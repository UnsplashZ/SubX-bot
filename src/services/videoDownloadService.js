const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const fsPromises = require('fs').promises
const biliApi = require('./biliApi')
const notificationService = require('./notificationService')
const logger = require('../utils/logger')
const config = require('../config')
const runtimeMetricsService = require('./runtimeMetricsService')
const subscriptionDeliveryStore = require('./subscription/subscriptionDeliveryStore')
const { OperationRegistry } = require('./runtime/operationRegistry')
const { botOperationRegistry } = require('./runtime/botOperationRegistry')
const qqRuntime = require('../providers/qq/runtime')
const {
    isVideoDownloadEnabledForGroup,
    getVideoDownloadResolutionForGroup,
    getVideoDownloadMaxDurationForGroup,
} = require('../config')
const {
    canReceiveSubscriptionVideoDownload
} = require('./subscription/updateChecker/helpers/groupReachability')
const {
    isOfficialTransport,
    isQqTransportReady
} = require('../providers/qq/readiness')

function toNapcatReadablePath(filePath, paths) {
    if (!filePath) return filePath
    const absFilePath = path.resolve(filePath)
    if (absFilePath === paths.writeBase || absFilePath.startsWith(paths.writeBase + path.sep)) {
        const relative = path.relative(paths.writeBase, absFilePath)
        return path.join(paths.readBase, relative)
    }
    sendLog('warn', 'path-outside-shared-base', {
        filePath
    })
    return filePath
}

function toFileUrlPath(filePath) {
    return String(filePath).replace(/\\/g, '/')
}

// 每群最近下载的视频信息，用于支持 /下载 P2 命令
// Map<groupId, { bvid, title, owner, totalPages, pageIndex }>
const lastDownloadInfo = new Map()

const MAX_CONCURRENT_DOWNLOADS = 3

// 正在下载中的任务 key 集合，防止同一视频被 linkHandler 和 updateChecker 重复触发
const _inProgressDownloads = new Set()

// 下载分辨率排序（从低到高），用于订阅扇出时取最高分辨率
const RESOLUTION_ORDER = ['360p', '480p', '720p', '1080p', '1080p+']

// 单次下载兜底超时：330s（高于 axios 300s，确保 _activeDownloads 配额最终释放）
const DOWNLOAD_TIMEOUT_MS = 330 * 1000

const DOWNLOAD_SCOPE = logger.createScope('svc', 'download')

function sendLog(level, message, fields = {}, scope = DOWNLOAD_SCOPE) {
    logger.logEvent(level, 'SEND', scope, message, fields)
}

class VideoDownloadService {
    constructor() {
        this._cleanupTimer = null
        this._activeDownloads = 0
        this._cleanupTimeouts = new Set()
        this._unconfirmedTasks = new Map()
        this.operationRegistry = new OperationRegistry({ name: 'download' })
        this.pathGeneration = 1
        this.currentPaths = this.resolvePaths()
    }

    resolvePaths(snapshot = config) {
        const writeBase = path.resolve(String(snapshot.napcatTempPath || snapshot.paths?.napcatTemp || '/app/.config/QQ/tmp/'))
        const readBase = path.resolve(String(snapshot.napcatReadPath || snapshot.paths?.napcatRead || writeBase))
        return Object.freeze({
            writeBase,
            readBase,
            downloadsDir: path.join(writeBase, 'downloads')
        })
    }

    createTaskContext(ws) {
        const parent = botOperationRegistry.getContext()
        let providerLease = parent?.providerSlotLease || null
        let ownsProviderLease = false
        if (!providerLease) {
            try {
                providerLease = qqRuntime.acquireProviderLease()
                ownsProviderLease = true
            } catch {
                providerLease = null
            }
        }
        return {
            taskId: crypto.randomUUID(),
            generation: this.pathGeneration,
            paths: this.currentPaths,
            transport: providerLease?.provider || ws,
            providerSlotLease: providerLease,
            providerGeneration: providerLease?.generation ?? parent?.providerGeneration ?? null,
            abortSignal: parent?.abortSignal || null,
            pythonRuntime: biliApi.getRuntimeStatus?.() || null,
            ownsProviderLease
        }
    }

    runDownloadTask(kind, ws, fn) {
        const task = this.createTaskContext(ws)
        const promise = this.operationRegistry.run(kind, () => fn(task), task)
            .finally(() => {
                if (task.ownsProviderLease) task.providerSlotLease?.release?.()
            })
        botOperationRegistry.getContext()?.trackPromise?.(promise)
        return promise
    }

    rememberUnconfirmedTask(taskContext) {
        this._unconfirmedTasks.set(taskContext.taskId, {
            instanceId: taskContext.pythonRuntime?.instanceId || null,
            generation: taskContext.generation,
            createdAt: Date.now()
        })
    }

