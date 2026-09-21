'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')

const { ServiceManager } = require('../../../src/services/ServiceManager')
const { ReloadRegistry } = require('../../../src/config/reloadRegistry')
const { applicationAdmissionGate } = require('../../../src/services/runtime/applicationAdmissionGate')

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function snapshot(port = 12001, overrides = {}) {
    return {
        paths: {
            python: 'python3',
            biliScript: './src/services/bili_server.py',
            napcatTemp: '/tmp/bili-runtime-a',
            ...(overrides.paths || {})
        },
        pythonService: { port, ...(overrides.pythonService || {}) }
    }
}

function createManager(options = {}) {
    return new ServiceManager({
        bypassSingleton: true,
        configProvider: () => snapshot(),
        httpClient: options.httpClient || { get: async () => { throw new Error('offline') } },
        spawn: options.spawn || (() => { throw new Error('unexpected spawn') })
    })
}

describe('ServiceManager runtime reconfigure', function () {
    const originalSecret = process.env.RUNTIME_TEST_SECRET

    afterEach(async function () {
        if (originalSecret === undefined) delete process.env.RUNTIME_TEST_SECRET
        else process.env.RUNTIME_TEST_SECRET = originalSecret
        if (applicationAdmissionGate.snapshot().closed && applicationAdmissionGate.activeToken) {
            applicationAdmissionGate.open(applicationAdmissionGate.activeToken)
        }
    })

    it('passes only an OS allowlist plus declared runtime identity to Python', async function () {
        process.env.RUNTIME_TEST_SECRET = 'must-not-leak'
        const manager = createManager()
        const runtime = manager.resolveRuntimeConfig(snapshot())
        const identity = manager.createRuntimeIdentity(runtime)
        const env = manager.buildChildEnv(runtime, identity)

        assert.equal(env.RUNTIME_TEST_SECRET, undefined)
        assert.equal(env.NAPCAT_TEMP_PATH, '/tmp/bili-runtime-a')
        assert.equal(env.BILI_RUNTIME_INSTANCE_ID, identity.instanceId)
        assert.equal(env.BILI_RUNTIME_EFFECT_HASH, identity.effectHash)
        assert.equal(env.BILI_RUNTIME_RESOURCE_GENERATION, '1')
        await manager.cleanup()
    })

    it('re-resolves pythonPath from the config provider when start runs', async function () {
        const spawned = []
        const spawn = (command, args) => {
            spawned.push({ command, args })
            const child = new EventEmitter()
            child.stdout = new EventEmitter()
            child.stderr = new EventEmitter()
            child.exitCode = null
            child.kill = () => {
                child.exitCode = 0
                child.emit('exit', 0, 'SIGTERM')
                return true
            }
            return child
        }
        const manager = new ServiceManager({
            bypassSingleton: true,
            configProvider: () => snapshot(12031, { paths: { python: 'venv-python-marker' } }),
            httpClient: { get: async () => { throw new Error('offline') } },
            spawn
        })
        manager.waitForHealth = async () => {}

        await manager.start()

        assert.equal(spawned.length, 1)
        assert.equal(spawned[0].command, 'venv-python-marker')
        assert.equal(manager.pythonPath, 'venv-python-marker')
        await manager.stop({ timeoutMs: 50, forceGraceMs: 50 })
        await manager.cleanup()
    })

    it('requires health identity, generation, effect hash, build and pid to match', async function () {
        const manager = createManager()
        const runtime = manager.resolveRuntimeConfig(snapshot())
        const identity = manager.createRuntimeIdentity(runtime)
        manager.httpClient = {
            get: async () => ({
                status: 200,
                data: {
                    status: 'ok',
                    instanceId: identity.instanceId,
                    resourceGeneration: identity.resourceGeneration,
                    effectHash: identity.effectHash,
                    buildVersion: identity.buildVersion,
                    pid: 123
                }
            })
        }

        assert.equal(await manager.isServiceHealthy(50, identity), true)
        assert.equal(await manager.isServiceHealthy(50, { ...identity, instanceId: 'stale' }), false)
        await manager.cleanup()
    })

    it('pauses new RPCs and waits for an in-flight RPC before applying new args', async function () {
        const manager = createManager()
        const inFlight = deferred()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = { pid: 2, exitCode: null }
        manager.process = oldChild
        manager._sendCommand = async () => inFlight.promise

        const rpc = manager.sendCommand('video', {})
        let oldTerminated = false
        manager.startCandidateRuntime = async () => ({
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002'
        })
        manager.isServiceHealthy = async () => true
        manager.terminateChild = async (child) => {
            child.exitCode = 0
            if (child === oldChild) oldTerminated = true
        }

        const reload = manager.reconfigure(snapshot(12002))
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(oldTerminated, false, 'old child must stay alive while its RPC lease is active')
        await assert.rejects(() => manager.sendCommand('article', {}), /ingress paused/)

        inFlight.resolve({ status: 'ok' })
        await rpc
        const result = await reload
        assert.equal(result.changed, true)
        assert.equal(manager.port, 12002)
        assert.equal(manager.process, candidateChild)
        assert.equal(oldTerminated, true)
        assert.equal(manager.requestRegistry.paused, false)
        manager.process = null
        await manager.cleanup()
    })

    it('keeps old args and service when the parallel candidate is not healthy', async function () {
        const manager = createManager()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = { pid: 2, exitCode: null }
        manager.process = oldChild
        manager.startCandidateRuntime = async () => ({
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002'
        })
        manager.isServiceHealthy = async () => false
        let candidateTerminated = false
        manager.terminateChild = async (child) => {
            if (child === candidateChild) candidateTerminated = true
            child.exitCode = 0
        }

        await assert.rejects(
            () => manager.reconfigure(snapshot(12002)),
            (error) => error.code === 'PYTHON_CANDIDATE_NOT_READY'
        )
        assert.equal(manager.port, 12001)
        assert.equal(manager.process, oldChild)
        assert.equal(candidateTerminated, true)
        assert.equal(manager.resourceGeneration, 1)
        assert.equal(manager.requestRegistry.paused, false)
        manager.process = null
        await manager.cleanup()
    })

    it('rechecks candidate identity health immediately before reload-handler commit', async function () {
        const manager = createManager()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = { pid: 2, exitCode: null }
        manager.process = oldChild
        manager.activeIdentity = { instanceId: 'old' }
        manager.startCandidateRuntime = async () => ({
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002'
        })
        manager.isServiceHealthy = async () => false
        manager.terminateChild = async (child) => { child.exitCode = 0 }
        const handler = manager.createReloadHandler()

        await handler.preflight(snapshot(12002))
        await handler.prepareParallel()
        await handler.pauseIngress()
        await handler.preCommitDrain()
        await handler.prepareExclusive()
        await assert.rejects(
            () => handler.commitHandles(),
            (error) => error.code === 'PYTHON_CANDIDATE_NOT_READY'
        )
        assert.equal(manager.process, oldChild)
        assert.equal(manager.port, 12001)
        await handler.rollbackExclusive()
        await handler.rollbackPrepared()
        await handler.restorePrevious()
        manager.process = null
        await manager.cleanup()
    })

    it('revalidates the committed child at the admission barrier and reverses to the old runtime', async function () {
        const manager = createManager()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = { pid: 2, exitCode: null }
        const candidateRuntime = {
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002',
            invalidated: false
        }
        manager.process = oldChild
        manager.activeIdentity = { instanceId: 'old' }
        manager.startCandidateRuntime = async () => candidateRuntime
        manager.isServiceHealthy = async () => !candidateRuntime.invalidated
        manager.terminateChild = async (child) => { child.exitCode = 0 }
        const handler = manager.createReloadHandler()

        await handler.preflight(snapshot(12002))
        await handler.prepareParallel()
        await handler.pauseIngress()
        await handler.preCommitDrain()
        await handler.prepareExclusive()
        await handler.commitHandles()
        assert.equal(manager.process, oldChild, 'parallel candidate stays staged until old retirement succeeds')
        candidateRuntime.invalidated = true

        await assert.rejects(
            () => handler.validateAdmission(),
            error => error.code === 'PYTHON_CANDIDATE_NOT_READY'
        )
        await handler.rollbackExclusive()
        await handler.rollbackPrepared()
        await handler.restorePrevious()
        assert.equal(manager.process, oldChild)
        assert.equal(manager.activeIdentity.instanceId, 'old')
        manager.process = null
        await manager.cleanup()
    })

    it('keeps admission paused and rolls back consistently when old-child retirement fails', async function () {
        const manager = createManager()
        const oldChild = new EventEmitter()
        oldChild.pid = 1
        oldChild.exitCode = null
        const candidateChild = new EventEmitter()
        candidateChild.pid = 2
        candidateChild.exitCode = null
        const oldIdentity = { instanceId: 'old' }
        manager.process = oldChild
        manager.activeIdentity = oldIdentity
        manager.startCandidateRuntime = async () => ({
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002'
        })
        manager.isServiceHealthy = async (_timeout, identity) => identity?.instanceId !== 'candidate' || candidateChild.exitCode == null
        let spawned = 0
        manager._startUnlocked = async () => { spawned += 1 }
        manager.terminateChild = async (child) => {
            if (child === oldChild) {
                const error = Object.assign(new Error('old retirement failed'), {
                    code: 'PYTHON_PROCESS_STOP_TIMEOUT', residualPid: oldChild.pid
                })
                manager.rememberResidualChild(oldChild, error, 'previous')
                throw error
            }
            child.exitCode = 0
        }
        const handler = manager.createReloadHandler()

        await handler.preflight(snapshot(12002))
        await handler.prepareParallel()
        await handler.pauseIngress()
        await handler.preCommitDrain()
        await handler.prepareExclusive()
        await handler.commitHandles()
        await assert.rejects(() => handler.validateAdmission(), error => error.code === 'PYTHON_PROCESS_STOP_TIMEOUT')

        assert.equal(manager.requestRegistry.paused, true)
        assert.equal(manager.pythonPath, 'python3')
        assert.equal(manager.port, 12001)
        assert.equal(manager.resourceGeneration, 1)
        assert.equal(manager.process, null, 'a possibly terminating old handle must not remain published')
        assert.equal(manager.activeIdentity, null)

        await handler.rollbackExclusive()
        await handler.rollbackPrepared()
        await handler.restorePrevious()
        assert.equal(manager.process, oldChild)
        assert.equal(manager.activeIdentity, oldIdentity)
        assert.equal(manager.resourceGeneration, 1)
        assert.equal(spawned, 0, 'rollback must reclaim the live old child rather than spawn another Python child')
        manager.process = null
        await manager.cleanup()
    })

    it('waits for the old child natural exit before publishing the parallel candidate', async function () {
        const manager = createManager()
        const oldChild = new EventEmitter()
        oldChild.pid = 1
        oldChild.exitCode = null
        oldChild.kill = () => {
            setImmediate(() => {
                oldChild.exitCode = 0
                oldChild.emit('exit', 0, 'SIGTERM')
            })
            return true
        }
        const candidateChild = new EventEmitter()
        candidateChild.pid = 2
        candidateChild.exitCode = null
        manager.process = oldChild
        manager.activeIdentity = { instanceId: 'old' }
        manager.startCandidateRuntime = async () => ({
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002'
        })
        manager.isServiceHealthy = async () => true
        const handler = manager.createReloadHandler()

        await handler.preflight(snapshot(12002))
        await handler.prepareParallel()
        await handler.pauseIngress()
        await handler.preCommitDrain()
        await handler.prepareExclusive()
        await handler.commitHandles()
        assert.equal(manager.process, oldChild)
        assert.equal(manager.requestRegistry.paused, true)
        await handler.validateAdmission()
        assert.equal(oldChild.exitCode, 0)
        assert.equal(manager.process, candidateChild)
        assert.equal(manager.activeIdentity.instanceId, 'candidate')
        assert.equal(manager.resourceGeneration, 2)
        assert.equal(manager.requestRegistry.paused, true, 'local RPC admission opens only in enableIngress')
        await handler.enableIngress()
        handler.finalizeAdmission()
        await handler.afterAdmissionOpen()
        await handler.disposeOld()
        manager.process = null
        await manager.cleanup()
    })

    it('surfaces candidate rollback termination failure and retains its residual pid', async function () {
        const manager = createManager()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = new EventEmitter()
        candidateChild.pid = 2
        candidateChild.exitCode = null
        manager.process = oldChild
        manager.startCandidateRuntime = async () => ({
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002',
            invalidated: false
        })
        manager.terminateChild = async (child) => {
            if (child === candidateChild) {
                const error = Object.assign(new Error('candidate terminate failed'), {
                    code: 'PYTHON_PROCESS_STOP_TIMEOUT',
                    residualPid: 2
                })
                manager.rememberResidualChild(child, error, 'candidate')
                throw error
            }
            child.exitCode = 0
        }
        const handler = manager.createReloadHandler()
        await handler.preflight(snapshot(12002))
        await handler.prepareParallel()

        await assert.rejects(
            () => handler.rollbackPrepared(),
            error => error.code === 'PYTHON_PROCESS_STOP_TIMEOUT'
        )
        assert.equal(manager.getResourceCounts().residualChildren, 1)
        assert.deepEqual(manager.getResourceCounts().residualPids, [2])

        candidateChild.exitCode = 0
        candidateChild.emit('exit', 0, 'SIGKILL')
        manager.process = null
        await manager.cleanup()
    })

    it('restores the previous runtime after a same-port candidate fails admission', async function () {
        const manager = createManager()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = { pid: 2, exitCode: null }
        const restoredChild = { pid: 3, exitCode: null }
        const candidateRuntime = {
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12001',
            invalidated: false
        }
        manager.process = oldChild
        manager.activeIdentity = { instanceId: 'old' }
        manager.allocateProbePort = async () => 12099
        manager.probeRuntime = async () => ({ identity: { instanceId: 'probe' }, port: 12099 })
        manager.startCandidateRuntime = async () => candidateRuntime
        manager.isServiceHealthy = async () => !candidateRuntime.invalidated
        manager.terminateChild = async (child) => { child.exitCode = 0 }
        manager._startUnlocked = async () => {
            manager.process = restoredChild
            manager.activeIdentity = { instanceId: 'restored-old' }
        }
        const handler = manager.createReloadHandler()
        const samePortChangedPath = snapshot(12001, {
            paths: { python: '/opt/new-python' }
        })

        await handler.preflight(samePortChangedPath)
        await handler.prepareParallel()
        await handler.pauseIngress()
        await handler.preCommitDrain()
        await handler.prepareExclusive()
        assert.equal(oldChild.exitCode, 0)
        await handler.commitHandles()
        candidateRuntime.invalidated = true
        await assert.rejects(() => handler.validateAdmission(), error => error.code === 'PYTHON_CANDIDATE_NOT_READY')
        await handler.rollbackExclusive()
        await handler.rollbackPrepared()
        await handler.restorePrevious()

        assert.equal(manager.pythonPath, 'python3')
        assert.equal(manager.port, 12001)
        assert.equal(manager.process, restoredChild)
        assert.equal(manager.activeIdentity.instanceId, 'restored-old')
        manager.process = null
        await manager.cleanup()
    })

    it('stops at a hard deadline and reports the residual pid when a child never exits', async function () {
        const manager = createManager()
        const child = new EventEmitter()
        child.pid = 4242
        child.exitCode = null
        child.kill = () => true
        manager.process = child
        manager.activeIdentity = { instanceId: 'stuck' }

        await assert.rejects(
            () => manager.stop({ timeoutMs: 5, forceGraceMs: 5 }),
            (error) => error.code === 'PYTHON_PROCESS_STOP_TIMEOUT' && error.residualPid === 4242
        )
        assert.equal(manager.process, null)
        assert.equal(manager.activeIdentity, null)
        assert.equal(manager.getResourceCounts().residualChildren, 1)
        assert.deepEqual(manager.getResourceCounts().residualPids, [4242])
        await assert.rejects(() => manager.start(), error => error.code === 'PYTHON_RESIDUAL_PROCESS_PRESENT')

        child.kill = () => {
            child.exitCode = 0
            child.emit('exit', 0, 'SIGTERM')
            return true
        }
        await manager.stop({ timeoutMs: 5, forceGraceMs: 5 })
        assert.equal(manager.getResourceCounts().residualChildren, 0)
        await manager.cleanup()
    })

    it('ignores stale child exit callbacks and cleans timers and the active child', async function () {
        const children = []
        const spawn = () => {
            const child = new EventEmitter()
            child.stdout = new EventEmitter()
            child.stderr = new EventEmitter()
            child.exitCode = null
            child.kill = () => {
                child.exitCode = 0
                child.emit('exit', 0, 'SIGTERM')
            }
            children.push(child)
            return child
        }
        let currentIdentity = null
        const manager = createManager({
            spawn,
            httpClient: {
                get: async () => {
                    if (!currentIdentity) throw new Error('offline')
                    return {
                        status: 200,
                        data: { status: 'ok', ...currentIdentity, pid: 123 }
                    }
                }
            }
        })
        const originalCreateIdentity = manager.createRuntimeIdentity.bind(manager)
        manager.createRuntimeIdentity = (...args) => {
            currentIdentity = originalCreateIdentity(...args)
            return currentIdentity
        }

        await manager.start()
        const stale = children[0]
        manager.process = { pid: 999 }
        stale.emit('exit', 1, null)
        assert.equal(manager.process.pid, 999)

        manager.process = stale
        await manager.cleanup()
        const counts = manager.getResourceCounts()
        assert.equal(counts.child, 0)
        assert.equal(counts.restartTimer, 0)
        assert.equal(counts.idleTimer, 0)
        assert.equal(counts.activeOperations, 0)
    })

    it('aborts active RPC operations and returns a bounded cleanup result', async function () {
        const manager = createManager()
        const operation = manager.requestRegistry.run('stuck-rpc', ({ abortSignal }) => new Promise((resolve, reject) => {
            abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
        }))
        await new Promise(resolve => setImmediate(resolve))
        const result = manager.abortOperations('test-abort')
        assert.equal(result.requested, 1)
        await assert.rejects(() => operation, /test-abort/)
        await manager.requestRegistry.drain({ timeoutMs: 50 })
        assert.equal(manager.getResourceCounts().activeOperations, 0)
        await manager.cleanup()
    })

    it('aborts after drain timeout and never starts another long cleanup wait', async function () {
        const manager = createManager()
        const operation = manager.requestRegistry.run('shutdown-rpc', ({ abortSignal }) => new Promise((resolve, reject) => {
            abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
        }))
        await new Promise(resolve => setImmediate(resolve))
        const startedAt = Date.now()
        await assert.rejects(
            () => manager.cleanup({ drainTimeoutMs: 5, abortDrainTimeoutMs: 50, stopTimeoutMs: 5 }),
            error => ['OPERATION_DRAIN_TIMEOUT', 'PYTHON_RUNTIME_CLEANUP_FAILED'].includes(error.code)
        )
        await assert.rejects(() => operation, /shutdown-drain-timeout/)
        assert.ok(Date.now() - startedAt < 500)
        assert.equal(manager.getResourceCounts().activeOperations, 0)
    })

    it('reports Python rollback cleanup failure through ReloadRegistry rollbackErrors', async function () {
        const manager = createManager()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = new EventEmitter()
        candidateChild.pid = 2
        candidateChild.exitCode = null
        manager.process = oldChild
        manager.startCandidateRuntime = async () => ({
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002',
            invalidated: false
        })
        manager.terminateChild = async (child) => {
            if (child === candidateChild) {
                const error = Object.assign(new Error('candidate cleanup failed'), {
                    code: 'PYTHON_PROCESS_STOP_TIMEOUT',
                    residualPid: 2
                })
                manager.rememberResidualChild(child, error, 'candidate')
                throw error
            }
            child.exitCode = 0
        }
        const registry = new ReloadRegistry()
        registry.register(manager.createReloadHandler())
        registry.register({
            id: 'later-python-fault',
            effects: ['python'],
            async prepareParallel() { throw new Error('later prepare failed') }
        })

        await assert.rejects(
            () => registry.prepare({
                candidate: snapshot(12002),
                previous: snapshot(12001),
                diff: [{ path: ['pythonService', 'port'], effects: ['python'] }]
            }),
            error => error.rollbackErrors?.some((entry) => (
                entry.handlerId === 'python-runtime' && entry.code === 'PYTHON_PROCESS_STOP_TIMEOUT'
            ))
        )
        assert.equal(manager.getResourceCounts().residualChildren, 1)
        candidateChild.exitCode = 0
        candidateChild.emit('exit', 0, 'SIGKILL')
        manager.process = null
        await manager.cleanup()
    })

    it('retains a partially prepared Python child so transaction rollback can recover it', async function () {
        const manager = createManager()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = { pid: 2, exitCode: null }
        manager.process = oldChild
        manager.activeIdentity = { instanceId: 'old' }
        manager.startCandidateRuntime = async (next, options) => {
            const runtime = {
                child: candidateChild,
                identity: { instanceId: 'candidate' },
                baseUrl: 'http://127.0.0.1:12002',
                invalidated: false
            }
            options.onSpawn?.(runtime)
            const error = new Error('candidate health failed')
            error.prepareCleanupError = Object.assign(new Error('first cleanup failed'), {
                code: 'PYTHON_PROCESS_STOP_TIMEOUT',
                residualPid: 2
            })
            throw error
        }
        let cleanupAttempts = 0
        manager.terminateChild = async (child) => {
            cleanupAttempts += 1
            child.exitCode = 0
        }
        const registry = new ReloadRegistry()
        registry.register(manager.createReloadHandler())

        await assert.rejects(
            () => registry.prepare({
                candidate: snapshot(12002),
                previous: snapshot(12001),
                diff: [{ path: ['pythonService', 'port'], effects: ['python'] }]
            }),
            error => error.message.includes('prepareParallel') && !error.rollbackErrors
        )
        assert.equal(cleanupAttempts, 1)
        assert.equal(manager.getResourceCounts().residualChildren, 0)
        assert.equal(registry.admissionGate.snapshot().closed, false)
        manager.process = null
        await manager.cleanup()
    })

    it('passes the operation abort signal through to the real HTTP request', async function () {
        let requestSignal = null
        const manager = createManager({
            httpClient: {
                get: async () => { throw new Error('offline') },
                post: async (url, data, options) => {
                    requestSignal = options.signal
                    return new Promise((resolve, reject) => {
                        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
                    })
                }
            }
        })
        manager.process = { pid: 1, exitCode: null }
        const request = manager.sendCommand('video', {})
        await new Promise(resolve => setImmediate(resolve))
        assert.ok(requestSignal)
        manager.abortOperations('shutdown-http-abort')
        await assert.rejects(() => request, /shutdown-http-abort/)
        manager.process = null
        await manager.cleanup()
    })

    it('serializes idle restart with start/stop and defers it while admission is closed', async function () {
        const manager = createManager()
        manager.lastRequestTime = 0
        let restartCalls = 0
        manager._restartUnlocked = async () => { restartCalls += 1 }
        const gateToken = applicationAdmissionGate.close('test-python-transition')

        const deferredIdle = await manager.checkIdle()
        assert.equal(deferredIdle.deferred, true)
        assert.equal(restartCalls, 0)
        applicationAdmissionGate.open(gateToken)
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(restartCalls, 1)

        const first = deferred()
        const events = []
        manager._stopUnlocked = async () => {
            events.push('stop:start')
            await first.promise
            events.push('stop:end')
        }
        manager._startUnlocked = async () => { events.push('start') }
        const stopping = manager.stop()
        const starting = manager.start()
        await new Promise(resolve => setImmediate(resolve))
        assert.deepEqual(events, ['stop:start'])
        first.resolve()
        await Promise.all([stopping, starting])
        assert.deepEqual(events, ['stop:start', 'stop:end', 'start'])

        const handler = manager.createReloadHandler()
        await handler.preflight(snapshot())
        await handler.prepareParallel()
        const startDuringReload = manager.start()
        await new Promise(resolve => setImmediate(resolve))
        assert.deepEqual(events, ['stop:start', 'stop:end', 'start'])
        await handler.pauseIngress()
        await handler.preCommitDrain()
        await handler.prepareExclusive()
        await handler.commitHandles()
        await handler.validateAdmission()
        await handler.enableIngress()
        handler.finalizeAdmission()
        await handler.afterAdmissionOpen()
        assert.deepEqual(events, ['stop:start', 'stop:end', 'start'])
        await handler.disposeOld()
        await startDuringReload
        assert.deepEqual(events, ['stop:start', 'stop:end', 'start', 'start'])
        await manager.cleanup()
    })

    it('fails the synchronous Python admission check if the child exits after async health validation', async function () {
        const manager = createManager()
        const oldChild = { pid: 1, exitCode: null }
        const candidateChild = new EventEmitter()
        candidateChild.pid = 2
        candidateChild.exitCode = null
        const candidateRuntime = {
            child: candidateChild,
            identity: { instanceId: 'candidate' },
            baseUrl: 'http://127.0.0.1:12002',
            invalidated: false
        }
        manager.process = oldChild
        manager.activeIdentity = { instanceId: 'old' }
        manager.startCandidateRuntime = async (next, options) => {
            options.onSpawn?.(candidateRuntime)
            return candidateRuntime
        }
        manager.isServiceHealthy = async () => true
        manager.terminateChild = async (child) => { child.exitCode = 0 }
        manager._startUnlocked = async () => {
            manager.process = { pid: 3, exitCode: null }
            manager.activeIdentity = { instanceId: 'restored-old' }
        }
        const handler = manager.createReloadHandler()

        await handler.preflight(snapshot(12002))
        await handler.prepareParallel()
        await handler.pauseIngress()
        await handler.preCommitDrain()
        await handler.prepareExclusive()
        await handler.commitHandles()
        await handler.validateAdmission()
        await handler.enableIngress()
        candidateRuntime.invalidated = true
        candidateChild.exitCode = 1

        assert.throws(() => handler.finalizeAdmission(), error => error.code === 'PYTHON_CANDIDATE_NOT_READY')
        await handler.rollbackExclusive()
        await handler.rollbackPrepared()
        await handler.restorePrevious()
        manager.process = null
        await manager.cleanup()
    })
})
