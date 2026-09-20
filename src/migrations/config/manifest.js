'use strict'

const path = require('path')
const { atomicWriteJson } = require('../common/atomicFile')
const { readPrivateText } = require('../common/privateFile')
const { MigrationError } = require('../common/errors')

const MANIFEST_VERSION = 1

const CHECKPOINTS = [
    'discovered',
    'cutover_intent',
    'legacy_fenced',
    'forced_recovery_ready',
    'runtime_stopped',
    'snapshot_ready',
    'candidate_written',
    'data_applied',
    'probe_started',
    'probe_ready',
    'release_prepared',
    'runtime_release_armed',
    'runtime_released',
    'runtime_ready',
    'upgrade_complete',
    'rollback_started',
    'rolled_back',
    'failed'
]

const CHECKPOINT_SET = new Set(CHECKPOINTS)
const SOURCE_RUNTIME_CLASSES = new Set(['fresh-install', 'managed-v1+', 'legacy-v0'])
const CUTOVER_KINDS = new Set(['fresh-install', 'first-managed-adoption', 'resume-same-attempt', 'managed-upgrade'])
const DELIVERY_GUARANTEES = new Set(['exactly-once', 'best-effort'])
const EXCEPTION_SCOPES = new Set(['none', 'legacy-v0-first-cutover-inflight-outbound'])
const AFFECTED_STATES = new Set(['none', 'operations-without-durable-part-record'])
const RETRY_POLICIES = new Set(['none', 'retry-determinable-uncommitted-parent-or-target'])
const IMMUTABLE_PROVENANCE_FIELDS = [
    'sourceRuntimeClass',
    'cutoverKind',
    'cutoverAttemptId',
    'deliveryGuarantee',
    'exceptionScope',
    'affectedState',
    'retryPolicy'
]
const FENCE_CAPABILITIES = new Set(['established', 'best-effort', 'unavailable', 'not-required'])
const STOP_MODES = new Set(['graceful', 'forced', 'not-required'])
const DRAIN_OUTCOMES = new Set(['not-required', 'clean', 'timed-out', 'interrupted'])
const WARNING_CODES = new Set([
    'LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS',
    'LEGACY_DETACHED_OUTBOUND_AMBIGUOUS',
    'LEGACY_FORCED_STOP_BEST_EFFORT',
    'LEGACY_NETWORK_FENCE_UNAVAILABLE',
    'LEGACY_COERCION_APPLIED',
    'LEGACY_UNMAPPED_GROUP_CONFIG',
    'LEGACY_AGENT_CONFIG_DROPPED'
])
const LEGACY_FEATURES = new Set([
    'subscription-push',
    'subscription-auto-download',
    'fallback-send',
    'python-download',
    'ffmpeg',
    'napcat-queued-send',
    'official-http-send'
])
const MANIFEST_KEYS = new Set([
    'manifestVersion',
    'migrationId',
    'fromVersion',
    'toVersion',
    'status',
    'sourceHashes',
    'targetHashes',
    'snapshotHashes',
    'dataSchemaVersion',
    'configSchemaVersion',
    'releaseEpoch',
    'businessAdmissionOpened',
    'archiveArtifacts',
    'deployment',
    'cutover',
    'createdAt',
    'updatedAt'
])
const CUTOVER_KEYS = new Set([
    'sourceRuntimeClass',
    'cutoverKind',
    'cutoverAttemptId',
    'deliveryGuarantee',
    'exceptionScope',
    'affectedState',
    'retryPolicy',
    'ambiguousDeliveryWindow',
    'ambiguousDeliveryWindowStartedAt',
    'ambiguousDeliveryWindowEndedAt',
    'fenceCapability',
    'stopMode',
    'fenceAttempted',
    'fenceEstablished',
    'forcedStop',
    'drainOutcome',
    'legacyFeatureInventory',
    'warningCodes',
    'appliesToCommittedRuntime'
])
const DEPLOYMENT_KEYS = new Set([
    'writerSetArtifact',
    'networkStateArtifact',
    'rollbackImageTag'
])

