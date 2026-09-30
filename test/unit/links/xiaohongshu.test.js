'use strict'

const assert = require('assert')

const linkHandler = require('../../../src/handlers/linkHandler')
const {
    extractInitialState,
    normalizeNote,
    extractVideoUrl,
    extractNoteId,
} = require('../../../src/services/externalParsers/xiaohongshuService')
const xhsNoteHandler = require('../../../src/services/link/linkTypes/xhsNote')
const xhsShortHandler = require('../../../src/services/link/linkTypes/xhsShort')
const externalMediaDelivery = require('../../../src/services/externalMediaDeliveryService')
const config = require('../../../src/config')

const NOTE_ID = '68feefe40000000007030c4a'

describe('xiaohongshu link extraction', function () {
    it('识别 explore 长链并保留 xsec_token', function () {
        const links = linkHandler.extractLinks(
            `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=ABCD1234&xsec_source=pc_share`,
            '10001'
        )
        const note = links.find((l) => l.type === 'xhs_note')
        assert.ok(note, '应解析出 xhs_note')
        assert.strictEqual(note.id, NOTE_ID)
        assert.strictEqual(note.meta.queryString, '?xsec_token=ABCD1234&xsec_source=pc_share')
    })

    it('兼容分享文本中的转义查询分隔符', function () {
        const links = linkHandler.extractLinks(
            `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=ABCD1234\\&xsec_source=pc_share`,
            '10001'
        )
        const note = links.find((l) => l.type === 'xhs_note')
        assert.ok(note)
        assert.strictEqual(note.meta.queryString, '?xsec_token=ABCD1234&xsec_source=pc_share')
    })

    it('兼容 HTML 转义的 amp 查询分隔符和 Markdown 链接', function () {
        const links = linkHandler.extractLinks(
            `[查看笔记](https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=TOKEN\\&amp;xsec_source=pc_feed)`,
            '10001'
        )
        assert.strictEqual(links[0].meta.queryString, '?xsec_token=TOKEN&xsec_source=pc_feed')
    })

    it('从完整 Markdown 链接中提取真实目标 URL', function () {
        const links = linkHandler.extractLinks(
            `[查看小红书笔记](https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=TOKEN\\&xsec_source=pc_feed)`,
            '10001'
        )
        const note = links.find((l) => l.type === 'xhs_note')
        assert.ok(note)
        assert.strictEqual(note.id, NOTE_ID)
        assert.strictEqual(note.meta.queryString, '?xsec_token=TOKEN&xsec_source=pc_feed')
    })

    it('识别 discovery/item 长链', function () {
        const links = linkHandler.extractLinks(
            `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}?xsec_token=TOKEN`,
            '10001'
        )
        const note = links.find((l) => l.type === 'xhs_note')
        assert.ok(note)
        assert.strictEqual(note.id, NOTE_ID)
        assert.strictEqual(note.meta.queryString, '?xsec_token=TOKEN')
    })

    it('识别 xhslink 短链', function () {
        const links = linkHandler.extractLinks('https://xhslink.com/a/1abcdEFgh2', '10001')
        assert.ok(links.some((l) => l.type === 'xhs_short' && l.id === 'a/1abcdEFgh2'))
    })

    it('识别 xhslink.cn 短链', function () {
        const links = linkHandler.extractLinks('https://xhslink.cn/a/1abcdEFgh2', '10001')
        assert.ok(links.some((l) => l.type === 'xhs_short' && l.id === 'a/1abcdEFgh2'))
    })

    it('无 query string 时 meta.queryString 为空串', function () {
        const links = linkHandler.extractLinks(`https://www.xiaohongshu.com/explore/${NOTE_ID}`, '10001')
        const note = links.find((l) => l.type === 'xhs_note')
        assert.ok(note)
        assert.strictEqual(note.meta.queryString, '')
    })
})

