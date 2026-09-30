'use strict'

const assert = require('assert')
const https = require('https')

const linkHandler = require('../../../src/handlers/linkHandler')
const {
    normalizeAweme,
    fetchDouyinContent,
    getAwemeDetail,
    buildPlayUrl,
    extractAwemeId,
} = require('../../../src/services/externalParsers/douyinService')
const { isDouyinOrXhsShortLink, expandExternalShortUrl } = require('../../../src/services/externalParsers/externalShortLinkExpander')
const douyinVideoHandler = require('../../../src/services/link/linkTypes/douyinVideo')
const douyinShortHandler = require('../../../src/services/link/linkTypes/douyinShort')

describe('douyin link extraction', function () {
    it('识别抖音视频长链', function () {
        const links = linkHandler.extractLinks('https://www.douyin.com/video/7521023890996514083', '10001')
        assert.ok(links.some((l) => l.type === 'douyin_video' && l.id === '7521023890996514083'))
    })

    it('识别抖音 note 长链（归 douyin_note 类型，保证图集投递 afterSend 被调度）', function () {
        const links = linkHandler.extractLinks('https://www.douyin.com/note/7469411074119322899', '10001')
        assert.ok(links.some((l) => l.type === 'douyin_note' && l.id === '7469411074119322899'))
        // note 链接不应再命中 video 规则产生重复 descriptor
        assert.ok(!links.some((l) => l.type === 'douyin_video' && l.id === '7469411074119322899'))
    })

    it('识别 iesdouyin.com share/note 链接', function () {
        const links = linkHandler.extractLinks('https://www.iesdouyin.com/share/note/7469411074119322899/', '10001')
        assert.ok(links.some((l) => l.type === 'douyin_note' && l.id === '7469411074119322899'))
    })

    it('识别 m.douyin.com 多段路径分享链接', function () {
        const links = linkHandler.extractLinks('https://m.douyin.com/share/video/7521023890996514083', '10001')
        assert.ok(links.some((l) => l.type === 'douyin_video' && l.id === '7521023890996514083'))
    })

    it('识别 jingxuan.douyin.com 多段路径链接', function () {
        const links = linkHandler.extractLinks('https://jingxuan.douyin.com/m/video/7521023890996514083', '10001')
        assert.ok(links.some((l) => l.type === 'douyin_video' && l.id === '7521023890996514083'))
    })

    it('识别 iesdouyin.com 分享链接', function () {
        const links = linkHandler.extractLinks('https://www.iesdouyin.com/share/video/7521023890996514083/', '10001')
        assert.ok(links.some((l) => l.type === 'douyin_video' && l.id === '7521023890996514083'))
    })

    it('识别 v.douyin.com 短链', function () {
        const links = linkHandler.extractLinks('https://v.douyin.com/iR5kX9y/', '10001')
        assert.ok(links.some((l) => l.type === 'douyin_short' && l.id === 'iR5kX9y'))
    })

    it('识别 jx.douyin.com 短链', function () {
        const links = linkHandler.extractLinks('https://jx.douyin.com/iR5kX9y/', '10001')
        assert.ok(links.some((l) => l.type === 'douyin_short' && l.id === 'iR5kX9y'))
    })

    it('短链识别辅助函数', function () {
        assert.ok(isDouyinOrXhsShortLink('https://v.douyin.com/iR5kX9y/'))
        assert.ok(isDouyinOrXhsShortLink('https://xhslink.com/a/abc123'))
        assert.ok(!isDouyinOrXhsShortLink('https://www.douyin.com/video/7521023890996514083'))
    })
})