const PHASE_BY_CHECKPOINT = {
    discovered: 'discovery',
    cutover_intent: 'cutover',
    legacy_fenced: 'cutover',
    forced_recovery_ready: 'snapshot',
    runtime_stopped: 'cutover',
    snapshot_ready: 'snapshot',
    candidate_written: 'migrate',
    data_applied: 'migrate',
    probe_started: 'probe',
    probe_ready: 'probe',
    release_prepared: 'release',
    runtime_release_armed: 'release',
    runtime_released: 'release',
    runtime_ready: 'complete',
    upgrade_complete: 'complete',
    rollback_started: 'rollback',
    rolled_back: 'rollback',
    failed: 'failed'
}

const ALLOWED_TRANSITIONS = {
    discovered: ['cutover_intent', 'snapshot_ready', 'candidate_written', 'failed'],
    cutover_intent: ['legacy_fenced', 'runtime_stopped', 'snapshot_ready', 'rollback_started', 'failed'],
    legacy_fenced: ['runtime_stopped', 'forced_recovery_ready', 'rollback_started', 'failed'],
    forced_recovery_ready: ['runtime_stopped', 'snapshot_ready', 'rollback_started', 'failed'],
    runtime_stopped: ['snapshot_ready', 'rollback_started', 'failed'],
    snapshot_ready: ['candidate_written', 'data_applied', 'rollback_started', 'failed'],
    candidate_written: ['data_applied', 'probe_started', 'rollback_started', 'failed'],
    data_applied: ['probe_started', 'rollback_started', 'failed'],
    probe_started: ['probe_ready', 'rollback_started', 'failed'],
    probe_ready: ['release_prepared', 'rollback_started', 'failed'],
    release_prepared: ['runtime_release_armed', 'rollback_started', 'failed'],
    runtime_release_armed: ['runtime_released', 'rollback_started', 'failed'],
    runtime_released: ['runtime_ready', 'failed'],
    runtime_ready: ['upgrade_complete', 'failed'],
    upgrade_complete: [],
    rollback_started: ['rolled_back', 'failed'],
    rolled_back: ['discovered'],
    failed: ['rollback_started', 'discovered']
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertEnum(value, allowed, code) {
    if (!allowed.has(value)) throw new MigrationError(code)
}

function assertIsoOrNull(value, code) {
    if (value === null || value === undefined) return
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new MigrationError(code)
}

function assertStringArray(value, allowed, code) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !allowed.has(item))) {
        throw new MigrationError(code)
    }
}

function defaultCutover(overrides = {}) {
    return {
        sourceRuntimeClass: 'fresh-install',
        cutoverKind: 'fresh-install',
        cutoverAttemptId: '',
        deliveryGuarantee: 'exactly-once',
        exceptionScope: 'none',
        affectedState: 'none',
        retryPolicy: 'none',
        ambiguousDeliveryWindow: false,
        ambiguousDeliveryWindowStartedAt: null,
        ambiguousDeliveryWindowEndedAt: null,
        fenceCapability: 'not-required',
        stopMode: 'not-required',
        fenceAttempted: false,
        fenceEstablished: false,
        forcedStop: false,
        drainOutcome: 'not-required',
        legacyFeatureInventory: [],
        warningCodes: [],
        appliesToCommittedRuntime: false,
        ...overrides
    }
}

