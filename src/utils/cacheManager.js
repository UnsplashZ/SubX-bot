const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const config = require('../config');

function storeLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:cache', message, fields);
}

class CacheManager {
    constructor() {
        this.cacheDir = path.resolve(process.cwd(), 'data', 'cache');
        this.maxSize = 1024 * 1024 * 1024; // 1GB
        this.initPromise = this.init();
    }

    async init() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            storeLog('error', 'cache-init-failed', {
                error: logger.getErrorMessage(error)
            });
        }
    }

    /**
     * Get data from cache
     * @param {string} key - Cache key
     * @returns {Promise<object|null>} - Cached data or null
     */
    async get(key) {
        await this.initPromise;
        try {
            const filePath = path.join(this.cacheDir, `${key}.json`);
            const stats = await fs.stat(filePath);
            const raw = await fs.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            const fetchedAtMs = this._resolveFetchedAtMs(parsed, stats);
            const ageSeconds = fetchedAtMs ? (Date.now() - fetchedAtMs) / 1000 : 0;

            const ttl = parsed?.__cacheMeta?.ttlSeconds ?? config.dataCacheTTL
            if (ttl && fetchedAtMs && ageSeconds > ttl) {
                storeLog('info', 'cache-expired', {
                    key,
                    ageSeconds: ageSeconds.toFixed(0)
                });
                await fs.unlink(filePath);
                return null;
            }

            return this._unwrapEntry(parsed);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                storeLog('error', 'cache-read-failed', {
                    key,
                    error: logger.getErrorMessage(error)
                });
            }
            return null;
        }
    }

    /**
     * Save data to cache
     * @param {string} key - Cache key
     * @param {object} data - Data to cache
     * @param {number} [ttlSeconds] - 可选的 per-key TTL（秒）；不传则回退到全局 config.dataCacheTTL
     */
    async set(key, data, ttlSeconds) {
        await this.initPromise;
        try {
            const filePath = path.join(this.cacheDir, `${key}.json`);
            const wrapped = {
                __cacheMeta: {
                    fetchedAt: Date.now(),
                    // 只有显式传入时才写入，undefined 不写入
                    ...(ttlSeconds != null ? { ttlSeconds } : {})
                },
                payload: data
            };
            await fs.writeFile(filePath, JSON.stringify(wrapped));
            // Trigger cleanup asynchronously
            this.checkSizeAndCleanup().catch(err => {
                storeLog('error', 'cache-cleanup-failed', {
                    error: logger.getErrorMessage(err)
                });
            });
        } catch (error) {
            storeLog('error', 'cache-write-failed', {
                key,
                error: logger.getErrorMessage(error)
            });
        }
    }

    /**
     * Check cache size and remove oldest files if limit exceeded
     */
    async checkSizeAndCleanup() {
        try {
            const files = await fs.readdir(this.cacheDir);
            let totalSize = 0;
            const fileStats = [];

            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                const filePath = path.join(this.cacheDir, file);
                try {
                    const stats = await fs.stat(filePath);
                    totalSize += stats.size;
                    fileStats.push({ path: filePath, mtime: stats.mtime, size: stats.size });
                } catch (e) {
                    // File might be deleted or inaccessible
                }
            }

            if (totalSize > this.maxSize) {
                // Sort by mtime ascending (oldest first)
                fileStats.sort((a, b) => a.mtime - b.mtime);

                let currentSize = totalSize;
                let deletedCount = 0;
                
                for (const file of fileStats) {
                    if (currentSize <= this.maxSize) break;
                    
                    try {
                        await fs.unlink(file.path);
                        currentSize -= file.size;
                        deletedCount++;
                    } catch (e) {
                        storeLog('warn', 'cache-delete-failed', {
                            filePath: file.path,
                            error: logger.getErrorMessage(e)
                        });
                    }
                }
                
                if (deletedCount > 0) {
                    storeLog('info', 'cache-cleanup-complete', {
                        deletedCount,
                        totalSizeBytes: totalSize,
                        remainingSizeBytes: currentSize
                    });
                }
            }
        } catch (error) {
            storeLog('error', 'cache-cleanup-failed', {
                error: logger.getErrorMessage(error)
            });
        }
    }

    _isWrappedEntry(value) {
        return Boolean(
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            value.__cacheMeta &&
            typeof value.__cacheMeta === 'object' &&
            typeof value.__cacheMeta.fetchedAt === 'number' &&
            Object.prototype.hasOwnProperty.call(value, 'payload')
        );
    }

    _resolveFetchedAtMs(parsed, stats) {
        if (this._isWrappedEntry(parsed)) {
            return parsed.__cacheMeta.fetchedAt;
        }
        return stats?.mtimeMs || 0;
    }

    _unwrapEntry(parsed) {
        if (this._isWrappedEntry(parsed)) {
            return parsed.payload;
        }
        return parsed;
    }
}

module.exports = new CacheManager();