    async reconcileUnconfirmedTasks() {
        for (const [taskId, task] of this._unconfirmedTasks) {
            const runtime = biliApi.getRuntimeStatus?.() || {}
            if (!runtime.running || (task.instanceId && runtime.instanceId !== task.instanceId)) {
                this._unconfirmedTasks.delete(taskId)
                continue
            }
            try {
                const status = await biliApi.getDownloadTaskStatus(taskId)
                if (status?.terminal) {
                    this._unconfirmedTasks.delete(taskId)
                    continue
                }
            } catch {
                // Keep the task unresolved while the same Python instance is alive.
            }
            const error = new Error(`Download task terminal state is unconfirmed: ${taskId}`)
            error.code = 'DOWNLOAD_TASK_TERMINAL_UNCONFIRMED'
            throw error
        }
    }

    _taskScope(groupId, bvid, pageIndex = 0) {
        return logger.createScope('task', 'download', groupId || 'unknown', bvid || 'unknown', pageIndex + 1)
    }

    _notifyTarget(ws, groupId, messageChain, enableFallback = false) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '')
            if (!realUserId) {
                sendLog('warn', 'notify-skipped', {
                    groupId,
                    reason: 'invalid_private_group'
                })
                return Promise.resolve(false)
            }
            return notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'VideoDownload', enableFallback)
        }
        return notificationService.sendGroupMessage(ws, groupId, messageChain, 'VideoDownload', enableFallback)
    }

    /**
     * 启动定时清理任务（每小时检查一次）
     */
    startCleanupScheduler() {
        if (this._cleanupTimer) return
        this._cleanupTimer = setInterval(() => {
            this._cleanupOldFiles().catch(e => {
                sendLog('error', 'cleanup-failed', {
                    error: logger.getErrorMessage(e)
                })
            })
        }, 60 * 60 * 1000)
        sendLog('info', 'cleanup-scheduler-started')
    }

    /**
     * 清理超过 videoDownloadCleanTimeout 小时的下载文件
     */
    async _cleanupOldFiles() {
        const downloadsDir = this.currentPaths.downloadsDir
        try {
            await fsPromises.access(downloadsDir)
        } catch {
            return // 目录不存在，无需清理
        }
        try {
            // 最小 1 小时，防止 cleanTimeout=0 导致所有文件被立即删除
            const cleanTimeout = Math.max(config.videoDownloadCleanTimeout || 24, 1)
            const maxAgeMs = cleanTimeout * 60 * 60 * 1000
            const now = Date.now()
            const files = await fsPromises.readdir(downloadsDir)
            for (const file of files) {
                if (!file.endsWith('.mp4') && !file.endsWith('.tmp')) continue
                const filePath = path.join(downloadsDir, file)
                try {
                    const stat = await fsPromises.stat(filePath)
                    if (now - stat.mtimeMs > maxAgeMs) {
                        await fsPromises.unlink(filePath)
                        sendLog('info', 'cleanup-file-removed', {
                            fileName: file
                        })
                    }
                } catch (e) {
                    sendLog('warn', 'cleanup-file-skipped', {
                        fileName: file,
                        error: logger.getErrorMessage(e)
                    })
                }
            }
        } catch (e) {
            sendLog('error', 'cleanup-failed', {
                error: logger.getErrorMessage(e)
            })
        }
    }

    /**
     * 删除单个文件（发送后清理）
     */
    async cleanupFile(filePath) {
        try {
            await fsPromises.access(filePath)
            await fsPromises.unlink(filePath)
            sendLog('info', 'cleanup-file-deleted', {
                filePath
            })
        } catch (e) {
            if (e.code !== 'ENOENT') {
                sendLog('error', 'cleanup-file-delete-failed', {
                    filePath,
                    error: logger.getErrorMessage(e)
                })
            }
        }
    }

    /**
     * 根据文件大小和群数量动态延迟清理：基础 60s + 每 100MB 额外 60s，上限 10 分钟
     * groupCount 为扇出群数量，延迟按群数量系数放大（上限 30 分钟）
     */
    _scheduleCleanup(filePath, groupCount = 1, generation = this.pathGeneration) {
        if (!config.videoDownloadAutoClean || !filePath) return
        const absoluteFilePath = path.resolve(filePath)
        const schedule = (delay) => {
            const timer = setTimeout(() => {
                this._cleanupTimeouts.delete(timer)
                this.cleanupFile(absoluteFilePath)
            }, delay)
            timer.unref?.()
            this._cleanupTimeouts.add(timer)
            return timer
        }
        let delayMs = 60 * 1000
        // 异步读取文件大小，不阻塞当前调用
        fsPromises.stat(filePath).then(stat => {
            const extraDelay = Math.floor(stat.size / (100 * 1024 * 1024)) * 60 * 1000
            delayMs = Math.min(delayMs + extraDelay, 10 * 60 * 1000)
            const groupFactor = Math.max(1, Math.ceil(groupCount / 2))
            const adjustedDelay = Math.min(delayMs * groupFactor, 30 * 60 * 1000)
            schedule(adjustedDelay)
        }).catch(() => {
            // 无法获取大小时使用默认值（含群数量系数）
            const groupFactor = Math.max(1, Math.ceil(groupCount / 2))
            const adjustedDelay = Math.min(delayMs * groupFactor, 30 * 60 * 1000)
            schedule(adjustedDelay)
        })
    }

    /**
     * 计算当前下载目标的有效时长（优先分P，其次总时长）
     * @param {object} videoInfo
     * @param {number} pageIndex
     * @returns {number} 秒
     */
    _getEffectiveDuration(videoInfo, pageIndex = 0) {
        const pages = videoInfo?.data?.pages
        if (Array.isArray(pages) && pages.length > 0) {
            const idx = Number(pageIndex)
            if (Number.isInteger(idx) && idx >= 0 && idx < pages.length) {
                const pageDuration = Number(pages[idx]?.duration)
                if (Number.isFinite(pageDuration) && pageDuration > 0) return pageDuration
            }
        }

        const totalDuration = Number(videoInfo?.data?.duration)
        if (Number.isFinite(totalDuration) && totalDuration > 0) return totalDuration

        return 0
    }

    /**
     * 主入口：检查配置 → 下载 → 发送
     * @param {WebSocket} ws
     * @param {string} groupId
     * @param {string} bvid
     * @param {object} videoInfo - 已有的视频信息（来自 getVideoInfo，含 data.duration 等）
     * @param {number} pageIndex - 分P索引（0-based），默认 0
     */
    downloadAndSend(ws, groupId, bvid, videoInfo, pageIndex = 0) {
        return this.runDownloadTask(
            `single:${groupId}:${bvid}:${pageIndex}`,
            ws,
            (taskContext) => this._downloadAndSend(taskContext, groupId, bvid, videoInfo, pageIndex)
        )
    }

    async _downloadAndSend(taskContext, groupId, bvid, videoInfo, pageIndex = 0) {
        const metricStartedAt = Date.now()
        const finishMetric = (result) => {
            runtimeMetricsService.record('videoDownload', {
                ok: Boolean(result?.ok || result?.silent),
                durationMs: Date.now() - metricStartedAt,
                latest: result?.reason || (result?.ok ? bvid : '失败')
            })
            return result
        }
        if (!isVideoDownloadEnabledForGroup(groupId)) return finishMetric({ ok: false, reason: 'disabled', silent: true })
        const taskScope = this._taskScope(groupId, bvid, pageIndex)
        const startedAt = Date.now()

        // 去重：避免 linkHandler 和 updateChecker 同时触发相同视频的重复下载
        const downloadKey = `${String(groupId)}:${bvid}:${pageIndex}`
        if (_inProgressDownloads.has(downloadKey)) {
            sendLog('info', 'download-skipped', {
                groupId,
                bvid,
                pageIndex,
                reason: 'duplicate'
            }, taskScope)
            return finishMetric({ ok: false, reason: 'duplicate', silent: true })
        }

        // 并发限制
        if (this._activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            sendLog('warn', 'download-skipped', {
                groupId,
                bvid,
                pageIndex,
                reason: 'max_concurrent',
                maxConcurrent: MAX_CONCURRENT_DOWNLOADS
            }, taskScope)
            await this._notifyTarget(taskContext.transport, groupId, [
                { type: 'text', data: { text: `⏳ 当前下载任务已满（最多 ${MAX_CONCURRENT_DOWNLOADS} 个），${bvid} 跳过下载` } }
            ], false)
            return finishMetric({ ok: false, reason: 'max_concurrent', silent: true })
        }

        const duration = this._getEffectiveDuration(videoInfo, pageIndex)
        const maxDuration = getVideoDownloadMaxDurationForGroup(groupId)

        // 时长超限：发送独立提示消息，不下载
        if (maxDuration > 0 && duration > maxDuration) {
            const durationMin = Math.round(duration / 60)
            const limitMin = Math.round(maxDuration / 60)
            await this._notifyTarget(taskContext.transport, groupId, [
                { type: 'text', data: { text: `⚠️ 视频时长 ${durationMin} 分钟，超出当前限制（${limitMin} 分钟），已跳过下载` } }
            ], false)
            return finishMetric({ ok: false, reason: 'duration_exceeded', silent: true })
        }

        // 磁盘空间预检（目录超过 5GB 时跳过）
        if (!await this._hasDiskSpace(taskContext.paths)) {
            sendLog('warn', 'download-skipped', {
                groupId,
                bvid,
                pageIndex,
                reason: 'disk_space_full'
            }, taskScope)
            await this._notifyTarget(taskContext.transport, groupId, [
                { type: 'text', data: { text: '⚠️ 下载目录空间不足（超过 5GB），已跳过下载。可使用 /清理下载 释放空间' } }
            ], false)
            return finishMetric({ ok: false, reason: 'disk_space_full', silent: true })
        }

        const resolution = getVideoDownloadResolutionForGroup(groupId)

        logger.logEvent('info', 'SEND', taskScope, 'download-start', {
            groupId,
            bvid,
            pageIndex,
            resolution
        })

        // 提前写入最近下载记录（供 /下载 P2 使用），避免下载期间竞态
        const gid = String(groupId)
        lastDownloadInfo.set(gid, {
            bvid,
            title: videoInfo?.data?.title ?? bvid,
            owner: videoInfo?.data?.owner?.name ?? 'Unknown',
            totalPages: videoInfo?.data?.pages?.length ?? 1,
            pageIndex,
        })

        // 构建元信息传递给 Python，避免重复调用 v.get_info()
        const meta = videoInfo?.data ? {
            title: videoInfo.data.title,
            owner: videoInfo.data.owner?.name ?? 'Unknown',
            duration: videoInfo.data.duration ?? 0,
            total_pages: videoInfo.data.pages?.length ?? 1,
        } : null

        this._activeDownloads++
        _inProgressDownloads.add(downloadKey)
        let result
        try {
            result = await biliApi.downloadVideo(bvid, pageIndex, resolution, groupId, meta, {
                taskId: taskContext.taskId,
                signal: taskContext.abortSignal,
                timeoutMs: DOWNLOAD_TIMEOUT_MS
            })
        } catch (e) {
            sendLog('error', 'download-fail', {
                groupId,
                bvid,
                pageIndex,
                error: logger.getErrorMessage(e)
            }, taskScope)
            return finishMetric({ ok: false, reason: e.message })
        } finally {
            this._activeDownloads--
            _inProgressDownloads.delete(downloadKey)
        }

        if (result.status !== 'success') {
            if (result.terminalConfirmed === false) this.rememberUnconfirmedTask(taskContext)
            sendLog('warn', 'download-fail', {
                groupId,
                bvid,
                pageIndex,
                error: result.message,
                errorType: result.errorType,
                failureKind: result.failureKind,
                httpStatus: result.httpStatus,
                biliCode: result.biliCode,
                retryable: result.retryable,
                reason: result.reason
            }, taskScope)
            return finishMetric({ ok: false, reason: result.message })
        }

        const sent = await this._sendForwardMessage(taskContext.transport, groupId, result, taskScope, taskContext.paths)

        // ws.send() 只是将 JSON 指令推入 WebSocket 缓冲区，NapCat 收到后才异步读取文件上传。
        // 必须延迟删除，给 NapCat 足够时间读取本地文件，而不是立即删除。
        if (sent) {
            this._scheduleCleanup(result.file_path, 1, taskContext.generation)
        } else {
            sendLog('warn', 'cleanup-deferred', {
                groupId,
                bvid,
                pageIndex,
                reason: 'video_send_failed',
                filePath: result.file_path
            }, taskScope)
        }

        // 多P提示（仅首P触发时发送）
        if (sent && result.total_pages > 1 && pageIndex === 0) {
            await this._notifyTarget(taskContext.transport, groupId, [
                { type: 'text', data: { text: `📺 当前视频共 ${result.total_pages}P，已下载第 1P\n回复 /下载 P2 可继续下载其他分集` } }
            ], false)
        }

        sendLog('info', 'download-ok', {
            groupId,
            bvid,
            pageIndex,
            sent,
            durationMs: Date.now() - startedAt
        }, taskScope)
        return finishMetric({ ok: sent, reason: sent ? 'sent' : 'send_failed' })
    }

    /**
     * 发送视频消息（群聊/私聊均使用普通消息）
     * @returns {boolean} 是否发送成功
     */
    async _sendForwardMessage(ws, groupId, result, scope = DOWNLOAD_SCOPE, paths = this.currentPaths, onFailure = null) {
        const activeWs = ws
        const isOfficialProvider = isOfficialTransport(activeWs)
        if (!isQqTransportReady(activeWs)) {
            sendLog('warn', 'video-send-skipped', {
                groupId,
                title: result.title,
                reason: 'transport_not_ready'
            }, scope)
            return false
        }

        const videoFilePath = isOfficialProvider
            ? result.file_path
            : toNapcatReadablePath(result.file_path, paths)
        const videoFile = `file://${toFileUrlPath(videoFilePath)}`

        // 私聊虚拟群场景
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '')
            if (!realUserId) {
                sendLog('warn', 'video-send-skipped', {
                    groupId,
                    reason: 'invalid_private_group'
                }, scope)
                return false
            }
        try {
            const response = await notificationService.sendPrivateMessage(activeWs, realUserId, [
                { type: 'text', data: { text: `「${result.title}」- ${result.owner}` } },
                { type: 'video', data: { file: videoFile } }
            ], 'VideoDownload', false)
            if (response?.fallbackUsed || response?.ok === false) {
                sendLog('warn', 'video-send-fallback-used', {
                    userId: realUserId,
                    title: result.title,
                    targetType: 'private',
                    reason: response.fallbackReason || 'media_fallback'
                }, scope)
                return false
            }
            sendLog('info', 'video-sent', {
                userId: realUserId,
                title: result.title,
                    targetType: 'private'
                }, scope)
                return true
            } catch (e) {
                onFailure?.(e)
                sendLog('error', 'video-send-failed', {
                    userId: realUserId,
                    title: result.title,
                    targetType: 'private',
                    error: logger.getErrorMessage(e)
                }, scope)
                return false
            }
        }

        const numericGroupId = Number(groupId)
        if (!isOfficialProvider && !Number.isFinite(numericGroupId)) {
            sendLog('warn', 'video-send-skipped', {
                groupId,
                reason: 'invalid_group'
            }, scope)
            return false
        }

        try {
            const response = await notificationService.sendGroupMessage(activeWs, isOfficialProvider ? String(groupId) : numericGroupId, [
                { type: 'text', data: { text: `「${result.title}」- ${result.owner}` } },
                { type: 'video', data: { file: videoFile } }
            ], 'VideoDownload', false)
            if (response?.fallbackUsed || response?.ok === false) {
                sendLog('warn', 'video-send-fallback-used', {
                    groupId,
                    title: result.title,
                    targetType: 'group',
                    reason: response.fallbackReason || 'media_fallback'
                }, scope)
                return false
            }
            sendLog('info', 'video-sent', {
                groupId,
                title: result.title,
                targetType: 'group'
            }, scope)
            return true
        } catch (e) {
            onFailure?.(e)
            sendLog('error', 'video-send-failed', {
                groupId,
                title: result.title,
                targetType: 'group',
                error: logger.getErrorMessage(e)
            }, scope)
            return false
        }
    }

    /**
     * 检查下载目录大小是否超过 5GB 上限
     */
    async _hasDiskSpace(paths = this.currentPaths) {
        const downloadsDir = paths.downloadsDir
        try {
            await fsPromises.access(downloadsDir)
        } catch {
            return true // 目录不存在，视为有空间
        }
        try {
            let totalSize = 0
            const files = await fsPromises.readdir(downloadsDir)
            for (const f of files) {
                if (!f.endsWith('.mp4') && !f.endsWith('.tmp')) continue
                try {
                    const stat = await fsPromises.stat(path.join(downloadsDir, f))
                    totalSize += stat.size
                } catch { /* skip */ }
            }
            return totalSize < 5 * 1024 * 1024 * 1024 // 5GB
        } catch {
            return true
        }
    }

    /**
     * 获取群最近的下载信息（供命令使用）
     */
    getLastDownloadInfo(groupId) {
        return lastDownloadInfo.get(String(groupId)) || null
    }

    /**
     * 获取下载目录状态（供 /下载状态 命令使用）
     */
    async getDownloadStats() {
        const downloadsDir = this.currentPaths.downloadsDir
        try {
            await fsPromises.access(downloadsDir)
        } catch {
            return { count: 0, totalSizeMB: 0 }
        }
        try {
            const allFiles = await fsPromises.readdir(downloadsDir)
            const files = allFiles.filter(f => f.endsWith('.mp4'))
            let totalSize = 0
            for (const f of files) {
                try {
                    const stat = await fsPromises.stat(path.join(downloadsDir, f))
                    totalSize += stat.size
                } catch { /* skip */ }
            }
            return { count: files.length, totalSizeMB: Math.round(totalSize / 1024 / 1024) }
        } catch {
            return { count: 0, totalSizeMB: 0 }
        }
    }

    /**
     * 下载视频一次，发送到多个群（用于订阅扇出场景）
     * 按群独立过滤时长限制，取所有目标群中最高的分辨率下载
     */
    downloadAndSendToGroups(ws, groupIds, bvid, videoInfo, pageIndex = 0, options = {}) {
        return this.runDownloadTask(
            `subscription:${bvid}:${pageIndex}`,
            ws,
            async (taskContext) => {
                let result = await this._downloadAndSendToGroups(taskContext, groupIds, bvid, videoInfo, pageIndex, options)
                const attemptedGroups = result?.attemptedGroups || []
                const sentGroups = [...(result?.sentGroups || [])]
                // QQ can reject large Highway uploads. Step down only for the
                // explicit rejection, retaining acknowledged groups and bounded retries.
                for (const resolution of ['720p', '480p', '360p']) {
                    if (!result?.uploadRejectedGroups?.length) break
                    if (RESOLUTION_ORDER.indexOf(resolution) >= RESOLUTION_ORDER.indexOf(result.resolution)) continue
                    sendLog('warn', 'video-upload-resolution-retry', { bvid, resolution, groupCount: result.uploadRejectedGroups.length })
                    const retryResult = await this._downloadAndSendToGroups(taskContext, result.uploadRejectedGroups, bvid, videoInfo, pageIndex, {
                        ...options, resolutionLimit: resolution
                    })
                    if (!retryResult) break
                    result = retryResult
                    sentGroups.push(...(result?.sentGroups || []))
                }
                return result ? { ...result, ok: sentGroups.length > 0, sentGroups: [...new Set(sentGroups)], attemptedGroups } : result
            }
        )
    }

    async _downloadAndSendToGroups(taskContext, groupIds, bvid, videoInfo, pageIndex = 0, options = {}) {
        const metricStartedAt = Date.now()
        const finishMetric = (ok, latest) => {
            runtimeMetricsService.record('videoDownload', {
                ok,
                durationMs: Date.now() - metricStartedAt,
                latest
            })
        }
        if (options.recordDelivery) {
            groupIds = await subscriptionDeliveryStore.getUndeliveredGroups(
                groupIds, options.contentType || 'video', String(options.contentId || bvid), options.deliveryPart || 'auto-download'
            )
        }
        const recordStatus = async (groups, status, reason = '') => {
            if (!options.recordDelivery || groups.length === 0) return
            await subscriptionDeliveryStore.recordDeliveryBatch(groups.map(groupId => ({
                groupId: String(groupId),
                type: options.contentType || 'video',
                contentId: String(options.contentId || bvid),
                deliveryPart: options.deliveryPart || 'auto-download',
                status,
                meta: { source: 'videoDownloadService', reason }
            })))
        }
        const enabledGroups = groupIds.filter(gid => canReceiveSubscriptionVideoDownload(gid))
        await recordStatus(groupIds.filter(gid => !enabledGroups.includes(gid)), 'skipped', 'download_disabled')
        if (enabledGroups.length === 0) {
            finishMetric(true, '无目标')
            return
        }

        const downloadKey = `subscription:${bvid}:${pageIndex}`
        const taskScope = logger.createScope('task', 'subscription-download', bvid || 'unknown', pageIndex + 1)

        // Mark attempts before any transient capacity/disk guard so the next poll can retry them.
        const duration = this._getEffectiveDuration(videoInfo, pageIndex)
        const filteredGroups = enabledGroups.filter(gid => {
            const maxDur = getVideoDownloadMaxDurationForGroup(gid)
            return maxDur === 0 || duration <= maxDur
        })
        await recordStatus(enabledGroups.filter(gid => !filteredGroups.includes(gid)), 'skipped', 'duration_exceeded')

        if (_inProgressDownloads.has(downloadKey)) {
            sendLog('info', 'download-skipped', {
                bvid,
                pageIndex,
                reason: 'duplicate_subscription'
            }, taskScope)
            finishMetric(true, 'duplicate_subscription')
            return
        }

        await recordStatus(filteredGroups, 'pending')

        // Ledger persistence yields; another task may acquire the same key meanwhile.
        if (_inProgressDownloads.has(downloadKey)) return

        if (this._activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            sendLog('warn', 'download-skipped', {
                bvid,
                pageIndex,
                reason: 'max_concurrent',
                maxConcurrent: MAX_CONCURRENT_DOWNLOADS
            }, taskScope)
            finishMetric(true, 'max_concurrent')
            return
        }

        // 按群独立过滤：只向时长限制内的群发送
        if (filteredGroups.length === 0) {
            sendLog('info', 'download-skipped', {
                bvid,
                pageIndex,
                reason: 'duration_exceeded_all_groups',
                durationMinutes: Math.round(duration / 60)
            }, taskScope)
            finishMetric(true, 'duration_exceeded_all_groups')
            return
        }

        this._activeDownloads++
        _inProgressDownloads.add(downloadKey)
        try {
            if (!await this._hasDiskSpace(taskContext.paths)) {
                sendLog('warn', 'download-skipped', {
                    bvid,
                    pageIndex,
                    reason: 'disk_space_full'
                }, taskScope)
                const rootAdminQQ = config.getRootAdminQQ()
                const notifyTransport = taskContext.transport
                if (rootAdminQQ && isQqTransportReady(notifyTransport)) {
                    await notificationService.sendPrivateMessage(notifyTransport, rootAdminQQ, [
                        { type: 'text', data: { text: `⚠️ 下载目录空间不足（超过 5GB），已跳过订阅视频 ${bvid} 的下载。可使用 /清理下载 释放空间` } }
                    ], 'VideoDownload', false)
                }
                finishMetric(true, 'disk_space_full')
                return
            }

            // 取所有目标群中最高的分辨率，以满足要求最高的群
            let resolution = filteredGroups.reduce((best, gid) => {
                const res = getVideoDownloadResolutionForGroup(gid)
                return RESOLUTION_ORDER.indexOf(res) > RESOLUTION_ORDER.indexOf(best) ? res : best
            }, '360p')
            if (RESOLUTION_ORDER.includes(options.resolutionLimit) && RESOLUTION_ORDER.indexOf(options.resolutionLimit) < RESOLUTION_ORDER.indexOf(resolution)) {
                resolution = options.resolutionLimit
            }

            sendLog('info', 'download-start', {
                bvid,
                pageIndex,
                resolution,
                groupCount: filteredGroups.length
            }, taskScope)

            const meta = videoInfo?.data ? {
                title: videoInfo.data.title,
                owner: videoInfo.data.owner?.name ?? 'Unknown',
                duration: videoInfo.data.duration ?? 0,
                total_pages: videoInfo.data.pages?.length ?? 1,
            } : null

            let result
            try {
                result = await biliApi.downloadVideo(bvid, pageIndex, resolution, filteredGroups[0], meta, {
                    taskId: taskContext.taskId,
                    signal: taskContext.abortSignal,
                    timeoutMs: DOWNLOAD_TIMEOUT_MS
                })
            } catch (e) {
                sendLog('error', 'download-fail', {
                    bvid,
                    pageIndex,
                    error: logger.getErrorMessage(e)
                }, taskScope)
                finishMetric(false, logger.getErrorMessage(e))
                await recordStatus(filteredGroups, 'failed', 'download_failed')
                return
            }

            if (result.status !== 'success') {
                if (result.terminalConfirmed === false) this.rememberUnconfirmedTask(taskContext)
                sendLog('warn', 'download-fail', {
                    bvid,
                    pageIndex,
                    error: result.message,
                    errorType: result.errorType,
                    failureKind: result.failureKind,
                    httpStatus: result.httpStatus,
                    biliCode: result.biliCode,
                    retryable: result.retryable,
                    reason: result.reason
                }, taskScope)
                finishMetric(false, result.message)
                await recordStatus(filteredGroups, 'failed', 'download_failed')
                return
            }

            // 向所有目标群发送同一文件
            let sentCount = 0
            const sentGroups = []
            const uploadRejectedGroups = []
            for (const gid of filteredGroups) {
                try {
                    const sent = await this._sendForwardMessage(taskContext.transport, gid, result, taskScope, taskContext.paths, error => {
                        if (/Highway.*102902/i.test(logger.getErrorMessage(error))) uploadRejectedGroups.push(String(gid))
                    })
                    if (sent) {
                        sentCount++
                        sentGroups.push(String(gid))
                    }
                } catch (e) {
                    sendLog('error', 'video-send-failed', {
                        groupId: gid,
                        title: result.title,
                        targetType: 'group',
                        error: logger.getErrorMessage(e)
                    }, taskScope)
                }
            }
            sendLog('info', 'download-ok', {
                bvid,
                pageIndex,
                sentCount,
                groupCount: filteredGroups.length
            }, taskScope)
            finishMetric(sentCount > 0, `${sentCount}/${filteredGroups.length}`)

            await recordStatus(sentGroups, 'delivered')
            await recordStatus(filteredGroups.filter(gid => !sentGroups.includes(String(gid))), 'failed', 'send_failed')

            // 至少一个群确认发送成功后再清理文件，延迟按成功群数量系数放大
            if (sentCount > 0) {
                this._scheduleCleanup(result.file_path, sentCount, taskContext.generation)
            } else {
                sendLog('warn', 'cleanup-deferred', {
                    bvid,
                    pageIndex,
                    reason: 'all_video_sends_failed',
                    filePath: result.file_path
                }, taskScope)
            }
            return { ok: sentCount > 0, sentGroups, attemptedGroups: filteredGroups.map(String), uploadRejectedGroups, resolution }
        } finally {
            this._activeDownloads--
            _inProgressDownloads.delete(downloadKey)
        }
    }

    /**
     * 清空下载目录（供 /清理下载 命令使用）
     * @returns {Promise<number>} 删除的文件数量，-1 表示有活跃下载被拒绝
     */
    async cleanAll() {
        const downloadsDir = this.currentPaths.downloadsDir
        try {
            await fsPromises.access(downloadsDir)
        } catch {
            return 0 // 目录不存在
        }
        try {
            // 有活跃下载时拒绝清理，防止删除正在使用的文件
            if (this._activeDownloads > 0) {
                sendLog('warn', 'cleanup-skipped', {
                    reason: 'downloads_in_progress',
                    activeDownloads: this._activeDownloads
                })
                return -1
            }
            // 同时清理 .mp4 和中途中断留下的 .tmp 临时文件
            const allFiles = await fsPromises.readdir(downloadsDir)
            const files = allFiles.filter(f => f.endsWith('.mp4') || f.endsWith('.tmp'))
            for (const f of files) {
                try { await fsPromises.unlink(path.join(downloadsDir, f)) } catch { /* skip */ }
            }
            return files.length
        } catch {
            return 0
        }
    }

    pauseOperations(reason = 'download-reconfigure') {
        this.operationRegistry.pause(reason)
    }

    resumeOperations() {
        this.operationRegistry.resume()
    }

    async drainOperations(timeoutMs = 330000) {
        await this.operationRegistry.drain({ timeoutMs })
        await this.reconcileUnconfirmedTasks()
        return true
    }

    abortOperations(reason = 'forced-cleanup') {
        this.operationRegistry.pause(reason)
        const operations = this.operationRegistry.snapshot()
        this.operationRegistry.abortAll(reason)
        return { requested: operations.length, operations }
    }

    async reconfigure(snapshot, options = {}) {
        const nextPaths = this.resolvePaths(snapshot)
        if (nextPaths.writeBase === this.currentPaths.writeBase && nextPaths.readBase === this.currentPaths.readBase) {
            return { changed: false, generation: this.pathGeneration }
        }
        const previous = this.currentPaths
        this.pauseOperations('download-path-reconfigure')
        try {
            await this.drainOperations(options.timeoutMs ?? 330000)
            this.currentPaths = nextPaths
            this.pathGeneration += 1
            return { changed: true, generation: this.pathGeneration, previous }
        } finally {
            if (!options.keepPaused) this.resumeOperations()
        }
    }

    createReloadHandler() {
        let previous = null
        let applied = false
        return {
            id: 'download-paths',
            effects: ['paths'],
            ownedPaths: ['paths.napcatTemp', 'paths.napcatRead'],
            preflight: async (candidate) => this.resolvePaths(candidate),
            pauseIngress: async () => this.pauseOperations('config-reload'),
            preCommitDrain: async () => this.drainOperations(330000),
            prepareExclusive: async (candidate) => {
                previous = this.currentPaths
                const result = await this.reconfigure(candidate, { keepPaused: true })
                applied = result.changed
            },
            rollbackExclusive: async () => {
                if (!applied || !previous) return
                this.currentPaths = previous
                this.pathGeneration += 1
            },
            restorePrevious: async () => this.resumeOperations(),
            enableIngress: async () => this.resumeOperations()
        }
    }

    getResourceCounts() {
        return {
            activeDownloads: this._activeDownloads,
            cleanupTimer: this._cleanupTimer ? 1 : 0,
            cleanupTimeouts: this._cleanupTimeouts.size,
            unconfirmedTasks: this._unconfirmedTasks.size,
            pathGeneration: this.pathGeneration,
            ...this.operationRegistry.getResourceCounts()
        }
    }

    async cleanup(options = {}) {
        this.pauseOperations('shutdown')
        const failures = []
        try {
            await this.drainOperations(options.drainTimeoutMs ?? 30000)
        } catch (error) {
            failures.push(error)
            this.abortOperations('shutdown-drain-timeout')
            try {
                await this.drainOperations(options.abortDrainTimeoutMs ?? 2000)
            } catch (abortDrainError) {
                failures.push(abortDrainError)
            }
        }
        if (this._cleanupTimer) clearInterval(this._cleanupTimer)
        this._cleanupTimer = null
        for (const timer of this._cleanupTimeouts) clearTimeout(timer)
        this._cleanupTimeouts.clear()
        if (failures.length > 0) {
            const error = new AggregateError(failures, 'Video download cleanup incomplete')
            error.code = 'VIDEO_DOWNLOAD_CLEANUP_FAILED'
            error.cleanupErrors = failures
            throw error
        }
        return this.getResourceCounts()
    }
}

module.exports = new VideoDownloadService()
module.exports.VideoDownloadService = VideoDownloadService
