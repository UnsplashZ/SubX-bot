'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
const { META } = require('../../config/schema')
const { validateConfig } = require('../../config/validator')
const { readPrivateFile, readPrivateText } = require('../common/privateFile')
const { MigrationError } = require('../common/errors')
const { parseConfigYaml, validateConfigObject } = require('./configDocument')

const LEGACY_FILES = {
    dotenv: '.env',
    json: 'config.json',
    jwtSecret: '.jwtSecret',
    officialSecret: '.qqOfficialClientSecret',
    yaml: 'config.yaml'
}

const FLAT_TO_YAML_PATH = {
    wsUrl: 'qq.napcat.wsUrl',
    wsToken: 'qq.napcat.wsToken',
    qqProvider: 'qq.provider',
    qqOfficialAppId: 'qq.official.appId',
    qqOfficialClientSecret: 'qq.official.clientSecret',
    qqOfficialApiBase: 'qq.official.apiBase',
    qqOfficialTokenUrl: 'qq.official.tokenUrl',
    qqOfficialUseShardedGateway: 'qq.official.useShardedGateway',
    qqOfficialIntents: 'qq.official.intents',
    qqOfficialGatewayAckTimeoutMs: 'qq.official.gatewayAckTimeoutMs',
    qqOfficialMediaUploadMode: 'qq.official.mediaUploadMode',
    qqOfficialTempPublicBaseUrl: 'qq.official.tempPublicBaseUrl',
    qqOfficialRootOpenids: 'qq.official.rootOpenids',
    qqOfficialAccountQpm: 'qq.official.rateLimit.accountQpm',
    qqOfficialGroupQpm: 'qq.official.rateLimit.groupQpm',
    qqOfficialQueueMaxSize: 'qq.official.rateLimit.queueMaxSize',
    pythonPath: 'paths.python',
    dashboardPort: 'dashboard.listenPort',
    dashboardPassword: 'dashboard.password',
    dashboardAllowedOrigins: 'dashboard.allowedOrigins',
    biliServerPort: 'pythonService.port',
    biliScriptPath: 'paths.biliScript',
    useBase64Send: 'rendering.useBase64Send',
    napcatTempPath: 'paths.napcatTemp',
    napcatReadPath: 'paths.napcatRead',
    linkCacheTimeout: 'cache.linkTtlSeconds',
    dataCacheTTL: 'cache.dataTtlSeconds',
    subscriptionCheckInterval: 'subscription.checkIntervalSeconds',
    showId: 'rendering.showId',
    previewGradientColor1: 'rendering.previewGradient.color1',
    previewGradientColor2: 'rendering.previewGradient.color2',
    previewLayoutConfig: 'rendering.previewLayout',
    videoDownloadEnabled: 'videoDownload.enabled',
    videoDownloadResolution: 'videoDownload.resolution',
    videoDownloadMaxDuration: 'videoDownload.maxDurationSeconds',
    videoDownloadAutoClean: 'videoDownload.autoClean',
    videoDownloadCleanTimeout: 'videoDownload.cleanTimeoutHours',
    blacklistedQQs: 'blacklistedQQs',
    enabledGroups: 'enabledGroups',
    providerScopedEnabledGroups: 'providerScopedEnabledGroups',
    nightMode: 'rendering.nightMode',
    labelConfig: 'rendering.labels',
    groupConfigs: 'groupConfigs'
}

const KNOWN_GROUP_KEYS = new Set([
    'admins',
    'blacklistedQQs',
    'cookieSyncGroupNames',
    'enableCookieSync',
    'isInGroup',
    'labelConfig',
    'linkCacheTimeout',
    'nightMode',
    'showId',
    'subscriptionAtAll',
    'subscriptionAtAllRules',
    'videoDownloadEnabled',
    'videoDownloadMaxDuration',
    'videoDownloadResolution'
])

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key)
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function setPath(target, dottedPath, value) {
    const segments = dottedPath.split('.')
    let current = target
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index]
        if (!isPlainObject(current[segment])) current[segment] = {}
        current = current[segment]
    }
    current[segments[segments.length - 1]] = clone(value)
}

