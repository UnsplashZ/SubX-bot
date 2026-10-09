#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const { EventEmitter } = require('events')

const config = require('../../../src/config')
const biliApi = require('../../../src/services/biliApi')
const videoDownloadService = require('../../../src/services/videoDownloadService')
const { VideoDownloadService } = require('../../../src/services/videoDownloadService')
const deliveryStore = require('../../../src/services/subscription/subscriptionDeliveryStore')

function createAckWebSocket(sent) {
    const ws = new EventEmitter()
    ws.readyState = 1
    ws.send = (raw, callback) => {
        const payload = JSON.parse(raw)
        sent.push(payload)
        callback?.(null)
        process.nextTick(() => ws.emit('message', JSON.stringify({
            status: 'ok',
            retcode: 0,
            echo: payload.echo
        })))
    }
    return ws
}

describe('videoDownloadService Official provider send path', () => {
    const originalBot = global.bot

    afterEach(() => {
        global.bot = originalBot
    })

    it('uses the bot-written local file path for Official media upload', async () => {
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message) {
                sent.push({ groupId, message })
                return { status: 'ok', retcode: 0 }
            }
        }
        global.bot = {
            ws: null,
            provider
        }
        const filePath = path.join(process.cwd(), 'test/output/video-download-official.mp4')

        const ok = await videoDownloadService._sendForwardMessage(provider, 'group-openid', {
            title: 'Video',
            owner: 'Owner',
            file_path: filePath
        })

        assert.equal(ok, true)
        assert.equal(sent[0].groupId, 'group-openid')
        assert.equal(sent[0].message[1].type, 'video')
        assert.equal(sent[0].message[1].data.file, `file://${filePath}`)
    })

    it('does not report success when Official video send only used media fallback', async () => {
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage() {
                return {
                    status: 'ok',
                    retcode: 0,
                    fallbackUsed: true,
                    fallbackReason: 'video_media_send_failed'
                }
            }
        }
        global.bot = {
            ws: null,
            provider
        }

        const ok = await videoDownloadService._sendForwardMessage(provider, 'group-openid', {
            title: 'Video',
            owner: 'Owner',
            file_path: path.join(process.cwd(), 'test/output/video-download-official.mp4')
        })

        assert.equal(ok, false)
    })

    it('sends through a leased NapCat provider handle', async () => {
        const sent = []
        const provider = {
            id: 'napcat',
            readyState: 1,
            ws: createAckWebSocket(sent)
        }

        const ok = await videoDownloadService._sendForwardMessage(provider, '123', {
            title: 'Video',
            owner: 'Owner',
            file_path: path.join(process.cwd(), 'test/output/video-download-napcat.mp4')
        })

        assert.equal(ok, true)
        assert.equal(sent[0].action, 'send_group_msg')
        assert.equal(sent[0].params.message[1].type, 'video')
    })

    it('does not report success when the leased NapCat socket rejects the send', async () => {
        const provider = {
            id: 'napcat',
            readyState: 1,
            ws: {
                readyState: 1,
                on() {},
                send() {
                    throw new Error('socket write failed')
                }
            }
        }

        const ok = await videoDownloadService._sendForwardMessage(provider, '123', {
            title: 'Video',
            owner: 'Owner',
            file_path: path.join(process.cwd(), 'test/output/video-download-napcat.mp4')
        })

        assert.equal(ok, false)
    })

    it('keeps the downloaded file when video delivery fails', async () => {
        const service = new VideoDownloadService()
        const mutableConfig = config.__getMutableCompatStateForTests()
        const originalEnabled = mutableConfig.videoDownloadEnabled
        const originalDownloadVideo = biliApi.downloadVideo
        let cleanupSchedules = 0

        mutableConfig.videoDownloadEnabled = true
        biliApi.downloadVideo = async () => ({
            status: 'success',
            file_path: path.join(process.cwd(), 'test/output/video-download-retained.mp4'),
            title: 'Video',
            owner: 'Owner',
            total_pages: 1
        })
        service._hasDiskSpace = async () => true
        service._sendForwardMessage = async () => false
        service._scheduleCleanup = () => { cleanupSchedules += 1 }

        try {
            const result = await service._downloadAndSend({
                taskId: 'test-task',
                generation: 1,
                paths: service.currentPaths,
                abortSignal: null
            }, '123', 'BV1TEST', {
                data: {
                    duration: 60,
                    title: 'Video',
                    owner: { name: 'Owner' },
                    pages: [{ duration: 60 }]
                }
            })

            assert.equal(result.ok, false)
            assert.equal(result.reason, 'send_failed')
            assert.equal(cleanupSchedules, 0)
        } finally {
            mutableConfig.videoDownloadEnabled = originalEnabled
            biliApi.downloadVideo = originalDownloadVideo
            await service.cleanup()
        }
    })

    it('keeps a subscription download when every group delivery fails', async () => {
        const service = new VideoDownloadService()
        const mutableConfig = config.__getMutableCompatStateForTests()
        const originalEnabled = mutableConfig.videoDownloadEnabled
        const originalGroupConfigs = mutableConfig.groupConfigs
        const originalDownloadVideo = biliApi.downloadVideo
        let cleanupSchedules = 0

        mutableConfig.videoDownloadEnabled = true
        mutableConfig.groupConfigs = {
            ...(originalGroupConfigs || {}),
            123: { enabled: true, videoDownloadEnabled: true },
            456: { enabled: true, videoDownloadEnabled: true }
        }
        biliApi.downloadVideo = async () => ({
            status: 'success',
            file_path: path.join(process.cwd(), 'test/output/video-download-fanout-retained.mp4'),
            title: 'Video',
            owner: 'Owner',
            total_pages: 1
        })
        service._hasDiskSpace = async () => true
        service._sendForwardMessage = async () => false
        service._scheduleCleanup = () => { cleanupSchedules += 1 }

        try {
            const result = await service._downloadAndSendToGroups({
                taskId: 'test-fanout-task',
                generation: 1,
                paths: service.currentPaths,
                abortSignal: null
            }, ['123', '456'], 'BV1FANOUT', {
                data: {
                    duration: 60,
                    title: 'Video',
                    owner: { name: 'Owner' },
                    pages: [{ duration: 60 }]
                }
            }, 0, { recordDelivery: true })

            assert.equal(result.ok, false)
            assert.equal(result.sentGroups.length, 0)
            assert.equal(cleanupSchedules, 0)
            assert.deepStrictEqual(await deliveryStore.getRetryableGroups(['123', '456'], 'video', 'BV1FANOUT'), ['123', '456'])
            assert.equal(await deliveryStore.hasDelivered('123', 'video', 'BV1FANOUT', 'auto-download'), false)
        } finally {
            mutableConfig.videoDownloadEnabled = originalEnabled
            mutableConfig.groupConfigs = originalGroupConfigs
            biliApi.downloadVideo = originalDownloadVideo
            await service.cleanup()
        }
    })

    it('records per-group media outcomes and keeps the download slot through upload', async () => {
        const service = new VideoDownloadService()
        const mutable = config.__getMutableCompatStateForTests()
        const originalGroups = mutable.groupConfigs
        const originalDownload = biliApi.downloadVideo
        const attempted = []
        mutable.groupConfigs = {
            123: { enabled: true, videoDownloadEnabled: true, videoDownloadMaxDuration: 600 },
            456: { enabled: true, videoDownloadEnabled: true, videoDownloadMaxDuration: 600 },
            789: { enabled: true, videoDownloadEnabled: true, videoDownloadMaxDuration: 30 }
        }
        service._hasDiskSpace = async () => true
        service._scheduleCleanup = () => {}
        service._sendForwardMessage = async (_ws, gid) => {
            assert.equal(service._activeDownloads, 1)
            attempted.push(gid)
            return gid === '123'
        }
        biliApi.downloadVideo = async () => ({ status: 'success', file_path: '/tmp/test.mp4', title: 'video' })
        try {
            await service._downloadAndSendToGroups({ paths: service.currentPaths }, ['123', '456', '789'], 'BV_MIXED', { data: { duration: 60 } }, 0, { recordDelivery: true })
            assert.deepStrictEqual(attempted, ['123', '456'])
            const records = deliveryStore.getSnapshot().records
            assert.equal(records['123:video:BV_MIXED:auto-download'].status, 'delivered')
            assert.equal(records['456:video:BV_MIXED:auto-download'].status, 'failed')
            assert.equal(records['789:video:BV_MIXED:auto-download'].status, 'skipped')
            assert.deepStrictEqual(await deliveryStore.getRetryableGroups(['123', '456', '789'], 'video', 'BV_MIXED'), ['456'])
            assert.equal(service._activeDownloads, 0)

            biliApi.downloadVideo = async () => { throw new Error('network failure') }
            await service._downloadAndSendToGroups({ paths: service.currentPaths }, ['123'], 'BV_THROW', { data: { duration: 60 } }, 0, { recordDelivery: true })
            assert.equal(service._activeDownloads, 0)
            assert.deepStrictEqual(await deliveryStore.getRetryableGroups(['123'], 'video', 'BV_THROW'), ['123'])
        } finally {
            mutable.groupConfigs = originalGroups
            biliApi.downloadVideo = originalDownload
            await service.cleanup()
        }
    })

    it('lowers resolution only for QQ Highway rejection and never resends successful groups', async () => {
        const service = new VideoDownloadService()
        const mutable = config.__getMutableCompatStateForTests()
        const originalGroups = mutable.groupConfigs
        const originalDownload = biliApi.downloadVideo
        mutable.groupConfigs = {
            123: { enabled: true, videoDownloadEnabled: true, videoDownloadResolution: '1080p+' },
            456: { enabled: true, videoDownloadEnabled: true, videoDownloadResolution: '1080p+' }
        }
        const resolutions = []
        const sends = []
        service._hasDiskSpace = async () => true
        service._scheduleCleanup = () => {}
        biliApi.downloadVideo = async (_bvid, _page, resolution) => {
            resolutions.push(resolution)
            return { status: 'success', file_path: '/tmp/test.mp4', title: 'video' }
        }
        service._sendForwardMessage = async (_ws, gid, _result, _scope, _paths, onFailure) => {
            sends.push(gid)
            if (gid === '456' && resolutions.length === 1) {
                onFailure(new Error('[Highway] HTTP Upload failed with code 102902'))
                return false
            }
            return true
        }
        try {
            const result = await service.downloadAndSendToGroups({}, ['123', '456'], 'BV_RETRY_RES', { data: { duration: 60 } }, 0, { recordDelivery: true })
            assert.deepStrictEqual(resolutions, ['1080p+', '720p'])
            assert.deepStrictEqual(sends, ['123', '456', '456'])
            assert.deepStrictEqual(result.sentGroups, ['123', '456'])
            assert.equal(result.ok, true)
            assert.deepStrictEqual(await deliveryStore.getRetryableGroups(['123', '456'], 'video', 'BV_RETRY_RES'), [])
            await service.downloadAndSendToGroups({}, ['123', '456'], 'BV_RETRY_RES', { data: { duration: 60 } }, 0, { recordDelivery: true })
            assert.equal(resolutions.length, 2)

            resolutions.length = 0
            service._sendForwardMessage = async (_ws, _gid, _result, _scope, _paths, onFailure) => {
                onFailure(new Error('[Highway] HTTP Upload failed with code 102902'))
                return false
            }
            const rejected = await service.downloadAndSendToGroups({}, ['456'], 'BV_ALL_REJECTED', { data: { duration: 60 } })
            assert.equal(rejected.ok, false)
            assert.deepStrictEqual(resolutions, ['1080p+', '720p', '480p', '360p'])

            resolutions.length = 0
            service._sendForwardMessage = async (_ws, _gid, _result, _scope, _paths, onFailure) => {
                onFailure(new Error('WebSocket closed'))
                return false
            }
            const disconnected = await service.downloadAndSendToGroups({}, ['456'], 'BV_DISCONNECTED', { data: { duration: 60 } })
            assert.equal(disconnected.ok, false)
            assert.deepStrictEqual(resolutions, ['1080p+'])
        } finally {
            mutable.groupConfigs = originalGroups
            biliApi.downloadVideo = originalDownload
            await service.cleanup()
        }
    })
})
