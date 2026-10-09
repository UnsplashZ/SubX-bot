'use strict'

const assert = require('assert')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const { SubscriptionDeliveryStore } = require('../../../src/services/subscription/subscriptionDeliveryStore')

const updateChecker = require('../../../src/services/subscription/updateChecker')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')
const videoDownloadService = require('../../../src/services/videoDownloadService')

describe('updateChecker unified state advance policy', function () {
    const originals = {
        getUserVideos: deps.biliApi.getUserVideos,
        getVideoInfo: deps.biliApi.getVideoInfo,
        getUserArticles: deps.biliApi.getUserArticles,
        getArticleInfo: deps.biliApi.getArticleInfo,
        subscriptionStateStore: deps.subscriptionStateStore,
        subscriptionDeliveryStore: deps.subscriptionDeliveryStore,
        normalizeGroupSourceMap: updateChecker.normalizeGroupSourceMap,
        getGroupIdsFromSourceMap: updateChecker.getGroupIdsFromSourceMap,
        notifyGroupsWithImageAndCache: updateChecker.notifyGroupsWithImageAndCache,
        updateVideoState: updateChecker.updateVideoState,
        updateArticleState: updateChecker.updateArticleState,
        downloadAndSendToGroups: videoDownloadService.downloadAndSendToGroups
    }

    afterEach(function () {
        deps.biliApi.getUserVideos = originals.getUserVideos
        deps.biliApi.getVideoInfo = originals.getVideoInfo
        deps.biliApi.getUserArticles = originals.getUserArticles
        deps.biliApi.getArticleInfo = originals.getArticleInfo
        deps.subscriptionStateStore = originals.subscriptionStateStore
        deps.subscriptionDeliveryStore = originals.subscriptionDeliveryStore
        updateChecker.normalizeGroupSourceMap = originals.normalizeGroupSourceMap
        updateChecker.getGroupIdsFromSourceMap = originals.getGroupIdsFromSourceMap
        updateChecker.notifyGroupsWithImageAndCache = originals.notifyGroupsWithImageAndCache
        updateChecker.updateVideoState = originals.updateVideoState
        updateChecker.updateArticleState = originals.updateArticleState
        videoDownloadService.downloadAndSendToGroups = originals.downloadAndSendToGroups
    })

    it('视频通知无成功群时不应推进 lastVideoId', async function () {
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                video: { videoId: 'BV_OLD', lastCreated: 100 }
            }),
            advanceVideo: async () => {
                throw new Error('should not advance')
            }
        }
        deps.subscriptionDeliveryStore = {
            recordDeliveredBatch: async () => {}
        }
        deps.biliApi.getUserVideos = async () => ({
            status: 'success',
            data: {
                videos: [
                    { bvid: 'BV_NEW', created: 200 },
                    { bvid: 'BV_OLD', created: 100 }
                ]
            }
        })
        deps.biliApi.getVideoInfo = async () => ({
            status: 'success',
            data: { title: 'video title' }
        })
        updateChecker.normalizeGroupSourceMap = (groupTargets) => {
            if (groupTargets instanceof Map) return groupTargets
            const map = new Map()
            ;(groupTargets || []).forEach(gid => map.set(String(gid), new Set(['manual'])))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000'],
            dedupKey: 'video:BV_NEW'
        })
        videoDownloadService.downloadAndSendToGroups = async () => {}

        let advanced = false
        updateChecker.updateVideoState = async () => {
            advanced = true
        }

        await updateChecker.checkUserVideoUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['1000'],
            source: 'manual',
            manualSub: {
                lastVideoId: 'BV_OLD',
                lastVideoCreated: 100
            }
        })

        assert.strictEqual(advanced, false)
    })

    it('专栏通知无成功群时不应推进 lastArticleId', async function () {
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                article: { articleId: 'cv1', lastPublishTime: 100 }
            }),
            advanceArticle: async () => {
                throw new Error('should not advance')
            }
        }
        deps.subscriptionDeliveryStore = {
            recordDeliveredBatch: async () => {}
        }
        deps.biliApi.getUserArticles = async () => ({
            status: 'success',
            data: {
                articles: [
                    { id: 2, publish_time: 200 },
                    { id: 1, publish_time: 100 }
                ]
            }
        })
        deps.biliApi.getArticleInfo = async () => ({
            status: 'success',
            type: 'article',
            data: { id: 2, title: 'article title' }
        })
        updateChecker.normalizeGroupSourceMap = (groupTargets) => {
            if (groupTargets instanceof Map) return groupTargets
            const map = new Map()
            ;(groupTargets || []).forEach(gid => map.set(String(gid), new Set(['manual'])))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: ['1000'],
            dedupKey: 'article:cv2'
        })

        let advanced = false
        updateChecker.updateArticleState = async () => {
            advanced = true
        }

        await updateChecker.checkUserArticleUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['1000'],
            source: 'manual',
            manualSub: {
                lastArticleId: 'cv1',
                lastArticlePublishTime: 100
            }
        })

        assert.strictEqual(advanced, false)
    })

    it('视频目标群全部关闭时应推进水位并写 disabled tombstone', async function () {
        const recorded = []
        const advanced = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                video: { videoId: 'BV_OLD', lastCreated: 100 }
            })
        }
        deps.subscriptionDeliveryStore = {
            recordDeliveredBatch: async (records) => {
                recorded.push(...records)
                return { changed: records.length }
            }
        }
        deps.biliApi.getUserVideos = async () => ({
            status: 'success',
            data: {
                videos: [
                    { bvid: 'BV_NEW', created: 200 },
                    { bvid: 'BV_OLD', created: 100 }
                ]
            }
        })
        deps.biliApi.getVideoInfo = async () => ({
            status: 'success',
            data: { title: 'video title' }
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: [],
            disabledSkippedGroups: ['1000'],
            ledgerSkippedGroups: ['1000'],
            dedupKey: 'video:BV_NEW'
        })
        updateChecker.updateVideoState = async (_userItem, state) => {
            advanced.push(state)
        }
        videoDownloadService.downloadAndSendToGroups = async () => {}

        await updateChecker.checkUserVideoUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['1000'],
            source: 'manual',
            manualSub: {
                lastVideoId: 'BV_OLD',
                lastVideoCreated: 100
            }
        })

        assert.deepStrictEqual(recorded.map(r => `${r.groupId}:${r.type}:${r.contentId}`), ['1000:video:BV_NEW'])
        assert.deepStrictEqual(advanced, [{ videoId: 'BV_NEW', videoCreated: 200 }])
    })

    it('专栏目标群全部关闭时应推进水位并写 disabled tombstone', async function () {
        const recorded = []
        const advanced = []
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                article: { articleId: 'cv1', lastPublishTime: 100 }
            })
        }
        deps.subscriptionDeliveryStore = {
            recordDeliveredBatch: async (records) => {
                recorded.push(...records)
                return { changed: records.length }
            }
        }
        deps.biliApi.getUserArticles = async () => ({
            status: 'success',
            data: {
                articles: [
                    { id: 2, publish_time: 200 },
                    { id: 1, publish_time: 100 }
                ]
            }
        })
        deps.biliApi.getArticleInfo = async () => ({
            status: 'success',
            type: 'article',
            data: { id: 2, title: 'article title' }
        })
        updateChecker.notifyGroupsWithImageAndCache = async () => ({
            successGroups: [],
            failedGroups: [],
            disabledSkippedGroups: ['1000'],
            ledgerSkippedGroups: ['1000'],
            dedupKey: 'article:cv2'
        })
        updateChecker.updateArticleState = async (_userItem, state) => {
            advanced.push(state)
        }

        await updateChecker.checkUserArticleUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['1000'],
            source: 'manual',
            manualSub: {
                lastArticleId: 'cv1',
                lastArticlePublishTime: 100
            }
        })

        assert.deepStrictEqual(recorded.map(r => `${r.groupId}:${r.type}:${r.contentId}`), ['1000:article:cv2'])
        assert.deepStrictEqual(advanced, [{ articleId: 'cv2', articlePublishTime: 200 }])
    })

    it('视频检查应在首群上下文失败时回退到后续群上下文', async function () {
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                video: { videoId: 'BV_OLD', lastCreated: 100 }
            }),
            advanceVideo: async () => {}
        }
        deps.subscriptionDeliveryStore = {
            recordDeliveredBatch: async () => {}
        }
        const videoListCalls = []
        deps.biliApi.getUserVideos = async (_uid, groupId) => {
            videoListCalls.push(String(groupId))
            if (String(groupId) === 'g1') {
                return { status: 'error', message: 'credential invalid for g1' }
            }
            return {
                status: 'success',
                data: { videos: [{ bvid: 'BV_NEW', created: 200 }, { bvid: 'BV_OLD', created: 100 }] }
            }
        }
        deps.biliApi.getVideoInfo = async () => ({
            status: 'success',
            data: { title: 'video title' }
        })
        updateChecker.normalizeGroupSourceMap = (groupTargets) => {
            if (groupTargets instanceof Map) return groupTargets
            const map = new Map()
            ;(groupTargets || []).forEach(gid => map.set(String(gid), new Set(['manual'])))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())

        let notifyCalled = 0
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            notifyCalled += 1
            return { successGroups: ['g2'], failedGroups: [], dedupKey: 'video:BV_NEW' }
        }
        videoDownloadService.downloadAndSendToGroups = async () => {}

        await updateChecker.checkUserVideoUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['g1', 'g2'],
            source: 'manual',
            manualSub: {
                lastVideoId: 'BV_OLD',
                lastVideoCreated: 100
            }
        })

        assert.deepStrictEqual(videoListCalls, ['g1', 'g2'])
        assert.strictEqual(notifyCalled, 1)
    })

    it('专栏检查应在首群上下文失败时回退到后续群上下文', async function () {
        deps.subscriptionStateStore = {
            getUserState: async () => ({
                article: { articleId: 'cv1', lastPublishTime: 100 }
            }),
            advanceArticle: async () => {}
        }
        deps.subscriptionDeliveryStore = {
            recordDeliveredBatch: async () => {}
        }
        const articleListCalls = []
        deps.biliApi.getUserArticles = async (_uid, groupId) => {
            articleListCalls.push(String(groupId))
            if (String(groupId) === 'g1') {
                return { status: 'error', message: 'credential invalid for g1' }
            }
            return {
                status: 'success',
                data: { articles: [{ id: 2, publish_time: 200 }, { id: 1, publish_time: 100 }] }
            }
        }
        deps.biliApi.getArticleInfo = async () => ({
            status: 'success',
            type: 'article',
            data: { id: 2, title: 'article title' }
        })
        updateChecker.normalizeGroupSourceMap = (groupTargets) => {
            if (groupTargets instanceof Map) return groupTargets
            const map = new Map()
            ;(groupTargets || []).forEach(gid => map.set(String(gid), new Set(['manual'])))
            return map
        }
        updateChecker.getGroupIdsFromSourceMap = (sourceMap) => Array.from(sourceMap.keys())

        let notifyCalled = 0
        updateChecker.notifyGroupsWithImageAndCache = async () => {
            notifyCalled += 1
            return { successGroups: ['g2'], failedGroups: [], dedupKey: 'article:cv2' }
        }

        await updateChecker.checkUserArticleUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['g1', 'g2'],
            source: 'manual',
            manualSub: {
                lastArticleId: 'cv1',
                lastArticlePublishTime: 100
            }
        })

        assert.deepStrictEqual(articleListCalls, ['g1', 'g2'])
        assert.strictEqual(notifyCalled, 1)
    })

    it('视频台账补偿时下载副作用只发送到缺失群', async function () {
        const downloadedTargets = []
        const state = {
            uid: '123',
            video: { videoId: 'BV_NEW', lastCreated: 200 },
            targets: {
                A: {
                    video: { baselineSource: 'existing_target', active: true }
                },
                B: {
                    video: { baselineSource: 'existing_target', active: true }
                }
            }
        }
        deps.subscriptionStateStore = {
            getUserState: () => state,
            ensureTargetBaselines: async () => ({ changed: false, state }),
            getTargetBaseline: (userState, groupId, type) => userState.targets?.[groupId]?.[type] || null
        }
        deps.subscriptionDeliveryStore = {
            getDeliveryCoverage: async () => ({
                deliveredGroups: ['A'],
                undeliveredGroups: ['B'],
                hasAnyRecord: true
            }),
            recordDeliveredBatch: async () => {}
        }
        deps.biliApi.getUserVideos = async () => ({
            status: 'success',
            data: {
                videos: [
                    { bvid: 'BV_NEW', created: 200 }
                ]
            }
        })
        deps.biliApi.getVideoInfo = async () => ({
            status: 'success',
            data: { title: 'video title' }
        })
        updateChecker.notifyGroupsWithImageAndCache = async (targetGroupSourceMap) => {
            assert.deepStrictEqual(Array.from(targetGroupSourceMap.keys()), ['B'])
            return { successGroups: ['B'], failedGroups: [], dedupKey: 'video:BV_NEW' }
        }
        videoDownloadService.downloadAndSendToGroups = async (_ws, groups) => {
            downloadedTargets.push(groups)
        }

        await updateChecker.checkUserVideoUnified({
            uid: '123',
            name: 'tester',
            targetGroups: ['A', 'B'],
            source: 'manual',
            manualSub: {
                lastVideoId: 'BV_NEW',
                lastVideoCreated: 200
            }
        })

        assert.deepStrictEqual(downloadedTargets, [['B']])
    })

    for (const newerPostExists of [false, true]) {
        it(`上传失败后只补发失败群视频且不重复卡片（更新投稿=${newerPostExists}）`, async function () {
            const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub-media-retry-'))
            try {
                const store = new SubscriptionDeliveryStore({ dataDir: tmpDir })
                deps.subscriptionDeliveryStore = store
                const groups = ['A', 'B', 'C', 'legacy']
                await store.recordDeliveredBatch(groups.map(groupId => ({ groupId, type: 'video', contentId: 'BV_NEW' })))
                await store.recordDeliveryBatch(['failed', 'delivered', 'skipped'].map((status, i) => ({
                    groupId: groups[i], type: 'video', contentId: 'BV_NEW', deliveryPart: 'auto-download', status
                })))
                const videos = newerPostExists
                    ? [{ bvid: 'BV_LATEST', created: 300 }, { bvid: 'BV_NEW', created: 200 }]
                    : [{ bvid: 'BV_NEW', created: 200 }]
                await store.recordDeliveredBatch(groups.map(groupId => ({ groupId, type: 'video', contentId: videos[0].bvid })))
                deps.subscriptionStateStore = { getUserState: () => ({ video: { videoId: videos[0].bvid, lastCreated: videos[0].created } }) }
                deps.biliApi.getUserVideos = async () => ({ status: 'success', data: { videos } })
                deps.biliApi.getVideoInfo = async () => ({ status: 'success', data: { title: 'video' } })
                let cards = 0
                updateChecker.notifyGroupsWithImageAndCache = async () => { cards++; return { successGroups: [] } }
                const attempts = []
                videoDownloadService.downloadAndSendToGroups = async (_ws, targets, bvid, _info, _page, options) => {
                    attempts.push({ targets, bvid })
                    assert.equal(options.recordDelivery, true)
                    await store.recordDeliveredBatch(targets.map(groupId => ({ groupId, type: 'video', contentId: bvid, deliveryPart: options.deliveryPart })))
                }
                const user = { uid: '123', name: 'tester', targetGroups: groups, source: 'manual' }
                await updateChecker.checkUserVideoUnified(user)
                await store.reload()
                await updateChecker.checkUserVideoUnified(user)
                assert.deepStrictEqual(attempts, [{ targets: ['A'], bvid: 'BV_NEW' }])
                assert.equal(cards, 0)
            } finally {
                await fs.rm(tmpDir, { recursive: true, force: true })
            }
        })
    }
})