function validateCutover(cutover) {
    if (!isPlainObject(cutover)) throw new MigrationError('MIGRATION_CUTOVER_REQUIRED')
    for (const key of Object.keys(cutover)) {
        if (!CUTOVER_KEYS.has(key)) throw new MigrationError('MIGRATION_CUTOVER_FIELD_UNKNOWN')
    }
    assertEnum(cutover.sourceRuntimeClass, SOURCE_RUNTIME_CLASSES, 'MIGRATION_SOURCE_RUNTIME_INVALID')
    assertEnum(cutover.cutoverKind, CUTOVER_KINDS, 'MIGRATION_CUTOVER_KIND_INVALID')
    if (typeof cutover.cutoverAttemptId !== 'string' || !/^[a-zA-Z0-9._:-]{0,200}$/.test(cutover.cutoverAttemptId)) {
        throw new MigrationError('MIGRATION_ATTEMPT_ID_INVALID')
    }
    assertEnum(cutover.deliveryGuarantee, DELIVERY_GUARANTEES, 'MIGRATION_DELIVERY_GUARANTEE_INVALID')
    assertEnum(cutover.exceptionScope, EXCEPTION_SCOPES, 'MIGRATION_EXCEPTION_SCOPE_INVALID')
    assertEnum(cutover.affectedState, AFFECTED_STATES, 'MIGRATION_AFFECTED_STATE_INVALID')
    assertEnum(cutover.retryPolicy, RETRY_POLICIES, 'MIGRATION_RETRY_POLICY_INVALID')
    assertEnum(cutover.fenceCapability, FENCE_CAPABILITIES, 'MIGRATION_FENCE_CAPABILITY_INVALID')
    assertEnum(cutover.stopMode, STOP_MODES, 'MIGRATION_STOP_MODE_INVALID')
    assertEnum(cutover.drainOutcome, DRAIN_OUTCOMES, 'MIGRATION_DRAIN_OUTCOME_INVALID')
    assertStringArray(cutover.warningCodes, WARNING_CODES, 'MIGRATION_WARNING_CODE_INVALID')
    assertStringArray(cutover.legacyFeatureInventory, LEGACY_FEATURES, 'MIGRATION_LEGACY_FEATURE_INVALID')
    assertIsoOrNull(cutover.ambiguousDeliveryWindowStartedAt, 'MIGRATION_WINDOW_START_INVALID')
    assertIsoOrNull(cutover.ambiguousDeliveryWindowEndedAt, 'MIGRATION_WINDOW_END_INVALID')
    for (const key of ['ambiguousDeliveryWindow', 'fenceAttempted', 'fenceEstablished', 'forcedStop', 'appliesToCommittedRuntime']) {
        if (typeof cutover[key] !== 'boolean') throw new MigrationError('MIGRATION_CUTOVER_BOOLEAN_INVALID')
    }

    const isLegacyBestEffort = cutover.deliveryGuarantee === 'best-effort'
    if (isLegacyBestEffort) {
        if (cutover.sourceRuntimeClass !== 'legacy-v0' || !['first-managed-adoption', 'resume-same-attempt'].includes(cutover.cutoverKind)) {
            throw new MigrationError('MIGRATION_BEST_EFFORT_SCOPE_INVALID')
        }
        if (cutover.exceptionScope !== 'legacy-v0-first-cutover-inflight-outbound' ||
            cutover.affectedState !== 'operations-without-durable-part-record' ||
            cutover.retryPolicy !== 'retry-determinable-uncommitted-parent-or-target') {
            throw new MigrationError('MIGRATION_BEST_EFFORT_METADATA_INVALID')
        }
        if (!cutover.cutoverAttemptId || !cutover.ambiguousDeliveryWindow || !cutover.warningCodes.includes('LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS')) {
            throw new MigrationError('MIGRATION_BEST_EFFORT_AUDIT_INVALID')
        }
    } else {
        if (cutover.exceptionScope !== 'none' || cutover.affectedState !== 'none' || cutover.retryPolicy !== 'none') {
            throw new MigrationError('MIGRATION_EXACT_GUARANTEE_METADATA_INVALID')
        }
        if (cutover.warningCodes.length > 0 || cutover.legacyFeatureInventory.length > 0 || cutover.forcedStop) {
            throw new MigrationError('MIGRATION_LEGACY_METADATA_FORBIDDEN')
        }
    }
    const isLegacy = cutover.sourceRuntimeClass === 'legacy-v0'
    if (isLegacy && (!['first-managed-adoption', 'resume-same-attempt'].includes(cutover.cutoverKind) || !isLegacyBestEffort)) {
        throw new MigrationError('MIGRATION_LEGACY_PROVENANCE_INVALID')
    }
    if (!isLegacy && ['first-managed-adoption', 'resume-same-attempt'].includes(cutover.cutoverKind)) {
        throw new MigrationError('MIGRATION_LEGACY_PROVENANCE_INVALID')
    }
    if (cutover.sourceRuntimeClass === 'fresh-install' && cutover.cutoverKind !== 'fresh-install') {
        throw new MigrationError('MIGRATION_PROVENANCE_PAIR_INVALID')
    }
    if (cutover.sourceRuntimeClass === 'managed-v1+' && cutover.cutoverKind !== 'managed-upgrade') {
        throw new MigrationError('MIGRATION_PROVENANCE_PAIR_INVALID')
    }
    return cutover
}

