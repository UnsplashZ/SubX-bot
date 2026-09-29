'use strict'

const path = require('path')
const fs = require('fs')
const fsPromises = require('fs').promises
const https = require('https')
const crypto = require('crypto')
const notificationService = require('./notificationService')
const logger = require('../utils/logger')
const config = require('../config')
const { isOfficialTransport, isQqTransportReady } = require('../providers/qq/readiness')

function getDownloadsDir() {
    const napcatTemp = config.napcatTempPath || config.paths?.napcatTemp || '/app/.config/QQ/tmp/'
    return path.join(path.resolve(napcatTemp), 'ext-downloads')
}

function toNapcatPath(filePath) {
    const writeBase = path.resolve(config.napcatTempPath || config.paths?.napcatTemp || '/app/.config/QQ/tmp/')
    const readBase  = path.resolve(config.napcatReadPath || config.paths?.napcatRead  || writeBase)
    const abs = path.resolve(filePath)
    if (abs.startsWith(writeBase)) {
        return path.join(readBase, path.relative(writeBase, abs))
    }
    return filePath
}

// 统一的发送目标解析：groupId 为 "private_xxx" 时走私聊，与 deliverVideoFile 的模式一致
function resolveTarget(groupId) {
    if (typeof groupId === 'string' && groupId.startsWith('private_')) {
        return { kind: 'private', userId: groupId.replace('private_', '') }
    }
    return { kind: 'group', groupId }
}

// 统一的消息发送入口：私聊走 sendPrivateMessage，群聊按 provider 转换 ID 类型
async function sendToTarget(ws, groupId, messages) {
    const target = resolveTarget(groupId)
    if (target.kind === 'private') {
        if (!target.userId) return false
        await notificationService.sendPrivateMessage(ws, target.userId, messages, 'ExternalMedia', false)
        return true
    }

    const numericGroupId = isOfficialTransport(ws) ? String(groupId) : Number(groupId)
    await notificationService.sendGroupMessage(ws, numericGroupId, messages, 'ExternalMedia', false)
    return true
}

function toHttps(nextUrl) {
    // 媒体 CDN 均支持 https；显式 http 的跳转地址升级为 https，避免 https.get 抛协议错误
    return nextUrl.startsWith('http://') ? `https://${nextUrl.slice('http://'.length)}` : nextUrl
}

function scheduleFileCleanup(filePath) {
    const timer = setTimeout(() => {
        fsPromises.unlink(filePath).catch(() => {})
    }, 5 * 60 * 1000)
    timer.unref?.()
    return timer
}

// 流式下载 URL 到 destPath
// 播放地址可能返回 302 跳转 CDN（如 aweme.snssdk.com → douyinvod.com），需跟随重定向
// 抖音 CDN 偶发 stall（连接不断但无数据），触发 60s 超时时整体重试一次（从原 URL 重新下载，
// 不做 Range 续传，保持简单），避免单次抖动导致投递失败。
async function streamDownload(url, destPath, maxBytes, redirectsLeft = 3, retriesLeft = 1) {
    return new Promise((resolve, reject) => {
        const tmpPath = destPath + '.tmp'
        const file = fs.createWriteStream(tmpPath)
        let received = 0

        const cleanupTmp = () => { fs.unlink(tmpPath, () => {}) }

        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 60000,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume()
                file.destroy()
                fs.unlink(destPath + '.tmp', () => {})
                if (redirectsLeft <= 0) {
                    reject(new Error(`too many redirects downloading ${url}`))
                    return
                }
                const nextUrl = toHttps(new URL(res.headers.location, url).href)
                streamDownload(nextUrl, destPath, maxBytes, redirectsLeft - 1, retriesLeft).then(resolve, reject)
                return
            }

            const contentLength = parseInt(res.headers['content-length'] || '0', 10)
            if (contentLength > maxBytes) {
                req.destroy()
                file.destroy()
                cleanupTmp()
                reject(new Error(`file too large: ${contentLength} > ${maxBytes}`))
                return
            }

            res.on('data', (chunk) => {
                received += chunk.length
                if (received > maxBytes) {
                    req.destroy()
                    file.destroy()
                    cleanupTmp()
                    reject(new Error(`downloaded size exceeded limit`))
                    return
                }
                file.write(chunk)
            })

            res.on('end', () => {
                file.end(() => {
                    fsPromises.rename(tmpPath, destPath).then(resolve).catch(reject)
                })
            })
        })

        const retryOrReject = (err) => {
            file.destroy()
            cleanupTmp()
            if (retriesLeft > 0) {
                logger.logEvent('warn', 'SEND', '', 'external-download-retry', {
                    url: url.slice(0, 80), error: String(err.message || err), retriesLeft
                })
                streamDownload(url, destPath, maxBytes, redirectsLeft, retriesLeft - 1).then(resolve, reject)
                return
            }
            reject(err)
        }
        req.on('timeout', () => { req.destroy(); retryOrReject(new Error('download timeout')) })
        req.on('error', retryOrReject)
    })
}

