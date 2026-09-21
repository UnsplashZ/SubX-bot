const { spawn } = require('child_process');
const crypto = require('crypto');
const net = require('net');
const path = require('path');
const { performance } = require('perf_hooks');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { classifyBiliApiError } = require('./biliApiErrorClassifier');
const { OperationRegistry } = require('./runtime/operationRegistry');
const { applicationAdmissionGate } = require('./runtime/applicationAdmissionGate');
const { version: BUILD_VERSION } = require('../../package.json');

const PY_LOG_BRIDGE_PREFIX = '__PYLOG__';
const PYTHON_LOG_PATTERN = /^(\d{4}-\d{2}-\d{2} [\d:,]+) - ([\w.]+) - ([A-Z]+) - (.*)$/;
const LEVEL_MAP = {
    TRACE: 'trace',
    DEBUG: 'debug',
    INFO: 'info',
    WARNING: 'warn',
    WARN: 'warn',
    ERROR: 'error',
    CRITICAL: 'fatal',
    FATAL: 'fatal'
};
const SUCCESS_STATUSES = new Set(['success', 'ok']);
const PYTHON_STDOUT_IGNORE_PATTERNS = [
    /^=+\s+Running on http:\/\/.+\s+=+$/,
    /^\(Press CTRL\+C to quit\)$/
];

class LifecycleMutex {
    constructor() {
        this.locked = false
        this.waiters = []
    }

    acquire() {
        return new Promise((resolve) => {
            const grant = () => {
                this.locked = true
                let released = false
                resolve(() => {
                    if (released) return
                    released = true
                    const next = this.waiters.shift()
                    if (next) next()
                    else this.locked = false
                })
            }
            if (this.locked) this.waiters.push(grant)
            else grant()
        })
    }
}

function composeAbortSignals(signals = []) {
    const activeSignals = signals.filter(Boolean)
    if (activeSignals.length === 0) return { signal: undefined, dispose() {} }
    if (activeSignals.length === 1) return { signal: activeSignals[0], dispose() {} }
    const controller = new AbortController()
    const listeners = []
    const abort = (source) => {
        if (!controller.signal.aborted) controller.abort(source.reason || new Error('Operation aborted'))
    }
    for (const source of activeSignals) {
        if (source.aborted) {
            abort(source)
            break
        }
        const listener = () => abort(source)
        source.addEventListener('abort', listener, { once: true })
        listeners.push([source, listener])
    }
    return {
        signal: controller.signal,
        dispose() {
            for (const [source, listener] of listeners) source.removeEventListener('abort', listener)
        }
    }
}

class ServiceManager {
    constructor(options = {}) {
        if (!options.bypassSingleton && ServiceManager.instance) {
            return ServiceManager.instance;
        }
        if (!options.bypassSingleton) ServiceManager.instance = this;

        this.spawnProcess = options.spawn || spawn
        this.httpClient = options.httpClient || axios
        this.configProvider = options.configProvider || (() => config)
        this.requestRegistry = new OperationRegistry({ name: 'python' })
        this.resourceGeneration = 1
        this.restartTimer = null
        this.activeIdentity = null
        this.residualChildren = new Map()
        this.runtimeTransitionActive = false
        this.lifecycleMutex = new LifecycleMutex()
        this._cancelIdleAdmissionRetry = null

        this.process = null;

        // 🆕 验证端口参数
        this.applyRuntimeConfig(this.resolveRuntimeConfig(this.configProvider()))
        this.lastRequestTime = Date.now();
        this.isRestarting = false;
        this.shutdownRequested = false;
        this.stdoutBuffer = '';
        this.stderrBuffer = '';

        // 崩溃计数（5分钟滑动窗口）
        this.crashCount = 0;
        this.crashWindowStart = null;
        this.CRASH_WINDOW_MS = 5 * 60 * 1000;  // 5分钟窗口
        this.CRASH_THRESHOLD = 3;              // 5分钟内崩溃3次触发通知
        this.onCriticalError = null;           // 回调，由外部注册

        // Idle check interval (every hour)
        this.idleCheckInterval = setInterval(() => {
            this.checkIdle().catch((error) => {
                logger.logEvent('error', 'PY', 'svc:lifecycle', 'idle-check-failed', {
                    error: error.message,
                    code: error.code || null
                })
            })
        }, 60 * 60 * 1000);
        if (typeof this.idleCheckInterval.unref === 'function') {
            this.idleCheckInterval.unref();
        }
    }

    assertNoResidualChildren() {
        if (this.residualChildren.size === 0) return
        const error = new Error('Cannot start Python while residual managed processes remain')
        error.code = 'PYTHON_RESIDUAL_PROCESS_PRESENT'
        error.residualPids = [...this.residualChildren.values()].map((entry) => entry.pid).filter(Boolean)
        throw error
    }

    rememberResidualChild(child, error, role = 'unknown') {
        if (!child) return
        const existing = this.residualChildren.get(child)
        this.residualChildren.set(child, {
            child,
            pid: child.pid || existing?.pid || null,
            role,
            code: error?.code || existing?.code || 'PYTHON_PROCESS_RESIDUAL',
            error: error || existing?.error || null
        })
        if (!existing && child.once) {
            child.once('exit', () => this.residualChildren.delete(child))
        }
    }

    clearResidualChild(child) {
        if (child) this.residualChildren.delete(child)
    }

    async withLifecycleMutex(_action, callback) {
        const release = await this.lifecycleMutex.acquire()
        try {
            return await callback()
        } finally {
            release()
        }
    }