function validateHashMap(value, code) {
    if (!isPlainObject(value)) throw new MigrationError(code)
    for (const [key, hash] of Object.entries(value)) {
        if (!/^[a-zA-Z0-9._-]+$/.test(key) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
            throw new MigrationError(code)
        }
    }
}

function validateManifest(manifest) {
    if (!isPlainObject(manifest)) throw new MigrationError('MIGRATION_MANIFEST_INVALID')
    for (const key of Object.keys(manifest)) {
        if (!MANIFEST_KEYS.has(key)) throw new MigrationError('MIGRATION_MANIFEST_FIELD_UNKNOWN')
    }
    if (manifest.manifestVersion !== MANIFEST_VERSION) throw new MigrationError('MIGRATION_MANIFEST_VERSION_UNSUPPORTED')
    if (typeof manifest.migrationId !== 'string' || !manifest.migrationId) throw new MigrationError('MIGRATION_ID_INVALID')
    if (!Number.isInteger(manifest.fromVersion) || !Number.isInteger(manifest.toVersion)) throw new MigrationError('MIGRATION_VERSION_INVALID')
    assertEnum(manifest.status, CHECKPOINT_SET, 'MIGRATION_STATUS_INVALID')
    validateHashMap(manifest.sourceHashes || {}, 'MIGRATION_SOURCE_HASH_INVALID')
    validateHashMap(manifest.targetHashes || {}, 'MIGRATION_TARGET_HASH_INVALID')
    validateHashMap(manifest.snapshotHashes || {}, 'MIGRATION_SNAPSHOT_HASH_INVALID')
    if (!isPlainObject(manifest.deployment)) throw new MigrationError('MIGRATION_DEPLOYMENT_INVALID')
    for (const key of Object.keys(manifest.deployment)) {
        if (!DEPLOYMENT_KEYS.has(key)) throw new MigrationError('MIGRATION_DEPLOYMENT_FIELD_UNKNOWN')
    }
    for (const key of ['writerSetArtifact', 'networkStateArtifact']) {
        const artifact = manifest.deployment[key]
        if (artifact !== null && artifact !== undefined && !isSafeArtifactName(artifact)) {
            throw new MigrationError('MIGRATION_DEPLOYMENT_ARTIFACT_INVALID')
        }
    }
    const rollbackImageTag = manifest.deployment.rollbackImageTag
    if (rollbackImageTag !== null && rollbackImageTag !== undefined &&
        (typeof rollbackImageTag !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,300}$/.test(rollbackImageTag))) {
        throw new MigrationError('MIGRATION_ROLLBACK_IMAGE_TAG_INVALID')
    }
    validateCutover(manifest.cutover)
    if (manifest.releaseEpoch !== null && manifest.releaseEpoch !== undefined &&
        (typeof manifest.releaseEpoch !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(manifest.releaseEpoch))) {
        throw new MigrationError('MIGRATION_RELEASE_EPOCH_INVALID')
    }
    if (typeof manifest.businessAdmissionOpened !== 'boolean') throw new MigrationError('MIGRATION_ADMISSION_STATE_INVALID')
    for (const key of ['createdAt', 'updatedAt']) assertIsoOrNull(manifest[key], 'MIGRATION_TIMESTAMP_INVALID')
    if (!Array.isArray(manifest.archiveArtifacts) || manifest.archiveArtifacts.some((item) => !isSafeArtifactName(item))) {
        throw new MigrationError('MIGRATION_ARCHIVE_ARTIFACT_INVALID')
    }
    const releaseIndex = CHECKPOINTS.indexOf('runtime_released')
    const statusIndex = CHECKPOINTS.indexOf(manifest.status)
    const committed = statusIndex >= releaseIndex && statusIndex <= CHECKPOINTS.indexOf('upgrade_complete')
    if (committed) {
        if (!manifest.releaseEpoch) throw new MigrationError('MIGRATION_RELEASE_EPOCH_REQUIRED')
        if (manifest.cutover.appliesToCommittedRuntime !== true) throw new MigrationError('MIGRATION_COMMIT_MARKER_INVALID')
    } else if (manifest.status !== 'failed' && manifest.cutover.appliesToCommittedRuntime !== false) {
        throw new MigrationError('MIGRATION_COMMIT_MARKER_INVALID')
    }
    if (['runtime_release_armed', 'runtime_released', 'runtime_ready', 'upgrade_complete'].includes(manifest.status) && !manifest.releaseEpoch) {
        throw new MigrationError('MIGRATION_RELEASE_EPOCH_REQUIRED')
    }
    if (['runtime_ready', 'upgrade_complete'].includes(manifest.status) && manifest.businessAdmissionOpened !== true) {
        throw new MigrationError('MIGRATION_ADMISSION_STATE_INVALID')
    }
    if (statusIndex < releaseIndex && manifest.businessAdmissionOpened) {
        throw new MigrationError('MIGRATION_ADMISSION_STATE_INVALID')
    }
    return manifest
}

