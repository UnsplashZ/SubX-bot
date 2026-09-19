const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const logger = require('../utils/logger');
const config = require('../config');
const qqProviderRuntime = require('../providers/qq/runtime');
const { botOperationRegistry } = require('./runtime/botOperationRegistry');
const { detectImplementation, adaptAction } = require('../providers/qq/onebotCompatibility');

const TEMP_IMAGE_CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const TEMP_IMAGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1h
const NOTIFICATION_SCOPE = logger.createScope('svc', 'notification');

function normalizeSource(logPrefix = 'NotificationService') {
    return String(logPrefix || 'NotificationService').trim() || 'NotificationService';
}

function sendLog(level, message, fields = {}, scope = NOTIFICATION_SCOPE) {
    logger.logEvent(level, 'SEND', scope, message, fields);
}

function trackRuntimePromise(promise) {
    const context = botOperationRegistry.getContext()
    return context?.trackPromise ? context.trackPromise(promise) : promise
}

function getOfficialProvider(handle = null) {
    if (handle) {
        return String(handle.id || '').toLowerCase() === 'official' ? handle : null;
    }
    const provider = qqProviderRuntime.getCurrentProvider();
    if (String(provider?.id || '').toLowerCase() === 'official') {
        return provider;
    }
    return null;
}

function shouldUseOfficialTransport(handle = null) {
    return Boolean(getOfficialProvider(handle));
}

function getNapcatWebSocket(handle = null) {
    if (String(handle?.id || '').toLowerCase() === 'napcat' && handle.ws) {
        return handle.ws;
    }
    return handle;
}

/**
 * NotificationService - 统一的消息发送服务
 * 提供共享的消息发送逻辑，支持文本、图片等多种消息类型
 */
class NotificationService {
    static runWithSendContext(context, fn) {
        if (typeof fn !== 'function') return undefined;
        return this._sendContext.run(context || {}, fn);
    }

    static getSendContext() {
        return this._sendContext.getStore() || {};
    }

    static getOfficialSendMetadata(extra = {}) {
        const context = this.getSendContext();
        return {
            ...(context.official || {}),
            ...extra
        };
    }