    createCleanupAggregate(message, failures, code) {
        const errors = failures.filter(Boolean)
        const result = errors.length === 1 ? errors[0] : new AggregateError(errors, message)
        if (!result.code) result.code = code
        result.cleanupErrors = errors
        result.residualPids = [...new Set(errors.flatMap((error) => [
            ...(Array.isArray(error?.residualPids) ? error.residualPids : []),
            ...(error?.residualPid ? [error.residualPid] : [])
        ]).filter(Boolean))]
        return result
    }

    resolveRuntimeConfig(snapshot = {}) {
        return {
            pythonPath: String(snapshot.pythonPath || snapshot.paths?.python || 'python3'),
            port: this.validatePort(snapshot.port || snapshot.biliServerPort || snapshot.pythonService?.port || 10001),
            scriptPath: path.resolve(process.cwd(), snapshot.scriptPath || snapshot.biliScriptPath || snapshot.paths?.biliScript || 'src/services/bili_server.py'),
            napcatTempPath: path.resolve(String(snapshot.napcatTempPath || snapshot.paths?.napcatTemp || '/app/.config/QQ/tmp/'))
        }
    }

    applyRuntimeConfig(next) {
        this.pythonPath = next.pythonPath
        this.port = next.port
        this.scriptPath = next.scriptPath
        this.napcatTempPath = next.napcatTempPath
        this.baseUrl = `http://127.0.0.1:${this.port}`
    }

    computeEffectHash(runtimeConfig) {
        const stable = JSON.stringify({
            pythonPath: runtimeConfig.pythonPath,
            port: runtimeConfig.port,
            scriptPath: runtimeConfig.scriptPath,
            napcatTempPath: runtimeConfig.napcatTempPath
        })
        return crypto.createHash('sha256').update(stable).digest('hex')
    }

    createRuntimeIdentity(runtimeConfig, generation = this.resourceGeneration) {
        return Object.freeze({
            instanceId: crypto.randomUUID(),
            resourceGeneration: generation,
            effectHash: this.computeEffectHash(runtimeConfig),
            buildVersion: BUILD_VERSION
        })
    }