function createManifest(options = {}) {
    const now = options.now || new Date().toISOString()
    const manifest = {
        manifestVersion: MANIFEST_VERSION,
        migrationId: options.migrationId || 'config-v0-to-v1',
        fromVersion: Number.isInteger(options.fromVersion) ? options.fromVersion : 0,
        toVersion: Number.isInteger(options.toVersion) ? options.toVersion : 1,
        status: options.status || 'discovered',
        sourceHashes: options.sourceHashes || {},
        targetHashes: options.targetHashes || {},
        snapshotHashes: options.snapshotHashes || {},
        dataSchemaVersion: Number.isInteger(options.dataSchemaVersion) ? options.dataSchemaVersion : 0,
        configSchemaVersion: Number.isInteger(options.configSchemaVersion) ? options.configSchemaVersion : 1,
        releaseEpoch: options.releaseEpoch ?? null,
        businessAdmissionOpened: Boolean(options.businessAdmissionOpened),
        archiveArtifacts: options.archiveArtifacts || [],
        deployment: {
            writerSetArtifact: null,
            networkStateArtifact: null,
            rollbackImageTag: null,
            ...(options.deployment || {})
        },
        cutover: defaultCutover(options.cutover),
        createdAt: options.createdAt || now,
        updatedAt: options.updatedAt || now
    }
    return validateManifest(manifest)
}

function readManifest(manifestPath) {
    let value
    try {
        value = JSON.parse(readPrivateText(manifestPath))
    } catch (error) {
        if (error instanceof MigrationError) throw error
        throw new MigrationError(error && error.code === 'ENOENT' ? 'MIGRATION_MANIFEST_NOT_FOUND' : 'MIGRATION_MANIFEST_PARSE_FAILED')
    }
    return validateManifest(value)
}

function writeManifest(manifestPath, manifest) {
    const next = validateManifest({ ...manifest, updatedAt: new Date().toISOString() })
    let current = null
    try {
        current = readManifest(manifestPath)
    } catch (error) {
        if (error?.code !== 'MIGRATION_MANIFEST_NOT_FOUND') throw error
    }
    if (current) {
        if (current.status !== 'discovered') {
            for (const field of IMMUTABLE_PROVENANCE_FIELDS) {
                if (next.cutover[field] !== current.cutover[field]) throw new MigrationError('MIGRATION_PROVENANCE_IMMUTABLE')
            }
            for (const warningCode of current.cutover.warningCodes) {
                if (!next.cutover.warningCodes.includes(warningCode)) throw new MigrationError('MIGRATION_WARNING_REMOVAL_FORBIDDEN')
            }
        }
        if (current.cutover.appliesToCommittedRuntime === true && next.cutover.appliesToCommittedRuntime !== true) {
            throw new MigrationError('MIGRATION_COMMITTED_ROLLBACK_FORBIDDEN')
        }
    }
    atomicWriteJson(manifestPath, next, { mode: 0o600 })
    return next
}

function assertTransition(current, next) {
    if (current === next) return
    const allowed = ALLOWED_TRANSITIONS[current] || []
    if (!allowed.includes(next)) throw new MigrationError('MIGRATION_TRANSITION_INVALID')
}

