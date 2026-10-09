#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')

const { createQqProvider, normalizeProviderName } = require('../../../../src/providers/qq/providerFactory')
const qqRuntime = require('../../../../src/providers/qq/runtime')
const notificationService = require('../../../../src/services/notificationService')

function createAckWebSocket(sent, { failPrimary = false } = {}) {
    const ws = new EventEmitter()
    ws.readyState = 1
    ws.send = (raw, callback) => {
        const payload = JSON.parse(raw)
        sent.push(payload)
        callback?.(null)
        process.nextTick(() => {
            ws.emit('message', JSON.stringify({
                status: failPrimary && sent.length === 1 ? 'failed' : 'ok',
                retcode: failPrimary && sent.length === 1 ? 102902 : 0,
                echo: payload.echo
            }))
        })
    }
    return ws
}

describe('QQ provider selection and notification facade', () => {
    afterEach(() => {
        qqRuntime.clearCurrentProvider()
    })

    it('defaults to napcat and creates official on request', () => {
        assert.equal(normalizeProviderName('onebot'), 'napcat')
        assert.equal(normalizeProviderName('official'), 'official')
        assert.equal(createQqProvider({ provider: 'napcat' }).id, 'napcat')
    })

    it('routes official sends without converting base64 to NapCat file urls', async () => {
        const sent = []
        const provider = {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message, metadata) {
                sent.push({ groupId, message, metadata })
                return { status: 'ok', retcode: 0 }
            }
        }
        qqRuntime.setCurrentProvider(provider)

        await notificationService.runWithSendContext({
            official: {
                msg_id: 'incoming-msg',
                msg_seq: 5
            }
        }, () => notificationService.sendGroupMessage(null, 'group-openid', [
            { type: 'image', data: { file: 'base64://aGVsbG8=' } }
        ], 'test', false))

        assert.equal(sent[0].groupId, 'group-openid')
        assert.equal(sent[0].message[0].data.file, 'base64://aGVsbG8=')
        assert.equal(sent[0].metadata.msg_id, 'incoming-msg')
        assert.equal(sent[0].metadata.msg_seq, 5)
    })

    it('keeps NapCat send payload compatible', async () => {
        const sent = []
        const ws = createAckWebSocket(sent)

        await notificationService.sendGroupMessage(ws, 123, [
            { type: 'text', data: { text: 'hello' } }
        ], 'test', false)
        await notificationService.sendPrivateMessage(ws, 456, 'hi', 'test', false)

        assert.equal(sent[0].action, 'send_group_msg')
        assert.deepEqual(sent[0].params, {
            group_id: 123,
            message: [{ type: 'text', data: { text: 'hello' } }]
        })
        assert.equal(sent[1].action, 'send_private_msg')
        assert.deepEqual(sent[1].params, {
            user_id: 456,
            message: [{ type: 'text', data: { text: 'hi' } }]
        })
    })

    it('routes NapCat provider handles through their WebSocket', async () => {
        const sent = []
        const provider = {
            id: 'napcat',
            ws: createAckWebSocket(sent)
        }

        const groupResult = await notificationService.sendGroupMessage(provider, 123, 'group', 'test', false)
        const privateResult = await notificationService.sendPrivateMessage(provider, 456, 'private', 'test', false)

        assert.equal(groupResult.ok, true)
        assert.equal(privateResult.ok, true)
        assert.equal(sent[0].action, 'send_group_msg')
        assert.equal(sent[1].action, 'send_private_msg')
    })

    it('propagates NapCat send failures when fallback is disabled', async () => {
        const provider = {
            id: 'napcat',
            ws: createAckWebSocket([], { failPrimary: true })
        }

        await assert.rejects(
            () => notificationService.sendGroupMessage(provider, 123, 'group', 'test', false),
            /send_group_msg failed/
        )
    })

    it('reports NapCat fallback use instead of false success', async () => {
        const provider = {
            id: 'napcat',
            ws: createAckWebSocket([], { failPrimary: true })
        }

        const result = await notificationService.sendGroupMessage(provider, 123, 'group', 'test', true)

        assert.equal(result.ok, false)
        assert.equal(result.fallbackUsed, true)
    })

    it('waits for matching video acknowledgement and rejects on socket close', async () => {
        const ws = new EventEmitter()
        ws.readyState = 1
        let payload
        ws.send = raw => { payload = JSON.parse(raw) }
        let settled = false
        const send = notificationService.sendGroupMessage(ws, 123, [{ type: 'video', data: { file: 'file:///tmp/test.mp4' } }], 'test', false)
        send.then(() => { settled = true }, () => { settled = true })
        ws.emit('message', JSON.stringify({ status: 'ok', retcode: 0, echo: 'unrelated' }))
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(settled, false)
        ws.emit('message', JSON.stringify({ status: 'ok', retcode: 0, echo: payload.echo }))
        assert.equal((await send).ok, true)
        const closedSend = notificationService.sendPrivateMessage(ws, 456, 'hello', 'test', false)
        ws.emit('close')
        await assert.rejects(closedSend, /WebSocket closed/)
    })

    it('rejects private uploads with nonzero retcode even when status says ok', async () => {
        const ws = new EventEmitter()
        ws.readyState = 1
        ws.send = raw => {
            const payload = JSON.parse(raw)
            process.nextTick(() => ws.emit('message', JSON.stringify({ status: 'ok', retcode: 1200, wording: 'upload failed', echo: payload.echo })))
        }
        await assert.rejects(notificationService.sendPrivateMessage(ws, 456, 'hello', 'test', false), /1200: upload failed/)
    })

    it('settles broadcast failures for both providers', async () => {
        const napcatResults = await notificationService.notifyGroups({
            id: 'napcat',
            ws: {
                readyState: 1,
                on() {},
                send() {
                    throw new Error('napcat failed')
                }
            }
        }, [123], 'group', 'test')
        const officialResults = await notificationService.notifyGroups({
            id: 'official',
            async sendGroupMessage() {
                throw new Error('official failed')
            }
        }, ['group-openid'], 'group', 'test')

        assert.equal(napcatResults[0].status, 'rejected')
        assert.equal(officialResults[0].status, 'rejected')
    })

    it('routes OneBot actions through a NapCat provider handle', async () => {
        const ws = new EventEmitter()
        ws.readyState = 1
        ws.send = (raw, callback) => {
            const payload = JSON.parse(raw)
            callback?.(null)
            process.nextTick(() => ws.emit('message', JSON.stringify({
                status: 'ok',
                retcode: 0,
                echo: payload.echo,
                data: { user_id: 123 }
            })))
        }

        const response = await notificationService.callAction({ id: 'napcat', ws }, 'get_login_info')

        assert.equal(response.status, 'ok')
        assert.equal(response.data.user_id, 123)
    })

    it('returns structured unsupported action failures under Official provider', async () => {
        const provider = createQqProvider({
            provider: 'official',
            config: {
                qqOfficialAppId: 'app',
                qqOfficialClientSecret: 'secret',
                qqOfficialTokenUrl: 'https://token.example.com',
                qqOfficialApiBase: 'https://api.example.com',
                qqOfficialAccountQpm: 100,
                qqOfficialGroupQpm: 100,
                qqOfficialQueueMaxSize: 10,
                qqOfficialMediaUploadMode: 'hybrid',
                qqOfficialUseShardedGateway: true,
                qqOfficialIntents: 33554432,
                napcatTempPath: '/tmp'
            },
            fetchImpl: async () => ({ ok: true, text: async () => '{}' })
        })

        const result = await provider.callAction('set_group_ban', { group_id: 'g' })

        assert.equal(result.status, 'failed')
        assert.equal(result.retcode, -1)
        assert.match(result.message, /unsupported_official_action:set_group_ban/)
    })
})