function parseLegacyValue(value, type, warnings, flatKey) {
    if (value === undefined || value === null) return value
    if (type === 'string') return String(value)
    if (type === 'int') {
        const parsed = parseInt(value, 10)
        if (Number.isNaN(parsed)) return 0
        if (typeof value !== 'number') warnings.push({ code: 'LEGACY_COERCION_APPLIED', path: flatKey })
        return parsed
    }
    if (type === 'float') {
        const parsed = parseFloat(value)
        if (Number.isNaN(parsed)) return 0
        if (typeof value !== 'number') warnings.push({ code: 'LEGACY_COERCION_APPLIED', path: flatKey })
        return parsed
    }
    if (type === 'bool') {
        if (typeof value === 'boolean') return value
        const normalized = String(value).trim().toLowerCase()
        warnings.push({ code: 'LEGACY_COERCION_APPLIED', path: flatKey })
        if (['true', '1', 'yes'].includes(normalized)) return true
        if (['false', '0', 'no'].includes(normalized)) return false
        return Boolean(value)
    }
    if (type === 'csv') {
        return Array.isArray(value)
            ? value.map((item) => String(item).trim()).filter(Boolean)
            : String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
    }
    if (type === 'array') {
        if (Array.isArray(value)) return clone(value)
        try {
            const parsed = JSON.parse(String(value))
            warnings.push({ code: 'LEGACY_COERCION_APPLIED', path: flatKey })
            return Array.isArray(parsed) ? parsed : []
        } catch {
            return []
        }
    }
    if (type === 'object') {
        if (typeof value === 'object' && value !== null) return clone(value)
        try {
            const parsed = JSON.parse(String(value))
            warnings.push({ code: 'LEGACY_COERCION_APPLIED', path: flatKey })
            return typeof parsed === 'object' && parsed !== null ? parsed : {}
        } catch {
            return {}
        }
    }
    return clone(value)
}

function readOptionalText(filePath, capture, logicalName) {
    try {
        const result = readPrivateFile(filePath, {
            mode: null,
            fileCode: 'LEGACY_SOURCE_UNSAFE',
            linkCode: 'LEGACY_SOURCE_UNSAFE',
            changedCode: 'LEGACY_SOURCE_CHANGED'
        })
        if (capture && logicalName) capture[logicalName] = Buffer.from(result.data)
        return result.data.toString('utf8')
    } catch (error) {
        if (error && error.code === 'ENOENT') return null
        if (error instanceof MigrationError && error.code === 'MIGRATION_FILE_READ_FAILED') {
            throw new MigrationError('LEGACY_SOURCE_READ_FAILED')
        }
        if (error instanceof MigrationError) throw error
        throw new MigrationError('LEGACY_SOURCE_READ_FAILED')
    }
}

function readOptionalAuthoritativeYaml(filePath) {
    try {
        return readPrivateText(filePath, {
            mode: 0o600,
            fileCode: 'CONFIG_FILE_UNSAFE',
            linkCode: 'CONFIG_FILE_UNSAFE',
            permissionCode: 'CONFIG_FILE_PERMISSION_UNSAFE',
            changedCode: 'CONFIG_FILE_CHANGED'
        })
    } catch (error) {
        if (error && error.code === 'ENOENT') return null
        if (error instanceof MigrationError && [
            'MIGRATION_SYMLINK_FORBIDDEN',
            'MIGRATION_PATH_COMPONENT_UNSAFE',
            'MIGRATION_DIRECTORY_REQUIRED',
            'MIGRATION_DIRECTORY_CHANGED'
        ].includes(error.code)) {
            throw new MigrationError('CONFIG_FILE_UNSAFE')
        }
        if (error instanceof MigrationError) throw error
        throw new MigrationError('CONFIG_FILE_READ_FAILED')
    }
}