function isSafeArtifactName(value) {
    if (typeof value !== 'string' || !value || value.includes('\\')) return false
    if (path.posix.isAbsolute(value)) return false
    const normalized = path.posix.normalize(value)
    return normalized !== '..' && !normalized.startsWith('../') && normalized.split('/').every((segment) => /^[a-zA-Z0-9._-]+$/.test(segment))
}

const CHECKPOINT_INPUT_KEYS = new Set([
    'sourceHashes',
    'targetHashes',
    'snapshotHashes',
    'dataSchemaVersion',
    'configSchemaVersion',
    'releaseEpoch',
    'businessAdmissionOpened',
    'archiveArtifacts',
    'deployment',
    'cutover'
])

function sanitizeCheckpointInput(input) {
    if (!isPlainObject(input)) throw new MigrationError('MIGRATION_CHECKPOINT_INPUT_INVALID')
    for (const key of Object.keys(input)) {
        if (!CHECKPOINT_INPUT_KEYS.has(key)) throw new MigrationError('MIGRATION_CHECKPOINT_FIELD_UNKNOWN')
    }
    const output = {}
    for (const key of ['sourceHashes', 'targetHashes', 'snapshotHashes']) {
        if (input[key] !== undefined) {
            validateHashMap(input[key], 'MIGRATION_CHECKPOINT_HASH_INVALID')
            output[key] = { ...input[key] }
        }
    }
    for (const key of ['dataSchemaVersion', 'configSchemaVersion']) {
        if (input[key] !== undefined) {
            if (!Number.isInteger(input[key]) || input[key] < 0) throw new MigrationError('MIGRATION_CHECKPOINT_VERSION_INVALID')
            output[key] = input[key]
        }
    }
    if (input.releaseEpoch !== undefined) {
        if (input.releaseEpoch !== null && (typeof input.releaseEpoch !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(input.releaseEpoch))) {
            throw new MigrationError('MIGRATION_RELEASE_EPOCH_INVALID')
        }
        output.releaseEpoch = input.releaseEpoch
    }
    if (input.businessAdmissionOpened !== undefined) {
        if (typeof input.businessAdmissionOpened !== 'boolean') throw new MigrationError('MIGRATION_ADMISSION_STATE_INVALID')
        output.businessAdmissionOpened = input.businessAdmissionOpened
    }
    if (input.archiveArtifacts !== undefined) {
        if (!Array.isArray(input.archiveArtifacts) || input.archiveArtifacts.some((item) => !isSafeArtifactName(item))) {
            throw new MigrationError('MIGRATION_ARCHIVE_ARTIFACT_INVALID')
        }
        output.archiveArtifacts = [...input.archiveArtifacts]
    }
    if (input.deployment !== undefined) {
        if (!isPlainObject(input.deployment)) throw new MigrationError('MIGRATION_DEPLOYMENT_INVALID')
        const deployment = {
            writerSetArtifact: null,
            networkStateArtifact: null,
            rollbackImageTag: null
        }
        for (const key of Object.keys(input.deployment)) {
            if (!DEPLOYMENT_KEYS.has(key)) throw new MigrationError('MIGRATION_DEPLOYMENT_FIELD_UNKNOWN')
        }
        for (const key of ['writerSetArtifact', 'networkStateArtifact']) {
            if (input.deployment[key] !== undefined) {
                if (input.deployment[key] !== null && !isSafeArtifactName(input.deployment[key])) {
                    throw new MigrationError('MIGRATION_DEPLOYMENT_ARTIFACT_INVALID')
                }
                deployment[key] = input.deployment[key]
            }
        }
        if (input.deployment.rollbackImageTag !== undefined) {
            const tag = input.deployment.rollbackImageTag
            if (tag !== null && (typeof tag !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,300}$/.test(tag))) {
                throw new MigrationError('MIGRATION_ROLLBACK_IMAGE_TAG_INVALID')
            }
            deployment.rollbackImageTag = tag
        }
        output.deployment = deployment
    }
    if (input.cutover !== undefined) output.cutover = { ...validateCutover(defaultCutover(input.cutover)) }
    return output
}