// 投递单个视频文件到群/私聊
async function deliverVideoFile(ws, groupId, filePath, label, author) {
    if (!isQqTransportReady(ws)) return false

    const isOfficial = isOfficialTransport(ws)
    const videoFilePath = isOfficial ? filePath : toNapcatPath(filePath)
    const videoFile = `file://${videoFilePath.replace(/\\/g, '/')}`
    const textMsg = { type: 'text', data: { text: `「${label}」- ${author}` } }
    const videoMsg = { type: 'video', data: { file: videoFile } }

    return sendToTarget(ws, groupId, [textMsg, videoMsg])
}

// 主入口：下载视频 URL 并发送
// 注意：maxDurationSeconds 必须在此处预检，不能仅靠 maxFileSizeBytes 兜底，
// 否则超长视频会在下载完成后才失败，浪费带宽和磁盘。
// durationSeconds 由 afterSend 调用方从 data.duration 取得并传入。
async function downloadAndSend({ ws, groupId, url, label, author, platform,
    durationSeconds, maxDurationSeconds, maxFileSizeBytes }) {
    // 时长预检（仿照 videoDownloadService 的模式）
    if (maxDurationSeconds > 0 && durationSeconds > 0 && durationSeconds > maxDurationSeconds) {
        const durMin = Math.round(durationSeconds / 60)
        const limMin = Math.round(maxDurationSeconds / 60)
        logger.logEvent('info', 'SEND', '', 'external-download-skipped-duration', {
            groupId, platform, durationSeconds, maxDurationSeconds
        })
        // 私聊场景不发提示，直接跳过
        if (resolveTarget(groupId).kind === 'group') {
            await sendToTarget(ws, groupId, [{
                type: 'text',
                data: { text: `⚠️ 视频时长 ${durMin} 分钟，超出当前限制（${limMin} 分钟），已跳过下载` }
            }])
        }
        return false
    }

    const dir = getDownloadsDir()
    await fsPromises.mkdir(dir, { recursive: true })

    const filename = `${platform}-${crypto.randomBytes(8).toString('hex')}.mp4`
    const filePath = path.join(dir, filename)

    try {
        await streamDownload(url, filePath, maxFileSizeBytes ?? 50 * 1024 * 1024)
        const sent = await deliverVideoFile(ws, groupId, filePath, label, author || platform)

        // 发送后延迟 5 分钟清理
        scheduleFileCleanup(filePath)

        return sent
    } catch (err) {
        fsPromises.unlink(filePath).catch(() => {})
        throw err
    }
}