function resolveLegacyJwtSecret({ overrides, env, jwtSecretText, generatedJwtSecret, allowGenerateJwtSecret }) {
    if (hasOwn(overrides, 'jwtSecret')) {
        if (typeof overrides.jwtSecret !== 'string' || overrides.jwtSecret.length === 0) {
            throw new MigrationError('LEGACY_JWT_SECRET_UNREPRESENTABLE')
        }
        return overrides.jwtSecret
    }
    if (env.JWT_SECRET) return String(env.JWT_SECRET)
    const saved = String(jwtSecretText || '').trim()
    if (saved.length === 64) return saved
    if (generatedJwtSecret !== undefined) {
        const captured = String(generatedJwtSecret)
        if (!/^[a-f0-9]{64}$/.test(captured)) throw new MigrationError('LEGACY_GENERATED_JWT_SECRET_INVALID')
        return captured
    }
    if (allowGenerateJwtSecret) return crypto.randomBytes(32).toString('hex')
    throw new MigrationError('LEGACY_JWT_SECRET_EFFECTIVE_UNPROVABLE')
}

function readOptionalJson(filePath, capture, logicalName) {
    const text = readOptionalText(filePath, capture, logicalName)
    if (text === null) return {}
    let value
    try {
        value = JSON.parse(text)
    } catch {
        throw new MigrationError('LEGACY_CONFIG_JSON_INVALID')
    }
    if (!isPlainObject(value)) throw new MigrationError('LEGACY_CONFIG_JSON_OBJECT_REQUIRED')
    return value
}

function readRuntimeEnvironment(options, capture) {
    if (isPlainObject(options.runtimeEnv)) return { ...options.runtimeEnv }
    if (options.runtimeEnvFile) {
        const data = readPrivateFile(options.runtimeEnvFile).data
        if (capture) capture.runtime_env = Buffer.from(data)
        const source = data.toString('utf8')
        let value
        try {
            value = JSON.parse(source)
        } catch {
            try {
                value = dotenv.parse(source)
            } catch {
                throw new MigrationError('LEGACY_RUNTIME_ENV_INVALID')
            }
        }
        if (!isPlainObject(value) || Object.values(value).some((item) => typeof item !== 'string')) {
            throw new MigrationError('LEGACY_RUNTIME_ENV_INVALID')
        }
        return { ...value }
    }
    if (options.requireRuntimeEnvSnapshot !== false) throw new MigrationError('LEGACY_RUNTIME_ENV_REQUIRED')
    return {}
}

function resolveEnvironment(runtimeEnv, dotenvText) {
    const effective = { ...runtimeEnv }
    if (dotenvText !== null) {
        let parsed
        try {
            parsed = dotenv.parse(dotenvText)
        } catch {
            throw new MigrationError('LEGACY_DOTENV_INVALID')
        }
        for (const [key, value] of Object.entries(parsed)) {
            if (!hasOwn(effective, key)) effective[key] = value
        }
    }
    return effective
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value === 'boolean') return value
    const normalized = String(value).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    return fallback
}

function resolveLegacyLogLevel(value) {
    const normalized = String(value || 'info').trim().toLowerCase()
    return ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(normalized) ? normalized : 'info'
}

function resolveLegacyLogStacks(value) {
    const normalized = String(value || 'error').trim().toLowerCase()
    if (normalized === 'all') return 'always'
    if (normalized === 'error') return 'error'
    return 'never'
}

function splitGroupConfigs(rawGroupConfigs, warnings) {
    if (!isPlainObject(rawGroupConfigs)) throw new MigrationError('LEGACY_EFFECTIVE_CONFIG_UNREPRESENTABLE')
    const groupConfigs = {}
    const unmapped = {}
    for (const [groupId, rawValue] of Object.entries(isPlainObject(rawGroupConfigs) ? rawGroupConfigs : {})) {
        const mappedValue = {}
        const unmappedValue = {}
        for (const [key, value] of Object.entries(isPlainObject(rawValue) ? rawValue : {})) {
            if (KNOWN_GROUP_KEYS.has(key)) mappedValue[key] = clone(value)
            else unmappedValue[key] = clone(value)
        }
        groupConfigs[String(groupId)] = mappedValue
        if (Object.keys(unmappedValue).length > 0) {
            unmapped[String(groupId)] = unmappedValue
            warnings.push({ code: 'LEGACY_UNMAPPED_GROUP_CONFIG', path: `groupConfigs.${groupId}` })
        }
    }
    return { groupConfigs, unmapped }
}

