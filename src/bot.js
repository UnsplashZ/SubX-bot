const WebSocket = require('ws');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const messageHandler = require('./handlers/messageHandler');
const subscriptionService = require('./services/subscriptionService');
const imageGenerator = require('./services/imageGenerator');
const ServiceManager = require('./services/ServiceManager');
const updateChecker = require('./services/subscription/updateChecker');
const dashboardServer = require('./dashboard/server');
const requestApprovalService = require('./services/requestApprovalService');
const { warmupEmojiIndexProvider } = require('./services/imageGenerator/renderers/components/emojiIndexProvider');
const { createQqProvider } = require('./providers/qq/providerFactory');
const qqProviderRuntime = require('./providers/qq/runtime');
const { logBuffer } = require('./dashboard/logBuffer');
const browserManager = require('./services/imageGenerator/core/browser');
const videoDownloadService = require('./services/videoDownloadService');
const notificationService = require('./services/notificationService');
const { FLAT_KEY_TO_PATH, DASHBOARD_INGRESS_PORT } = require('./config/schemaV1');
const { botOperationRegistry } = require('./services/runtime/botOperationRegistry');
const { getCurrentMigrationStatus } = require('./dashboard/migrationStatus');
const { applicationAdmissionGate } = require('./services/runtime/applicationAdmissionGate');
const { ConfigControlServer, defaultConfigControlSocketPath } = require('./config/configControl');
const fs = require('fs');
const { readPrivateText } = require('./migrations/common/privateFile');
const { ApplicationMigrationBootstrap } = require('./bootstrap/applicationMigrationBootstrap');

global.bot = global.bot || { groupList: new Map(), selfId: '0' };

let ws = null;
let officialProvider = null;
let reconnectCount = 0;
let reconnectTimer = null;
let isManualClose = false;
const MAX_RECONNECT_DELAY = 60000;
const GROUP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const GROUP_LIST_ECHO_PREFIX = 'get_group_list#';
let groupRefreshTimer = null;
let initialSyncDone = false;
let processHandlersRegistered = false;
let configReloadHandlersRegistered = false;
let configControlServer = null;
let shutdownPromise = null;
let providerStartupRecovery = null;
const pendingSubscriptionStops = new Set();

const WS_OPEN = WebSocket.OPEN ?? 1;
const WS_CONNECTING = WebSocket.CONNECTING ?? 0;
const LIFECYCLE_SCOPE = logger.createScope('svc', 'lifecycle');

function botLog(level, message, fields = {}, scope = LIFECYCLE_SCOPE) {
    logger.logEvent(level, 'BOT', scope, message, fields);
}

function getSnapshotValue(snapshot, segments) {
    let current = snapshot;
    for (const segment of segments) {
        if (current === null || current === undefined) return undefined;
        current = current[segment];
    }
    return current;
}

function createSnapshotFacade(snapshot) {
    return new Proxy({
        get(pathOrKey) {
            const segments = Object.prototype.hasOwnProperty.call(FLAT_KEY_TO_PATH, pathOrKey)
                ? FLAT_KEY_TO_PATH[pathOrKey]
                : String(pathOrKey || '').split('.').filter(Boolean);
            return structuredClone(getSnapshotValue(snapshot, segments));
        },
        getSnapshot() {
            return structuredClone(snapshot);
        }
    }, {
        get(target, property, receiver) {
            if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
            if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(FLAT_KEY_TO_PATH, property)) {
                return structuredClone(getSnapshotValue(snapshot, FLAT_KEY_TO_PATH[property]));
            }
            return undefined;
        },
        set() {
            throw new TypeError('Runtime snapshot facade is read-only');
        }
    });
}

function providerAdmissionClosed() {
    const release = qqProviderRuntime.providerRuntimeManager.releaseGate.snapshot();
    return applicationAdmissionGate.snapshot().closed ||
        qqProviderRuntime.providerRuntimeManager.ingressPaused ||
        (release.epoch && !release.admissionEnabled);
}

const PROVIDER_EVENT_BUFFER_LIMIT = 1000;

function createProviderRuntimeEventBuffer(provider, dispatch, options = {}) {
    const pending = [];
    const instanceToken = Object.freeze({ provider, createdAt: Date.now() });
    let cancelGateOpen = null;
    let stopped = false;

    const isCurrent = () => !stopped &&
        provider.__runtimeEventBufferToken === instanceToken &&
        qqProviderRuntime.getCurrentProvider() === provider;
    const cancelPendingFlush = () => {
        cancelGateOpen?.();
        cancelGateOpen = null;
    };
    const armGateOpenFlush = () => {
        if (stopped || cancelGateOpen || !applicationAdmissionGate.snapshot().closed) return;
        const gateSequence = applicationAdmissionGate.snapshot().sequence;
        cancelGateOpen = applicationAdmissionGate.runWhenOpen(() => {
            cancelGateOpen = null;
            if (!isCurrent()) return 0;
            if (applicationAdmissionGate.snapshot().sequence !== gateSequence) {
                if (applicationAdmissionGate.snapshot().closed) {
                    armGateOpenFlush();
                    return 0;
                }
            }
            return flush();
        });
    };
    const flush = () => {
        cancelPendingFlush();
        if (!isCurrent() || providerAdmissionClosed()) {
            armGateOpenFlush();
            return 0;
        }
        const buffered = pending.splice(0);
        for (const payload of buffered) dispatch(payload);
        return buffered.length;
    };
    const enqueue = (payload) => {
        if (stopped) return false;
        if (pending.length >= (options.limit || PROVIDER_EVENT_BUFFER_LIMIT)) {
            const error = new Error(`${options.label || 'Provider'} event buffer overflow`);
            error.code = 'PROVIDER_EVENT_BUFFER_OVERFLOW';
            options.onOverflow?.(error);
            return false;
        }
        pending.push(payload);
        armGateOpenFlush();
        return true;
    };
    const cancel = () => {
        if (stopped) return;
        stopped = true;
        cancelPendingFlush();
        pending.length = 0;
        if (provider.__runtimeEventBufferToken === instanceToken) provider.__runtimeEventBufferToken = null;
    };

    provider.__runtimeEventBufferToken = instanceToken;
    provider.flushPendingRuntimeEvents = flush;
    provider.armPendingRuntimeEventFlush = armGateOpenFlush;
    provider.cancelPendingRuntimeEvents = cancel;
    return { enqueue, flush, cancel, armGateOpenFlush, pending };
}

function attachNapcatPrecommitBuffer(socket, provider) {
    const pending = [];
    let overflowError = null;
    let attached = true;
    const onMessage = (data) => {
        if (!attached || overflowError) return;
        if (pending.length >= PROVIDER_EVENT_BUFFER_LIMIT) {
            overflowError = new Error('NapCat candidate precommit event buffer overflow');
            overflowError.code = 'PROVIDER_EVENT_BUFFER_OVERFLOW';
            socket.close?.(1011, 'provider precommit event buffer overflow');
            return;
        }
        pending.push(data);
    };
    socket.on('message', onMessage);
    const controller = {
        assertHealthy() {
            if (overflowError) throw overflowError;
            return true;
        },
        handoff() {
            if (!attached) return [];
            attached = false;
            socket.removeListener?.('message', onMessage);
            this.assertHealthy();
            return pending.splice(0);
        },
        cancel() {
            if (!attached) return;
            attached = false;
            socket.removeListener?.('message', onMessage);
            pending.length = 0;
        }
    };
    provider.precommitInboundBuffer = controller;
    return controller;
}