    /**
     * 调用 OneBot Action，并等待带同一 echo 的响应
     * @param {WebSocket} ws - WebSocket连接实例
     * @param {string} action - OneBot action 名称
     * @param {Object} params - action 参数
     * @param {string} logPrefix - 日志前缀
     * @param {number} timeoutMs - 超时时间（毫秒）
     * @returns {Promise<Object>} - 原始 OneBot 响应 payload
     */
    static callAction(ws, action, params = {}, logPrefix = 'NotificationService', timeoutMs = 5000) {
        if (getOfficialProvider(ws) || !['_del_group_notice', 'get_group_ignored_notifies'].includes(action)) {
            return this._callActionRaw(ws, action, params, logPrefix, timeoutMs);
        }
        return trackRuntimePromise((async () => {
            const deadline = Date.now() + timeoutMs;
            const detection = detectImplementation(getNapcatWebSocket(ws),
                (probe, args) => this._callActionRaw(ws, probe, args, logPrefix, Math.min(timeoutMs, 3000)));
            let timer;
            let implementation;
            try {
                implementation = await Promise.race([detection, new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`Action timeout after ${timeoutMs}ms: ${action}`)), timeoutMs);
                })]);
            } finally { clearTimeout(timer); }
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error(`Action timeout after ${timeoutMs}ms: ${action}`);
            return this._callActionRaw(ws, adaptAction(implementation, action), params, logPrefix, remaining);
        })());
    }

    static _callActionRaw(ws, action, params = {}, logPrefix = 'NotificationService', timeoutMs = 5000) {
        const officialProvider = getOfficialProvider(ws);
        if (officialProvider) {
            return trackRuntimePromise(officialProvider.callAction(action, params, {
                ...this.getOfficialSendMetadata(params),
                source: normalizeSource(logPrefix),
                timeoutMs
            }));
        }

        ws = getNapcatWebSocket(ws);

        return trackRuntimePromise(new Promise((resolve, reject) => {
            if (!ws) {
                reject(new Error('WebSocket is not available'));
                return;
            }

            if (ws.readyState !== 1) {
                reject(new Error(`WebSocket is not open (readyState=${ws.readyState})`));
                return;
            }

            this._ensureActionDispatcher(ws);

            const pendingMap = this._actionPendingByWs.get(ws);
            let echo = `${action}#${Date.now()}#${Math.random().toString(36).slice(2, 10)}`;
            while (pendingMap.has(echo)) {
                echo = `${action}#${Date.now()}#${Math.random().toString(36).slice(2, 10)}`;
            }

            const timeoutId = setTimeout(() => {
                const pending = pendingMap.get(echo);
                if (!pending) return;
                pendingMap.delete(echo);
                pending.reject(new Error(`Action timeout after ${timeoutMs}ms: ${action}`));
            }, timeoutMs);

            pendingMap.set(echo, {
                action,
                resolve,
                reject,
                timeoutId
            });

            const payload = { action, params, echo };
            try {
                ws.send(JSON.stringify(payload), sendErr => {
                    if (!sendErr) {
                        sendLog('debug', 'action-sent', {
                            source: normalizeSource(logPrefix),
                            action,
                            echo
                        });
                        return;
                    }

                    const pending = pendingMap.get(echo);
                    if (!pending) return;

                    pendingMap.delete(echo);
                    clearTimeout(pending.timeoutId);
                    pending.reject(sendErr);
                });
            } catch (e) {
                const pending = pendingMap.get(echo);
                if (!pending) {
                    reject(e);
                    return;
                }

                pendingMap.delete(echo);
                clearTimeout(pending.timeoutId);
                pending.reject(e);
            }
        }));
    }

    static _ensureActionDispatcher(ws) {
        if (!this._actionPendingByWs.has(ws)) {
            this._actionPendingByWs.set(ws, new Map());
        }

        if (this._actionDispatcherByWs.has(ws)) {
            return;
        }

        const handleResponse = (raw) => {
            let messageText = '';
            try {
                messageText = typeof raw === 'string' ? raw : raw.toString('utf8');
            } catch {
                return;
            }

            let payload;
            try {
                payload = JSON.parse(messageText);
            } catch {
                return;
            }

            if (!payload || payload.echo === undefined || payload.echo === null) {
                return;
            }

            const pendingMap = this._actionPendingByWs.get(ws);
            if (!pendingMap) return;

            const pending = pendingMap.get(payload.echo);
            if (!pending) return;

            pendingMap.delete(payload.echo);
            clearTimeout(pending.timeoutId);
            pending.resolve(payload);
        };

        const rejectAllPending = (errorPrefix, err) => {
            const pendingMap = this._actionPendingByWs.get(ws);
            if (!pendingMap) return;

            for (const [echo, pending] of pendingMap.entries()) {
                pendingMap.delete(echo);
                clearTimeout(pending.timeoutId);
                pending.reject(new Error(`${errorPrefix}: ${pending.action}${err ? ` (${err?.message || err})` : ''}`));
            }
        };

        const handleClose = () => {
            rejectAllPending('WebSocket closed while waiting action response');
            this._actionDispatcherByWs.delete(ws);
            this._actionPendingByWs.delete(ws);
        };

        const handleError = (err) => {
            rejectAllPending('WebSocket error while waiting action response', err);
        };

        ws.on('message', handleResponse);
        ws.on('close', handleClose);
        ws.on('error', handleError);

        this._actionDispatcherByWs.set(ws, {
            handleResponse,
            handleClose,
            handleError
        });
    }

    /**
     * 获取图片临时目录（Bot 写入路径 + NapCat 读取路径）
     * @returns {{ hostTempDir: string, containerTempDir: string }}
     */
    static getImageTempDirs() {
        return {
            hostTempDir: config.napcatTempPath,
            containerTempDir: config.napcatReadPath
        };
    }

    /**
     * 启动图片临时文件清理任务（每小时执行一次，清理超过 24 小时的 .png）
     */
    static startTempImageCleanupScheduler() {
        if (this._tempImageCleanupTimer) return this._tempImageCleanupPromise;

        const runCleanup = async () => {
            const cleanupPromise = (async () => {
                try {
                    await this.cleanupExpiredTempImages();
                } catch (e) {
                    sendLog('error', 'temp-image-cleanup-failed', {
                        error: logger.getErrorMessage(e)
                    });
                }
            })();
            this._tempImageCleanupPromise = cleanupPromise;
            try {
                await cleanupPromise;
            } finally {
                if (this._tempImageCleanupPromise === cleanupPromise) {
                    this._tempImageCleanupPromise = null;
                }
            }
        };

        // 先执行一次，尽快清理历史残留
        runCleanup();

        this._tempImageCleanupTimer = setInterval(runCleanup, TEMP_IMAGE_CLEANUP_INTERVAL_MS);
        // 不阻止 Node 进程退出
        if (typeof this._tempImageCleanupTimer.unref === 'function') {
            this._tempImageCleanupTimer.unref();
        }
        sendLog('info', 'temp-image-cleanup-scheduler-started');
        return this._tempImageCleanupPromise;
    }

    /**
     * 停止图片临时文件清理任务（主要用于测试）
     */
    static async stopTempImageCleanupScheduler() {
        if (this._tempImageCleanupTimer) {
            clearInterval(this._tempImageCleanupTimer);
            this._tempImageCleanupTimer = null;
        }
        const pendingCleanup = this._tempImageCleanupPromise;
        if (pendingCleanup) await pendingCleanup;
    }

    static async stop() {
        await this.stopTempImageCleanupScheduler();
    }

    /**
     * 清理超过 24 小时的图片临时文件
     */
    static async cleanupExpiredTempImages() {
        if (this._tempImageCleanupRunning) return;
        this._tempImageCleanupRunning = true;

        try {
            const { hostTempDir } = this.getImageTempDirs();
            try {
                await fsPromises.access(hostTempDir);
            } catch {
                return;
            }

            const files = await fsPromises.readdir(hostTempDir);
            const now = Date.now();
            let deletedCount = 0;

            for (const file of files) {
                if (!file.endsWith('.png')) continue;
                const filePath = path.join(hostTempDir, file);

                try {
                    const stat = await fsPromises.stat(filePath);
                    if (!stat.isFile()) continue;

                    if (now - stat.mtimeMs > TEMP_IMAGE_CLEANUP_MAX_AGE_MS) {
                        await fsPromises.unlink(filePath);
                        deletedCount++;
                    }
                } catch (e) {
                    if (e.code !== 'ENOENT') {
                        sendLog('warn', 'temp-image-cleanup-file-failed', {
                            file,
                            error: logger.getErrorMessage(e)
                        });
                    }
                }
            }

            if (deletedCount > 0) {
                sendLog('info', 'temp-image-cleanup-complete', {
                    deletedCount
                });
            }
        } finally {
            this._tempImageCleanupRunning = false;
        }
    }

    /**
     * 保存Base64图片为文件
     * @param {string} base64Data - Base64编码的图片数据
     * @param {string} logPrefix - 日志前缀，用于标识调用来源
     * @returns {string} - 返回容器内的文件路径
     */
    static saveImageAsFile(base64Data, logPrefix = 'NotificationService') {
        try {
            // 使用共享目录，确保npm运行的bot和docker运行的napcat都能访问
            const { hostTempDir, containerTempDir } = this.getImageTempDirs();

            // 确保清理器已启动
            this.startTempImageCleanupScheduler();

            // 确保目录存在
            if (!fs.existsSync(hostTempDir)) {
                fs.mkdirSync(hostTempDir, { recursive: true });
                sendLog('info', 'temp-dir-created', {
                    source: normalizeSource(logPrefix),
                    path: hostTempDir
                });
            }

            // 生成唯一的文件名
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}.png`;
            const hostFilePath = path.join(hostTempDir, fileName); // 宿主机上的完整路径
            const containerFilePath = path.join(containerTempDir, fileName); // 容器内的路径

            // 将base64数据写入宿主机文件
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // 检查图片大小（以MB为单位）
            const imageSizeMB = imageBuffer.length / (1024 * 1024);
            sendLog('debug', 'temp-image-size', {
                source: normalizeSource(logPrefix),
                imageSizeMB: imageSizeMB.toFixed(2)
            });

            // 如果图片超过10MB，记录警告
            if (imageSizeMB > 10) {
                sendLog('warn', 'temp-image-large', {
                    source: normalizeSource(logPrefix),
                    imageSizeMB: imageSizeMB.toFixed(2)
                });
            }

            fs.writeFileSync(hostFilePath, imageBuffer);
            sendLog('info', 'temp-image-saved', {
                source: normalizeSource(logPrefix),
                path: hostFilePath,
                imageSizeMB: imageSizeMB.toFixed(2)
            });

            // 返回容器内的路径，这样napcat可以访问
            return containerFilePath;
        } catch (e) {
            sendLog('error', 'temp-image-save-failed', {
                source: normalizeSource(logPrefix),
                error: logger.getErrorMessage(e)
            });
            throw e;
        }
    }

    /**
     * 清理文本，移除可能导致编码问题的字符
     * @param {string} text - 待清理的文本
     * @returns {string} - 清理后的文本
     */
    static cleanText(text) {
        if (typeof text !== 'string') return text;

        try {
            // 移除零宽字符和其他可能导致问题的Unicode字符
            let cleaned = text
                .replace(/[\u200B-\u200D\uFEFF]/g, '') // 零宽字符
                .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '') // 控制字符
                .replace(/\uFFFD/g, ''); // 替换字符

            // 确保文本是有效的UTF-8
            // 尝试编码和解码来验证
            Buffer.from(cleaned, 'utf8');

            return cleaned;
        } catch (e) {
            sendLog('warn', 'text-clean-failed', {
                error: logger.getErrorMessage(e)
            });
            return text;
        }
    }

    /**
     * 处理消息链，处理图片等资源
     * @param {Array|string} message - 消息内容
     * @param {string} logPrefix - 日志前缀
     * @returns {Array} - 处理后的消息链
     */
    static processMessageChain(message, logPrefix, options = {}) {
        let messageChain;
        const officialTransport = options.officialTransport || shouldUseOfficialTransport(options.transport || null);
        // Check if message is an array (for mixed content like text + image)
        if (Array.isArray(message)) {
            // 处理图片消息，将base64图片转换为文件路径
            messageChain = message.map(item => {
                if (!officialTransport && item.type === 'image' && item.data.file && item.data.file.startsWith('base64://')) {
                    // 如果配置了直接发送 Base64，则不做转换
                    if (config.useBase64Send) {
                        return item;
                    }

                    const base64Data = item.data.file.substring(9); // 移除 'base64://' 前缀
                    const imagePath = this.saveImageAsFile(base64Data, logPrefix);
                    // 返回文件路径格式，让NapCat直接发送原图
                    return {
                        type: 'image',
                        data: {
                            file: `file://${imagePath}`
                        }
                    };
                } else if (item.type === 'text' && item.data.text) {
                    // 清理文本
                    return {
                        type: 'text',
                        data: {
                            text: this.cleanText(item.data.text)
                        }
                    };
                }
                return item;
            });
        } else {
            // If it's a string, wrap it in a text message object and clean it
            messageChain = [{ type: 'text', data: { text: this.cleanText(message) } }];
        }
        return messageChain;
    }

    /**
     * 发送群组消息
     * @param {WebSocket} ws - WebSocket连接实例
     * @param {string|number} groupId - 群组ID
     * @param {Array|string} message - 消息内容，可以是消息链数组或纯文本字符串
     * @param {string} logPrefix - 日志前缀，用于标识调用来源
     * @param {boolean} enableFallback - 是否启用失败回退（发送错误通知），默认为true
     */
    static sendGroupMessage(ws, groupId, message, logPrefix = 'NotificationService', enableFallback = true) {
        const officialProvider = getOfficialProvider(ws);
        if (officialProvider) {
            const messageChain = this.processMessageChain(message, logPrefix, {
                officialTransport: true,
                transport: officialProvider
            });
            sendLog('info', 'group-send-start', {
                source: normalizeSource(logPrefix),
                provider: 'official',
                groupId,
                chainLength: messageChain.length
            });
            return trackRuntimePromise(officialProvider.sendGroupMessage(groupId, messageChain, {
                ...this.getOfficialSendMetadata(),
                source: normalizeSource(logPrefix)
            }).then((result) => {
                sendLog('info', 'group-send-ok', {
                    source: normalizeSource(logPrefix),
                    provider: 'official',
                    groupId
                });
                return result;
            }).catch((e) => {
                sendLog('error', 'group-send-failed', {
                    source: normalizeSource(logPrefix),
                    provider: 'official',
                    groupId,
                    error: logger.getErrorMessage(e)
                });
                if (enableFallback) {
                    return officialProvider.sendGroupMessage(groupId, [{ type: 'text', data: { text: '消息发送失败，请查看日志' } }], {
                        ...this.getOfficialSendMetadata(),
                        source: normalizeSource(logPrefix)
                    }).catch((fallbackError) => {
                        sendLog('error', 'group-send-fallback-failed', {
                            source: normalizeSource(logPrefix),
                            provider: 'official',
                            groupId,
                            error: logger.getErrorMessage(fallbackError)
                        });
                        throw fallbackError;
                    });
                }
                throw e;
            }));
        }

        ws = getNapcatWebSocket(ws);

        if (!ws) {
            sendLog('warn', 'group-send-skipped', {
                source: normalizeSource(logPrefix),
                groupId,
                reason: 'ws_missing'
            });
            return;
        }

        try {
            const messageChain = this.processMessageChain(message, logPrefix, { transport: ws });

            const payload = {
                action: 'send_group_msg',
                params: {
                    group_id: groupId,
                    message: messageChain
                }
            };

            sendLog('info', 'group-send-start', {
                source: normalizeSource(logPrefix),
                groupId,
                chainLength: messageChain.length
            });
            sendLog('debug', 'group-send-payload', {
                source: normalizeSource(logPrefix),
                payloadPreview: JSON.stringify(payload, null, 2).substring(0, 500)
            });

            ws.send(JSON.stringify(payload));
            sendLog('info', 'group-send-ok', {
                source: normalizeSource(logPrefix),
                groupId
            });
            return { ok: true, status: 'ok', provider: 'napcat' };
        } catch (e) {
            sendLog('error', 'group-send-failed', {
                source: normalizeSource(logPrefix),
                groupId,
                error: logger.getErrorMessage(e),
                messagePreview: JSON.stringify(message, null, 2).substring(0, 500)
            });

            // 尝试发送简化的错误通知（仅在启用fallback时）
            if (enableFallback) {
                try {
                    const fallbackPayload = {
                        action: 'send_group_msg',
                        params: {
                            group_id: groupId,
                            message: [{ type: 'text', data: { text: '消息发送失败，请查看日志' } }]
                        }
                    };
                    ws.send(JSON.stringify(fallbackPayload));
                } catch (fallbackError) {
                    sendLog('error', 'group-send-fallback-failed', {
                        source: normalizeSource(logPrefix),
                        groupId,
                        error: logger.getErrorMessage(fallbackError)
                    });
                    throw fallbackError;
                }
                return { ok: false, status: 'failed', fallbackUsed: true, fallbackReason: 'send_failed' };
            }
            throw e;
        }
    }

    /**
     * 发送私聊消息
     * @param {WebSocket} ws - WebSocket连接实例
     * @param {string|number} userId - 用户ID
     * @param {Array|string} message - 消息内容
     * @param {string} logPrefix - 日志前缀
     * @param {boolean} enableFallback - 是否启用失败回退
     */
    static sendPrivateMessage(ws, userId, message, logPrefix = 'NotificationService', enableFallback = true) {
        const officialProvider = getOfficialProvider(ws);
        if (officialProvider) {
            const messageChain = this.processMessageChain(message, logPrefix, {
                officialTransport: true,
                transport: officialProvider
            });
            sendLog('info', 'private-send-start', {
                source: normalizeSource(logPrefix),
                provider: 'official',
                userId,
                chainLength: messageChain.length
            });
            return trackRuntimePromise(officialProvider.sendPrivateMessage(userId, messageChain, {
                ...this.getOfficialSendMetadata(),
                source: normalizeSource(logPrefix)
            }).then((result) => {
                sendLog('info', 'private-send-ok', {
                    source: normalizeSource(logPrefix),
                    provider: 'official',
                    userId
                });
                return result;
            }).catch((e) => {
                sendLog('error', 'private-send-failed', {
                    source: normalizeSource(logPrefix),
                    provider: 'official',
                    userId,
                    error: logger.getErrorMessage(e)
                });
                if (enableFallback) {
                    return officialProvider.sendPrivateMessage(userId, [{ type: 'text', data: { text: '消息发送失败，请查看日志' } }], {
                        ...this.getOfficialSendMetadata(),
                        source: normalizeSource(logPrefix)
                    }).catch((fallbackError) => {
                        sendLog('error', 'private-send-fallback-failed', {
                            source: normalizeSource(logPrefix),
                            provider: 'official',
                            userId,
                            error: logger.getErrorMessage(fallbackError)
                        });
                        throw fallbackError;
                    });
                }
                throw e;
            }));
        }

        ws = getNapcatWebSocket(ws);

        if (!ws) {
            sendLog('warn', 'private-send-skipped', {
                source: normalizeSource(logPrefix),
                userId,
                reason: 'ws_missing'
            });
            return;
        }

        try {
            const messageChain = this.processMessageChain(message, logPrefix, { transport: ws });

            const payload = {
                action: 'send_private_msg',
                params: {
                    user_id: userId,
                    message: messageChain
                }
            };

            sendLog('info', 'private-send-start', {
                source: normalizeSource(logPrefix),
                userId,
                chainLength: messageChain.length
            });
            sendLog('debug', 'private-send-payload', {
                source: normalizeSource(logPrefix),
                payloadPreview: JSON.stringify(payload, null, 2).substring(0, 500)
            });

            ws.send(JSON.stringify(payload));
            sendLog('info', 'private-send-ok', {
                source: normalizeSource(logPrefix),
                userId
            });
            return { ok: true, status: 'ok', provider: 'napcat' };
        } catch (e) {
            sendLog('error', 'private-send-failed', {
                source: normalizeSource(logPrefix),
                userId,
                error: logger.getErrorMessage(e)
            });

            if (enableFallback) {
                try {
                    const fallbackPayload = {
                        action: 'send_private_msg',
                        params: {
                            user_id: userId,
                            message: [{ type: 'text', data: { text: '消息发送失败，请查看日志' } }]
                        }
                    };
                    ws.send(JSON.stringify(fallbackPayload));
                } catch (fallbackError) {
                    sendLog('error', 'private-send-fallback-failed', {
                        source: normalizeSource(logPrefix),
                        userId,
                        error: logger.getErrorMessage(fallbackError)
                    });
                    throw fallbackError;
                }
                return { ok: false, status: 'failed', fallbackUsed: true, fallbackReason: 'send_failed' };
            }
            throw e;
        }
    }

    /**
     * 批量发送群组消息
     * @param {WebSocket} ws - WebSocket连接实例
     * @param {Array<string|number>} groupIds - 群组ID数组
     * @param {Array|string} message - 消息内容，可以是消息链数组或纯文本字符串
     * @param {string} logPrefix - 日志前缀，用于标识调用来源
     */
    static notifyGroups(ws, groupIds, message, logPrefix = 'NotificationService') {
        const officialProvider = getOfficialProvider(ws);
        if (officialProvider) {
            if (!Array.isArray(groupIds) || groupIds.length === 0) {
                sendLog('warn', 'notify-groups-skipped', {
                    source: normalizeSource(logPrefix),
                    provider: 'official',
                    reason: 'no_groups'
                });
                return Promise.resolve([]);
            }
            return Promise.allSettled(groupIds.map(gid => Promise.resolve().then(() => (
                this.sendGroupMessage(officialProvider, gid, message, logPrefix, false)
            ))));
        }

        if (!ws) {
            sendLog('warn', 'notify-groups-skipped', {
                source: normalizeSource(logPrefix),
                reason: 'ws_missing'
            });
            return Promise.resolve([]);
        }

        if (!Array.isArray(groupIds) || groupIds.length === 0) {
            sendLog('warn', 'notify-groups-skipped', {
                source: normalizeSource(logPrefix),
                reason: 'no_groups'
            });
            return Promise.resolve([]);
        }

        return Promise.allSettled(groupIds.map(gid => Promise.resolve().then(() => {
            // 调用单个消息发送方法，禁用fallback以避免在批量通知时发送过多错误消息
            return this.sendGroupMessage(ws, gid, message, logPrefix, false);
        })));
    }
}

NotificationService._tempImageCleanupTimer = null;
NotificationService._tempImageCleanupRunning = false;
NotificationService._tempImageCleanupPromise = null;
NotificationService._actionPendingByWs = new WeakMap();
NotificationService._actionDispatcherByWs = new WeakMap();
NotificationService._sendContext = new AsyncLocalStorage();
module.exports = NotificationService;
