'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')
const bot = require('../../../src/bot')
const config = require('../../../src/config')
const { createDefaultConfig } = require('../../../src/config/schemaV1')
const runtime = require('../../../src/providers/qq/runtime')
const ServiceManager = require('../../../src/services/ServiceManager')
const dashboard = require('../../../src/dashboard/server')
const subscription = require('../../../src/services/subscriptionService')
const approval = require('../../../src/services/requestApprovalService')
const downloads = require('../../../src/services/videoDownloadService')
const notifications = require('../../../src/services/notificationService')
const { applicationAdmissionGate } = require('../../../src/services/runtime/applicationAdmissionGate')
const NapcatProvider = require('../../../src/providers/qq/napcatProvider')

const tick = () => new Promise(resolve => setImmediate(resolve))

class Socket extends EventEmitter {
    constructor() { super(); this.readyState = 1 }
    send() {}
    close() { this.readyState = 3; this.emit('close', 1000) }
}

function provider(id, failure = null) {
    return {
        id, ws: id === 'napcat' ? new Socket() : null, stops: 0,
        async start() {},
        async waitUntilReady() { if (failure) throw failure },
        isRuntimeReady() { return true },
        setWebSocket(socket) { this.ws = socket },
        async stop() { this.stops++; this.ws?.close() }
    }
}