function checkpointManifest(manifestPath, status, input = {}) {
    assertEnum(status, CHECKPOINT_SET, 'MIGRATION_STATUS_INVALID')
    const current = readManifest(manifestPath)
    if (current.cutover.appliesToCommittedRuntime === true && ['rollback_started', 'rolled_back', 'discovered'].includes(status)) {
        throw new MigrationError('MIGRATION_COMMITTED_ROLLBACK_FORBIDDEN')
    }
    assertTransition(current.status, status)
    if (current.status === 'cutover_intent' && status === 'snapshot_ready' && current.cutover.sourceRuntimeClass !== 'fresh-install') {
        throw new MigrationError('MIGRATION_TRANSITION_INVALID')
    }
    const patch = sanitizeCheckpointInput(input)
    if (patch.cutover) {
        patch.cutover = validateCutover({
            ...patch.cutover,
            warningCodes: [...new Set([...current.cutover.warningCodes, ...patch.cutover.warningCodes])]
        })
    }
    if (current.releaseEpoch && patch.releaseEpoch && current.releaseEpoch !== patch.releaseEpoch) {
        throw new MigrationError('MIGRATION_RELEASE_EPOCH_CONFLICT')
    }
    if (current.cutover.cutoverAttemptId && patch.cutover?.cutoverAttemptId && current.cutover.cutoverAttemptId !== patch.cutover.cutoverAttemptId) {
        throw new MigrationError('MIGRATION_ATTEMPT_ID_CONFLICT')
    }
    if (current.status !== 'discovered' && patch.cutover) {
        for (const field of IMMUTABLE_PROVENANCE_FIELDS) {
            if (patch.cutover[field] !== current.cutover[field]) throw new MigrationError('MIGRATION_PROVENANCE_IMMUTABLE')
        }
    }
    const next = {
        ...current,
        ...patch,
        status,
        cutover: patch.cutover || current.cutover
    }
    if (current.cutover.appliesToCommittedRuntime === true) {
        next.cutover = { ...next.cutover, appliesToCommittedRuntime: true }
    }
    if (['runtime_released', 'runtime_ready', 'upgrade_complete'].includes(status)) {
        next.cutover = { ...next.cutover, appliesToCommittedRuntime: true }
    }
    if (status === 'rolled_back' || status === 'rollback_started') {
        next.cutover = { ...next.cutover, appliesToCommittedRuntime: false }
    }
    return writeManifest(manifestPath, next)
}

function toPublicMigrationStatus(manifest) {
    const value = validateManifest(manifest)
    const cutover = value.cutover
    return {
        migrationId: value.migrationId,
        checkpoint: value.status,
        phase: PHASE_BY_CHECKPOINT[value.status],
        sourceRuntimeClass: cutover.sourceRuntimeClass,
        cutoverKind: cutover.cutoverKind,
        deliveryGuarantee: cutover.deliveryGuarantee,
        exceptionScope: cutover.exceptionScope,
        affectedState: cutover.affectedState,
        retryPolicy: cutover.retryPolicy,
        legacyFeatureInventory: [...cutover.legacyFeatureInventory],
        ambiguousDeliveryWindow: cutover.ambiguousDeliveryWindow,
        ambiguousDeliveryWindowStartedAt: cutover.ambiguousDeliveryWindowStartedAt,
        ambiguousDeliveryWindowEndedAt: cutover.ambiguousDeliveryWindowEndedAt,
        forcedStop: cutover.forcedStop,
        drainOutcome: cutover.drainOutcome,
        warningCodes: [...cutover.warningCodes],
        appliesToCommittedRuntime: cutover.appliesToCommittedRuntime,
        releaseEpoch: value.releaseEpoch,
        businessAdmissionOpened: value.businessAdmissionOpened,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
    }
}

module.exports = {
    MANIFEST_VERSION,
    CHECKPOINTS,
    WARNING_CODES,
    LEGACY_FEATURES,
    IMMUTABLE_PROVENANCE_FIELDS,
    createManifest,
    validateManifest,
    validateCutover,
    readManifest,
    writeManifest,
    checkpointManifest,
    sanitizeCheckpointInput,
    toPublicMigrationStatus,
    isSafeArtifactName
}