async function armCurrentReleaseEpoch(options = {}) {
    let migration;
    try {
        migration = await (options.getMigrationStatus || getCurrentMigrationStatus)();
    } catch (error) {
        botLog('error', 'migration-status-invalid', { code: error?.code || 'MIGRATION_STATUS_UNAVAILABLE' });
        const markerError = new Error('Migration state exists but cannot be safely validated');
        markerError.code = 'RUNTIME_RELEASE_MARKER_REQUIRED';
        markerError.cause = error;
        throw markerError;
    }
    if (!migration) return null;
    if (migration.status === 'ready' && migration.configSchemaVersion) {
        return migration.releaseEpoch || null;
    }
    const epoch = String(migration.releaseEpoch || '').trim();
    const allowed = new Set(['runtime_released', 'runtime_ready', 'upgrade_complete']);
    if (!epoch || !allowed.has(migration.checkpoint)) {
        const error = new Error('Normal runtime requires a committed runtime_released migration epoch');
        error.code = 'RUNTIME_RELEASE_MARKER_REQUIRED';
        throw error;
    }
    const gate = qqProviderRuntime.providerRuntimeManager.releaseGate;
    const current = gate.snapshot();
    if (current.epoch && current.epoch !== epoch) {
        throw new Error('Runtime release epoch conflicts with active Provider epoch');
    }
    gate.arm(epoch);
    return epoch;
}

function releaseCurrentEpoch(epoch) {
    if (!epoch) return null;
    const gate = qqProviderRuntime.providerRuntimeManager.releaseGate;
    gate.release(epoch);
    gate.enableAdmission(epoch);
    return epoch;
}

async function bindCurrentReleaseEpoch() {
    const epoch = await armCurrentReleaseEpoch();
    return releaseCurrentEpoch(epoch);
}

async function preflightSelectedProvider(options = {}) {
    const snapshot = options.snapshot || config.getSnapshot();
    const providerName = String(snapshot?.qq?.provider || 'napcat').toLowerCase();
    if (providerName !== 'official') {
        qqProviderRuntime.providerRuntimeManager.probeStatus = {
            id: providerName,
            state: 'deferred',
            releaseEpoch: null
        };
        return { provider: providerName, state: 'deferred' };
    }
    const provider = (options.createProvider || createQqProvider)({
        provider: 'official',
        config: createSnapshotFacade(snapshot),
        publishGlobal: false,
        runtimeActive: false,
        forkSharedState: true
    });
    let result;
    let preflightError = null;
    try {
        if (typeof provider.preflight !== 'function') {
            const error = new Error('QQ Official Provider does not support no-consume preflight');
            error.code = 'OFFICIAL_PREFLIGHT_UNAVAILABLE';
            throw error;
        }
        await provider.preflight();
        qqProviderRuntime.providerRuntimeManager.probeStatus = {
            id: providerName,
            state: 'preflight-ready',
            releaseEpoch: null
        };
        result = { provider: providerName, state: 'preflight-ready' };
    } catch (error) {
        preflightError = error;
        qqProviderRuntime.providerRuntimeManager.probeStatus = {
            id: providerName,
            state: 'failed',
            releaseEpoch: null,
            code: error?.code || 'OFFICIAL_PREFLIGHT_FAILED'
        };
    }
    let cleanupError = null;
    try {
        await provider.stop?.();
    } catch (error) {
        cleanupError = error;
        qqProviderRuntime.providerRuntimeManager.trackResidualProvider?.(provider, error);
        qqProviderRuntime.providerRuntimeManager.probeStatus = {
            id: providerName,
            state: 'cleanup-pending',
            releaseEpoch: null,
            code: error?.code || 'OFFICIAL_PREFLIGHT_CLEANUP_FAILED'
        };
    }
    if (preflightError && cleanupError) {
        const error = new AggregateError(
            [preflightError, cleanupError],
            'QQ Official Provider preflight and cleanup failed'
        );
        error.code = 'OFFICIAL_PREFLIGHT_AND_CLEANUP_FAILED';
        error.preflightError = preflightError;
        error.cleanupErrors = [cleanupError];
        throw error;
    }
    if (preflightError) throw preflightError;
    if (cleanupError) {
        const error = new AggregateError([cleanupError], 'QQ Official Provider preflight cleanup failed');
        error.code = 'OFFICIAL_PREFLIGHT_CLEANUP_FAILED';
        error.cleanupErrors = [cleanupError];
        throw error;
    }
    return result;
}

function pauseProviderOperations() {
    botOperationRegistry.pause('qq-provider-reload');
    subscriptionService.pauseOperations?.('qq-provider-reload');
    videoDownloadService.pauseOperations?.('qq-provider-reload');
}

async function drainProviderOperations(timeoutMs = 330000) {
    await Promise.all([
        botOperationRegistry.drain({ timeoutMs }),
        subscriptionService.drainOperations?.(timeoutMs) || Promise.resolve(true),
        videoDownloadService.drainOperations?.(timeoutMs) || Promise.resolve(true)
    ]);
}

