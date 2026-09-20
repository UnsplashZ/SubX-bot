'use strict'

const express = require('express')
const logger = require('../../../../utils/logger')
const defaultConfig = require('../../../../config')
const { FLAT_KEY_TO_PATH, resolveSchemaNode } = require('../../../../config/schemaV1')
const { dashLog } = require('../shared/logging')
const { getCurrentMigrationStatus } = require('../../../migrationStatus')
const { publicRecoveryStatus } = require('../shared/config-mutation')

const ALLOWED_GLOBAL_CONFIG_KEYS = new Set([
    'subscriptionCheckInterval',
    'linkCacheTimeout',
    'showId',
    'previewGradientColor1',
    'previewGradientColor2',
    'videoDownloadEnabled',
    'videoDownloadResolution',
    'videoDownloadMaxDuration',
    'videoDownloadAutoClean',
    'videoDownloadCleanTimeout',
    'wsUrl',
    'wsToken',
    'qqProvider',
    'qqOfficialAppId',
    'qqOfficialClientSecret',
    'qqOfficialApiBase',
    'qqOfficialTokenUrl',
    'qqOfficialUseShardedGateway',
    'qqOfficialIntents',
    'qqOfficialGatewayAckTimeoutMs',
    'qqOfficialMediaUploadMode',
    'qqOfficialTempPublicBaseUrl',
    'qqOfficialRootOpenids',
    'qqOfficialAccountQpm',
    'qqOfficialGroupQpm',
    'qqOfficialQueueMaxSize'
])

const REQUEST_META_KEYS = new Set(['expectedGeneration', 'values', 'patch', 'secretActions'])
const INTEGER_KEYS = new Set([
    'subscriptionCheckInterval',
    'linkCacheTimeout',
    'videoDownloadMaxDuration',
    'videoDownloadCleanTimeout',
    'qqOfficialIntents',
    'qqOfficialGatewayAckTimeoutMs',
    'qqOfficialAccountQpm',
    'qqOfficialGroupQpm',
    'qqOfficialQueueMaxSize'
])
const BOOLEAN_KEYS = new Set([
    'showId',
    'videoDownloadEnabled',
    'videoDownloadAutoClean',
    'qqOfficialUseShardedGateway'
])
const SECRET_KEY_TO_PATH = Object.freeze({
    qqOfficialClientSecret: FLAT_KEY_TO_PATH.qqOfficialClientSecret,
    wsToken: FLAT_KEY_TO_PATH.wsToken
})

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function normalizeFlatValue(key, value) {
    if (INTEGER_KEYS.has(key)) {
        const parsed = typeof value === 'number' ? value : Number(value)
        if (!Number.isSafeInteger(parsed)) {
            const error = new Error('Expected integer')
            error.code = 'CONFIG_VALIDATION_ERROR'
            throw error
        }
        return parsed
    }
    if (BOOLEAN_KEYS.has(key)) {
        if (typeof value !== 'boolean') {
            const error = new Error('Expected boolean')
            error.code = 'CONFIG_VALIDATION_ERROR'
            throw error
        }
        return value
    }
    if (key === 'qqProvider') {
        const provider = String(value || '').trim().toLowerCase()
        if (!['napcat', 'onebot', 'official'].includes(provider)) {
            const error = new Error('Unsupported Provider')
            error.code = 'CONFIG_VALIDATION_ERROR'
            throw error
        }
        return provider === 'official' ? 'official' : 'napcat'
    }
    if (key === 'qqOfficialRootOpenids') {
        const values = Array.isArray(value) ? value : String(value || '').split(',')
        return values.map((item) => String(item).trim()).filter(Boolean)
    }
    if (key === 'qqOfficialMediaUploadMode') return String(value || '').trim().toLowerCase()
    if (key.startsWith('previewGradientColor')) return String(value || '').trim().toUpperCase()
    if (typeof value === 'string') return value.trim()
    return clone(value)
}

function assertExpectedGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        const error = new Error('expectedGeneration is required')
        error.code = 'CONFIG_EXPECTED_GENERATION_REQUIRED'
        throw error
    }
    return value
}

