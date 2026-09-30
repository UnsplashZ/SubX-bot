'use strict'

const assert = require('assert')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const https = require('https')
const { EventEmitter } = require('events')
const { Readable } = require('stream')
const config = require('../../../src/config')
const linkDomain = require('../../../src/services/link')
const { normalizeNote } = require('../../../src/services/externalParsers/xiaohongshuService')

describe('小红书视频预览后的下载投递管线', function () {
    const compat = config.__getMutableCompatStateForTests()
    const original = {
        get: https.get,
        napcatTempPath: compat.napcatTempPath,
        napcatReadPath: compat.napcatReadPath,
        externalParsers: structuredClone(compat.externalParsers)
    }
    let tempDir

    beforeEach(async function () {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xhs-delivery-pipeline-'))
        compat.napcatTempPath = tempDir
        compat.napcatReadPath = tempDir
        compat.externalParsers.xiaohongshu.downloadEnabled = true
        compat.externalParsers.xiaohongshu.cookie = 'test-cookie=1'
        linkDomain.__resetCacheForTests()
    })

    afterEach(async function () {
        https.get = original.get
        compat.napcatTempPath = original.napcatTempPath
        compat.napcatReadPath = original.napcatReadPath
        compat.externalParsers = structuredClone(original.externalParsers)
        linkDomain.__resetCacheForTests()
        await fs.rm(tempDir, { recursive: true, force: true })
    })

    for (const type of ['xhs_note', 'xhs_short']) {
        it(`${type} 的 EF5 视频先发送预览，再下载落盘并投递视频`, async function () {
            const payload = Buffer.from('test-mp4-payload')
            let requestCount = 0
            https.get = (url, options, callback) => {
                requestCount += 1
                assert.strictEqual(url, 'https://cdn.example.com/video.mp4')
                assert.strictEqual(options.headers.Referer, 'https://www.xiaohongshu.com/')
                assert.strictEqual(options.headers.Cookie, 'test-cookie=1')
                const request = new EventEmitter()
                request.destroy = () => {}
                process.nextTick(() => {
                    const response = Readable.from([payload])
                    response.statusCode = 200
                    response.headers = { 'content-length': String(payload.length) }
                    callback(response)
                })
                return request
            }
            const data = normalizeNote({
                noteId: '6abba2d9000000000200e10b',
                title: '视频笔记',
                type: 'video',
                video: { media: { stream: { EF5: [{
                    masterUrl: 'http://cdn.example.com/video.mp4', duration: 12567
                }] } } }
            }, 'explore')
            const order = []
            const sent = []
            const result = await linkDomain.processLinkDescriptors([{ type, id: 'delivery-test' }], {
                ws: { readyState: 1, send(raw) { order.push('video'); sent.push(JSON.parse(raw)) } },
                groupId: '10001'
            }, {
                fetchLinkInfo: async () => ({ info: { status: 'success', data }, fromCache: false }),
                prepareLinkRender: async () => ({ status: 'card_ready', cardType: 'xhs_video', url: '' }),
                sendPreparedLink: async () => { order.push('preview') }
            })

            assert.strictEqual(result.successCount, 1)
            assert.strictEqual(requestCount, 1)
            assert.deepStrictEqual(order, ['preview', 'video'])
            assert.strictEqual(sent[0].action, 'send_group_msg')
            assert.strictEqual(sent[0].params.group_id, 10001)
            const video = sent[0].params.message.find(message => message.type === 'video')
            assert.ok(video.data.file.startsWith(`file://${tempDir}/ext-downloads/`))
            assert.deepStrictEqual(await fs.readFile(video.data.file.slice('file://'.length)), payload)
        })
    }
})