function abortProviderOperations(reason = 'shutdown deadline exceeded') {
    const failures = [];
    const results = [];
    for (const [owner, abort] of [
        ['bot', () => botOperationRegistry.abortAll(reason)],
        ['subscription', () => subscriptionService.abortOperations?.(reason)],
        ['download', () => videoDownloadService.abortOperations?.(reason)],
        ['python', () => ServiceManager.abortOperations?.(reason)]
    ]) {
        try {
            results.push({ owner, result: abort() })
        } catch (error) {
            failures.push(error)
        }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Runtime operation abort failed')
    return results
}

async function resumeProviderOperations({ candidate, previous } = {}) {
    videoDownloadService.resumeOperations?.();
    botOperationRegistry.resume();
    const provider = qqProviderRuntime.getCurrentProvider();
    const snapshot = candidate || previous || config.getSnapshot();
    if (provider) {
        await startActiveProviderRuntime(provider, snapshot, {
            resumeOperations: true,
            throwOnSubscriptionError: true
        });
    }
    else subscriptionService.resumeOperations?.();
}

async function pauseRecoveredProviderOperations() {
    pauseProviderOperations();
    clearReconnectTimer();
    clearGroupRefreshTimer();
    const failures = [];
    for (const cleanup of [
        () => subscriptionService.stop(),
        () => videoDownloadService.cleanup?.({ drainTimeoutMs: 30000, abortDrainTimeoutMs: 2000 })
    ]) {
        try {
            await cleanup();
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        const error = new AggregateError(failures, 'Recovered Provider runtime pause failed');
        error.code = 'PROVIDER_RECOVERY_PAUSE_FAILED';
        error.cleanupErrors = failures;
        throw error;
    }
}

function createProviderDescriptor(snapshot, options = {}) {
    const providerName = String(snapshot?.qq?.provider || 'napcat').toLowerCase();
    if (providerName === 'official') {
        let provider = null;
        let runtimeEventBuffer = null;
        provider = createQqProvider({
            provider: 'official',
            config: createSnapshotFacade(snapshot),
            sharedState: options.sharedState || options.previousProvider?.getSharedState?.(),
            forkSharedState: true,
            publishGlobal: false,
            runtimeActive: false,
            onEvent(payload) {
                if (qqProviderRuntime.getCurrentProvider() !== provider || providerAdmissionClosed()) {
                    runtimeEventBuffer.enqueue(payload);
                    return;
                }
                handleOfficialProviderEvent(payload);
            }
        });
        runtimeEventBuffer = createProviderRuntimeEventBuffer(provider, handleOfficialProviderEvent, {
            label: 'Official candidate',
            onOverflow(error) {
                if (provider.listenerCount?.('error') > 0) provider.emit('error', error);
                else botLog('error', 'provider-buffer-overflow', { provider: 'official', code: error.code });
                Promise.resolve(provider.stop?.()).catch(() => {});
            }
        });
        return {
            provider,
            supportsParallelSession: false,
            prepareInExclusive: true,
            startOptions: { publishGlobal: false },
            timeoutMs: Number(snapshot?.qq?.official?.gatewayAckTimeoutMs || 90000) + 15000
        };
    }

    const socket = new WebSocket(`${snapshot.qq.napcat.wsUrl}?access_token=${snapshot.qq.napcat.wsToken || ''}`);
    const provider = createQqProvider({ provider: 'napcat', ws: socket });
    attachNapcatPrecommitBuffer(socket, provider);
    return {
        provider,
        supportsParallelSession: true,
        timeoutMs: 15000
    };
}

async function startActiveProviderRuntime(provider, snapshot = config.getSnapshot(), options = {}) {
    if (pendingSubscriptionStops.size > 0) {
        await Promise.allSettled([...pendingSubscriptionStops]);
    }
    const resumeOperations = options.resumeOperations !== false;
    if (provider.id === 'official') {
        await subscriptionService.start(provider, {
            resumeOperations,
            throwOnError: options.throwOnSubscriptionError === true
        });
    } else {
        const socket = provider.ws;
        await subscriptionService.start(socket, {
            resumeOperations,
            throwOnError: options.throwOnSubscriptionError === true
        });
        if (socket?.readyState === WS_OPEN) {
            socket.send(JSON.stringify({ action: 'get_login_info', params: {}, echo: 'init_self_id' }));
            requestGroupList();
            clearGroupRefreshTimer();
            groupRefreshTimer = setInterval(requestGroupList, GROUP_REFRESH_INTERVAL_MS);
        }
    }
    subscriptionService.updateCheckInterval?.(
        snapshot?.subscription?.checkIntervalSeconds ?? config.subscriptionCheckInterval
    );
    applicationAdmissionGate.runWhenOpen(() => {
        const activeProvider = qqProviderRuntime.getCurrentProvider();
        if (!activeProvider) return 0;
        try {
            return activeProvider.flushPendingRuntimeEvents?.() || 0;
        } catch (error) {
            botLog('error', 'provider-buffer-flush-failed', {
                provider: activeProvider.id || 'unknown',
                code: error?.code || 'PROVIDER_BUFFER_FLUSH_FAILED',
                error: logger.getErrorMessage(error)
            });
            return 0;
        }
    });
    videoDownloadService.startCleanupScheduler();
    notificationService.startTempImageCleanupScheduler?.();
}

function publishOfficialProvider(provider, snapshot = config.getSnapshot(), options = {}) {
    clearGroupRefreshTimer();
    ws = null;
    officialProvider = provider;
    if (options.activateGlobal !== false) provider.activateGlobal?.();
    global.bot = global.bot || { groupList: new Map(), selfId: '0' };
    global.bot.ws = null;
    global.bot.provider = provider;
    if (options.startRuntime !== false) return startActiveProviderRuntime(provider, snapshot, options);
    return Promise.resolve();
}

function restoreExistingProviderHandle(previousExternal, snapshot) {
    const provider = previousExternal?.provider;
    if (!provider) return false;
    clearGroupRefreshTimer();
    if (provider.id === 'official') {
        publishOfficialProvider(provider, snapshot, { resumeOperations: false, startRuntime: false });
        return true;
    }
    ws = previousExternal.ws || provider.ws || null;
    officialProvider = null;
    global.bot = global.bot || { groupList: new Map(), selfId: '0' };
    global.bot.ws = ws;
    global.bot.provider = provider;
    return Boolean(ws);
}

async function rebuildProviderHandle(snapshot, options = {}) {
    const descriptorFactory = options.createDescriptor || createProviderDescriptor;
    const descriptor = descriptorFactory(snapshot, options);
    const provider = descriptor.provider;
    try {
        if (provider.id === 'official') {
            await provider.start(descriptor.startOptions);
            await provider.waitUntilReady(descriptor.timeoutMs);
            provider.commitSharedState?.();
            publishOfficialProvider(provider, snapshot, { resumeOperations: false, startRuntime: false });
        } else {
            await provider.waitUntilReady(descriptor.timeoutMs);
            createWebSocketConnection({
                ws: provider.ws,
                provider,
                wsUrl: snapshot.qq.napcat.wsUrl,
                wsToken: snapshot.qq.napcat.wsToken,
                subscriptionCheckInterval: snapshot.subscription.checkIntervalSeconds,
                resumeOperations: false,
                startRuntime: false,
                registerRuntime: false
            });
        }
    } catch (error) {
        try {
            await provider.stop?.();
        } catch (cleanupError) {
            qqProviderRuntime.providerRuntimeManager.trackResidualProvider(provider, cleanupError);
            error.cleanupErrors = [...(error.cleanupErrors || []), cleanupError];
        }
        throw error;
    }
    return provider;
}

function createQqProviderReloadHandler(options = {}) {
    const descriptorFactory = options.createDescriptor || createProviderDescriptor;
    let previousExternal = null;
    let previousStopState = 'untouched';
    let recoveryToResume = null;
    const handler = qqProviderRuntime.createReloadHandler({
        id: 'qq-provider-runtime',
        ownedPaths: ['qq', 'paths.napcatTemp'],
        timeoutMs: 330000,
        createCandidate({ candidate, previousSlot }) {
            previousExternal = {
                provider: previousSlot?.provider || qqProviderRuntime.getCurrentProvider(),
                ws,
                officialProvider
            };
            previousStopState = 'untouched';
            return descriptorFactory(candidate, {
                previousProvider: previousSlot?.provider,
                sharedState: previousSlot?.provider?.getSharedState?.()
            });
        },
        pauseOperations: pauseProviderOperations,
        drainOperations: drainProviderOperations,
        async prepareExclusive({ previousSlot }) {
            const provider = previousSlot?.provider;
            if (!provider) return;
            await subscriptionService.stop();
            clearReconnectTimer();
            clearGroupRefreshTimer();
            provider.deactivateGlobal?.();
            previousStopState = 'stopping';
            try {
                await provider.stop?.();
                previousStopState = 'stopped';
            } catch (error) {
                previousStopState = 'residual';
                qqProviderRuntime.providerRuntimeManager.trackResidualProvider(provider, error, {
                    slot: previousSlot
                });
                throw error;
            }
            if (global.bot?.provider === provider) global.bot.provider = null;
            if (global.bot?.ws === previousExternal?.ws) global.bot.ws = null;
            if (ws === previousExternal?.ws) ws = null;
            if (officialProvider === provider) officialProvider = null;
        },
        async activateCandidate({ activeSlot, candidate }) {
            const provider = activeSlot.provider;
            clearReconnectTimer();
            if (provider.id === 'official') {
                await publishOfficialProvider(provider, candidate, {
                    resumeOperations: false,
                    startRuntime: false,
                    activateGlobal: false
                });
                return;
            }
            officialProvider?.deactivateGlobal?.();
            officialProvider = null;
            createWebSocketConnection({
                ws: provider.ws,
                provider,
                wsUrl: candidate.qq.napcat.wsUrl,
                wsToken: candidate.qq.napcat.wsToken,
                subscriptionCheckInterval: candidate.subscription.checkIntervalSeconds,
                resumeOperations: false,
                startRuntime: false,
                registerRuntime: false
            });
        },
        commitAdmission({ activeSlot }) {
            const provider = activeSlot?.provider;
            if (provider?.id !== 'official') return;
            const sharedState = provider.commitSharedState?.();
            if (sharedState) qqProviderRuntime.providerRuntimeManager.sharedState = sharedState;
            provider.activateGlobal?.();
        },
        rollbackAdmission({ activeSlot }) {
            activeSlot?.provider?.rollbackSharedStateCommit?.();
        },
        afterAdmissionOpen({ activeSlot }) {
            activeSlot?.provider?.finalizeSharedStateCommit?.();
            recoveryToResume = null;
        },
        async restorePrevious({ previous, previousSlot }) {
            if (previousStopState === 'residual') {
                const error = new Error('Previous Provider cleanup remains incomplete');
                error.code = 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED';
                error.residualCount = qqProviderRuntime.providerRuntimeManager.getStatus().residualCount;
                throw error;
            }
            // Startup can now leave the service online with no QQ connection.
            // Rolling back a config edit must restore that disconnected state.
            if (!previousExternal?.provider && !previousSlot) return { provider: null };
            if (previousStopState !== 'stopped' && restoreExistingProviderHandle(previousExternal, previous)) {
                return { provider: previousExternal.provider };
            }
            const provider = await rebuildProviderHandle(previous, {
                previousProvider: previousExternal?.provider,
                sharedState: previousExternal?.provider?.getSharedState?.(),
                createDescriptor: descriptorFactory
            });
            if (previousSlot) previousSlot.provider = provider;
            return { provider };
        },
        resumeOperations: resumeProviderOperations,
        pauseRecovery: pauseRecoveredProviderOperations
    });
    const preflight = handler.preflight;
    handler.preflight = (candidate, previous, context = {}) => preflight(candidate, previous, {
        ...context,
        releaseEpoch: context.releaseEpoch || providerStartupRecovery?.releaseEpoch
    });
    const prepareParallel = handler.prepareParallel;
    handler.prepareParallel = async (...args) => {
        // The transaction registers rollbackPrepared before entering this phase.
        // Preflight failures therefore cannot strand a cancelled startup retry.
        recoveryToResume = providerStartupRecovery;
        await stopProviderStartupRecovery();
        return prepareParallel(...args);
    };
    const rollbackPrepared = handler.rollbackPrepared;
    handler.rollbackPrepared = async (...args) => {
        try {
            return await rollbackPrepared(...args);
        } finally {
            if (recoveryToResume && !isManualClose && !qqProviderRuntime.getCurrentProvider()) {
                startProviderStartupRecovery(recoveryToResume.releaseEpoch, recoveryToResume.options);
            }
            recoveryToResume = null;
        }
    };
    return handler;
}

function registerCoreConfigReloadHandlers() {
    if (configReloadHandlersRegistered || typeof config.registerReloadHandler !== 'function') return;
    configReloadHandlersRegistered = true;

    config.registerReloadHandler({
        id: 'logging',
        ownedPaths: ['logging'],
        effects: ['logging'],
        commitHandles(next) {
            logger.reconfigure(next.logging || {});
            logBuffer.resize(next.logging?.bufferSize || 2000);
        },
        restorePrevious(previous) {
            logger.reconfigure(previous.logging || {});
            logBuffer.resize(previous.logging?.bufferSize || 2000);
        }
    });

    config.registerReloadHandler({
        id: 'cache',
        ownedPaths: ['cache'],
        effects: ['cache']
    });

    config.registerReloadHandler({
        id: 'subscription-runtime',
        ownedPaths: ['subscription', 'enabledGroups', 'providerScopedEnabledGroups', 'groupConfigs'],
        effects: ['subscription', 'groups'],
        pauseIngress() {
            subscriptionService.pauseOperations('config-reload');
        },
        preCommitDrain() {
            return subscriptionService.drainOperations(330000);
        },
        commitHandles(candidate) {
            subscriptionService.updateCheckInterval(candidate.subscription.checkIntervalSeconds);
        },
        enableIngress() {
            if (!qqProviderRuntime.providerRuntimeManager.ingressPaused) {
                subscriptionService.resumeOperations();
            }
        },
        restorePrevious(previous) {
            subscriptionService.updateCheckInterval(previous.subscription.checkIntervalSeconds);
            if (!qqProviderRuntime.providerRuntimeManager.ingressPaused) {
                subscriptionService.resumeOperations();
            }
        }
    });

    config.registerReloadHandler(createQqProviderReloadHandler());

    for (const runtime of [ServiceManager, browserManager, videoDownloadService]) {
        if (typeof runtime.createReloadHandler === 'function') {
            config.registerReloadHandler(runtime.createReloadHandler());
        }
    }
}

function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function clearGroupRefreshTimer() {
    if (!groupRefreshTimer) return;
    clearInterval(groupRefreshTimer);
    groupRefreshTimer = null;
}

function getMessageScope(payload) {
    const messageType = String(payload?.message_type || 'group');
    const userId = payload?.user_id != null ? String(payload.user_id) : 'unknown';
    const groupId = messageType === 'private'
        ? `private_${userId}`
        : (payload?.group_id != null ? String(payload.group_id) : 'unknown');
    const messageId = payload?.message_id != null ? String(payload.message_id) : Date.now();
    return logger.createMessageScope(groupId, userId, messageId);
}

function resolveOperationTransport(context, fallback) {
    const provider = context?.providerSlotLease?.provider;
    if (!provider) return fallback;
    return provider.id === 'napcat' ? (provider.ws || fallback) : provider;
}

function runInboundOperation(kind, transport, payload, providerLabel, scope, handler) {
    const operation = botOperationRegistry.runBotOperation(kind, async (context) => {
        const leasedTransport = resolveOperationTransport(context, transport);
        return handler(leasedTransport, context);
    });
    operation.catch((e) => {
        botLog('error', 'message-handler-failed', {
            provider: providerLabel,
            operation: kind,
            groupId: payload?.group_id != null ? String(payload.group_id) : '',
            userId: payload?.user_id != null ? String(payload.user_id) : '',
            messageId: payload?.message_id != null ? String(payload.message_id) : '',
            error: logger.getErrorMessage(e),
            stack: e.stack || ''
        }, scope);
    });
    return operation;
}

function dispatchMessageToHandler(transport, payload, providerLabel, scope) {
    return runInboundOperation(
        'message',
        transport,
        payload,
        providerLabel,
        scope,
        (leasedTransport) => messageHandler.handleMessage(leasedTransport, payload)
    );
}

function requestGroupList() {
    if (!ws || ws.readyState !== WS_OPEN) return;
    const echo = `${GROUP_LIST_ECHO_PREFIX}${Date.now()}`;
    const payload = { action: 'get_group_list', params: {}, echo };
    try {
        ws.send(JSON.stringify(payload));
    } catch (e) {
        botLog('error', 'group-list-request-failed', {
            error: logger.getErrorMessage(e)
        });
    }
}

function handleOfficialProviderEvent(payload) {
    try {
        if (!payload || !officialProvider) return;

        if (payload.post_type === 'message') {
            const scope = getMessageScope(payload);
            payload.traceContext = { scope, receivedLogged: true };
            const resolvedGroupId = payload.message_type === 'private'
                ? `private_${payload.user_id != null ? String(payload.user_id) : 'unknown'}`
                : (payload.group_id != null ? String(payload.group_id) : '');

            botLog('info', 'recv', {
                provider: 'official',
                groupId: resolvedGroupId,
                userId: payload.user_id != null ? String(payload.user_id) : '',
                messageType: payload.message_type
            }, scope);

            dispatchMessageToHandler(officialProvider, payload, 'official', scope);
            return;
        }

        if (payload.post_type === 'notice') {
            return runInboundOperation('notice', officialProvider, payload, 'official', LIFECYCLE_SCOPE, async (provider) => {
                const groupId = String(payload.group_id || '');
                if (payload.notice_type === 'group_increase') {
                    if (groupId) {
                        await config.ensureGroupConfig(groupId);
                        await config.mutate((draft) => {
                            if (!draft.groupConfigs[groupId] || draft.groupConfigs[groupId].isInGroup !== false) return false;
                            draft.groupConfigs[groupId].isInGroup = true;
                            return true;
                        }, { actor: 'official-group-increase' });
                        global.bot.groupList = provider.idStore.toGroupListMap();
                    }
                    await messageHandler.handleGroupIncrease(provider, payload);
                    return;
                }

                if (payload.notice_type === 'group_decrease') {
                    if (groupId) {
                        await config.mutate((draft) => {
                            if (!draft.groupConfigs[groupId]) return false;
                            draft.groupConfigs[groupId].isInGroup = false;
                            return true;
                        }, { actor: 'official-group-decrease' });
                    }
                    global.bot.groupList = provider.idStore.toGroupListMap();
                    return;
                }

                if (payload.notice_type === 'group_reachability') {
                    botLog('info', 'official-group-reachability', {
                        groupId,
                        reachable: Boolean(payload.reachable),
                        reason: payload.reason || ''
                    });
                }
            });
        }
    } catch (e) {
        botLog('error', 'official-payload-process-failed', {
            error: logger.getErrorMessage(e),
            stack: e.stack || ''
        });
    }
}

async function createOfficialProviderConnection(options = {}) {
    if (officialProvider) {
        try {
            await officialProvider.stop();
        } catch (e) {
            botLog('error', 'official-stop-old-failed', {
                error: logger.getErrorMessage(e)
            });
        }
    }

    const descriptor = createProviderDescriptor(config.getSnapshot());
    const provider = descriptor.provider;

    botLog('info', 'official-connect-attempt', {
        appId: config.qqOfficialAppId,
        useShardedGateway: config.qqOfficialUseShardedGateway
    });

    await provider.start(descriptor.startOptions);
    await provider.waitUntilReady(descriptor.timeoutMs);
    const sharedState = provider.commitSharedState?.();
    if (sharedState) qqProviderRuntime.providerRuntimeManager.sharedState = sharedState;
    officialProvider = provider;
    qqProviderRuntime.setCurrentProvider(provider);
    await publishOfficialProvider(provider, config.getSnapshot(), { startRuntime: options.startRuntime !== false });

    botLog('info', 'official-started', {
        provider: 'official'
    });

    return provider;
}

async function migrateGroupConfigs() {
    let migrated = 0;
    await config.mutate((draft) => {
        for (const groupId of Object.keys(draft.groupConfigs || {})) {
            if (draft.groupConfigs[groupId].isInGroup === undefined) {
                draft.groupConfigs[groupId].isInGroup = true;
                migrated++;
            }
        }
        return migrated;
    }, { actor: 'group-config-state-migration' });

    if (migrated > 0) {
        botLog('info', 'config-migrated', {
            count: migrated
        });
    }
}

async function syncGroupStates() {
    if (!global.bot || !global.bot.groupList) {
        botLog('warn', 'group-sync-skipped', {
            reason: 'group_list_unavailable'
        });
        return;
    }

    const groupList = global.bot.groupList;
    let leftCount = 0;
    let rejoinedCount = 0;
    await config.mutate((draft) => {
        const groupConfigs = draft.groupConfigs || {};
        for (const configGroupId of Object.keys(groupConfigs)) {
            if (!groupList.has(configGroupId) && groupConfigs[configGroupId].isInGroup !== false) {
                groupConfigs[configGroupId].isInGroup = false;
                leftCount++;
                botLog('warn', 'group-left-detected', {
                    groupId: configGroupId
                });
            }
        }

        for (const groupId of groupList.keys()) {
            if (groupConfigs[groupId] && groupConfigs[groupId].isInGroup === false) {
                groupConfigs[groupId].isInGroup = true;
                rejoinedCount++;
                const groupInfo = groupList.get(groupId);
                botLog('info', 'group-rejoined', {
                    groupId,
                    groupName: groupInfo?.group_name || groupId
                });
            }
        }
    }, { actor: 'group-state-sync' });

    if (leftCount > 0 || rejoinedCount > 0) {
        botLog('info', 'group-sync-complete', {
            leftCount,
            rejoinedCount
        });
    }

    initialSyncDone = true;
}

function createWebSocketConnection(options = {}) {
    if (!options.ws && ws) {
        try {
            ws.removeAllListeners();
            if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) {
                ws.close();
            }
        } catch (e) {
            botLog('error', 'ws-close-old-failed', {
                error: logger.getErrorMessage(e)
            });
        }
    }

    botLog('info', 'connect-attempt', {
        attempt: reconnectCount + 1,
        wsUrl: options.wsUrl || config.wsUrl
    });
    const socket = options.ws || new WebSocket(`${options.wsUrl || config.wsUrl}?access_token=${options.wsToken ?? config.wsToken}`);
    const napcatProvider = options.provider || createQqProvider({ provider: 'napcat', ws: socket });
    ws = socket;
    global.bot.ws = socket;
    if (options.registerRuntime !== false) qqProviderRuntime.setCurrentProvider(napcatProvider);
    global.bot.provider = napcatProvider;

    let openHandled = false;
    const handleOpen = function open() {
        if (openHandled) return;
        if (qqProviderRuntime.getCurrentProvider() !== napcatProvider || ws !== socket) return;
        openHandled = true;
        napcatProvider.setWebSocket(socket);
        botLog('info', 'connected', {
            wsUrl: options.wsUrl || config.wsUrl
        });
        reconnectCount = 0;

        if (options.startRuntime !== false) {
            startActiveProviderRuntime(
                napcatProvider,
                options.snapshot || config.getSnapshot?.() || null,
                { resumeOperations: options.resumeOperations !== false }
            ).catch((error) => {
                botLog('error', 'subscription-runtime-start-failed', {
                    provider: 'napcat',
                    code: error?.code || 'SUBSCRIPTION_RUNTIME_START_FAILED',
                    error: logger.getErrorMessage(error)
                });
            });
        }
    };

    socket.on('open', handleOpen);
    if (socket.readyState === WS_OPEN) {
        queueMicrotask(handleOpen);
    }

    let runtimeEventBuffer = null;
    const incoming = function incoming(data) {
        if (qqProviderRuntime.getCurrentProvider() !== napcatProvider || ws !== socket) return;
        if (providerAdmissionClosed()) {
            runtimeEventBuffer.enqueue(data);
            return;
        }
        try {
            const payload = JSON.parse(data);

            if (payload && payload.echo === 'init_self_id' && payload.data && payload.data.user_id) {
                napcatProvider.markLoginReady?.(payload.data.user_id);
                global.bot.selfId = String(payload.data.user_id);
                if (payload.data.nickname) {
                    global.bot.nickname = String(payload.data.nickname);
                }
                botLog('info', 'self-id-ready', {
                    selfId: global.bot.selfId,
                    nickname: global.bot.nickname || ''
                });
            }

            if (payload && payload.echo && String(payload.echo).startsWith(GROUP_LIST_ECHO_PREFIX)) {
                const list = Array.isArray(payload.data) ? payload.data : [];
                const newMap = new Map();
                for (const g of list) {
                    const gid = g && g.group_id !== undefined ? String(g.group_id) : null;
                    if (gid) {
                        newMap.set(gid, g);
                    }
                }
                global.bot = global.bot || {};
                global.bot.groupList = newMap;

                if (!initialSyncDone) {
                    runInboundOperation(
                        'group-state-sync',
                        socket,
                        payload,
                        'napcat',
                        LIFECYCLE_SCOPE,
                        async () => {
                            await migrateGroupConfigs();
                            await syncGroupStates();
                        }
                    );
                }
            }

            if (payload.post_type === 'meta_event') return;

            if (payload.post_type === 'message') {
                const scope = getMessageScope(payload);
                payload.traceContext = { scope, receivedLogged: true };
                const resolvedGroupId = payload.message_type === 'private'
                    ? `private_${payload.user_id != null ? String(payload.user_id) : 'unknown'}`
                    : (payload.group_id != null ? String(payload.group_id) : '');

                botLog('info', 'recv', {
                    groupId: resolvedGroupId,
                    userId: payload.user_id != null ? String(payload.user_id) : '',
                    messageType: payload.message_type
                }, scope);

                if (payload.self_id && global.bot.selfId === '0') {
                    global.bot.selfId = String(payload.self_id);
                    botLog('info', 'self-id-stored', {
                        selfId: global.bot.selfId
                    }, scope);
                }

                dispatchMessageToHandler(socket, payload, 'napcat', scope);
                return;
            }

            if (payload.post_type === 'request') {
                runInboundOperation(
                    'request',
                    socket,
                    payload,
                    'napcat',
                    LIFECYCLE_SCOPE,
                    (leasedTransport) => requestApprovalService.handleRequestEvent(leasedTransport, payload)
                );
                return;
            }

            if (payload.post_type === 'notice' && payload.notice_type === 'group_increase') {
                const groupId = String(payload.group_id);
                const userId = String(payload.user_id);
                const selfId = String(payload.self_id);

                runInboundOperation('notice', socket, payload, 'napcat', LIFECYCLE_SCOPE, async (leasedTransport) => {
                    if (userId === selfId) {
                        await config.ensureGroupConfig(groupId);
                        const changed = await config.mutate((draft) => {
                            if (!draft.groupConfigs[groupId] || draft.groupConfigs[groupId].isInGroup !== false) return false;
                            draft.groupConfigs[groupId].isInGroup = true;
                            return true;
                        }, { actor: 'napcat-group-increase' });
                        if (changed) {
                            const groupInfo = global.bot?.groupList?.get(groupId);
                            botLog('info', 'group-rejoined', {
                                groupId,
                                groupName: groupInfo?.group_name || groupId
                            });
                        }
                    }

                    await messageHandler.handleGroupIncrease(leasedTransport, payload);
                    requestGroupList();
                });
                return;
            }

            if (payload.post_type === 'notice' && payload.notice_type === 'group_decrease') {
                const groupId = String(payload.group_id);
                const userId = String(payload.user_id);
                const selfId = String(payload.self_id);
                const subType = payload.sub_type;

                if (userId === selfId || subType === 'kick_me') {
                    runInboundOperation('notice', socket, payload, 'napcat', LIFECYCLE_SCOPE, async () => {
                        const changed = await config.mutate((draft) => {
                            if (!draft.groupConfigs[groupId]) return false;
                            draft.groupConfigs[groupId].isInGroup = false;
                            return true;
                        }, { actor: 'napcat-group-decrease' });
                        if (changed) {
                            const groupInfo = global.bot?.groupList?.get(groupId);
                            botLog('warn', 'group-left', {
                                groupId,
                                groupName: groupInfo?.group_name || groupId,
                                action: subType === 'kick_me' ? 'kicked' : 'left'
                            });
                        }
                        requestGroupList();
                    });
                }
            }
        } catch (e) {
            botLog('error', 'payload-process-failed', {
                error: logger.getErrorMessage(e),
                stack: e.stack || ''
            });
        }
    };
    runtimeEventBuffer = createProviderRuntimeEventBuffer(napcatProvider, incoming, {
        label: 'NapCat',
        onOverflow(error) {
            if (napcatProvider.listenerCount?.('error') > 0) napcatProvider.emit('error', error);
            else botLog('error', 'provider-buffer-overflow', { provider: 'napcat', code: error.code });
            socket.close?.(1011, 'provider event buffer overflow');
        }
    });
    socket.on('message', incoming);
    const precommitMessages = napcatProvider.precommitInboundBuffer?.handoff?.() || [];
    for (const data of precommitMessages) incoming(data);
    napcatProvider.precommitInboundBuffer = null;

    socket.on('close', function close(code, reason) {
        napcatProvider.cancelPendingRuntimeEvents?.();
        botLog('warn', 'disconnected', {
            code,
            reason: reason ? String(reason) : 'N/A'
        });

        const wasActive = ws === socket && qqProviderRuntime.getCurrentProvider() === napcatProvider;
        if (!wasActive) return;
        if (global.bot.ws === socket) global.bot.ws = null;
        if (global.bot.provider === napcatProvider) global.bot.provider = null;
        qqProviderRuntime.clearCurrentProvider(napcatProvider);

        const stopPromise = Promise.resolve(subscriptionService.stop()).catch((error) => {
            botLog('error', 'subscription-stop-after-provider-close-failed', {
                error: logger.getErrorMessage(error)
            });
        }).finally(() => pendingSubscriptionStops.delete(stopPromise));
        pendingSubscriptionStops.add(stopPromise);
        clearGroupRefreshTimer();

        if (!isManualClose && (!options.startupRecovery || options.startupRecovery.complete)) {
            stopPromise.finally(() => {
                if (!isManualClose) scheduleReconnect();
            });
        }
    });

    socket.on('error', function error(err) {
        if (qqProviderRuntime.getCurrentProvider() !== napcatProvider || ws !== socket) return;
        botLog('error', 'ws-error', {
            error: logger.getErrorMessage(err)
        });
    });

    if (socket.readyState === WS_OPEN) queueMicrotask(handleOpen);
    return socket;
}

function scheduleReconnect() {
    clearReconnectTimer();
    reconnectCount++;

    const baseDelay = 1000;
    const exponentialDelay = baseDelay * Math.pow(2, reconnectCount - 1);
    const delay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY);

    botLog('info', 'reconnect-scheduled', {
        delayMs: delay,
        attempt: reconnectCount,
        backoff: reconnectCount - 1
    });

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        createWebSocketConnection();
    }, delay);
}