describe('douyin normalizeAweme', function () {
    const baseAweme = {
        aweme_id: '7521023890996514083',
        create_time: 1727414400,
        author: {
            nickname: '测试作者',
            signature: '签名',
            avatar_thumb: { url_list: ['https://example.com/avatar.jpg'] },
        },
        share_info: { share_desc: '标题', share_desc_info: '#标题# 正文内容' },
        share_url: 'https://www.iesdouyin.com/share/video/7521023890996514083/?mid=1',
    }

    it('普通视频产生 douyin_video 结构', function () {
        const aweme = {
            ...baseAweme,
            video: {
                duration: 65000,
                play_addr: { uri: 'v0200fg10000' },
                cover: { url_list: ['https://example.com/cover-s.jpg', 'https://example.com/cover-l.jpg'] },
            },
        }
        const data = normalizeAweme(aweme)
        assert.strictEqual(data.type, 'douyin_video')
        assert.strictEqual(data.aweme_id, '7521023890996514083')
        assert.strictEqual(data.title, '正文内容')
        assert.strictEqual(data.author.name, '测试作者')
        assert.strictEqual(data.duration, 65)
        assert.strictEqual(data.play_addr_uri, 'v0200fg10000')
        assert.strictEqual(data.cover, 'https://example.com/cover-l.jpg')
        assert.strictEqual(data.share_url, 'https://www.iesdouyin.com/share/video/7521023890996514083/')
        assert.strictEqual(data.pubdate, 1727414400)
    })

    it('图集产生 douyin_note 结构', function () {
        const aweme = {
            ...baseAweme,
            images: [
                { clip_type: 2, url_list: ['https://example.com/1-s.jpg', 'https://example.com/1-l.jpg'] },
                { clip_type: 2, url_list: ['https://example.com/2-l.jpg'] },
            ],
        }
        const data = normalizeAweme(aweme)
        assert.strictEqual(data.type, 'douyin_note')
        assert.deepStrictEqual(data.images, ['https://example.com/1-l.jpg', 'https://example.com/2-l.jpg'])
        assert.strictEqual(data.cover, 'https://example.com/1-l.jpg')
    })

    it('Live Photo 产生 douyin_live_photo 结构', function () {
        const aweme = {
            ...baseAweme,
            images: [
                { clip_type: 2, url_list: ['https://example.com/photo.jpg'] },
                {
                    clip_type: 1,
                    video: {
                        cover: { url_list: ['https://example.com/lp-cover.jpg'] },
                        play_addr: { uri: 'v0300fg10000' },
                    },
                },
            ],
        }
        const data = normalizeAweme(aweme)
        assert.strictEqual(data.type, 'douyin_live_photo')
        assert.strictEqual(data.livePhotos.length, 1)
        assert.strictEqual(data.livePhotos[0].play_addr_uri, 'v0300fg10000')
        assert.strictEqual(data.livePhotos[0].cover, 'https://example.com/lp-cover.jpg')
        assert.deepStrictEqual(data.images, ['https://example.com/photo.jpg'])
    })

    it('图集 url_list 为空时忽略该图', function () {
        const aweme = {
            ...baseAweme,
            images: [
                { clip_type: 2 },
                { clip_type: 2, url_list: ['https://example.com/ok.jpg'] },
            ],
        }
        const data = normalizeAweme(aweme)
        assert.deepStrictEqual(data.images, ['https://example.com/ok.jpg'])
    })
})

describe('douyin service helpers', function () {
    it('buildPlayUrl 拼接播放地址', function () {
        const url = buildPlayUrl('v0200fg10000')
        assert.strictEqual(
            url,
            'https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg10000&ratio=1080p&line=0'
        )
    })

    it('extractAwemeId 支持多段路径', function () {
        assert.strictEqual(extractAwemeId('https://www.douyin.com/video/7521023890996514083'), '7521023890996514083')
        assert.strictEqual(extractAwemeId('https://m.douyin.com/share/video/7521023890996514083'), '7521023890996514083')
        assert.strictEqual(extractAwemeId('https://jingxuan.douyin.com/m/video/7521023890996514083'), '7521023890996514083')
        assert.strictEqual(extractAwemeId('https://www.douyin.com/discover?modal_id=123'), null)
    })

    it('详情接口 status_code=5 时有界重试并恢复', async function () {
        let calls = 0
        const waits = []
        const detail = { aweme_id: '7650834539283862457' }
        const result = await getAwemeDetail('7650834539283862457', {
            fetcher: async () => {
                calls++
                if (calls < 3) return { status_code: 5 }
                return { status_code: 0, aweme_detail: detail }
            },
            wait: async (ms) => { waits.push(ms) },
        })

        assert.strictEqual(result, detail)
        assert.strictEqual(calls, 3)
        assert.deepStrictEqual(waits, [150, 350])
    })

    it('详情接口确定性错误不重试', async function () {
        let calls = 0
        await assert.rejects(
            getAwemeDetail('7650834539283862457', {
                fetcher: async () => {
                    calls++
                    return { status_code: 4 }
                },
                wait: async () => { throw new Error('should not wait') },
            }),
            /status_code=4/
        )
        assert.strictEqual(calls, 1)
    })

    it('已展开的抖音长链先提取 aweme_id 再请求详情', async function () {
        const originalGet = https.get
        let requestedUrl = ''
        https.get = (url, _options, callback) => {
            requestedUrl = String(url)
            const response = new (require('events').EventEmitter)()
            response.statusCode = 200
            const req = new (require('events').EventEmitter)()
            req.destroy = () => {}
            process.nextTick(() => {
                callback(response)
                response.emit('data', JSON.stringify({
                    status_code: 0,
                    aweme_detail: { aweme_id: '7650834539283862457' },
                }))
                response.emit('end')
            })
            return req
        }

        try {
            const data = await fetchDouyinContent(
                'https://www.douyin.com/video/7650834539283862457?previous_page=app_code_link'
            )
            assert.strictEqual(data.aweme_id, '7650834539283862457')
            assert.match(requestedUrl, /aweme_id=7650834539283862457/)
            assert.ok(!requestedUrl.includes(encodeURIComponent('https://www.douyin.com/video/')))
        } finally {
            https.get = originalGet
        }
    })
})

