'use strict'

const CONFIG_SCHEMA_VERSION = 1
// The container-facing Dashboard ingress is deliberately independent from
// dashboard.listenPort. That field remains hot-reloadable for the application
// snapshot (including canonical local origins), while deployment always has a
// stable target and health endpoint.
const DASHBOARD_INGRESS_PORT = 3000
const SAFE_ENTITY_ID_PATTERN = '^[A-Za-z0-9:_-]{1,200}$'

const LABEL_KEYS = [
    'video',
    'bangumi',
    'article',
    'live',
    'dynamic',
    'user',
    'interactive_video',
    'favorite_list',
    'audio',
    'audio_list',
    'topic',
    'channel_series',
    'article_list',
    'note',
    'cheese_video',
    'movie',
    'tv',
    'guocha',
    'doc',
    'variety'
]

const DEFAULT_LABEL_CONFIG = Object.freeze(Object.fromEntries(LABEL_KEYS.map((key) => [key, true])))

const AT_ALL_SOURCE_KEYS = ['manual', 'cookieSync']
const AT_ALL_CATEGORY_KEYS = [
    'video',
    'dynamic',
    'live',
    'article',
    'bangumi',
    'movie',
    'tv',
    'guocha',
    'doc',
    'variety'
]

const stringNode = (defaultValue = '', options = {}) => ({
    type: 'string',
    default: defaultValue,
    ...options
})

const booleanNode = (defaultValue = false, options = {}) => ({
    type: 'boolean',
    default: defaultValue,
    ...options
})

const integerNode = (defaultValue = 0, options = {}) => ({
    type: 'integer',
    default: defaultValue,
    ...options
})

const numberNode = (defaultValue = 0, options = {}) => ({
    type: 'number',
    default: defaultValue,
    ...options
})

const arrayNode = (item, defaultValue = [], options = {}) => ({
    type: 'array',
    item,
    default: defaultValue,
    ...options
})

const objectNode = (properties, options = {}) => ({
    type: 'object',
    properties,
    additionalProperties: false,
    default: options.default || {},
    ...options
})

const mapNode = (value, options = {}) => ({
    type: 'map',
    value,
    keyPattern: options.keyPattern || '^.+$',
    default: options.default || {},
    ...options
})

function boolProperties(keys, defaultValue = true) {
    return Object.fromEntries(keys.map((key) => [key, booleanNode(defaultValue)]))
}