function normalizePatchPath(operation) {
    const rawPath = operation?.path
    let path
    if (Array.isArray(rawPath)) {
        if (rawPath.some((segment) => typeof segment !== 'string' || !segment)) {
            const error = new Error('Patch path segments must be non-empty strings')
            error.code = 'CONFIG_PATH_INVALID'
            throw error
        }
        path = [...rawPath]
    } else if (typeof rawPath === 'string' && rawPath.startsWith('/')) {
        const encoded = rawPath.slice(1).split('/')
        if (encoded.some((segment) => !segment || /~(?![01])/u.test(segment))) {
            const error = new Error('Patch path must be a strict RFC 6901 JSON Pointer')
            error.code = 'CONFIG_PATH_INVALID'
            throw error
        }
        path = encoded.map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    } else {
        const error = new Error('Patch path must be a segment array or RFC 6901 JSON Pointer')
        error.code = 'CONFIG_PATH_INVALID'
        throw error
    }
    const allowed = [...ALLOWED_GLOBAL_CONFIG_KEYS].some((key) => {
        const mapped = FLAT_KEY_TO_PATH[key]
        return mapped && mapped.join('.') === path.join('.')
    })
    if (!allowed) {
        const error = new Error('Dashboard path is not writable')
        error.code = 'CONFIG_PATH_NOT_ALLOWED'
        throw error
    }
    return path
}

function buildPatchOperations(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        const error = new Error('Invalid request')
        error.code = 'CONFIG_REQUEST_INVALID'
        throw error
    }
    for (const key of Object.keys(body)) {
        if (!REQUEST_META_KEYS.has(key) && !ALLOWED_GLOBAL_CONFIG_KEYS.has(key)) {
            const error = new Error('Unknown configuration field')
            error.code = 'CONFIG_FIELD_UNKNOWN'
            throw error
        }
    }

    const operations = []
    if (body.patch !== undefined) {
        if (!Array.isArray(body.patch)) {
            const error = new Error('Patch must be an array')
            error.code = 'CONFIG_PATCH_INVALID'
            throw error
        }
        for (const rawOperation of body.patch) {
            const path = normalizePatchPath(rawOperation)
            const schema = resolveSchemaNode(path)
            const operation = String(rawOperation.op || 'set')
            if (schema?.secret && operation !== 'clear-secret' && rawOperation.value === '') continue
            operations.push({ op: operation, path, ...(operation === 'clear-secret' ? {} : { value: clone(rawOperation.value) }) })
        }
    }

    const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values)
        ? body.values
        : Object.fromEntries(Object.entries(body).filter(([key]) => ALLOWED_GLOBAL_CONFIG_KEYS.has(key)))
    for (const [key, rawValue] of Object.entries(values)) {
        if (!ALLOWED_GLOBAL_CONFIG_KEYS.has(key)) {
            const error = new Error('Unknown configuration field')
            error.code = 'CONFIG_FIELD_UNKNOWN'
            throw error
        }
        const path = FLAT_KEY_TO_PATH[key]
        const schema = resolveSchemaNode(path)
        if (schema?.secret && (rawValue === '' || rawValue === undefined || rawValue === null)) continue
        operations.push({ op: 'set', path, value: normalizeFlatValue(key, rawValue) })
    }

    if (body.secretActions !== undefined) {
        if (!body.secretActions || typeof body.secretActions !== 'object' || Array.isArray(body.secretActions)) {
            const error = new Error('Invalid secret actions')
            error.code = 'CONFIG_SECRET_ACTION_INVALID'
            throw error
        }
        for (const [key, action] of Object.entries(body.secretActions)) {
            const path = SECRET_KEY_TO_PATH[key]
            if (!path || action !== 'clear') {
                const error = new Error('Unsupported secret action')
                error.code = 'CONFIG_SECRET_ACTION_INVALID'
                throw error
            }
            operations.push({ op: 'clear-secret', path })
        }
    }

    if (operations.length === 0) {
        const error = new Error('No configuration changes')
        error.code = 'CONFIG_PATCH_EMPTY'
        throw error
    }
    return operations
}

function publicConfigResponse(config) {
    const snapshot = typeof config.getDashboardConfigSnapshot === 'function'
        ? config.getDashboardConfigSnapshot()
        : config.getPublicConfig()
    return clone(snapshot)
}

function configErrorResponse(config, error) {
    const publicError = typeof config.service?.toPublicError === 'function'
        ? config.service.toPublicError(error)
        : {
            code: typeof error?.code === 'string' ? error.code : 'CONFIG_ERROR',
            path: typeof error?.path === 'string' ? error.path : '',
            line: Number.isInteger(error?.line) ? error.line : null,
            column: Number.isInteger(error?.column) ? error.column : null
        }
    const status = config.getStatus()
    return {
        error: publicError.code,
        ...publicError,
        generation: status.documentGeneration,
        fingerprint: status.fingerprint,
        ...publicRecoveryStatus(status),
        ...(Array.isArray(error?.conflictPaths) ? { conflictPaths: [...error.conflictPaths] } : {})
    }
}