    buildChildEnv(runtimeConfig = this.resolveRuntimeConfig(this.configProvider()), identity = this.createRuntimeIdentity(runtimeConfig)) {
        const env = {
            BILI_PY_LOG_BRIDGE: '1',
            PYTHONUNBUFFERED: '1',
            NAPCAT_TEMP_PATH: runtimeConfig.napcatTempPath,
            BILI_RUNTIME_INSTANCE_ID: identity.instanceId,
            BILI_RUNTIME_RESOURCE_GENERATION: String(identity.resourceGeneration),
            BILI_RUNTIME_EFFECT_HASH: identity.effectHash,
            BILI_RUNTIME_BUILD_VERSION: identity.buildVersion
        }
        for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE']) {
            if (process.env[key]) env[key] = process.env[key]
        }
        return env
    }

    async allocateProbePort() {
        return new Promise((resolve, reject) => {
            const server = net.createServer()
            server.unref()
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => {
                const address = server.address()
                const port = address && typeof address === 'object' ? address.port : null
                server.close((error) => {
                    if (error) reject(error)
                    else resolve(port)
                })
            })
        })
    }

    // 🆕 验证端口号是否有效
    validatePort(port) {
        const MIN_PORT = 1024;  // 非特权端口起始
        const MAX_PORT = 65535; // 最大端口号

        // 类型检查
        const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

        if (isNaN(portNum) || !Number.isInteger(portNum)) {
            const errorMsg = `Invalid port type: ${port} (type: ${typeof port}). Port must be an integer.`;
            logger.logEvent('error', 'PY', 'svc:lifecycle', 'port-invalid', { error: errorMsg });
            throw new Error(errorMsg);
        }

        // 范围检查
        if (portNum < MIN_PORT || portNum > MAX_PORT) {
            const errorMsg = `Invalid port ${portNum}. Port must be between ${MIN_PORT} and ${MAX_PORT}.`;
            logger.logEvent('error', 'PY', 'svc:lifecycle', 'port-invalid', { error: errorMsg });
            throw new Error(errorMsg);
        }

        logger.logEvent('info', 'PY', 'svc:lifecycle', 'port-validated', { port: portNum });
        return portNum;
    }

    async start() {
        return this.withLifecycleMutex('start', () => this._startUnlocked())
    }

    async _startUnlocked() {
        this.assertNoResidualChildren()
        if (this.process) {
            logger.logEvent('warn', 'PY', 'svc:lifecycle', 'already-running', { port: this.port });
            return;
        }

        // Re-resolve runtime config from the provider at start time: the constructor
        // captures defaults before the config service finishes initializing, so
        // paths.python / PYTHON_PATH from a cold start must be re-read here.
        this.applyRuntimeConfig(this.resolveRuntimeConfig(this.configProvider()))

        if (await this.isServiceHealthy(300, null)) {
            const error = new Error(`Python service port ${this.port} is already occupied by an unmanaged instance`)
            error.code = 'PYTHON_PORT_CONFLICT'
            throw error
        }

        logger.logEvent('info', 'PY', 'svc:lifecycle', 'start', { port: this.port });

        try {
            const runtimeConfig = {
                pythonPath: this.pythonPath,
                port: this.port,
                scriptPath: this.scriptPath,
                napcatTempPath: this.napcatTempPath
            }
            const identity = this.createRuntimeIdentity(runtimeConfig, this.resourceGeneration)
            const child = this.spawnProcess(this.pythonPath, [
                this.scriptPath,
                '--port',
                this.port.toString()
            ], {
                env: {
                    ...this.buildChildEnv(runtimeConfig, identity)
                }
            });
            this.process = child
            this.activeIdentity = identity
            this.attachManagedChild(child)

            await this.waitForHealth(20, 500, identity);
            logger.logEvent('info', 'PY', 'svc:lifecycle', 'ready', { port: this.port });

        } catch (error) {
            logger.logEvent('error', 'PY', 'svc:lifecycle', 'start-failed', {
                port: this.port,
                error: error.message
            });
            const failedChild = this.process
            if (failedChild) {
                this.process = null
                this.activeIdentity = null
                try {
                    await this.terminateChild(failedChild, 3000, 1000, 'start-failed')
                } catch (cleanupError) {
                    error.cleanupErrors = [...(error.cleanupErrors || []), cleanupError]
                }
            }
            throw error;
        }
    }

    attachManagedChild(child) {
        child.stdout?.on?.('data', (data) => this.handlePythonStream('stdout', data))
        child.stderr?.on?.('data', (data) => this.handlePythonStream('stderr', data))
        child.on?.('exit', (code, signal) => {
            this.clearResidualChild(child)
            if (this.process !== child) return
            logger.logEvent('warn', 'PY', 'svc:lifecycle', 'exit', { code, signal: signal || 'null' })
            this.process = null
            this.activeIdentity = null
            if (this.isRestarting || this.shutdownRequested || this.runtimeTransitionActive) return

            const now = Date.now()
            if (!this.crashWindowStart || now - this.crashWindowStart > this.CRASH_WINDOW_MS) {
                this.crashWindowStart = now
                this.crashCount = 1
            } else {
                this.crashCount++
            }
            if (this.crashCount === this.CRASH_THRESHOLD && this.onCriticalError) {
                this.onCriticalError(`⚠️ Python服务在5分钟内已崩溃 ${this.crashCount} 次，可能存在严重问题，请检查日志。`)
            }
            logger.logEvent('warn', 'PY', 'svc:lifecycle', 'restart-scheduled', {
                delay: '1s',
                crashCount: this.crashCount
            })
            if (this.restartTimer) clearTimeout(this.restartTimer)
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null
                this.start().catch((error) => {
                    logger.logEvent('error', 'PY', 'svc:lifecycle', 'automatic-restart-failed', {
                        error: error.message,
                        code: error.code || null,
                        residualPids: error.residualPids || []
                    })
                    this.onCriticalError?.(`⚠️ Python服务自动重启失败：${error.code || error.message}`)
                })
            }, 1000)
        })
    }

    async startCandidateRuntime(runtimeConfig, options = {}) {
        this.assertNoResidualChildren()
        const port = options.port ?? runtimeConfig.port
        const baseUrl = `http://127.0.0.1:${port}`
        if (await this.isServiceHealthy(300, null, baseUrl)) {
            const error = new Error(`Python candidate port ${port} is already occupied`)
            error.code = 'PYTHON_PORT_CONFLICT'
            throw error
        }
        const identity = this.createRuntimeIdentity(runtimeConfig, options.generation ?? this.resourceGeneration + 1)
        const child = this.spawnProcess(runtimeConfig.pythonPath, [
            runtimeConfig.scriptPath,
            '--port',
            String(port)
        ], { env: this.buildChildEnv(runtimeConfig, identity) })
        this.attachManagedChild(child)
        const runtime = {
            child,
            identity,
            baseUrl,
            port,
            runtimeConfig,
            invalidated: false,
            exitCode: null,
            exitSignal: null
        }
        const observeExit = (code, signal) => {
            runtime.invalidated = true
            runtime.exitCode = code
            runtime.exitSignal = signal
        }
        child.on?.('exit', observeExit)
        runtime.stopObserving = () => child.removeListener?.('exit', observeExit)
        options.onSpawn?.(runtime)
        try {
            await this.waitForHealth(options.maxRetries ?? 20, options.interval ?? 250, identity, baseUrl)
            return runtime
        } catch (error) {
            try {
                await this.terminateChild(child, options.stopTimeoutMs ?? 3000, 1000, 'candidate-start-failed')
            } catch (cleanupError) {
                if (options.deferCleanupToRollback) error.prepareCleanupError = cleanupError
                else error.cleanupErrors = [...(error.cleanupErrors || []), cleanupError]
            }
            throw error
        }
    }

    async assertCandidateRuntimeHealthy(runtime, timeoutMs = 500) {
        if (!runtime || runtime.invalidated ||
            (runtime.child.exitCode !== null && runtime.child.exitCode !== undefined)) {
            const error = new Error('Python candidate exited before admission')
            error.code = 'PYTHON_CANDIDATE_NOT_READY'
            throw error
        }
        if (!await this.isServiceHealthy(timeoutMs, runtime.identity, runtime.baseUrl)) {
            const error = new Error('Python candidate identity health failed before admission')
            error.code = 'PYTHON_CANDIDATE_NOT_READY'
            throw error
        }
        return true
    }

    assertCandidateRuntimeReadySync(runtime) {
        if (!runtime || runtime.invalidated ||
            (runtime.child.exitCode !== null && runtime.child.exitCode !== undefined) ||
            this.process !== runtime.child ||
            this.activeIdentity?.instanceId !== runtime.identity?.instanceId) {
            const error = new Error('Python candidate exited before final admission')
            error.code = 'PYTHON_CANDIDATE_NOT_READY'
            throw error
        }
        return true
    }

    async waitForHealth(maxRetries = 20, interval = 500, expectedIdentity = this.activeIdentity, baseUrl = this.baseUrl) {
        for (let i = 0; i < maxRetries; i++) {
            if (await this.isServiceHealthy(interval, expectedIdentity, baseUrl)) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        throw new Error('Timeout waiting for Python server health check');
    }

    async isServiceHealthy(timeout = 500, expectedIdentity = this.activeIdentity, baseUrl = this.baseUrl) {
        try {
            const response = await this.httpClient.get(`${baseUrl}/health`, { timeout });
            if (response.status !== 200 || response.data?.status !== 'ok') return false
            if (!expectedIdentity) return true
            return response.data?.instanceId === expectedIdentity.instanceId &&
                Number(response.data?.resourceGeneration) === Number(expectedIdentity.resourceGeneration) &&
                response.data?.effectHash === expectedIdentity.effectHash &&
                response.data?.buildVersion === expectedIdentity.buildVersion &&
                Number.isInteger(Number(response.data?.pid)) && Number(response.data.pid) > 0
        } catch (e) {
            return false;
        }
    }

    async terminateChild(child, timeoutMs = 5000, forceGraceMs = 1000, role = 'managed') {
        if (!child) return { exited: true, forced: false, residualPid: null }
        if (child.exitCode !== null && child.exitCode !== undefined) {
            this.clearResidualChild(child)
            return { exited: true, forced: false, residualPid: null }
        }
        return new Promise((resolve, reject) => {
            let settled = false
            let forceTimer = null
            let deadlineTimer = null
            let forced = false
            const finish = () => {
                if (settled) return
                settled = true
                if (forceTimer) clearTimeout(forceTimer)
                if (deadlineTimer) clearTimeout(deadlineTimer)
                this.clearResidualChild(child)
                resolve({ exited: true, forced, residualPid: null })
            }
            child.once?.('exit', finish)
            try {
                child.kill?.('SIGTERM')
            } catch (error) {
                settled = true
                child.removeListener?.('exit', finish)
                const stopError = new Error(`Failed to stop Python process ${child.pid || 'unknown'}: ${error.message}`)
                stopError.code = 'PYTHON_PROCESS_STOP_FAILED'
                stopError.residualPid = child.pid || null
                this.rememberResidualChild(child, stopError, role)
                reject(stopError)
                return
            }
            if (settled) return
            forceTimer = setTimeout(() => {
                forced = true
                try { child.kill?.('SIGKILL') } catch { /* ignore */ }
            }, Math.max(1, timeoutMs))
            deadlineTimer = setTimeout(() => {
                if (settled) return
                settled = true
                if (forceTimer) clearTimeout(forceTimer)
                child.removeListener?.('exit', finish)
                const error = new Error(`Python process ${child.pid || 'unknown'} did not exit before hard deadline`)
                error.code = 'PYTHON_PROCESS_STOP_TIMEOUT'
                error.residualPid = child.pid || null
                error.forced = forced
                this.rememberResidualChild(child, error, role)
                reject(error)
            }, Math.max(2, timeoutMs + Math.max(1, forceGraceMs)))
        })
    }

    async probeRuntime(runtimeConfig, options = {}) {
        const probePort = options.port || await this.allocateProbePort()
        const candidate = await this.startCandidateRuntime(runtimeConfig, {
            port: probePort,
            generation: this.resourceGeneration + 1,
            maxRetries: options.maxRetries,
            interval: options.interval,
            stopTimeoutMs: options.stopTimeoutMs
        })
        try {
            return { identity: candidate.identity, port: probePort }
        } finally {
            await this.terminateChild(candidate.child, options.stopTimeoutMs ?? 3000)
        }
    }

    async sendCommand(endpoint, data, options = {}) {
        const existingContext = this.requestRegistry.getContext()
        if (existingContext) return this._sendCommand(endpoint, data, options, existingContext)
        return this.requestRegistry.run(`rpc:${endpoint}`, async (operationContext) => this._sendCommand(endpoint, data, options, operationContext), {
            generation: this.resourceGeneration,
            baseUrl: this.baseUrl,
            instanceId: this.activeIdentity?.instanceId || null
        })
    }

    async _sendCommand(endpoint, data, options = {}, operationContext = {}) {
        // Ensure server is running
        if (!this.process) {
            await this.start();
        }

        this.lastRequestTime = Date.now();
        
        // Remove leading slash if present to avoid double slashes
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        const requestBaseUrl = operationContext.baseUrl || this.baseUrl
        const url = `${requestBaseUrl}/${cleanEndpoint}`;
        const timeoutMs = Number(options.timeoutMs);
        const reqId = options.reqId || this.createReqId(cleanEndpoint);
        const logFields = {
            endpoint: cleanEndpoint,
            ...this.extractResourceFields(data)
        };
        const combinedAbort = composeAbortSignals([operationContext.abortSignal, options.signal])
        const requestOptions = {
            ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeout: timeoutMs } : {}),
            ...(combinedAbort.signal ? { signal: combinedAbort.signal } : {}),
            headers: {
                'x-request-id': reqId,
                'x-rpc-endpoint': cleanEndpoint,
                ...(options.headers || {})
            }
        };
        const startedAt = performance.now();

        logger.logEvent('info', 'RPC', `req:${reqId}`, 'start', logFields);

        try {
            const response = await this.httpClient.post(url, data, requestOptions);
            const status = response?.data?.status || response?.status || 'unknown';
            const normalizedStatus = String(status).toLowerCase();
            const level = SUCCESS_STATUSES.has(normalizedStatus) ? 'info' : 'warn';
            logger.logEvent(level, 'RPC', `req:${reqId}`, 'done', {
                ...logFields,
                status,
                duration: `${Math.round(performance.now() - startedAt)}ms`
            });
            return response.data;
        } catch (error) {
            error.endpoint = cleanEndpoint;
            error.timeout = requestOptions.timeout ?? null;
            error.httpStatus = error.response?.status ?? null;
            error.responseData = error.response?.data ?? null;
            const classified = classifyBiliApiError(error);
            logger.logEvent('error', 'RPC', `req:${reqId}`, 'fail', {
                ...logFields,
                duration: `${Math.round(performance.now() - startedAt)}ms`,
                error: error.message,
                code: error.code,
                httpStatus: error.httpStatus,
                endpoint: cleanEndpoint,
                timeout: error.timeout,
                responseData: error.responseData,
                failureKind: classified.failureKind,
                errorType: classified.errorType,
                biliCode: classified.biliCode,
                retryable: classified.retryable
            });
            throw error;
        } finally {
            combinedAbort.dispose()
        }
    }

    async checkIdle() {
        const IDLE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
        if (Date.now() - this.lastRequestTime <= IDLE_TIMEOUT) return { restarted: false }
        return this.withLifecycleMutex('idle-restart', async () => {
            if (applicationAdmissionGate.snapshot().closed || this.runtimeTransitionActive) {
                if (!this._cancelIdleAdmissionRetry && applicationAdmissionGate.snapshot().closed) {
                    this._cancelIdleAdmissionRetry = applicationAdmissionGate.runWhenOpen(() => {
                        this._cancelIdleAdmissionRetry = null
                        return this.checkIdle()
                    })
                }
                return { restarted: false, deferred: true }
            }
            logger.logEvent('info', 'PY', 'svc:lifecycle', 'restart-idle', { idle: '24h' });
            await this._restartUnlocked();
            return { restarted: true }
        })
    }

    async restart() {
        return this.withLifecycleMutex('restart', () => this._restartUnlocked())
    }

    async _restartUnlocked() {
        this.isRestarting = true;
        try {
            await this._stopUnlocked({ timeoutMs: 10000, forceGraceMs: 2000 })
            this.assertNoResidualChildren()
            await this._startUnlocked()
        } finally {
            this.isRestarting = false;
        }
    }

    async stop(options = {}) {
        return this.withLifecycleMutex('stop', () => this._stopUnlocked(options))
    }

    async _stopUnlocked(options = {}) {
        this.shutdownRequested = true;

        try {
            const child = this.process
            const targets = new Set([...this.residualChildren.keys(), ...(child ? [child] : [])])
            if (targets.size === 0) return { exited: true, forced: false, residualPid: null }
            if (child) {
                logger.logEvent('info', 'PY', 'svc:lifecycle', 'stop', { signal: 'SIGTERM' });
                this.process = null
                this.activeIdentity = null
            }
            const results = []
            const failures = []
            for (const target of targets) {
                try {
                    results.push(await this.terminateChild(
                        target,
                        options.timeoutMs ?? 5000,
                        options.forceGraceMs ?? 1000,
                        target === child ? 'active' : (this.residualChildren.get(target)?.role || 'residual')
                    ))
                } catch (error) {
                    failures.push(error)
                }
            }
            if (failures.length > 0) {
                throw this.createCleanupAggregate('Python process cleanup failed', failures, 'PYTHON_PROCESS_CLEANUP_FAILED')
            }
            const result = {
                exited: true,
                forced: results.some((entry) => entry?.forced),
                residualPid: null
            }
            logger.logEvent('info', 'PY', 'svc:lifecycle', 'terminated', {
                mode: result?.forced ? 'force' : 'graceful'
            });
            return result
        } catch (error) {
            logger.logEvent('error', 'PY', 'svc:lifecycle', 'stop-failed', {
                error: error.message,
                residualPid: error.residualPid || null
            })
            throw error
        } finally {
            this.shutdownRequested = false;
        }
    }

    async reconfigure(snapshot, options = {}) {
        return this.withLifecycleMutex('reconfigure', () => this._reconfigureUnlocked(snapshot, options))
    }

    async _reconfigureUnlocked(snapshot, options = {}) {
        const next = this.resolveRuntimeConfig(snapshot)
        if (next.pythonPath === this.pythonPath &&
            next.port === this.port &&
            next.scriptPath === this.scriptPath &&
            next.napcatTempPath === this.napcatTempPath) {
            return { changed: false, resourceGeneration: this.resourceGeneration }
        }
        const previous = {
            pythonPath: this.pythonPath,
            port: this.port,
            scriptPath: this.scriptPath,
            napcatTempPath: this.napcatTempPath
        }
        if (next.port !== previous.port) {
            const candidate = await this.startCandidateRuntime(next, {
                port: next.port,
                generation: this.resourceGeneration + 1,
                maxRetries: options.probeMaxRetries,
                interval: options.probeInterval,
                stopTimeoutMs: options.probeStopTimeoutMs
            })
            const oldChild = this.process
            this.requestRegistry.pause('python-reconfigure')
            try {
                await this.requestRegistry.drain({ timeoutMs: options.timeoutMs ?? 30000 })
                if ((candidate.child.exitCode !== null && candidate.child.exitCode !== undefined) ||
                    !await this.isServiceHealthy(500, candidate.identity, candidate.baseUrl)) {
                    const error = new Error('Python candidate exited before commit')
                    error.code = 'PYTHON_CANDIDATE_NOT_READY'
                    throw error
                }
                // Keep the old runtime published and all RPC admission paused until
                // its process has actually retired. A failed retirement must not
                // expose a candidate while the old child can still own the runtime.
                await this.terminateChild(oldChild, options.stopTimeoutMs ?? 5000, 1000, 'previous')
                this.applyRuntimeConfig(next)
                this.resourceGeneration += 1
                this.process = candidate.child
                this.activeIdentity = candidate.identity
                return {
                    changed: true,
                    resourceGeneration: this.resourceGeneration,
                    previous,
                    parallelCutover: true
                }
            } catch (error) {
                try {
                    await this.terminateChild(candidate.child, options.stopTimeoutMs ?? 3000, 1000, 'candidate-rollback')
                } catch (cleanupError) {
                    error.cleanupErrors = [...(error.cleanupErrors || []), cleanupError]
                }
                throw error
            } finally {
                if (!options.keepPaused) this.requestRegistry.resume()
            }
        }
        this.requestRegistry.pause('python-reconfigure')
        let generationAdvanced = false
        try {
            await this.requestRegistry.drain({ timeoutMs: options.timeoutMs ?? 30000 })
            const probePort = next.port === previous.port ? await this.allocateProbePort() : next.port
            await this.probeRuntime(next, {
                port: probePort,
                maxRetries: options.probeMaxRetries,
                interval: options.probeInterval,
                stopTimeoutMs: options.probeStopTimeoutMs
            })
            await this._stopUnlocked()
            this.applyRuntimeConfig(next)
            this.resourceGeneration += 1
            generationAdvanced = true
            await this._startUnlocked()
            return { changed: true, resourceGeneration: this.resourceGeneration, previous }
        } catch (error) {
            const cleanupErrors = []
            try {
                await this._stopUnlocked()
            } catch (cleanupError) {
                cleanupErrors.push(cleanupError)
            }
            this.applyRuntimeConfig(previous)
            if (generationAdvanced) this.resourceGeneration = Math.max(1, this.resourceGeneration - 1)
            try {
                await this._startUnlocked()
            } catch (restoreError) {
                error.restoreError = restoreError
                cleanupErrors.push(restoreError)
            }
            if (cleanupErrors.length > 0) error.cleanupErrors = cleanupErrors
            throw error
        } finally {
            if (!options.keepPaused) this.requestRegistry.resume()
        }
    }

    createReloadHandler() {
        let previous = null
        let next = null
        let previousChild = null
        let previousIdentity = null
        let previousGeneration = null
        let candidateRuntime = null
        let samePort = false
        let oldStopped = false
        let committed = false
        let lifecycleRelease = null
        let ingressPaused = false

        const releaseLifecycle = () => {
            if (!lifecycleRelease) return
            const release = lifecycleRelease
            lifecycleRelease = null
            release()
        }

        const stopWithoutRestart = async (child, timeoutMs = 5000) => {
            if (!child) return
            if (this.process === child) {
                this.process = null
                this.activeIdentity = null
            }
            await this.terminateChild(child, timeoutMs, 1000, child === previousChild ? 'previous' : 'candidate')
        }

        const restorePreviousRuntime = async () => {
            if (!previous) return
            const failures = []
            if (candidateRuntime) {
                try {
                    await stopWithoutRestart(candidateRuntime.child, 3000)
                    candidateRuntime = null
                } catch (error) {
                    failures.push(error)
                }
            }
            this.applyRuntimeConfig(previous)
            this.resourceGeneration = previousGeneration
            if (!oldStopped && previousChild && previousChild.exitCode == null) {
                if (this.residualChildren.has(previousChild)) {
                    const previousBaseUrl = `http://127.0.0.1:${previous.port}`
                    const previousHealthy = previousIdentity &&
                        await this.isServiceHealthy(500, previousIdentity, previousBaseUrl)
                    if (!previousHealthy) {
                        const error = new Error('Previous Python runtime could not be reclaimed after failed termination')
                        error.code = 'PYTHON_PREVIOUS_RUNTIME_NOT_READY'
                        error.residualPid = previousChild.pid || null
                        failures.push(error)
                        this.process = null
                        this.activeIdentity = null
                    } else {
                        this.clearResidualChild(previousChild)
                        this.process = previousChild
                        this.activeIdentity = previousIdentity
                    }
                } else {
                    this.process = previousChild
                    this.activeIdentity = previousIdentity
                }
            } else {
                this.process = null
                this.activeIdentity = null
                try {
                    await this._startUnlocked()
                } catch (error) {
                    failures.push(error)
                }
            }
            committed = false
            this.runtimeTransitionActive = false
            if (failures.length > 0) {
                throw this.createCleanupAggregate(
                    'Python runtime rollback failed',
                    failures,
                    'PYTHON_RUNTIME_ROLLBACK_FAILED'
                )
            }
        }

        return {
            id: 'python-runtime',
            effects: ['python', 'paths'],
            ownedPaths: ['pythonService', 'paths.python', 'paths.biliScript', 'paths.napcatTemp'],
            preflight: async (candidate) => {
                next = this.resolveRuntimeConfig(candidate)
            },
            prepareParallel: async () => {
                lifecycleRelease = await this.lifecycleMutex.acquire()
                previous = {
                    pythonPath: this.pythonPath,
                    port: this.port,
                    scriptPath: this.scriptPath,
                    napcatTempPath: this.napcatTempPath
                }
                previousChild = this.process
                previousIdentity = this.activeIdentity
                previousGeneration = this.resourceGeneration
                samePort = next.port === previous.port
                oldStopped = false
                committed = false
                ingressPaused = false
                this.runtimeTransitionActive = true
                if (!next || samePort) return
                candidateRuntime = await this.startCandidateRuntime(next, {
                    port: next.port,
                    generation: previousGeneration + 1,
                    deferCleanupToRollback: true,
                    onSpawn: (runtime) => { candidateRuntime = runtime }
                })
            },
            pauseIngress: async () => {
                ingressPaused = true
                this.requestRegistry.pause('config-reload')
            },
            preCommitDrain: async () => this.requestRegistry.drain({ timeoutMs: 30000 }),
            prepareExclusive: async () => {
                if (!next) return
                const changed = next.pythonPath !== previous.pythonPath ||
                    next.port !== previous.port ||
                    next.scriptPath !== previous.scriptPath ||
                    next.napcatTempPath !== previous.napcatTempPath
                if (!changed) return
                if (!candidateRuntime) {
                    const probePort = await this.allocateProbePort()
                    await this.probeRuntime(next, { port: probePort })
                    await stopWithoutRestart(previousChild, 5000)
                    oldStopped = true
                    candidateRuntime = await this.startCandidateRuntime(next, {
                        port: next.port,
                        generation: previousGeneration + 1,
                        deferCleanupToRollback: true,
                        onSpawn: (runtime) => { candidateRuntime = runtime }
                    })
                }
            },
            rollbackExclusive: async () => {
                await restorePreviousRuntime()
            },
            rollbackPrepared: async () => {
                try {
                    if (!committed && candidateRuntime) {
                        await stopWithoutRestart(candidateRuntime.child, 3000)
                        candidateRuntime = null
                    }
                } finally {
                    if (!committed) this.runtimeTransitionActive = false
                    if (!ingressPaused) releaseLifecycle()
                }
            },
            commitHandles: async () => {
                if (!candidateRuntime) return
                await this.assertCandidateRuntimeHealthy(candidateRuntime, 500)
                // Same-port cutover already retired the previous child during the
                // exclusive phase. Parallel cutover remains staged until the
                // admission validation barrier retires the old child successfully.
                if (oldStopped) {
                    this.applyRuntimeConfig(next)
                    this.resourceGeneration = previousGeneration + 1
                    this.process = candidateRuntime.child
                    this.activeIdentity = candidateRuntime.identity
                    committed = true
                }
            },
            restorePrevious: async () => {
                try {
                    this.runtimeTransitionActive = false
                    this.requestRegistry.resume()
                } finally {
                    ingressPaused = false
                    releaseLifecycle()
                }
            },
            validateAdmission: async () => {
                if (candidateRuntime) {
                    await this.assertCandidateRuntimeHealthy(candidateRuntime, 500)
                    if (!committed) {
                        await stopWithoutRestart(previousChild, 5000)
                        oldStopped = true
                        await this.assertCandidateRuntimeHealthy(candidateRuntime, 500)
                        this.applyRuntimeConfig(next)
                        this.resourceGeneration = previousGeneration + 1
                        this.process = candidateRuntime.child
                        this.activeIdentity = candidateRuntime.identity
                        committed = true
                    }
                }
            },
            enableIngress: async () => {
                this.runtimeTransitionActive = false
                this.requestRegistry.resume()
            },
            finalizeAdmission: () => {
                if (candidateRuntime) this.assertCandidateRuntimeReadySync(candidateRuntime)
            },
            afterAdmissionOpen: async () => {
                candidateRuntime?.stopObserving?.()
            },
            disposeOld: async () => {
                try {
                    // Previous child retirement is an admission prerequisite; this
                    // phase only releases bookkeeping and cannot discover a new
                    // post-admission residual process.
                    candidateRuntime = null
                    previousChild = null
                    this.runtimeTransitionActive = false
                } finally {
                    ingressPaused = false
                    releaseLifecycle()
                }
            }
        }
    }

    abortOperations(reason = 'forced-cleanup') {
        this.requestRegistry.pause(reason)
        const before = this.requestRegistry.snapshot()
        this.requestRegistry.abortAll(reason)
        return {
            requested: before.length,
            operations: before
        }
    }

    forceTerminateAll(reason = 'absolute shutdown deadline') {
        const children = new Set([
            this.process,
            ...this.residualChildren.keys()
        ].filter(Boolean))
        const pids = []
        for (const child of children) {
            if (child.pid) pids.push(child.pid)
            try { child.kill?.('SIGKILL') } catch { /* process exit remains non-zero */ }
        }
        this.requestRegistry.abortAll(reason)
        return { requested: children.size, pids }
    }

    async abortAndDrainOperations(reason = 'forced-cleanup', timeoutMs = 30000) {
        const result = this.abortOperations(reason)
        await this.requestRegistry.drain({ timeoutMs })
        return {
            ...result,
            remaining: this.requestRegistry.snapshot()
        }
    }

    getResourceCounts() {
        return {
            child: this.process ? 1 : 0,
            residualChildren: this.residualChildren.size,
            residualPids: [...this.residualChildren.values()].map((entry) => entry.pid).filter(Boolean),
            restartTimer: this.restartTimer ? 1 : 0,
            idleTimer: this.idleCheckInterval ? 1 : 0,
            ...this.requestRegistry.getResourceCounts()
        }
    }

    async cleanup(options = {}) {
        if (this.restartTimer) clearTimeout(this.restartTimer)
        this.restartTimer = null
        this._cancelIdleAdmissionRetry?.()
        this._cancelIdleAdmissionRetry = null
        if (this.idleCheckInterval) clearInterval(this.idleCheckInterval)
        this.idleCheckInterval = null
        this.requestRegistry.pause('shutdown')
        const failures = []
        try {
            await this.requestRegistry.drain({ timeoutMs: options.drainTimeoutMs ?? 30000 })
        } catch (error) {
            failures.push(error)
            this.abortOperations('shutdown-drain-timeout')
            try {
                await this.requestRegistry.drain({ timeoutMs: options.abortDrainTimeoutMs ?? 2000 })
            } catch (abortDrainError) {
                failures.push(abortDrainError)
            }
        }
        try {
            await this.stop({
                timeoutMs: options.stopTimeoutMs ?? 5000,
                forceGraceMs: options.forceGraceMs ?? 1000
            })
        } catch (error) {
            failures.push(error)
        }
        if (this.residualChildren.size > 0) {
            const error = new Error('Python cleanup left residual managed processes')
            error.code = 'PYTHON_CLEANUP_RESIDUAL_PROCESSES'
            error.residualPids = [...this.residualChildren.values()].map((entry) => entry.pid).filter(Boolean)
            failures.push(error)
        }
        if (failures.length > 0) {
            throw this.createCleanupAggregate('Python runtime cleanup incomplete', failures, 'PYTHON_RUNTIME_CLEANUP_FAILED')
        }
        return this.getResourceCounts()
    }

    createReqId(endpoint) {
        const aliasMap = {
            dynamic_detail: 'dy',
            user_dynamic: 'ud',
            video: 'vd',
            bangumi: 'bg',
            article: 'ar',
            live_room: 'lv',
            user_info: 'ui',
            user_card: 'uc',
            opus: 'op',
            media: 'md',
            ep: 'ep'
        };
        const prefix = aliasMap[endpoint] || endpoint.slice(0, 2) || 'py';
        return `${prefix}_${crypto.randomBytes(3).toString('hex')}`;
    }

    extractResourceFields(data = {}) {
        const fieldMap = {
            bvid: 'bvid',
            uid: 'uid',
            cvid: 'cvid',
            season_id: 'seasonId',
            room_id: 'roomId',
            dynamic_id: 'dynamicId',
            opus_id: 'opusId',
            media_id: 'mediaId',
            ep_id: 'epId',
            group_id: 'groupId'
        };
        return Object.entries(fieldMap).reduce((acc, [key, label]) => {
            const value = data?.[key];
            if (value !== undefined && value !== null && value !== '') {
                acc[label] = value;
            }
            return acc;
        }, {});
    }

    handlePythonStream(streamName, data) {
        const bufferKey = streamName === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
        this[bufferKey] += data.toString();
        const lines = this[bufferKey].split('\n');
        this[bufferKey] = lines.pop();
        lines.forEach((line) => this.handlePythonLine(streamName, line.trimEnd()));
    }

    handlePythonLine(streamName, line) {
        if (!line) return;

        if (streamName === 'stdout' && this.shouldIgnorePythonStdout(line)) {
            return;
        }

        if (line.startsWith(PY_LOG_BRIDGE_PREFIX)) {
            try {
                const payload = JSON.parse(line.slice(PY_LOG_BRIDGE_PREFIX.length));
                logger.logEvent(
                    payload.level || 'info',
                    payload.channel || 'PY',
                    payload.scope || `py:${streamName}`,
                    payload.message || '',
                    payload.fields || {}
                );
                return;
            } catch (error) {
                logger.logEvent('warn', 'PY', 'svc:lifecycle', 'bridge-parse-failed', {
                    source: streamName,
                    error: error.message
                });
            }
        }

        const parsed = this.parsePythonLine(line);
        if (parsed) {
            logger.logEvent(parsed.level, parsed.channel, parsed.scope, parsed.message, parsed.fields);
            return;
        }

        logger.logEvent(streamName === 'stderr' ? 'error' : 'info', 'PY', `py:${streamName}`, line);
    }

    shouldIgnorePythonStdout(line) {
        return PYTHON_STDOUT_IGNORE_PATTERNS.some((pattern) => pattern.test(String(line || '').trim()));
    }

    parsePythonLine(line) {
        const match = line.match(PYTHON_LOG_PATTERN);
        if (!match) return null;

        const [, timestamp, loggerName, levelName, message] = match;
        const level = LEVEL_MAP[levelName] || 'info';
        const scope = this.resolvePythonScope(loggerName);
        return {
            level,
            channel: this.resolvePythonChannel(loggerName),
            scope,
            message,
            fields: { ts: timestamp }
        };
    }

    resolvePythonChannel(loggerName) {
        if (loggerName === 'aiohttp.access') return 'HTTP';
        if (loggerName.includes('.services.')) return 'SERVICE';
        if (loggerName.includes('.web.handlers')) return 'RPC';
        return 'PY';
    }

    resolvePythonScope(loggerName) {
        if (loggerName.endsWith('.main') || loggerName.endsWith('.app')) {
            return 'svc:lifecycle';
        }
        const segments = String(loggerName || '').split('.');
        return `py:${segments[segments.length - 1] || 'service'}`;
    }
}

const serviceManager = new ServiceManager();
module.exports = serviceManager;
module.exports.ServiceManager = ServiceManager;