function resolveOrdinaryFlat(overrides, env, warnings, options = {}) {
    const flat = {}
    for (const [key, meta] of Object.entries(META)) {
        if (['qqProvider', 'qqOfficialClientSecret', 'qqOfficialMediaUploadMode', 'qqOfficialRootOpenids', 'pythonPath', 'agent'].includes(key)) continue
        if (hasOwn(overrides, key)) {
            flat[key] = clone(overrides[key])
            continue
        }
        const raw = meta.env && hasOwn(env, meta.env) ? env[meta.env] : meta.def
        flat[key] = parseLegacyValue(raw, meta.type, warnings, key)
    }
    const providerRaw = hasOwn(overrides, 'qqProvider') ? overrides.qqProvider : (env.QQ_PROVIDER || META.qqProvider.def)
    flat.qqProvider = String(providerRaw || '').trim().toLowerCase() === 'official' ? 'official' : 'napcat'
    const mediaRaw = hasOwn(overrides, 'qqOfficialMediaUploadMode')
        ? overrides.qqOfficialMediaUploadMode
        : (env.QQ_OFFICIAL_MEDIA_UPLOAD_MODE || META.qqOfficialMediaUploadMode.def)
    const mediaMode = String(mediaRaw || '').trim().toLowerCase()
    flat.qqOfficialMediaUploadMode = ['hybrid', 'url_only', 'file_data'].includes(mediaMode) ? mediaMode : 'hybrid'
    flat.pythonPath = hasOwn(overrides, 'pythonPath')
        ? clone(overrides.pythonPath)
        : String(env.PYTHON_PATH || options.detectedPythonPath || META.pythonPath.def)
    if (hasOwn(overrides, 'agent') || Object.keys(env).some((key) => key.startsWith('AGENT_'))) {
        warnings.push({ code: 'LEGACY_AGENT_CONFIG_DROPPED', path: 'agent' })
    }
    if (hasOwn(overrides, 'previewLayoutConfig')) {
        flat.previewLayoutConfig = isPlainObject(overrides.previewLayoutConfig) ? clone(overrides.previewLayoutConfig) : {}
    }
    if (hasOwn(overrides, 'labelConfig')) {
        const defaults = META.labelConfig.def
        const rawLabels = isPlainObject(overrides.labelConfig) ? clone(overrides.labelConfig) : {}
        flat.labelConfig = Object.fromEntries(Object.keys(defaults).map((key) => [
            key,
            typeof rawLabels[key] === 'boolean' ? rawLabels[key] : defaults[key]
        ]))
    }
    return flat
}

function buildV1Config(flat, special, options = {}) {
    const config = { version: 1 }
    for (const [flatKey, yamlPath] of Object.entries(FLAT_TO_YAML_PATH)) {
        if (flatKey === 'groupConfigs') continue
        setPath(config, yamlPath, flat[flatKey])
    }
    const split = splitGroupConfigs(flat.groupConfigs, special.warnings)
    config.groupConfigs = split.groupConfigs
    if (Object.keys(split.unmapped).length > 0) {
        config.compat = { unmappedLegacy: { groupConfigs: split.unmapped } }
    }
    setPath(config, 'qq.official.clientSecret', special.officialSecret)
    setPath(config, 'qq.official.rootOpenids', special.officialRootOpenids)
    setPath(config, 'dashboard.jwtSecret', special.jwtSecret)
    setPath(config, 'admin.rootQQ', special.rootAdminQQ)
    setPath(config, 'paths.chromium', special.chromiumPath)
    setPath(config, 'paths.puppeteerExecutable', special.puppeteerExecutablePath)
    setPath(config, 'messageDedup.ttlMs', special.messageDedupTtlMs)
    setPath(config, 'messageDedup.maxEntries', special.messageDedupMaxEntries)
    setPath(config, 'logging', special.logging)
    setPath(config, 'dashboard.allowedOrigins', Array.isArray(flat.dashboardAllowedOrigins)
        ? flat.dashboardAllowedOrigins.map((item) => String(item).trim()).filter(Boolean)
        : String(flat.dashboardAllowedOrigins || '').split(',').map((item) => item.trim()).filter(Boolean))
    setPath(config, 'messageDedup.enabled', true)
    config.deployment = clone(options.deployment || {
        ports: { dashboardHost: flat.dashboardPort, napcatWebuiHost: 6099, napcatWsHost: 3001 },
        mounts: {
            config: './config',
            data: './data',
            logs: './logs',
            fonts: './fonts/custom',
            napcatConfig: './napcat/config',
            napcatQq: './napcat/qq'
        },
        network: { name: 'bot_network', external: false }
    })
    return config
}