function configErrorLogFields(error, payload = {}) {
    let cause = error?.cause || null
    const seen = new Set()
    while (cause?.cause && !seen.has(cause)) {
        seen.add(cause)
        cause = cause.cause
    }

    const detail = cause || error
    return {
        code: payload.code || error?.code || 'CONFIG_ERROR',
        phase: error?.phase || '',
        handlerId: error?.handlerId || '',
        causeCode: detail?.code || '',
        causeMessage: logger.getErrorMessage(detail),
        httpStatus: Number.isInteger(detail?.httpStatus) ? detail.httpStatus : null,
        qqCode: typeof detail?.qqCode === 'string' || typeof detail?.qqCode === 'number' ? detail.qqCode : null,
        causePath: typeof detail?.path === 'string' ? detail.path : ''
    }
}

function createConfigRouter(options = {}) {
    const config = options.config || defaultConfig
    const migrationStatusProvider = options.getMigrationStatus || getCurrentMigrationStatus
    const router = express.Router()

    router.get('/config', (req, res) => {
        try {
            const snapshot = publicConfigResponse(config)
            if (typeof config.getRootAdminQQ === 'function') snapshot.rootAdminQQ = config.getRootAdminQQ()
            res.json(snapshot)
        } catch (error) {
            dashLog(req, 'error', 'config-fetch-failed', { code: error?.code || 'CONFIG_ERROR' })
            res.status(500).json(configErrorResponse(config, error))
        }
    })

    router.post('/config', async (req, res) => {
        try {
            const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
            const operations = buildPatchOperations(req.body)
            const result = await config.patch(operations, {
                actor: 'dashboard',
                expectedGeneration
            })
            const snapshot = publicConfigResponse(config)
            dashLog(req, 'info', 'config-updated', {
                appliedCount: result.applied.length,
                reloadedCount: result.reloaded.length,
                deploymentCount: result.deploymentApplyRequired.length
            })
            res.json({
                ...result,
                config: snapshot
            })
        } catch (error) {
            const payload = configErrorResponse(config, error)
            const statusCode = error?.code === 'CONFIG_GENERATION_CONFLICT'
                ? 409
                : (String(error?.code || '').startsWith('CONFIG_') ? 400 : 500)
            dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'config-update-failed', configErrorLogFields(error, payload))
            res.status(statusCode).json(payload)
        }
    })

    router.get('/config/status', (req, res) => {
        try {
            const status = config.getStatus()
            res.json(status)
        } catch (error) {
            res.status(500).json(configErrorResponse(config, error))
        }
    })

    router.post('/config/reload', async (req, res) => {
        try {
            const result = await config.reload({ source: 'dashboard' })
            res.json(result)
        } catch (error) {
            const statusCode = String(error?.code || '').startsWith('CONFIG_') ? 400 : 500
            res.status(statusCode).json(configErrorResponse(config, error))
        }
    })

    router.post('/config/recover', async (req, res) => {
        try {
            const result = await config.recover({ source: 'dashboard' })
            res.json(result)
        } catch (error) {
            const statusCode = String(error?.code || '').startsWith('CONFIG_') ? 409 : 500
            res.status(statusCode).json(configErrorResponse(config, error))
        }
    })

    router.get('/config/migrations', async (req, res) => {
        try {
            const migration = await migrationStatusProvider()
            res.json({ migration: migration || null })
        } catch (error) {
            logger.logEvent('warn', 'DASH', req.logScope || 'config-migrations', 'migration-status-failed', {
                code: error?.code || 'MIGRATION_ERROR'
            })
            res.status(503).json({ error: 'MIGRATION_STATUS_UNAVAILABLE' })
        }
    })

    return router
}

const router = createConfigRouter()

module.exports = router
module.exports.createConfigRouter = createConfigRouter
module.exports.buildPatchOperations = buildPatchOperations
module.exports.normalizePatchPath = normalizePatchPath
module.exports.configErrorResponse = configErrorResponse
module.exports.configErrorLogFields = configErrorLogFields
module.exports.ALLOWED_GLOBAL_CONFIG_KEYS = ALLOWED_GLOBAL_CONFIG_KEYS