async function gracefulShutdown(exitCode = 0, options = {}) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = performGracefulShutdown(exitCode, options);
    return shutdownPromise;
}

async function startConfigControlServer(options = {}) {
    if (!configControlServer) {
        configControlServer = options.server || new ConfigControlServer(config.service, {
            socketPath: defaultConfigControlSocketPath()
        });
    }
    try {
        await configControlServer.start();
        return configControlServer;
    } catch (error) {
        configControlServer = null;
        throw error;
    }
}

async function stopConfigControlServer() {
    if (!configControlServer) return;
    await configControlServer.stop();
    configControlServer = null;
}

async function performGracefulShutdown(exitCode = 0, options = {}) {
    const failures = [];
    const drainTimeoutMs = Number(options.drainTimeoutMs ?? 330000);
    const abortDrainTimeoutMs = Number(options.abortDrainTimeoutMs ?? 10000);
    const shutdownTimeoutMs = Math.max(1, Number(
        options.shutdownTimeoutMs ?? (drainTimeoutMs + (abortDrainTimeoutMs * 4) + 30000)
    ));
    const shutdownDeadlineAt = Date.now() + shutdownTimeoutMs;
    let deadlineAbortTriggered = false;
    const abortAtDeadline = () => {
        if (deadlineAbortTriggered) return;
        deadlineAbortTriggered = true;
        const deadlineError = new Error('Absolute process shutdown deadline exceeded');
        deadlineError.code = 'PROCESS_SHUTDOWN_DEADLINE_EXCEEDED';
        recordFailure('shutdown-deadline', deadlineError);
        try {
            abortProviderOperations('absolute process shutdown deadline exceeded');
        } catch (error) {
            recordFailure('shutdown-deadline-abort', error);
        }
        try { ws?.terminate?.(); } catch { /* process exits non-zero below */ }
        try { qqProviderRuntime.getCurrentProvider()?.ws?.terminate?.(); } catch { /* best effort */ }
        Promise.resolve(qqProviderRuntime.forceCloseAll?.({
            reason: 'absolute process shutdown deadline exceeded'
        })).catch((error) => recordFailure('provider-force-close', error));
        try { dashboardServer.forceStop?.(); } catch (error) { recordFailure('dashboard-force-stop', error); }
        try { imageGenerator.forceCleanup?.(); } catch (error) { recordFailure('image-force-cleanup', error); }
        try { ServiceManager.forceTerminateAll?.('absolute process shutdown deadline exceeded'); } catch (error) {
            recordFailure('python-force-terminate', error);
        }
    };
    const deadlineTimer = setTimeout(abortAtDeadline, shutdownTimeoutMs);
    const recordFailure = (stage, error) => {
        failures.push({ stage, error });
        botLog('error', `${stage}-failed`, {
            code: error?.code || 'SHUTDOWN_STAGE_FAILED',
            error: logger.getErrorMessage(error)
        });
    };
    const withDeadline = async (stage, operation) => {
        const remainingMs = shutdownDeadlineAt - Date.now();
        if (remainingMs <= 0) {
            abortAtDeadline();
            const error = new Error(`Shutdown deadline exceeded before ${stage}`);
            error.code = 'PROCESS_SHUTDOWN_DEADLINE_EXCEEDED';
            throw error;
        }
        let timer = null;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => {
                        abortAtDeadline();
                        const error = new Error(`Shutdown stage ${stage} exceeded the absolute deadline`);
                        error.code = 'PROCESS_SHUTDOWN_DEADLINE_EXCEEDED';
                        reject(error);
                    }, remainingMs);
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };
    const attempt = async (stage, operation) => {
        try {
            return await withDeadline(stage, operation);
        } catch (error) {
            recordFailure(stage, error);
            return undefined;
        }
    };

    botLog('info', 'shutdown-start', {
        exitCode
    });
    isManualClose = true;

    clearReconnectTimer();
    clearGroupRefreshTimer();

    await attempt('provider-startup-stop', stopProviderStartupRecovery);
    await attempt('config-control-stop', stopConfigControlServer);

    try {
        pauseProviderOperations();
        await withDeadline('runtime-drain', () => drainProviderOperations(
            Math.min(drainTimeoutMs, Math.max(1, shutdownDeadlineAt - Date.now()))
        ));
    } catch (error) {
        recordFailure('runtime-drain', error);
        await attempt('runtime-abort', async () => abortProviderOperations('process shutdown drain deadline exceeded'));
        await attempt('runtime-abort-drain', () => drainProviderOperations(
            Math.min(abortDrainTimeoutMs, Math.max(1, shutdownDeadlineAt - Date.now()))
        ));
    }

    await attempt('subscription-stop', () => Promise.resolve(subscriptionService.stop()));
    await attempt('auxiliary-services-stop', async () => {
        const results = await Promise.allSettled([
            requestApprovalService.stop?.(),
            notificationService.stop?.()
        ]);
        const rejected = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
        if (rejected.length > 0) throw new AggregateError(rejected, 'Auxiliary service shutdown failed');
    });
    const activeProvider = qqProviderRuntime.getCurrentProvider();
    activeProvider?.deactivateGlobal?.();
    try {
        if (typeof qqProviderRuntime.stopAll === 'function') {
            await withDeadline('provider-stop', () => qqProviderRuntime.stopAll({
                reason: 'process shutdown',
                timeoutMs: Math.min(abortDrainTimeoutMs, Math.max(1, shutdownDeadlineAt - Date.now()))
            }));
        } else if (activeProvider) {
            await withDeadline('provider-stop', () => activeProvider.stop?.());
            qqProviderRuntime.clearCurrentProvider(activeProvider);
        }
    } catch (e) {
        recordFailure('provider-stop', e);
        await attempt('provider-force-close', () => qqProviderRuntime.forceCloseAll?.({
            reason: 'provider stop failed during process shutdown'
        }));
    }
    if (global.bot) global.bot.provider = null;
    ws = null;
    officialProvider = null;

    await attempt('dashboard-stop', () => dashboardServer.stop());
    await attempt('image-cleanup', () => imageGenerator.cleanup());
    await attempt('download-cleanup', () => videoDownloadService.cleanup({
        drainTimeoutMs: abortDrainTimeoutMs,
        abortDrainTimeoutMs
    }));
    await attempt('python-cleanup', async () => {
        const result = await ServiceManager.cleanup({
            drainTimeoutMs: abortDrainTimeoutMs,
            abortDrainTimeoutMs,
            stopTimeoutMs: abortDrainTimeoutMs
        });
        const residualPids = result?.residualPids || result?.residualProcesses || [];
        if (Array.isArray(residualPids) && residualPids.length > 0) {
            const error = new Error(`Python cleanup left residual processes: ${residualPids.join(',')}`);
            error.code = 'PYTHON_RESIDUAL_PROCESSES';
            error.residualPids = residualPids;
            throw error;
        }
    });
    if (typeof config.stop === 'function') {
        await attempt('config-stop', () => config.stop());
    }

    clearTimeout(deadlineTimer);
    if (!deadlineAbortTriggered && Date.now() >= shutdownDeadlineAt) abortAtDeadline();
    const finalExitCode = (deadlineAbortTriggered || failures.length > 0) ? 1 : exitCode;

    botLog('info', 'shutdown-complete', {
        exitCode: finalExitCode,
        requestedExitCode: exitCode,
        failureCount: failures.length,
        failedStages: failures.map((entry) => entry.stage)
    });
    process.exit(finalExitCode);
    return finalExitCode;
}