function createDefaultV1Config(options = {}) {
    const warnings = []
    const env = isPlainObject(options.env) ? options.env : {}
    const flat = resolveOrdinaryFlat({}, env, warnings, options)
    flat.qqProvider = options.provider === 'official' ? 'official' : 'napcat'
    const special = {
        officialSecret: String(options.officialClientSecret || ''),
        officialRootOpenids: Array.isArray(options.officialRootOpenids)
            ? options.officialRootOpenids.map((item) => String(item).trim()).filter(Boolean)
            : [],
        jwtSecret: String(options.jwtSecret || crypto.randomBytes(32).toString('hex')),
        rootAdminQQ: String(options.rootAdminQQ || ''),
        chromiumPath: String(options.chromiumPath || ''),
        puppeteerExecutablePath: String(options.puppeteerExecutablePath || ''),
        messageDedupTtlMs: Number(options.messageDedupTtlMs || 120000),
        messageDedupMaxEntries: Number(options.messageDedupMaxEntries || 50000),
        logging: {
            level: 'info',
            channels: [],
            excludeChannels: [],
            color: false,
            timestamp: false,
            pretty: true,
            stacks: 'error',
            bufferSize: 2000,
            ...(isPlainObject(options.logging) ? options.logging : {})
        },
        warnings
    }
    const config = buildV1Config(flat, special, options)
    if (options.wsUrl !== undefined) config.qq.napcat.wsUrl = String(options.wsUrl)
    if (options.wsToken !== undefined) config.qq.napcat.wsToken = String(options.wsToken)
    if (options.officialAppId !== undefined) config.qq.official.appId = String(options.officialAppId)
    if (options.dashboardPassword !== undefined) config.dashboard.password = String(options.dashboardPassword)
    return config
}

