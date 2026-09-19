'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')
const Notification = require('../../../src/services/notificationService')
const groupAdmin = require('../../../src/services/qqGroupAdminService')
const { detectImplementation, getImplementation } = require('../../../src/providers/qq/onebotCompatibility')

function socket(appName) {
    const ws = new EventEmitter()
    ws.readyState = 1
    ws.calls = []
    ws.send = (raw, callback) => {
        const request = JSON.parse(raw)
        ws.calls.push(request)
        callback?.()
        queueMicrotask(() => ws.emit('message', JSON.stringify({
            echo: request.echo, status: 'ok', retcode: 0,
            data: request.action === 'get_version_info' ? { app_name: appName } : null
        })))
    }
    return ws
}

describe('OneBot implementation compatibility', () => {
    it('does not send a mutation after implementation detection exhausts the timeout', async () => {
        const ws = socket('LLOneBot')
        ws.send = (raw, callback) => { ws.calls.push(JSON.parse(raw)); callback?.() }
        await assert.rejects(Notification.callAction(ws, '_del_group_notice', {}, 'Test', 20), /timeout/)
        assert.deepStrictEqual(ws.calls.map(x => x.action), ['get_version_info'])
    })

    it('honors a shorter caller deadline while sharing a pending detection', async () => {
        const ws = socket('LLOneBot')
        let release
        const probe = detectImplementation(ws, () => new Promise(resolve => { release = resolve }))
        await assert.rejects(Notification.callAction(ws, '_del_group_notice', {}, 'Test', 20), /timeout/)
        assert.equal(ws.calls.length, 0)
        release({ status: 'ok', retcode: 0, data: { app_name: 'LLOneBot' } })
        await probe
        assert.equal(ws.calls.length, 0)
    })

    it('detects LLBot and sends the correct notice deletion action exactly once', async () => {
        const ws = socket('LLOneBot')
        const params = { group_id: '123', notice_id: 'fixture' }
        await Notification.callAction(ws, '_del_group_notice', params)
        assert.deepStrictEqual(ws.calls.map(x => x.action), ['get_version_info', '_delete_group_notice'])
        assert.deepStrictEqual(ws.calls[1].params, params)
        assert.equal(getImplementation({ ws }), 'llbot')
    })

    it('rejects filtered-only queries without substituting all group requests', async () => {
        const ws = socket('LLOneBot')
        await assert.rejects(Notification.callAction(ws, 'get_group_ignored_notifies'),
            error => error.code === 'ONEBOT_ACTION_UNSUPPORTED')
        assert.deepStrictEqual(ws.calls.map(x => x.action), ['get_version_info'])
    })

    it('preserves NapCat action names and caches detection per connection', async () => {
        const ws = socket('NapCat')
        await Notification.callAction(ws, '_del_group_notice', {})
        await Notification.callAction(ws, '_del_group_notice', {})
        assert.deepStrictEqual(ws.calls.map(x => x.action), ['get_version_info', '_del_group_notice', '_del_group_notice'])
        assert.equal(getImplementation(socket('LLOneBot')), 'unknown')
    })

    it('coalesces concurrent detection and permits retry after failure', async () => {
        const ws = {}
        let calls = 0
        const probe = async () => { calls++; return { status: 'ok', retcode: 0, data: { app_name: 'LLOneBot' } } }
        await Promise.all([detectImplementation(ws, probe), detectImplementation(ws, probe)])
        assert.equal(calls, 1)
        const other = {}
        assert.equal(await detectImplementation(other, async () => { throw Error('offline') }), 'unknown')
        assert.equal(await detectImplementation(other, probe), 'llbot')
    })

    it('normalizes both invitation field names without leaking other groups', () => {
        for (const key of ['InvitedRequest', 'invited_requests']) {
            const result = groupAdmin.filterSystemMessagesByGroup({
                [key]: [{ group_id: 123, request_id: 1 }, { group_id: 456, request_id: 2 }],
                join_requests: [{ group_id: 123, request_id: 3 }]
            }, '123')
            assert.equal(result.invitedRequests.length, 1)
            assert.equal(result.joinRequests.length, 1)
        }
    })

    it('preserves SnowLuma mixed arrays without guessing request types or leaking other groups', () => {
        const result = groupAdmin.filterSystemMessagesByGroup([
            { group_id: 123, request_id: 1, invitor_uin: 99, flag: 'opaque' },
            { group_id: 123, request_id: 2 },
            { group_id: 456, request_id: 3 }
        ], '123')
        assert.equal(result.joinRequests.length, 0)
        assert.equal(result.invitedRequests.length, 0)
        assert.equal(result.unclassifiedRequests.length, 2)
        assert.equal(result.unclassifiedRequests[0].raw.flag, 'opaque')
    })
})