describe('xhs extractInitialState', function () {
    it('解析含 undefined 字面值的 INITIAL STATE', function () {
        const html = `<html><body><script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${NOTE_ID}":{"note":{"title":"hello"}}}},"user":undefined}</script></body></html>`
        const state = extractInitialState(html)
        assert.strictEqual(state.note.noteDetailMap[NOTE_ID].note.title, 'hello')
        assert.strictEqual(state.user, null)
    })

    it('解析含空 Map 和换行的 INITIAL STATE', function () {
        const html = `<script>window.__INITIAL_STATE__ = {
            "note": {"noteDetailMap": {}},
            "tailMap": new Map([]),
            "extra": new Set()
        };</script>`
        const state = extractInitialState(html)
        assert.deepStrictEqual(state.tailMap, {})
        assert.deepStrictEqual(state.extra, {})
    })

    it('缺少 INITIAL STATE 时抛错', function () {
        assert.throws(() => extractInitialState('<html></html>'), /__INITIAL_STATE__ not found/)
    })

    it('JSON 非法时抛错', function () {
        const html = '<script>window.__INITIAL_STATE__={broken</script>'
        assert.throws(() => extractInitialState(html), /JSON parse failed/)
    })
})

describe('xhs normalizeNote', function () {
    it('图文笔记产生 xhs_note 结构（explore 形态 user 字段）', function () {
        const noteData = {
            noteId: NOTE_ID,
            type: 'normal',
            title: '笔记标题',
            desc: '笔记正文',
            time: 1727414400000,
            user: { nickname: '小红书用户', avatar: 'https://example.com/a.jpg' },
            imageList: [
                { urlDefault: 'https://example.com/1.jpg', url: 'https://example.com/1-s.jpg' },
                { url: 'https://example.com/2.jpg' },
            ],
        }
        const data = normalizeNote(noteData, 'explore')
        assert.strictEqual(data.type, 'xhs_note')
        assert.strictEqual(data.note_id, NOTE_ID)
        assert.strictEqual(data.title, '笔记标题')
        assert.strictEqual(data.desc, '笔记正文')
        assert.strictEqual(data.author.name, '小红书用户')
        assert.strictEqual(data.author.face, 'https://example.com/a.jpg')
        assert.strictEqual(data.pubdate, 1727414400)
        assert.deepStrictEqual(data.images, ['https://example.com/1.jpg', 'https://example.com/2.jpg'])
        assert.strictEqual(data.cover, 'https://example.com/1.jpg')
    })

    it('http 图床地址升级为 https（投递侧仅支持 https 抓取）', function () {
        const noteData = {
            noteId: NOTE_ID,
            type: 'normal',
            user: { nickname: 'u', avatar: 'http://example.com/a.jpg' },
            imageList: [
                { urlDefault: 'http://sns-webpic-qc.xhscdn.com/1.jpg' },
                { url: 'http://sns-webpic-qc.xhscdn.com/2.jpg' },
            ],
        }
        const data = normalizeNote(noteData, 'discovery')
        assert.deepStrictEqual(data.images, [
            'https://sns-webpic-qc.xhscdn.com/1.jpg',
            'https://sns-webpic-qc.xhscdn.com/2.jpg',
        ])
        assert.strictEqual(data.cover, 'https://sns-webpic-qc.xhscdn.com/1.jpg')
        assert.strictEqual(data.author.face, 'https://example.com/a.jpg')
    })

    it('视频笔记产生 xhs_video 结构并提取最优流', function () {
        const noteData = {
            id: NOTE_ID,
            type: 'video',
            title: '视频标题',
            desc: '',
            time: 1727414400000,
            author: { nickName: '视频作者', avatarUrl: 'https://example.com/va.jpg' },
            imageList: [{ urlDefault: 'https://example.com/cover.jpg' }],
            video: {
                media: {
                    stream: {
                        h265: [{ masterUrl: 'https://example.com/h265.mp4', duration: 30000 }],
                        h264: [{ masterUrl: 'https://example.com/h264.mp4', duration: 30000 }],
                    },
                },
            },
        }
        const data = normalizeNote(noteData, 'discovery')
        assert.strictEqual(data.type, 'xhs_video')
        assert.strictEqual(data.video_url, 'https://example.com/h265.mp4')
        assert.strictEqual(data.video_duration, 30)
        assert.strictEqual(data.cover, 'https://example.com/cover.jpg')
        assert.strictEqual(data.author.name, '视频作者')
    })

    it('视频流缺失时 video_url 为 null', function () {
        const noteData = { type: 'video', video: {} }
        const data = normalizeNote(noteData, 'explore')
        assert.strictEqual(data.type, 'xhs_video')
        assert.strictEqual(data.video_url, null)
        assert.strictEqual(data.video_duration, 0)
    })

    it('兼容视频流使用 urlList / play_url 字段', function () {
        const result = extractVideoUrl({
            media: {
                stream: {
                    h264: [{
                        urlList: ['https://example.com/fallback.mp4'],
                        duration: 31,
                    }],
                },
            },
        })
        assert.strictEqual(result.url, 'https://example.com/fallback.mp4')
        assert.strictEqual(result.duration, 31)

        const alternate = extractVideoUrl({
            media: { play_url: 'https://example.com/play.mp4', duration: 32000 },
        })
        assert.strictEqual(alternate.url, 'https://example.com/play.mp4')
        assert.strictEqual(alternate.duration, 32)
    })

    it('兼容 mediaV2、对象形式备用地址和协议相对地址', function () {
        const result = extractVideoUrl({
            mediaV2: {
                stream: {
                    h264: [{
                        urlList: [{ url: '//cdn.example.com/video.mp4' }],
                        videoDuration: 1500,
                    }],
                },
            },
        })
        assert.strictEqual(result.url, '//cdn.example.com/video.mp4')
        assert.strictEqual(result.duration, 1)
        assert.strictEqual(normalizeNote({
            noteId: NOTE_ID,
            type: 'video',
            video: { media: { stream: {} } },
            imageList: [],
        }, 'discovery').video_url, null)
    })

    it('兼容小红书当前 EF4/EF5 视频流字段和 JSON 字符串 mediaV2', function () {
        const result = extractVideoUrl({
            mediaV2: JSON.stringify({
                stream: {
                    EF4: [{ masterUrl: 'https://example.com/259.mp4', duration: 12567 }],
                    EF5: [{ masterUrl: 'https://example.com/520.mp4', duration: 12567 }],
                },
            }),
        })
        assert.strictEqual(result.url, 'https://example.com/520.mp4')
        assert.strictEqual(result.duration, 12)
    })

    it('未知编码键和 snake_case 字段仍能提取视频地址', function () {
        const result = extractVideoUrl({
            mediaV2: JSON.stringify({
                stream: { futureCodec: [{ master_url: 'https://example.com/future.mp4', duration: 24000 }] }
            })
        })
        assert.deepStrictEqual(result, { url: 'https://example.com/future.mp4', duration: 24 })
    })

    it('非法 mediaV2 不影响仍可用的 media 视频流', function () {
        const result = extractVideoUrl({
            mediaV2: '{broken',
            media: { stream: { EF4: [{ masterUrl: 'https://example.com/video.mp4', duration: 12000 }] } }
        })
        assert.deepStrictEqual(result, { url: 'https://example.com/video.mp4', duration: 12 })
    })
})