describe('douyinShort handler', function () {
    it('保留 jx.douyin.com 原始短链域名和查询参数', function () {
        const descriptor = {
            id: 'iR5kX9y',
            match: 'jx.douyin.com/iR5kX9y',
            sourceToken: 'https://jx.douyin.com/iR5kX9y/?from=share',
        }
        assert.strictEqual(
            douyinShortHandler.buildShortUrl(descriptor),
            'https://jx.douyin.com/iR5kX9y/?from=share'
        )
    })

    it('不可信原始地址回退到 v.douyin.com', function () {
        assert.strictEqual(
            douyinShortHandler.buildShortUrl({ id: 'iR5kX9y', sourceToken: 'https://evil.example/iR5kX9y/' }),
            'https://v.douyin.com/iR5kX9y/'
        )
    })
})

describe('expandExternalShortUrl', function () {
    const originalRequest = https.request

    function mockRequest(handler) {
        https.request = handler
    }

    afterEach(function () {
        https.request = originalRequest
    })

    function fakeReq(callback, response) {
        const req = {
            on() { return req },
            end() { callback(response) },
            destroy() {},
        }
        return req
    }

    it('302 跟随到展开后的 URL', async function () {
        const calls = []
        mockRequest((url, options, callback) => {
            calls.push({ url, method: options.method })
            if (url.includes('v.douyin.com')) {
                return fakeReq(callback, {
                    statusCode: 302,
                    headers: { location: 'https://www.douyin.com/video/7521023890996514083' },
                    resume() {},
                })
            }
            return fakeReq(callback, { statusCode: 200, headers: {}, resume() {} })
        })

        const result = await expandExternalShortUrl('https://v.douyin.com/iR5kX9y/')
        assert.strictEqual(result, 'https://www.douyin.com/video/7521023890996514083')
    })

    it('HEAD 返回 405 时用 GET 重试（GET fallback）', async function () {
        const calls = []
        mockRequest((url, options, callback) => {
            calls.push({ url, method: options.method })
            if (url.includes('www.douyin.com')) {
                return fakeReq(callback, { statusCode: 200, headers: {}, resume() {} })
            }
            if (options.method === 'HEAD') {
                return fakeReq(callback, { statusCode: 405, headers: {}, resume() {} })
            }
            return fakeReq(callback, {
                statusCode: 302,
                headers: { location: 'https://www.douyin.com/video/7521023890996514083' },
                resume() {},
            })
        })

        const result = await expandExternalShortUrl('https://v.douyin.com/iR5kX9y/')
        assert.strictEqual(result, 'https://www.douyin.com/video/7521023890996514083')
        // HEAD 405 → GET 重试 → 302 → HEAD 落地页 200 → GET fallback → 200 结束
        assert.deepStrictEqual(calls.map((c) => c.method), ['HEAD', 'GET', 'HEAD', 'GET'])
    })

    it('重定向到白名单外域名时终止并返回当前 URL', async function () {
        mockRequest((url, options, callback) => {
            return fakeReq(callback, {
                statusCode: 302,
                headers: { location: 'https://evil.example.com/steal' },
                resume() {},
            })
        })

        const result = await expandExternalShortUrl('https://v.douyin.com/iR5kX9y/')
        assert.strictEqual(result, 'https://v.douyin.com/iR5kX9y/')
    })

    it('跟随 302 到 www.iesdouyin.com（短链第一跳真实目标）', async function () {
        mockRequest((url, options, callback) => {
            if (url.includes('v.douyin.com')) {
                return fakeReq(callback, {
                    statusCode: 302,
                    headers: { location: 'https://www.iesdouyin.com/share/video/7650834539283862457/?from_ssr=1' },
                    resume() {},
                })
            }
            return fakeReq(callback, { statusCode: 200, headers: {}, resume() {} })
        })

        const result = await expandExternalShortUrl('https://v.douyin.com/0zAOSqLaT9Y/')
        assert.strictEqual(result, 'https://www.iesdouyin.com/share/video/7650834539283862457/?from_ssr=1')
    })

    it('非 3xx 且无 Location 时返回原 URL', async function () {
        mockRequest((url, options, callback) => {
            return fakeReq(callback, { statusCode: 404, headers: {}, resume() {} })
        })

        const result = await expandExternalShortUrl('https://v.douyin.com/iR5kX9y/')
        assert.strictEqual(result, 'https://v.douyin.com/iR5kX9y/')
    })
})