async function stopProviderStartupRecovery() {
    const recovery = providerStartupRecovery;
    if (!recovery) return;
    recovery.cancelled = true;
    clearTimeout(recovery.timer);
    await recovery.promise;
    if (providerStartupRecovery === recovery) providerStartupRecovery = null;
}

function startProviderStartupRecovery(releaseEpoch, options = {}) {
    if (providerStartupRecovery && !providerStartupRecovery.cancelled) return providerStartupRecovery.promise;
    const recovery = { releaseEpoch, options, attempt: 0, timer: null, promise: null, cancelled: false, complete: false };
    providerStartupRecovery = recovery;
    const manager = qqProviderRuntime.providerRuntimeManager;
    const schedule = () => {
        if (recovery.cancelled || isManualClose) return;
        const delayMs = Math.min(1000 * (2 ** Math.min(recovery.attempt++, 6)), MAX_RECONNECT_DELAY);
        botLog('warn', 'provider-startup-retry-scheduled', { delayMs });
        recovery.timer = setTimeout(() => {
            recovery.timer = null;
            recovery.promise = attempt();
        }, delayMs);
    };
    const attempt = async () => {
        if (recovery.cancelled || isManualClose) return;
        // A configuration transaction owns Provider changes while admission is closed.
        if (applicationAdmissionGate.snapshot().closed || manager.ingressPaused) {
            schedule();
            return;
        }
        if (qqProviderRuntime.getCurrentProvider()) return;
        let provider = null;
        try {
            if (manager.residualSlots.size > 0) await manager.retryResidualCleanup();
            if (recovery.cancelled || isManualClose) return;
            const snapshot = config.getSnapshot();
            const descriptor = (options.createDescriptor || createProviderDescriptor)(snapshot);
            provider = descriptor.provider;
            let connectionError = null;
            provider.ws?.on?.('error', (error) => { connectionError = error; });
            if (provider.id === 'official') await provider.start(descriptor.startOptions);
            await provider.waitUntilReady(descriptor.timeoutMs);
            if (connectionError) throw connectionError;
            if (recovery.cancelled || isManualClose) throw new Error('Provider startup cancelled');
            if (provider.isRuntimeReady && !provider.isRuntimeReady()) throw new Error('Provider lost readiness');
            if (provider.id === 'official') {
                const sharedState = provider.commitSharedState?.();
                if (sharedState) manager.sharedState = sharedState;
                qqProviderRuntime.setCurrentProvider(provider);
                await publishOfficialProvider(provider, snapshot, { startRuntime: false });
            } else {
                createWebSocketConnection({
                    ws: provider.ws, provider, startRuntime: false, startupRecovery: recovery,
                    wsUrl: snapshot.qq.napcat.wsUrl, wsToken: snapshot.qq.napcat.wsToken
                });
            }
            releaseCurrentEpoch(releaseEpoch);
            await startActiveProviderRuntime(provider, snapshot, { resumeOperations: true });
            if (qqProviderRuntime.getCurrentProvider() !== provider ||
                (provider.isRuntimeReady && !provider.isRuntimeReady())) {
                throw new Error('Provider disconnected during runtime startup');
            }
            recovery.complete = true;
            botLog('info', 'provider-startup-ready', { provider: provider.id });
            if (providerStartupRecovery === recovery) providerStartupRecovery = null;
        } catch (error) {
            if (provider) {
                provider.cancelPendingRuntimeEvents?.();
                provider.precommitInboundBuffer?.cancel?.();
                const wasActive = qqProviderRuntime.getCurrentProvider() === provider;
                if (wasActive) qqProviderRuntime.clearCurrentProvider(provider);
                if (ws === provider.ws) {
                    if (global.bot?.ws === ws) global.bot.ws = null;
                    ws = null;
                }
                if (officialProvider === provider) officialProvider = null;
                try {
                    await provider.stop();
                } catch (cleanupError) {
                    manager.trackResidualProvider(provider, cleanupError);
                }
                if (wasActive) {
                    clearGroupRefreshTimer();
                    await subscriptionService.stop().catch((cleanupError) => {
                        botLog('error', 'subscription-startup-cleanup-failed', {
                            code: cleanupError?.code || 'SUBSCRIPTION_STOP_FAILED'
                        });
                    });
                }
            }
            if (!recovery.cancelled && !isManualClose) {
                botLog('warn', 'provider-startup-unavailable', {
                    provider: provider?.id || config.qqProvider,
                    code: error?.code || 'PROVIDER_STARTUP_FAILED'
                });
                schedule();
            }
        }
    };
    recovery.promise = attempt();
    return recovery.promise;
}