describe('xhs extractNoteId', function () {
    it('从 explore URL 提取 noteId + queryString', function () {
        const result = extractNoteId(`https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=TOKEN&xsec_source=pc`)
        assert.deepStrictEqual(result, { noteId: NOTE_ID, queryString: '?xsec_token=TOKEN&xsec_source=pc' })
    })

    it('从 discovery URL 提取 noteId + queryString', function () {
        const result = extractNoteId(`https://www.xiaohongshu.com/discovery/item/${NOTE_ID}?xsec_token=TOKEN`)
        assert.deepStrictEqual(result, { noteId: NOTE_ID, queryString: '?xsec_token=TOKEN' })
    })

    it('extractNoteId 兼容转义查询分隔符', function () {
        const result = extractNoteId(`https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=TOKEN\\&xsec_source=pc`)
        assert.deepStrictEqual(result, { noteId: NOTE_ID, queryString: '?xsec_token=TOKEN&xsec_source=pc' })
    })

    it('extractNoteId 兼容 HTML 转义查询分隔符', function () {
        const result = extractNoteId(`https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=TOKEN&amp;xsec_source=pc`)
        assert.deepStrictEqual(result, { noteId: NOTE_ID, queryString: '?xsec_token=TOKEN&xsec_source=pc' })
    })

    it('无 query string 的链接也能提取（queryString 为空串）', function () {
        const result = extractNoteId(`https://www.xiaohongshu.com/explore/${NOTE_ID}`)
        assert.deepStrictEqual(result, { noteId: NOTE_ID, queryString: '' })
    })

    it('无法提取时返回 null', function () {
        assert.strictEqual(extractNoteId('https://www.xiaohongshu.com/explore/notanoteid'), null)
    })

    it('从 login redirectPath 提取编码后的 discovery URL', function () {
        const target = `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}?xsec_token=TOKEN&xsec_source=pc`
        const loginUrl = `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(target)}`
        assert.deepStrictEqual(extractNoteId(loginUrl), {
            noteId: NOTE_ID,
            queryString: '?xsec_token=TOKEN&xsec_source=pc'
        })
    })

    it('非法 redirectPath 返回 null', function () {
        const loginUrl = `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent('https://example.com/not-xhs')}`
        assert.strictEqual(extractNoteId(loginUrl), null)
    })
})