describe('douyinVideo handler', function () {
    it('平台未开启时 fetch 返回 disabled', async function () {
        const descriptor = { id: '7521023890996514083', type: 'douyin_video' }
        const info = await douyinVideoHandler.fetch('10001', descriptor)
        assert.strictEqual(info.status, 'disabled')
    })

    it('disabled 时 buildUrl 返回 null、buildFetchFailureText 返回 null（pipeline 静默跳过）', function () {
        const descriptor = { id: '7521023890996514083', type: 'douyin_video' }
        assert.strictEqual(douyinVideoHandler.buildUrl(descriptor, { status: 'disabled' }), null)
        assert.strictEqual(douyinVideoHandler.buildFetchFailureText({ status: 'disabled' }), null)
    })

    it('disabled 时 resolveCardType 走默认兜底', function () {
        assert.strictEqual(douyinVideoHandler.resolveCardType({ status: 'disabled' }), 'douyin_video')
    })

    it('getCacheIdentity 返回 aweme_id', function () {
        assert.strictEqual(douyinVideoHandler.getCacheIdentity({ id: '7521023890996514083' }), '7521023890996514083')
    })

    it('声明了 60s 缓存 TTL', function () {
        assert.strictEqual(douyinVideoHandler.cacheTtlSeconds, 60)
    })
})

describe('douyinShort afterSend（短链投递分发）', function () {
    const config = require('../../../src/config')
    const externalMediaDelivery = require('../../../src/services/externalMediaDeliveryService')
    const compatState = config.__getMutableCompatStateForTests()
    const originalExternalParsers = structuredClone(compatState.externalParsers)
    const originalDownloadAndSend = externalMediaDelivery.downloadAndSend
    const originalDeliverImages = externalMediaDelivery.deliverImages
    const originalDeliverLivePhotoGroup = externalMediaDelivery.deliverLivePhotoGroup

    afterEach(function () {
        compatState.externalParsers = structuredClone(originalExternalParsers)
        externalMediaDelivery.downloadAndSend = originalDownloadAndSend
        externalMediaDelivery.deliverImages = originalDeliverImages
        externalMediaDelivery.deliverLivePhotoGroup = originalDeliverLivePhotoGroup
    })

    it('短链展开为视频时触发下载投递', async function () {
        compatState.externalParsers.douyin = { enabled: true, downloadEnabled: true }
        const calls = []
        externalMediaDelivery.downloadAndSend = async (options) => { calls.push(options); return true }

        await douyinShortHandler.afterSend({
            ws: {},
            groupId: '10001',
            info: {
                data: {
                    type: 'douyin_video',
                    aweme_id: '7521023890996514083',
                    title: '标题',
                    duration: 6,
                    play_addr_uri: 'v0200fg10000',
                    author: { name: '作者' },
                },
            },
        })

        assert.strictEqual(calls.length, 1)
        assert.strictEqual(
            calls[0].url,
            'https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg10000&ratio=1080p&line=0'
        )
        assert.strictEqual(calls[0].durationSeconds, 6)
    })

    it('短链展开为图集时触发图片投递，且不触发视频下载', async function () {
        compatState.externalParsers.douyin = { enabled: true, downloadEnabled: true }
        let downloadCalls = 0
        const imageCalls = []
        externalMediaDelivery.downloadAndSend = async () => { downloadCalls += 1 }
        externalMediaDelivery.deliverImages = async (ws, groupId, images, label) => {
            imageCalls.push({ images, label })
        }

        await douyinShortHandler.afterSend({
            ws: {},
            groupId: '10001',
            info: {
                data: {
                    type: 'douyin_note',
                    aweme_id: '7469411074119322899',
                    title: '图集标题',
                    images: ['https://example.com/1.jpg'],
                },
            },
        })

        assert.strictEqual(downloadCalls, 0)
        assert.strictEqual(imageCalls.length, 1)
        assert.deepStrictEqual(imageCalls[0].images, ['https://example.com/1.jpg'])
    })
})
