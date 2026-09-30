'use strict'

const assert = require('assert')
const cacheManager = require('../../../src/utils/cacheManager')
const linkFetchService = require('../../../src/services/link/linkFetchService')
const xhsNote = require('../../../src/services/link/linkTypes/xhsNote')
const xhsShort = require('../../../src/services/link/linkTypes/xhsShort')

describe('external video data cache', function () {
    const originalGet = cacheManager.get
    const originalSet = cacheManager.set

    afterEach(function () {
        cacheManager.get = originalGet
        cacheManager.set = originalSet
    })

    for (const baseHandler of [xhsNote, xhsShort]) {
        it(`${baseHandler.type}: 无视频地址的旧缓存应重新抓取并保存可用媒体`, async function () {
            let fetchCount = 0
            const freshInfo = {
                status: 'success',
                data: { type: 'xhs_video', video_url: 'https://example.com/fresh.mp4' }
            }
            const writes = []
            const handler = {
                ...baseHandler,
                async fetch() { fetchCount += 1; return freshInfo }
            }
            cacheManager.get = async (key, ttlSeconds) => {
                assert.strictEqual(ttlSeconds, 60)
                return { status: 'success', data: { type: 'xhs_video', video_url: null } }
            }
            cacheManager.set = async (...args) => { writes.push(args) }

            const result = await linkFetchService.fetch(handler, '10001', { id: 'note-id' })
            assert.strictEqual(result.fromCache, false)
            assert.strictEqual(fetchCount, 1)
            assert.strictEqual(result.info, freshInfo)
            assert.deepStrictEqual(writes, [[`${baseHandler.type}_note-id`, freshInfo, 60]])
        })
    }

    it('新抓取的空视频地址不应固化为成功的数据缓存', async function () {
        cacheManager.get = async () => null
        let writes = 0
        cacheManager.set = async () => { writes += 1 }
        await linkFetchService.fetch({
            ...xhsNote,
            async fetch() {
                return { status: 'success', data: { type: 'xhs_video', video_url: null } }
            }
        }, '10001', { id: 'note-id' })
        assert.strictEqual(writes, 0)
    })

    it('可用的视频缓存和普通图文缓存继续复用', async function () {
        for (const data of [
            { type: 'xhs_video', video_url: 'https://example.com/fresh.mp4' },
            { type: 'xhs_note', images: [] }
        ]) {
            const cachedInfo = { status: 'success', data }
            cacheManager.get = async () => cachedInfo
            const handler = {
                ...xhsNote,
                async fetch() { throw new Error('should not fetch') }
            }
            const result = await linkFetchService.fetch(handler, '10001', { id: 'note-id' })
            assert.strictEqual(result.fromCache, true)
            assert.strictEqual(result.info, cachedInfo)
        }
    })
})