describe('xhsNote handler', function () {
    const compatState = config.__getMutableCompatStateForTests()
    const originalExternalParsers = structuredClone(compatState.externalParsers)
    const originalDownloadAndSend = externalMediaDelivery.downloadAndSend

    afterEach(function () {
        compatState.externalParsers = structuredClone(originalExternalParsers)
        externalMediaDelivery.downloadAndSend = originalDownloadAndSend
    })

    it('平台未开启时 fetch 返回 disabled', async function () {
        const descriptor = { id: NOTE_ID, type: 'xhs_note', meta: {} }
        const info = await xhsNoteHandler.fetch('10001', descriptor)
        assert.strictEqual(info.status, 'disabled')
    })

    it('disabled 时 buildUrl 返回 null、buildFetchFailureText 返回 null（pipeline 静默跳过）', function () {
        const descriptor = { id: NOTE_ID, type: 'xhs_note' }
        assert.strictEqual(xhsNoteHandler.buildUrl(descriptor, { status: 'disabled' }), null)
        assert.strictEqual(xhsNoteHandler.buildFetchFailureText({ status: 'disabled' }), null)
    })

    it('disabled 时 resolveCardType 走默认兜底', function () {
        assert.strictEqual(xhsNoteHandler.resolveCardType({ status: 'disabled' }), 'xhs_note')
    })

    it('正常时 buildUrl 返回 explore 链接', function () {
        const descriptor = { id: NOTE_ID, type: 'xhs_note' }
        assert.strictEqual(xhsNoteHandler.buildUrl(descriptor, { status: 'success' }), `https://www.xiaohongshu.com/explore/${NOTE_ID}`)
    })

    it('buildUrl 保留 xsec_token 且不重复拼接问号', function () {
        const descriptor = {
            id: NOTE_ID,
            type: 'xhs_note',
            meta: { queryString: '?xsec_token=ABCD1234&xsec_source=pc_share' },
        }
        assert.strictEqual(
            xhsNoteHandler.buildUrl(descriptor, { status: 'success' }),
            `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=ABCD1234&xsec_source=pc_share`
        )
    })

    it('getCacheIdentity 返回 note_id', function () {
        assert.strictEqual(xhsNoteHandler.getCacheIdentity({ id: NOTE_ID }), NOTE_ID)
    })

    it('视频预览发送后自动下载并携带小红书请求头', async function () {
        compatState.externalParsers.xiaohongshu.enabled = true
        compatState.externalParsers.xiaohongshu.downloadEnabled = true
        compatState.externalParsers.xiaohongshu.cookie = 'a=1; b=2'
        const calls = []
        externalMediaDelivery.downloadAndSend = async (options) => {
            calls.push(options)
            return true
        }

        await xhsNoteHandler.afterSend({
            ws: { name: 'socket' },
            groupId: '10001',
            info: {
                data: {
                    type: 'xhs_video',
                    note_id: NOTE_ID,
                    title: '视频标题',
                    video_url: 'https://example.com/video.mp4',
                    video_duration: 42,
                    author: { name: '作者' },
                },
            },
        })

        assert.strictEqual(calls.length, 1)
        assert.strictEqual(calls[0].url, 'https://example.com/video.mp4')
        assert.strictEqual(calls[0].durationSeconds, 42)
        assert.strictEqual(calls[0].maxDurationSeconds, 120)
        assert.strictEqual(calls[0].maxFileSizeBytes, 50 * 1024 * 1024)
        assert.deepStrictEqual(calls[0].requestHeaders, {
            Referer: 'https://www.xiaohongshu.com/',
            Cookie: 'a=1; b=2',
        })
    })

    it('关闭下载开关或缺少视频地址时跳过投递', async function () {
        compatState.externalParsers.xiaohongshu.downloadEnabled = false
        let callCount = 0
        externalMediaDelivery.downloadAndSend = async () => { callCount += 1 }

        const context = {
            ws: {},
            groupId: '10001',
            info: { data: { type: 'xhs_video', video_url: 'https://example.com/video.mp4' } },
        }
        await xhsNoteHandler.afterSend(context)
        await xhsNoteHandler.afterSend({
            ...context,
            info: { data: { type: 'xhs_video', video_url: null } },
        })
        assert.strictEqual(callCount, 0)
    })

    it('下载异常只记录日志，不阻断链接处理', async function () {
        compatState.externalParsers.xiaohongshu.downloadEnabled = true
        externalMediaDelivery.downloadAndSend = async () => {
            throw new Error('HTTP 403')
        }
        await assert.doesNotReject(() => xhsNoteHandler.afterSend({
            ws: {},
            groupId: '10001',
            info: { data: { type: 'xhs_video', note_id: NOTE_ID, video_url: 'https://example.com/video.mp4' } },
        }))
    })
})