const nightModeSchema = objectNode({
    mode: stringNode('off', { enum: ['off', 'on', 'timed'] }),
    startTime: stringNode('21:00', { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    endTime: stringNode('06:00', { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
})

const labelConfigSchema = objectNode(boolProperties(LABEL_KEYS))

const subscriptionAtAllRulesSchema = objectNode({
    sources: objectNode(boolProperties(AT_ALL_SOURCE_KEYS)),
    categories: objectNode(boolProperties(AT_ALL_CATEGORY_KEYS)),
    manualDisabledIds: arrayNode(stringNode('', { pattern: '^\\d+$' })),
    cookieSyncDisabledIds: arrayNode(stringNode('', { pattern: '^\\d+$' }))
})

const groupConfigSchema = objectNode({
    linkCacheTimeout: integerNode(5, { minimum: 0, effects: ['cache'] }),
    labelConfig: labelConfigSchema,
    enableCookieSync: booleanNode(false, { effects: ['subscription'] }),
    subscriptionAtAll: booleanNode(false, { effects: ['subscription'] }),
    subscriptionAtAllRules: subscriptionAtAllRulesSchema,
    cookieSyncGroupNames: arrayNode(stringNode('')),
    blacklistedQQs: arrayNode(stringNode('', { pattern: SAFE_ENTITY_ID_PATTERN })),
    admins: arrayNode(stringNode('', { pattern: SAFE_ENTITY_ID_PATTERN })),
    nightMode: nightModeSchema,
    isInGroup: booleanNode(true, { effects: ['subscription'] }),
    showId: booleanNode(true),
    videoDownloadEnabled: booleanNode(false),
    videoDownloadResolution: stringNode('1080p'),
    videoDownloadMaxDuration: integerNode(600, { minimum: 0 })
}, { partial: true })

const CONFIG_SCHEMA = objectNode({
    version: integerNode(CONFIG_SCHEMA_VERSION, { enum: [CONFIG_SCHEMA_VERSION] }),
    qq: objectNode({
        provider: stringNode('napcat', { enum: ['napcat', 'official'], effects: ['qqProvider'] }),
        napcat: objectNode({
            wsUrl: stringNode('ws://localhost:3001', { effects: ['qqProvider'] }),
            wsToken: stringNode('', { secret: true, effects: ['qqProvider'] })
        }),
        official: objectNode({
            appId: stringNode('', { effects: ['qqProvider'] }),
            clientSecret: stringNode('', { secret: true, effects: ['qqProvider'] }),
            apiBase: stringNode('https://api.sgroup.qq.com', { effects: ['qqProvider'] }),
            tokenUrl: stringNode('https://bots.qq.com/app/getAppAccessToken', { effects: ['qqProvider'] }),
            useShardedGateway: booleanNode(true, { effects: ['qqProvider'] }),
            intents: integerNode(33554432, { minimum: 0, effects: ['qqProvider'] }),
            mediaUploadMode: stringNode('hybrid', { enum: ['hybrid', 'url_only', 'file_data'], effects: ['qqProvider'] }),
            tempPublicBaseUrl: stringNode('', { effects: ['qqProvider', 'dashboard'] }),
            rootOpenids: arrayNode(stringNode('', { pattern: SAFE_ENTITY_ID_PATTERN }), [], { effects: ['auth'] }),
            gatewayAckTimeoutMs: integerNode(90000, { minimum: 1000, effects: ['qqProvider'] }),
            rateLimit: objectNode({
                accountQpm: integerNode(30, { minimum: 1, effects: ['qqProvider'] }),
                groupQpm: integerNode(20, { minimum: 1, effects: ['qqProvider'] }),
                queueMaxSize: integerNode(300, { minimum: 1, effects: ['qqProvider'] })
            })
        })
    }),
    admin: objectNode({
        rootQQ: stringNode('', { pattern: '^$|^\\d+$', effects: ['auth'] })
    }),
    dashboard: objectNode({
        listenPort: integerNode(3000, {
            minimum: 1,
            maximum: 65535,
            effects: ['dashboard']
        }),
        password: stringNode('admin', { secret: true, allowEmpty: false, effects: ['auth'] }),
        jwtSecret: stringNode('', { secret: true, allowEmpty: false, effects: ['auth'] }),
        allowedOrigins: arrayNode(stringNode('', { format: 'http-origin' }), [], {
            effects: ['dashboard'],
            uniqueItems: true
        })
    }),
    deployment: objectNode({
        ports: mapNode(integerNode(0, { minimum: 0, maximum: 65535, deploymentApplyRequired: true, effects: ['deployment'] }), {
            default: { dashboardHost: 3000, napcatWebuiHost: 6099, napcatWsHost: 3001 }
        }),
        mounts: mapNode(stringNode('', { deploymentApplyRequired: true, effects: ['deployment'] }), {
            default: {
                config: './config',
                data: './data',
                logs: './logs',
                fonts: './fonts/custom',
                napcatConfig: './napcat/config',
                napcatQq: './napcat/qq'
            }
        }),
        network: objectNode({
            name: stringNode('bot_network', { deploymentApplyRequired: true, effects: ['deployment'] }),
            external: booleanNode(false, { deploymentApplyRequired: true, effects: ['deployment'] })
        }, { deploymentApplyRequired: true, effects: ['deployment'] })
    }),
    paths: objectNode({
        napcatTemp: stringNode('/app/.config/QQ/tmp/', { effects: ['paths', 'qqProvider'] }),
        napcatRead: stringNode('/app/.config/QQ/tmp/', { effects: ['paths'] }),
        chromium: stringNode('', { effects: ['browser'] }),
        puppeteerExecutable: stringNode('', { effects: ['browser'] }),
        python: stringNode('python3', { effects: ['python'] }),
        biliScript: stringNode('./src/services/bili_server.py', { effects: ['python'] })
    }),
    pythonService: objectNode({
        port: integerNode(10001, { minimum: 1, maximum: 65535, effects: ['python'] })
    }),
    cache: objectNode({
        linkTtlSeconds: integerNode(600, { minimum: 0, effects: ['cache'] }),
        dataTtlSeconds: integerNode(3600, { minimum: 0, effects: ['cache'] })
    }),
    messageDedup: objectNode({
        enabled: booleanNode(true, { effects: ['messageDedup'] }),
        ttlMs: integerNode(120000, { minimum: 1, effects: ['messageDedup'] }),
        maxEntries: integerNode(50000, { minimum: 1, effects: ['messageDedup'] })
    }),
    subscription: objectNode({
        checkIntervalSeconds: integerNode(60, { minimum: 1, effects: ['subscription'] })
    }),
    rendering: objectNode({
        useBase64Send: booleanNode(false, { effects: ['rendering'] }),
        showId: booleanNode(true, { effects: ['rendering'] }),
        previewGradient: objectNode({
            color1: stringNode('#D8C7F1', { effects: ['rendering'] }),
            color2: stringNode('#BFE6E2', { effects: ['rendering'] })
        }),
        previewLayout: mapNode({ type: 'unknown', effects: ['rendering'] }),
        labels: labelConfigSchema,
        nightMode: nightModeSchema
    }),
    videoDownload: objectNode({
        enabled: booleanNode(false, { effects: ['download'] }),
        resolution: stringNode('1080p', { effects: ['download'] }),
        maxDurationSeconds: integerNode(600, { minimum: 0, effects: ['download'] }),
        autoClean: booleanNode(true, { effects: ['download'] }),
        cleanTimeoutHours: integerNode(6, { minimum: 0, effects: ['download'] })
    }),
    logging: objectNode({
        level: stringNode('info', { enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'], effects: ['logging'] }),
        channels: arrayNode(stringNode(''), [], { effects: ['logging'] }),
        excludeChannels: arrayNode(stringNode(''), [], { effects: ['logging'] }),
        color: booleanNode(false, { effects: ['logging'] }),
        timestamp: booleanNode(false, { effects: ['logging'] }),
        pretty: booleanNode(true, { effects: ['logging'] }),
        stacks: stringNode('error', { enum: ['never', 'error', 'warn', 'always'], effects: ['logging'] }),
        bufferSize: integerNode(2000, { minimum: 1, effects: ['logging'] })
    }),
    blacklistedQQs: arrayNode(stringNode('', { pattern: SAFE_ENTITY_ID_PATTERN })),
    enabledGroups: arrayNode(stringNode('', { pattern: SAFE_ENTITY_ID_PATTERN }), [], { effects: ['subscription'] }),
    providerScopedEnabledGroups: mapNode(arrayNode(stringNode('', { pattern: SAFE_ENTITY_ID_PATTERN })), { effects: ['subscription'] }),
    groupConfigs: mapNode(groupConfigSchema, { keyPattern: SAFE_ENTITY_ID_PATTERN, effects: ['groups'] }),
    // Legacy tombstone: the Agent subsystem was removed. Existing documents
    // may still carry an `agent` section; accept and retain it (secret, never
    // projected publicly) so they keep validating, but nothing consumes it.
    agent: mapNode({ type: 'unknown', secret: true }, { secret: true, legacyTombstone: true }),
    compat: objectNode({
        unmappedLegacy: objectNode({
            groupConfigs: mapNode({ type: 'unknown', secret: true })
        }, { secret: true })
    }, { secret: true })
})

const FLAT_KEY_TO_PATH = Object.freeze({
    wsUrl: ['qq', 'napcat', 'wsUrl'],
    wsToken: ['qq', 'napcat', 'wsToken'],
    qqProvider: ['qq', 'provider'],
    qqOfficialAppId: ['qq', 'official', 'appId'],
    qqOfficialClientSecret: ['qq', 'official', 'clientSecret'],
    qqOfficialApiBase: ['qq', 'official', 'apiBase'],
    qqOfficialTokenUrl: ['qq', 'official', 'tokenUrl'],
    qqOfficialUseShardedGateway: ['qq', 'official', 'useShardedGateway'],
    qqOfficialIntents: ['qq', 'official', 'intents'],
    qqOfficialMediaUploadMode: ['qq', 'official', 'mediaUploadMode'],
    qqOfficialTempPublicBaseUrl: ['qq', 'official', 'tempPublicBaseUrl'],
    qqOfficialRootOpenids: ['qq', 'official', 'rootOpenids'],
    qqOfficialAccountQpm: ['qq', 'official', 'rateLimit', 'accountQpm'],
    qqOfficialGroupQpm: ['qq', 'official', 'rateLimit', 'groupQpm'],
    qqOfficialQueueMaxSize: ['qq', 'official', 'rateLimit', 'queueMaxSize'],
    qqOfficialGatewayAckTimeoutMs: ['qq', 'official', 'gatewayAckTimeoutMs'],
    pythonPath: ['paths', 'python'],
    dashboardPort: ['dashboard', 'listenPort'],
    dashboardPassword: ['dashboard', 'password'],
    dashboardAllowedOrigins: ['dashboard', 'allowedOrigins'],
    biliServerPort: ['pythonService', 'port'],
    biliScriptPath: ['paths', 'biliScript'],
    useBase64Send: ['rendering', 'useBase64Send'],
    napcatTempPath: ['paths', 'napcatTemp'],
    napcatReadPath: ['paths', 'napcatRead'],
    linkCacheTimeout: ['cache', 'linkTtlSeconds'],
    dataCacheTTL: ['cache', 'dataTtlSeconds'],
    subscriptionCheckInterval: ['subscription', 'checkIntervalSeconds'],
    showId: ['rendering', 'showId'],
    previewGradientColor1: ['rendering', 'previewGradient', 'color1'],
    previewGradientColor2: ['rendering', 'previewGradient', 'color2'],
    previewLayoutConfig: ['rendering', 'previewLayout'],
    videoDownloadEnabled: ['videoDownload', 'enabled'],
    videoDownloadResolution: ['videoDownload', 'resolution'],
    videoDownloadMaxDuration: ['videoDownload', 'maxDurationSeconds'],
    videoDownloadAutoClean: ['videoDownload', 'autoClean'],
    videoDownloadCleanTimeout: ['videoDownload', 'cleanTimeoutHours'],
    blacklistedQQs: ['blacklistedQQs'],
    enabledGroups: ['enabledGroups'],
    providerScopedEnabledGroups: ['providerScopedEnabledGroups'],
    nightMode: ['rendering', 'nightMode'],
    labelConfig: ['rendering', 'labels'],
    groupConfigs: ['groupConfigs'],
    jwtSecret: ['dashboard', 'jwtSecret'],
    rootAdminQQ: ['admin', 'rootQQ']
})

const LEGACY_ENV_TO_PATH = Object.freeze({
    WS_URL: 'qq.napcat.wsUrl',
    WS_TOKEN: 'qq.napcat.wsToken',
    QQ_PROVIDER: 'qq.provider',
    QQ_OFFICIAL_APP_ID: 'qq.official.appId',
    QQ_OFFICIAL_CLIENT_SECRET: 'qq.official.clientSecret',
    QQ_OFFICIAL_API_BASE: 'qq.official.apiBase',
    QQ_OFFICIAL_TOKEN_URL: 'qq.official.tokenUrl',
    QQ_OFFICIAL_USE_SHARDED_GATEWAY: 'qq.official.useShardedGateway',
    QQ_OFFICIAL_INTENTS: 'qq.official.intents',
    QQ_OFFICIAL_MEDIA_UPLOAD_MODE: 'qq.official.mediaUploadMode',
    QQ_OFFICIAL_TEMP_PUBLIC_BASE_URL: 'qq.official.tempPublicBaseUrl',
    QQ_OFFICIAL_ROOT_OPENIDS: 'qq.official.rootOpenids',
    QQ_OFFICIAL_ACCOUNT_QPM: 'qq.official.rateLimit.accountQpm',
    QQ_OFFICIAL_GROUP_QPM: 'qq.official.rateLimit.groupQpm',
    QQ_OFFICIAL_QUEUE_MAX_SIZE: 'qq.official.rateLimit.queueMaxSize',
    QQ_OFFICIAL_GATEWAY_ACK_TIMEOUT_MS: 'qq.official.gatewayAckTimeoutMs',
    ADMIN_QQ: 'admin.rootQQ',
    DASHBOARD_PORT: 'dashboard.listenPort',
    DASHBOARD_PASSWORD: 'dashboard.password',
    DASHBOARD_ALLOWED_ORIGINS: 'dashboard.allowedOrigins',
    JWT_SECRET: 'dashboard.jwtSecret',
    PYTHON_PATH: 'paths.python',
    BILI_SERVER_PORT: 'pythonService.port',
    USE_BASE64_SEND: 'rendering.useBase64Send',
    NAPCAT_TEMP_PATH: 'paths.napcatTemp',
    NAPCAT_READ_PATH: 'paths.napcatRead',
    DATA_CACHE_TTL: 'cache.dataTtlSeconds',
    CHROMIUM_PATH: 'paths.chromium',
    PUPPETEER_EXECUTABLE_PATH: 'paths.puppeteerExecutable',
    MESSAGE_DEDUP_TTL_MS: 'messageDedup.ttlMs',
    AI_MESSAGE_DEDUP_TTL_MS: 'messageDedup.ttlMs',
    MESSAGE_DEDUP_MAX_ENTRIES: 'messageDedup.maxEntries',
    AI_MESSAGE_DEDUP_MAX_ENTRIES: 'messageDedup.maxEntries',
    LOG_LEVEL: 'logging.level',
    LOG_CHANNELS: 'logging.channels',
    LOG_EXCLUDE_CHANNELS: 'logging.excludeChannels',
    LOG_COLOR: 'logging.color',
    LOG_TIMESTAMP: 'logging.timestamp',
    LOG_PRETTY: 'logging.pretty',
    LOG_STACKS: 'logging.stacks',
    LOG_BUFFER_SIZE: 'logging.bufferSize'
})

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function createDefaultFromSchema(node) {
    if (node.legacyTombstone) return undefined
    if (node.type === 'object') {
        const value = {}
        for (const [key, child] of Object.entries(node.properties || {})) {
            if (child && child.legacyTombstone) continue
            value[key] = createDefaultFromSchema(child)
        }
        return value
    }
    if (node.type === 'map') return clone(node.default || {})
    return clone(node.default)
}

function createDefaultConfig() {
    return createDefaultFromSchema(CONFIG_SCHEMA)
}

function normalizePath(pathOrKey) {
    if (Array.isArray(pathOrKey)) return pathOrKey.map(String)
    if (Object.prototype.hasOwnProperty.call(FLAT_KEY_TO_PATH, pathOrKey)) {
        return [...FLAT_KEY_TO_PATH[pathOrKey]]
    }
    if (typeof pathOrKey !== 'string') return []
    if (pathOrKey.startsWith('/')) {
        return pathOrKey.split('/').slice(1).map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    }
    return pathOrKey.split('.').filter(Boolean)
}

function normalizePatchPath(pathValue) {
    if (Array.isArray(pathValue)) return pathValue.map(String)
    if (typeof pathValue !== 'string' || !pathValue.startsWith('/')) {
        const error = new TypeError('Configuration patch path must be a segment array or RFC 6901 JSON Pointer')
        error.code = 'CONFIG_PATCH_PATH_INVALID'
        throw error
    }
    if (pathValue === '') return []
    return pathValue.split('/').slice(1).map((segment) => {
        if (/~(?:[^01]|$)/.test(segment)) {
            const error = new TypeError('Configuration patch path contains an invalid RFC 6901 escape')
            error.code = 'CONFIG_PATCH_PATH_INVALID'
            throw error
        }
        return segment.replace(/~1/g, '/').replace(/~0/g, '~')
    })
}

function resolveSchemaNode(pathOrKey, root = CONFIG_SCHEMA) {
    const segments = normalizePath(pathOrKey)
    let node = root
    for (const segment of segments) {
        if (!node) return null
        if (node.type === 'object') {
            node = node.properties?.[segment]
        } else if (node.type === 'map') {
            node = node.value
        } else if (node.type === 'array' && /^\\d+$/.test(segment)) {
            node = node.item
        } else {
            return null
        }
    }
    return node || null
}

function buildInventory(node = CONFIG_SCHEMA, prefix = [], inherited = {}) {
    const secret = Boolean(inherited.secret || node.secret)
    const effects = [...new Set([...(inherited.effects || []), ...(node.effects || [])])]
    if (node.type === 'object') {
        const yamlPath = prefix.join('.')
        const flatKey = Object.entries(FLAT_KEY_TO_PATH).find(([, value]) => value.join('.') === yamlPath)?.[0] || null
        const ownEntry = flatKey ? [{
            yamlPath,
            flatKey,
            legacyEnvKeys: Object.entries(LEGACY_ENV_TO_PATH).filter(([, value]) => value === yamlPath).map(([key]) => key),
            type: 'object',
            default: createDefaultFromSchema(node),
            secret,
            allowEmpty: true,
            validator: 'strict-object',
            normalizer: null,
            effects,
            deploymentApplyRequired: Boolean(node.deploymentApplyRequired),
            publicShape: secret ? 'configured-marker' : 'value',
            legacyResolver: 'field'
        }] : []
        return [...ownEntry, ...Object.entries(node.properties || {}).flatMap(([key, child]) => (
            buildInventory(child, [...prefix, key], { secret, effects })
        ))]
    }
    if (node.type === 'map') {
        const yamlPath = prefix.join('.')
        return [{
            yamlPath,
            flatKey: Object.entries(FLAT_KEY_TO_PATH).find(([, value]) => value.join('.') === yamlPath)?.[0] || null,
            legacyEnvKeys: Object.entries(LEGACY_ENV_TO_PATH).filter(([, value]) => value === yamlPath).map(([key]) => key),
            type: 'map',
            default: clone(node.default || {}),
            secret,
            allowEmpty: node.allowEmpty !== false,
            validator: 'strict-map',
            normalizer: null,
            effects,
            deploymentApplyRequired: Boolean(node.deploymentApplyRequired),
            publicShape: secret ? 'configured-marker' : 'value',
            legacyResolver: 'field'
        }]
    }
    const yamlPath = prefix.join('.')
    return [{
        yamlPath,
        flatKey: Object.entries(FLAT_KEY_TO_PATH).find(([, value]) => value.join('.') === yamlPath)?.[0] || null,
        legacyEnvKeys: Object.entries(LEGACY_ENV_TO_PATH).filter(([, value]) => value === yamlPath).map(([key]) => key),
        type: node.type,
        default: clone(node.default),
        secret,
        allowEmpty: node.allowEmpty !== false,
        validator: node.enum ? 'enum' : (node.pattern ? 'pattern' : `strict-${node.type}`),
        normalizer: null,
        effects,
        deploymentApplyRequired: Boolean(node.deploymentApplyRequired),
        publicShape: secret ? 'configured-marker' : 'value',
        legacyResolver: 'field'
    }]
}

const CONFIG_INVENTORY = Object.freeze(buildInventory())

module.exports = {
    CONFIG_SCHEMA_VERSION,
    DASHBOARD_INGRESS_PORT,
    SAFE_ENTITY_ID_PATTERN,
    CONFIG_SCHEMA,
    CONFIG_INVENTORY,
    FLAT_KEY_TO_PATH,
    LEGACY_ENV_TO_PATH,
    LABEL_KEYS,
    DEFAULT_LABEL_CONFIG,
    AT_ALL_SOURCE_KEYS,
    AT_ALL_CATEGORY_KEYS,
    createDefaultConfig,
    normalizePath,
    normalizePatchPath,
    resolveSchemaNode,
    createDefaultFromSchema
}
