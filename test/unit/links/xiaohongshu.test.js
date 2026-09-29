'use strict'

const assert = require('assert')

const linkHandler = require('../../../src/handlers/linkHandler')
const {
    extractInitialState,
    normalizeNote,
    extractNoteId,
} = require('../../../src/services/externalParsers/xiaohongshuService')
const xhsNoteHandler = require('../../../src/services/link/linkTypes/xhsNote')

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

    it('无 query string 的链接也能提取（queryString 为空串）', function () {
        const result = extractNoteId(`https://www.xiaohongshu.com/explore/${NOTE_ID}`)
        assert.deepStrictEqual(result, { noteId: NOTE_ID, queryString: '' })
    })

    it('无法提取时返回 null', function () {
        assert.strictEqual(extractNoteId('https://www.xiaohongshu.com/explore/notanoteid'), null)
    })
})

describe('xhsNote handler', function () {
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

    it('getCacheIdentity 返回 note_id', function () {
        assert.strictEqual(xhsNoteHandler.getCacheIdentity({ id: NOTE_ID }), NOTE_ID)
    })
})