describe('xhsShort handler', function () {
    const compatState = config.__getMutableCompatStateForTests()
    const originalExternalParsers = structuredClone(compatState.externalParsers)
    const originalDownloadAndSend = externalMediaDelivery.downloadAndSend

    afterEach(function () {
        compatState.externalParsers = structuredClone(originalExternalParsers)
        externalMediaDelivery.downloadAndSend = originalDownloadAndSend
    })

    it('复用 xhsNote 的 afterSend：视频笔记触发下载投递', async function () {
        compatState.externalParsers.xiaohongshu.enabled = true
        compatState.externalParsers.xiaohongshu.downloadEnabled = true
        const calls = []
        externalMediaDelivery.downloadAndSend = async (options) => { calls.push(options); return true }

        assert.strictEqual(typeof xhsShortHandler.afterSend, 'function')
        await xhsShortHandler.afterSend({
            ws: {},
            groupId: '10001',
            info: {
                data: {
                    type: 'xhs_video',
                    note_id: NOTE_ID,
                    title: '视频标题',
                    video_url: 'https://example.com/video.mp4',
                    video_duration: 10,
                },
            },
        })

        assert.strictEqual(calls.length, 1)
        assert.strictEqual(calls[0].url, 'https://example.com/video.mp4')
    })

    it('复用 xhsNote 的 afterSend：图文笔记不触发下载', async function () {
        compatState.externalParsers.xiaohongshu.enabled = true
        compatState.externalParsers.xiaohongshu.downloadEnabled = true
        let callCount = 0
        externalMediaDelivery.downloadAndSend = async () => { callCount += 1 }

        await xhsShortHandler.afterSend({
            ws: {},
            groupId: '10001',
            info: { data: { type: 'xhs_note', note_id: NOTE_ID, images: [] } },
        })

        assert.strictEqual(callCount, 0)
    })
})
