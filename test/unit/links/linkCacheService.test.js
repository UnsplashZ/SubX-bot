'use strict'

const assert = require('assert')

const config = require('../../../src/config')
const linkCacheService = require('../../../src/services/link/linkCacheService')

describe('linkCacheService', function () {
    const compatState = config.__getMutableCompatStateForTests()
    const originalTimeout = compatState.linkCacheTimeout

    afterEach(function () {
        compatState.linkCacheTimeout = originalTimeout
        delete compatState.groupConfigs['external-cache-group']
    })
    beforeEach(function () {
        linkCacheService.__resetForTests()
        delete config.__getMutableCompatStateForTests().groupConfigs['test-group']
        delete config.__getMutableCompatStateForTests().groupConfigs['expire-group']
    })

    it('marks cache keys and reports hits before expiry', function () {
        config.__getMutableCompatStateForTests().groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = 'video|BV1xx411c7mD|test-group'
        const markedKey = linkCacheService.markProcessed(cacheKey)

        assert.strictEqual(markedKey, cacheKey)
        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })

    it('builds cache keys from descriptors', function () {
        config.__getMutableCompatStateForTests().groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = linkCacheService.markProcessedDescriptor({
            type: 'favorite_list',
            id: '456',
            groupId: 'test-group',
            meta: { uniqueId: 'video:456' }
        })

        assert.strictEqual(cacheKey, 'favorite_list|video:456|test-group')
        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })

    it('keeps existing entries when the group timeout is extended before cleanup', function () {
        config.__getMutableCompatStateForTests().groupConfigs['expire-group'] = { linkCacheTimeout: 1 }

        const cacheKey = 'dynamic|123456|expire-group'
        linkCacheService.markProcessed(cacheKey)
        linkCacheService.__setCacheTimeForTests(cacheKey, Date.now() - 1500)
        config.__getMutableCompatStateForTests().groupConfigs['expire-group'].linkCacheTimeout = 60

        linkCacheService.cleanupExpired()

        assert.strictEqual(linkCacheService.isCached(cacheKey), true)
    })

    it('expires existing cache entries immediately when the group timeout is shortened', function () {
        config.__getMutableCompatStateForTests().groupConfigs['test-group'] = { linkCacheTimeout: 60 }

        const cacheKey = 'video|BV1xx411c7mD|test-group'
        linkCacheService.markProcessed(cacheKey)
        linkCacheService.__setCacheTimeForTests(cacheKey, Date.now() - 30000)
        config.__getMutableCompatStateForTests().groupConfigs['test-group'].linkCacheTimeout = 10

        assert.strictEqual(linkCacheService.isCached(cacheKey), false)
    })

    it('抖音和小红书长短链共用 Dashboard 全局冷却并立即跟随修改', function () {
        const types = ['douyin_video', 'douyin_note', 'douyin_short', 'xhs_note', 'xhs_short']
        compatState.linkCacheTimeout = 60
        for (const type of types) {
            const key = `${type}|content-id|external-cache-group`
            linkCacheService.markProcessed(key)
            linkCacheService.__setCacheTimeForTests(key, Date.now() - 30000)
            assert.strictEqual(linkCacheService.isCached(key), true)
        }

        compatState.linkCacheTimeout = 10
        for (const type of types) {
            assert.strictEqual(linkCacheService.isCached(`${type}|content-id|external-cache-group`), false)
        }
    })

    it('外部链接优先使用 Dashboard 群级冷却；设为 0 后不再阻止重复解析', function () {
        compatState.linkCacheTimeout = 1
        compatState.groupConfigs['external-cache-group'] = { linkCacheTimeout: 60 }
        for (const type of ['douyin_video', 'douyin_short', 'xhs_note', 'xhs_short']) {
            const key = `${type}|content-id|external-cache-group`
            linkCacheService.markProcessed(key)
            linkCacheService.__setCacheTimeForTests(key, Date.now() - 30000)
            assert.strictEqual(linkCacheService.isCached(key), true)
        }

        compatState.groupConfigs['external-cache-group'].linkCacheTimeout = 0
        for (const type of ['douyin_video', 'douyin_short', 'xhs_note', 'xhs_short']) {
            assert.strictEqual(linkCacheService.isCached(`${type}|content-id|external-cache-group`), false)
        }
    })
})