async function initializeBot(options = {}) {
    const mode = options.mode === 'probe' ? 'probe' : 'normal';
    try {
        botLog('info', 'startup', {
            phase: 'begin',
            mode
        });

        await ServiceManager.start();
        botLog('info', 'startup-step', {
            step: 'python-service-manager'
        });

        ServiceManager.onCriticalError = (message) => {
            updateChecker.notifyAdmin(message);
        };

        await dashboardServer.start(DASHBOARD_INGRESS_PORT);
        botLog('info', 'startup-step', {
            step: 'dashboard-server',
            port: DASHBOARD_INGRESS_PORT
        });

        if (mode !== 'probe') {
            qqProviderRuntime.providerRuntimeManager.probeStatus = null;
            const releaseEpoch = await armCurrentReleaseEpoch();
            await startProviderStartupRecovery(releaseEpoch, options);
            requestApprovalService.start?.();
            botLog('info', 'startup-step', {
                step: 'request-approval-cleanup-scheduler'
            });
        } else {
            const preflight = await preflightSelectedProvider({
                snapshot: config.getSnapshot?.() || null,
                createProvider: options.createProvider
            });
            botLog('info', 'startup-step', {
                step: preflight.state === 'preflight-ready'
                    ? 'provider-preflight-ready'
                    : 'provider-preflight-deferred',
                provider: preflight.provider
            });
        }

        botLog('info', 'startup', {
            phase: providerStartupRecovery ? 'degraded' : 'ready',
            mode
        });
    } catch (error) {
        botLog('error', 'startup-failed', {
            error: logger.getErrorMessage(error),
            stack: error.stack || ''
        });

        try {
            await gracefulShutdown(1);
        } catch (cleanupError) {
            botLog('error', 'cleanup-failed', {
                error: logger.getErrorMessage(cleanupError)
            });
        }

        process.exit(1);
    }
}

