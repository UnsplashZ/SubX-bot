'use strict'

const assert = require('assert')
const fs = require('fs').promises
const os = require('os')
const path = require('path')

const cacheManager = require('../../../src/utils/cacheManager')
const config = require('../../../src/config')

describe('cacheManager freshness semantics', function () {
    const originals = {
        cacheDir: cacheManager.cacheDir,
        initPromise: cacheManager.initPromise,
        dataCacheTTL: config.dataCacheTTL
    }

    let tempDir = ''

    beforeEach(async function () {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-manager-freshness-'))
        cacheManager.cacheDir = tempDir
        cacheManager.initPromise = fs.mkdir(tempDir, { recursive: true })
        config.__getMutableCompatStateForTests().dataCacheTTL = 60
    })

    afterEach(async function () {
        cacheManager.cacheDir = originals.cacheDir
        cacheManager.initPromise = originals.initPromise
        config.__getMutableCompatStateForTests().dataCacheTTL = originals.dataCacheTTL

        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true })
        }
    })

    it('读取缓存不应延长其 TTL', async function () {
        const cacheKey = 'user:123:test'
        const filePath = path.join(tempDir, `${cacheKey}.json`)
        const staleFetchedAt = Date.now() - 120 * 1000

        await fs.writeFile(filePath, JSON.stringify({
            __cacheMeta: {
                fetchedAt: staleFetchedAt
            },
            payload: {
                status: 'success',
                data: { name: 'tester' }
            }
        }))

        const first = await cacheManager.get(cacheKey)
        assert.strictEqual(first, null)

        await fs.writeFile(filePath, JSON.stringify({
            __cacheMeta: {
                fetchedAt: Date.now() - 30 * 1000
            },
            payload: {
                status: 'success',
                data: { name: 'tester' }
            }
        }))

        const statsBefore = await fs.stat(filePath)
        const second = await cacheManager.get(cacheKey)
        const statsAfter = await fs.stat(filePath)

        assert.deepStrictEqual(second, {
            status: 'success',
            data: { name: 'tester' }
        })
        assert.strictEqual(statsAfter.mtimeMs, statsBefore.mtimeMs)
    })

    it('兼容旧格式缓存文件', async function () {
        const cacheKey = 'user:legacy:test'
        const filePath = path.join(tempDir, `${cacheKey}.json`)

        await fs.writeFile(filePath, JSON.stringify({
            status: 'success',
            data: { name: 'legacy' }
        }))

        const result = await cacheManager.get(cacheKey)
        assert.deepStrictEqual(result, {
            status: 'success',
            data: { name: 'legacy' }
        })
    })

    it('读取时的 TTL 上限淘汰没有 per-key TTL 的旧媒体缓存', async function () {
        config.__getMutableCompatStateForTests().dataCacheTTL = 3600
        const cacheKey = 'xhs_note_stale-video'
        await fs.writeFile(path.join(tempDir, `${cacheKey}.json`), JSON.stringify({
            __cacheMeta: { fetchedAt: Date.now() - 120000 },
            payload: { status: 'success', data: { video_url: 'https://example.com/expired.mp4' } }
        }))

        assert.strictEqual(await cacheManager.get(cacheKey, 60), null)
    })

    it('读取时的 TTL 上限不延长已保存的更短 TTL', async function () {
        const cacheKey = 'xhs_note_short-ttl'
        await fs.writeFile(path.join(tempDir, `${cacheKey}.json`), JSON.stringify({
            __cacheMeta: { fetchedAt: Date.now() - 30000, ttlSeconds: 10 },
            payload: { status: 'success', data: {} }
        }))

        assert.strictEqual(await cacheManager.get(cacheKey, 60), null)
    })
})