describe('QQ startup failure recovery', () => {
    let restores, timers, calls
    const manager = runtime.providerRuntimeManager
    function stub(target, key, replacement) {
        const original = target[key]
        target[key] = replacement
        restores.push(() => { target[key] = original })
    }
    async function retry() {
        const timer = timers.find(item => !item.cancelled && !item.fired)
        assert.ok(timer, 'expected a pending retry')
        timer.fired = true
        timer.callback()
        await tick()
        return timer.delay
    }
    beforeEach(() => {
        restores = []; timers = []; calls = []
        bot.__testHooks.resetRuntimeState()
        runtime.clearCurrentProvider()
        manager.residualSlots.clear()
        manager.ingressPaused = false
        manager.releaseGate.reset()
        stub(config, 'getSnapshot', () => createDefaultConfig())
        stub(global, 'setTimeout', (callback, delay) => {
            const timer = { callback, delay, cancelled: false, fired: false }
            timers.push(timer)
            return timer
        })
        stub(global, 'clearTimeout', timer => { if (timer) timer.cancelled = true })
        stub(subscription, 'start', async () => { calls.push('subscription') })
        stub(subscription, 'stop', async () => { calls.push('subscription-stop') })
        stub(subscription, 'updateCheckInterval', () => {})
        stub(downloads, 'startCleanupScheduler', () => {})
        stub(notifications, 'startTempImageCleanupScheduler', () => {})
        stub(approval, 'start', () => { calls.push('approval') })
    })
    afterEach(async () => {
        await bot.__testHooks.stopProviderStartupRecovery()
        bot.__testHooks.clearReconnectTimer()
        bot.__testHooks.clearGroupRefreshTimer()
        runtime.clearCurrentProvider()
        manager.residualSlots.clear()
        manager.releaseGate.reset()
        if (applicationAdmissionGate.activeToken) applicationAdmissionGate.open(applicationAdmissionGate.activeToken)
        bot.__testHooks.resetRuntimeState()
        for (const restore of restores.reverse()) restore()
        await tick()
    })

    for (const id of ['napcat', 'official']) {
        it(`keeps the process and Dashboard alive after ${id} readiness failure, then recovers`, async () => {
            stub(ServiceManager, 'start', async () => { calls.push('python') })
            stub(dashboard, 'start', async () => { calls.push('dashboard') })
            stub(dashboard, 'stop', async () => { calls.push('dashboard-stop') })
            stub(process, 'exit', () => { calls.push('exit') })
            const failed = provider(id, Object.assign(new Error('unavailable'), { code: 'READY_TIMEOUT' }))
            const ready = provider(id)
            let attempts = 0
            await bot.initializeBot({ createDescriptor: () => ({ provider: ++attempts === 1 ? failed : ready }) })
            assert.equal(failed.stops, 1)
            assert.equal(runtime.getCurrentProvider(), null)
            assert.deepStrictEqual(calls, ['python', 'dashboard', 'approval'])
            assert.equal(await retry(), 1000)
            assert.equal(runtime.getCurrentProvider(), ready)
            assert.equal(calls.filter(value => value === 'subscription').length, 1)
            assert.ok(!calls.includes('exit'))
            assert.ok(!calls.includes('dashboard-stop'))
        })
    }

    it('cleans up Official token/start failures and caps serial retries at 60 seconds', async () => {
        const instances = []
        const createDescriptor = () => {
            const item = provider('official')
            item.start = async () => { throw new Error('token rejected') }
            instances.push(item)
            return { provider: item }
        }
        await bot.__testHooks.startProviderStartupRecovery(null, { createDescriptor })
        const delays = []
        for (let i = 0; i < 8; i++) delays.push(await retry())
        assert.deepStrictEqual(delays, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000])
        assert.ok(instances.every(item => item.stops === 1))
        assert.equal(timers.filter(item => !item.cancelled && !item.fired).length, 1)
        assert.equal(runtime.getCurrentProvider(), null)
    })

    it('does not release the migration admission gate until a retry is ready', async () => {
        manager.releaseGate.arm('test-epoch')
        let attempts = 0
        await bot.__testHooks.startProviderStartupRecovery('test-epoch', {
            createDescriptor: () => ({ provider: provider('official', ++attempts === 1 ? new Error('down') : null) })
        })
        assert.equal(manager.releaseGate.snapshot().admissionEnabled, false)
        await retry()
        assert.equal(manager.releaseGate.snapshot().admissionEnabled, true)
    })

    it('cancels pending retries and never publishes a late ready result after stop', async () => {
        let resolveReady
        const item = provider('official')
        item.waitUntilReady = () => new Promise(resolve => { resolveReady = resolve })
        const starting = bot.__testHooks.startProviderStartupRecovery(null, { createDescriptor: () => ({ provider: item }) })
        await tick()
        const stopping = bot.__testHooks.stopProviderStartupRecovery()
        resolveReady()
        await Promise.all([starting, stopping])
        assert.equal(item.stops, 1)
        assert.equal(runtime.getCurrentProvider(), null)
        assert.equal(timers.length, 0)
        assert.ok(!calls.includes('subscription'))
    })

    it('retries residual cleanup before constructing another connection', async () => {
        const failed = provider('official', new Error('down'))
        failed.stop = async () => { failed.stops++; if (failed.stops < 3) throw new Error('cleanup failed') }
        let attempts = 0
        await bot.__testHooks.startProviderStartupRecovery(null, {
            createDescriptor: () => ({ provider: ++attempts === 1 ? failed : provider('official') })
        })
        await retry()
        assert.equal(attempts, 1)
        await retry()
        assert.equal(attempts, 2)
        assert.equal(manager.residualSlots.size, 0)
    })

    it('defers recovery while config admission is closed', async () => {
        const token = applicationAdmissionGate.close('test config reload')
        let attempts = 0
        await bot.__testHooks.startProviderStartupRecovery(null, {
            createDescriptor: () => { attempts++; return { provider: provider('official') } }
        })
        await retry()
        assert.equal(attempts, 0)
        applicationAdmissionGate.open(token)
        await retry()
        assert.equal(attempts, 1)
    })

    it('stops old retries for a config reload and resumes after failed preparation', async () => {
        let attempts = 0
        await bot.__testHooks.startProviderStartupRecovery(null, {
            createDescriptor: () => { attempts++; return { provider: provider('official', new Error('down')) } }
        })
        const handler = bot.__testHooks.createQqProviderReloadHandler({
            createDescriptor: () => { throw new Error('invalid candidate') }
        })
        await handler.preflight(createDefaultConfig(), createDefaultConfig(), {})
        assert.equal(timers.filter(item => !item.cancelled && !item.fired).length, 1)
        await assert.rejects(handler.prepareParallel(createDefaultConfig(), createDefaultConfig(), {}), /invalid candidate/)
        assert.equal(timers.filter(item => !item.cancelled && !item.fired).length, 0)
        await handler.rollbackPrepared()
        await tick()
        assert.equal(attempts, 2)
    })

    it('carries the pending startup release epoch into a successful config cutover', async () => {
        manager.releaseGate.arm('startup-epoch')
        await bot.__testHooks.startProviderStartupRecovery('startup-epoch', {
            createDescriptor: () => ({ provider: provider('official', new Error('down')) })
        })
        const ready = provider('official')
        const handler = bot.__testHooks.createQqProviderReloadHandler({
            createDescriptor: () => ({ provider: ready })
        })
        const snapshot = createDefaultConfig()
        await handler.preflight(snapshot, snapshot, {})
        await handler.prepareParallel(snapshot, snapshot, {})
        await handler.commitHandles(snapshot, snapshot, {})
        assert.equal(manager.releaseGate.snapshot().admissionEnabled, false)
        await handler.commitAdmission(snapshot, snapshot, {})
        await handler.afterAdmissionOpen(snapshot, snapshot, {})
        assert.equal(manager.releaseGate.snapshot().admissionEnabled, true)
        assert.equal(runtime.getCurrentProvider(), ready)
        assert.equal(timers.filter(item => !item.cancelled && !item.fired).length, 0)
    })

    it('handles the error emitted when stopping a connecting NapCat socket', async () => {
        const socket = new Socket()
        socket.readyState = 0
        socket.close = () => {
            socket.emit('error', new Error('WebSocket closed before connection established'))
            socket.readyState = 3
            socket.emit('close')
        }
        await new NapcatProvider(socket).stop()
        assert.equal(socket.readyState, 3)
    })

    it('recovers from a real NapCat login probe timeout without publishing the unready socket', async () => {
        let attempts = 0
        const sockets = []
        const starting = bot.__testHooks.startProviderStartupRecovery(null, {
            createDescriptor: () => {
                const socket = new Socket()
                sockets.push(socket)
                const responds = ++attempts > 1
                socket.send = raw => {
                    const request = JSON.parse(raw)
                    if (responds && String(request.echo).startsWith('provider_ready#')) {
                        queueMicrotask(() => socket.emit('message', JSON.stringify({
                            echo: request.echo, retcode: 0, data: { user_id: 123 }
                        })))
                    }
                }
                const item = new NapcatProvider(socket)
                bot.__testHooks.attachNapcatPrecommitBuffer(socket, item)
                return { provider: item, timeoutMs: 15000 }
            }
        })
        assert.equal(runtime.getCurrentProvider(), null)
        const probeTimer = timers.find(item => item.delay === 15000)
        assert.ok(probeTimer)
        probeTimer.fired = true
        probeTimer.callback()
        await starting
        assert.equal(sockets[0].readyState, 3)
        assert.ok(!calls.includes('subscription'))
        await retry()
        assert.equal(runtime.getCurrentProvider().isRuntimeReady(), true)
        assert.equal(calls.filter(value => value === 'subscription').length, 1)
        assert.equal(timers.filter(item => !item.cancelled && !item.fired).length, 0)
    })

    it('uses only the startup retry when NapCat closes while subscriptions are starting', async () => {
        const item = provider('napcat')
        stub(subscription, 'start', async () => { item.ws.close() })
        await bot.__testHooks.startProviderStartupRecovery(null, { createDescriptor: () => ({ provider: item }) })
        await tick()
        assert.equal(runtime.getCurrentProvider(), null)
        assert.equal(timers.filter(timer => !timer.cancelled && !timer.fired).length, 1)
    })
})