function registerProcessHandlers() {
    if (processHandlersRegistered) return;
    processHandlersRegistered = true;

    process.on('SIGINT', () => gracefulShutdown(0));
    process.on('SIGTERM', () => gracefulShutdown(0));

    process.on('unhandledRejection', (reason) => {
        botLog('error', 'unhandled-rejection', {
            error: logger.getErrorMessage(reason),
            stack: reason instanceof Error ? reason.stack || '' : ''
        });
    });

    process.on('uncaughtException', (error) => {
        botLog('error', 'uncaught-exception', {
            error: logger.getErrorMessage(error),
            stack: error?.stack || ''
        });
        process.exit(1);
    });
}

function readBootstrapInstallInput(filePath) {
    if (!filePath) return null;
    const value = JSON.parse(readPrivateText(path.resolve(filePath), {
        mode: 0o600,
        fileCode: 'CONFIG_BOOTSTRAP_INVALID_INPUT',
        permissionCode: 'CONFIG_BOOTSTRAP_INVALID_INPUT'
    }));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        const error = new Error('Invalid bootstrap install input');
        error.code = 'CONFIG_BOOTSTRAP_INVALID_INPUT';
        throw error;
    }
    return value;
}

function cleanupBootstrapInstallInput(filePath, options = {}) {
    if (!filePath) return { removed: false, retained: false };
    const fsModule = options.fsModule || fs;
    try {
        fsModule.unlinkSync(path.resolve(filePath));
        return { removed: true, retained: false };
    } catch (error) {
        if (error?.code === 'ENOENT') return { removed: false, retained: false };
        botLog('warn', 'bootstrap-input-retained', {
            code: error?.code || 'BOOTSTRAP_INPUT_CLEANUP_FAILED'
        });
        return { removed: false, retained: true, code: error?.code || 'BOOTSTRAP_INPUT_CLEANUP_FAILED' };
    }
}