// 发送图片数组（图集）
// notificationService 已支持 { type: 'image', data: { file: 'base64://...' } }，
// NapCat 模式自动将 base64 转存文件再以 file:// 发出；Official 模式直接传 base64。
// 每张图片单独 fetch，失败单张静默跳过，不影响其余。私聊（private_xxx）同样支持。
async function deliverImages(ws, groupId, imageUrls, label, maxImages = 9) {
    if (!isQqTransportReady(ws)) return 0
    const toSend = imageUrls.slice(0, maxImages)
    let sent = 0

    for (const url of toSend) {
        try {
            const buf = await fetchBuffer(url, 10 * 1024 * 1024)  // 单图 10MB 上限
            const b64 = buf.toString('base64')
            await sendToTarget(ws, groupId, [{ type: 'image', data: { file: `base64://${b64}` } }])
            sent++
        } catch (e) {
            logger.logEvent('warn', 'SEND', '', 'external-image-send-failed', {
                groupId, url: url.slice(0, 80), error: String(e.message || e)
            })
        }
    }
    return sent
}

// 发送一组 Live Photo（封面图 + 短视频），按组逐个投递。私聊（private_xxx）同样支持。
async function deliverLivePhotoGroup(ws, groupId, livePhotos, platform, maxGroups = 4,
    maxVideoSizeBytes = 30 * 1024 * 1024) {
    if (!isQqTransportReady(ws)) return
    const toSend = livePhotos.slice(0, maxGroups)

    for (const lp of toSend) {
        // 封面图
        if (lp.cover) {
            try {
                const buf = await fetchBuffer(lp.cover, 10 * 1024 * 1024)
                await sendToTarget(ws, groupId,
                    [{ type: 'image', data: { file: `base64://${buf.toString('base64')}` } }])
            } catch (e) { /* 封面失败不阻断短视频 */ }
        }

        // 短视频
        if (lp.play_addr_uri) {
            const videoUrl = buildPlayUrl(lp.play_addr_uri)
            const dir = getDownloadsDir()
            await fsPromises.mkdir(dir, { recursive: true })
            const filename = `${platform}-lp-${crypto.randomBytes(6).toString('hex')}.mp4`
            const filePath = path.join(dir, filename)
            try {
                await streamDownload(videoUrl, filePath, maxVideoSizeBytes)
                await deliverVideoFile(ws, groupId, filePath, 'Live Photo', platform)
                scheduleFileCleanup(filePath)
            } catch (e) {
                fsPromises.unlink(filePath).catch(() => {})
                logger.logEvent('warn', 'SEND', '', 'external-livephoto-send-failed', {
                    groupId, error: String(e.message || e)
                })
            }
        }
    }
}

// 辅助：流式 fetch 到内存 Buffer（用于图片，不落盘）
// 图片 CDN 也可能 302 跳转，需跟随重定向
function fetchBuffer(url, maxBytes, redirectsLeft = 3) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume()
                if (redirectsLeft <= 0) {
                    reject(new Error(`too many redirects fetching ${url}`))
                    return
                }
                fetchBuffer(toHttps(new URL(res.headers.location, url).href), maxBytes, redirectsLeft - 1).then(resolve, reject)
                return
            }
            const cl = parseInt(res.headers['content-length'] || '0', 10)
            if (cl > maxBytes) { req.destroy(); reject(new Error(`image too large: ${cl}`)); return }
            const chunks = []
            let received = 0
            res.on('data', (chunk) => {
                received += chunk.length
                if (received > maxBytes) { req.destroy(); reject(new Error('image size exceeded')); return }
                chunks.push(chunk)
            })
            res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')) })
        req.on('error', reject)
    })
}

// buildPlayUrl 默认实现（抖音播放地址模板），可通过 setBuildPlayUrl 覆盖
let buildPlayUrl = (uri) => `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=1080p&line=0`
function setBuildPlayUrl(fn) { buildPlayUrl = fn }

module.exports = {
    downloadAndSend,
    deliverVideoFile,
    deliverImages,
    deliverLivePhotoGroup,
    scheduleFileCleanup,
    setBuildPlayUrl,
}