function resolveLegacyConfig(options = {}) {
    const configDir = path.resolve(options.configDir)
    const yamlPath = path.join(configDir, LEGACY_FILES.yaml)
    // An already-managed config is authoritative.  It is also a secret-bearing
    // runtime input, so never accept the looser permissions used for legacy
    // sources: the same private-file contract applies whether it is copied to a
    // staging path or retained in place.
    const yamlText = readOptionalAuthoritativeYaml(yamlPath)
    if (yamlText !== null) {
        const parsed = parseConfigYaml(yamlText)
        return {
            source: 'existing-yaml',
            sourcePath: yamlPath,
            sourceText: yamlText,
            config: validateConfigObject(parsed.value, { validator: options.validator || validateConfig }),
            sourceHashes: { config_yaml: crypto.createHash('sha256').update(yamlText).digest('hex') },
            warnings: []
        }
    }

    const capturedSources = {}
    const runtimeEnv = readRuntimeEnvironment(options, capturedSources)
    const dotenvPath = path.join(configDir, LEGACY_FILES.dotenv)
    const dotenvText = readOptionalText(dotenvPath, capturedSources, 'dotenv')
    const env = resolveEnvironment(runtimeEnv, dotenvText)
    const jsonPath = path.join(configDir, LEGACY_FILES.json)
    const overrides = readOptionalJson(jsonPath, capturedSources, 'json')
    const officialSecretText = readOptionalText(path.join(configDir, LEGACY_FILES.officialSecret), capturedSources, 'officialSecret')
    const jwtSecretText = readOptionalText(path.join(configDir, LEGACY_FILES.jwtSecret), capturedSources, 'jwtSecret')
    const warnings = []
    const flat = resolveOrdinaryFlat(overrides, env, warnings, options)

    const envOfficialRoots = String(env.QQ_OFFICIAL_ROOT_OPENIDS || '').split(',').map((item) => item.trim()).filter(Boolean)
    const configGetterRoots = hasOwn(overrides, 'qqOfficialRootOpenids')
        ? parseLegacyValue(overrides.qqOfficialRootOpenids, 'csv', warnings, 'qqOfficialRootOpenids')
        : envOfficialRoots
    // Legacy runtime authorization concatenated the config getter result with
    // the direct environment list. Ordering and duplicates are observable and
    // must be retained during the one-time effective-config freeze.
    const officialRootOpenids = [...configGetterRoots, ...envOfficialRoots]
    const officialSecret = env.QQ_OFFICIAL_CLIENT_SECRET
        ? String(env.QQ_OFFICIAL_CLIENT_SECRET).trim()
        : (officialSecretText && officialSecretText.trim()
            ? officialSecretText.trim()
            : String(overrides.qqOfficialClientSecret || '').trim())
    const jwtSecret = resolveLegacyJwtSecret({
        overrides,
        env,
        jwtSecretText,
        generatedJwtSecret: options.generatedJwtSecret,
        allowGenerateJwtSecret: options.allowGenerateJwtSecret
    })

    const special = {
        officialSecret,
        officialRootOpenids,
        jwtSecret,
        rootAdminQQ: String(env.ADMIN_QQ || '').trim(),
        chromiumPath: String(env.CHROMIUM_PATH || '').trim(),
        puppeteerExecutablePath: String(env.PUPPETEER_EXECUTABLE_PATH || '').trim(),
        messageDedupTtlMs: parseInt(env.MESSAGE_DEDUP_TTL_MS || env.AI_MESSAGE_DEDUP_TTL_MS || '120000', 10) || 120000,
        messageDedupMaxEntries: parseInt(env.MESSAGE_DEDUP_MAX_ENTRIES || env.AI_MESSAGE_DEDUP_MAX_ENTRIES || '50000', 10) || 50000,
        logging: {
            level: resolveLegacyLogLevel(env.LOG_LEVEL),
            channels: String(env.LOG_CHANNELS || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean),
            excludeChannels: String(env.LOG_EXCLUDE_CHANNELS || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean),
            color: parseBoolean(env.LOG_COLOR, false),
            timestamp: parseBoolean(env.LOG_TIMESTAMP, false),
            pretty: parseBoolean(env.LOG_PRETTY, true),
            stacks: resolveLegacyLogStacks(env.LOG_STACKS),
            bufferSize: parseInt(env.LOG_BUFFER_SIZE || '2000', 10) || 2000
        },
        warnings
    }
    flat.qqOfficialClientSecret = officialSecret
    flat.qqOfficialRootOpenids = officialRootOpenids
    const config = buildV1Config(flat, special, options)
    try {
        validateConfigObject(config, { validator: options.validator || validateConfig })
    } catch (error) {
        if (error instanceof MigrationError) throw error
        throw new MigrationError('LEGACY_EFFECTIVE_CONFIG_UNREPRESENTABLE', 'LEGACY_EFFECTIVE_CONFIG_UNREPRESENTABLE', {
            path: typeof error?.path === 'string' ? error.path : ''
        })
    }

    const sourceHashes = Object.fromEntries(Object.entries(capturedSources).map(([name, data]) => (
        [name, crypto.createHash('sha256').update(data).digest('hex')]
    )))
    return {
        source: 'legacy',
        config,
        effectiveFlat: flat,
        sourceHashes,
        capturedSources,
        warnings
    }
}

module.exports = {
    LEGACY_FILES,
    FLAT_TO_YAML_PATH,
    KNOWN_GROUP_KEYS,
    resolveEnvironment,
    resolveLegacyConfig,
    buildV1Config,
    createDefaultV1Config,
    splitGroupConfigs,
    setPath,
    resolveLegacyJwtSecret
}