async function startBot(options = {}) {
    registerProcessHandlers();
    const upgradeMode = String(process.env.BILI_UPGRADE_MODE || '').trim().toLowerCase();
    const mode = upgradeMode === 'probe' ? 'probe' : 'normal';
    const bootstrap = options.bootstrap || new ApplicationMigrationBootstrap({
        configDir: options.configDir,
        dataDir: options.dataDir
    });
    const installInputPath = options.installInputPath || process.env.BILI_BOOTSTRAP_INPUT;
    const installInput = options.installInput || readBootstrapInstallInput(installInputPath);
    await bootstrap.run({
        mode,
        installInput,
        createIfMissing: Boolean(installInput),
        allowLegacyMigration: true,
        deploymentAttemptId: process.env.BILI_DEPLOYMENT_ATTEMPT_ID || null,
        releaseEpoch: process.env.BILI_RELEASE_EPOCH || null,
        retainForHandoff: true
    });
    await bootstrap.handoff(config, { watch: true });
    cleanupBootstrapInstallInput(installInputPath);
    try {
        await startConfigControlServer();
    } catch (error) {
        await config.stop().catch(() => {});
        throw error;
    }
    logger.reconfigure(config.get('logging') || {});
    logBuffer.resize(config.get('logging.bufferSize') || 2000);
    registerCoreConfigReloadHandlers();
    botLog('info', 'startup-step', {
        step: 'config-service',
        generation: config.getStatus().documentGeneration
    });
    warmupEmojiIndexProvider();
    await initializeBot({ mode });
}

if (require.main === module) {
    startBot().catch((err) => {
        botLog('error', 'startup-unhandled', {
            error: logger.getErrorMessage(err),
            stack: err?.stack || ''
        });
        process.exit(1);
    });
}

module.exports = {
    initializeBot,
    createWebSocketConnection,
    createOfficialProviderConnection,
    scheduleReconnect,
    gracefulShutdown,
    registerProcessHandlers,
    startBot,
    __testHooks: {
        clearReconnectTimer,
        clearGroupRefreshTimer,
        cleanupBootstrapInstallInput,
        createSnapshotFacade,
        createProviderDescriptor,
        attachNapcatPrecommitBuffer,
        createQqProviderReloadHandler,
        startActiveProviderRuntime,
        startConfigControlServer,
        stopConfigControlServer,
        resumeProviderOperations,
        armCurrentReleaseEpoch,
        bindCurrentReleaseEpoch,
        preflightSelectedProvider,
        startProviderStartupRecovery,
        stopProviderStartupRecovery,
        getRuntimeState() {
            return { ws, officialProvider, activeProvider: qqProviderRuntime.getCurrentProvider() };
        },
        resetRuntimeState() {
            if (providerStartupRecovery) {
                providerStartupRecovery.cancelled = true;
                clearTimeout(providerStartupRecovery.timer);
                providerStartupRecovery = null;
            }
            ws = null;
            officialProvider = null;
            reconnectCount = 0;
            reconnectTimer = null;
            isManualClose = false;
            groupRefreshTimer = null;
            initialSyncDone = false;
            shutdownPromise = null;
            pendingSubscriptionStops.clear();
        }
    }
};
