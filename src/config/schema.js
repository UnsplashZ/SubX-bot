'use strict'

// Legacy flat-key metadata retained for migration fixtures and compatibility
// lookups only. Runtime loading is owned by ConfigService/schemaV1 and this
// module must remain free of filesystem, dotenv, Secret, and process.env reads.

const SUBSCRIPTION_AT_ALL_SOURCE_KEYS = ['manual', 'cookieSync']
const SUBSCRIPTION_AT_ALL_CATEGORY_KEYS = [
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

const DEFAULT_LABEL_CONFIG = {
    video: true,
    bangumi: true,
    article: true,
    live: true,
    dynamic: true,
    user: true,
    interactive_video: true,
    favorite_list: true,
    audio: true,
    audio_list: true,
    topic: true,
    channel_series: true,
    article_list: true,
    note: true,
    cheese_video: true,
    movie: true,
    tv: true,
    guocha: true,
    doc: true,
    variety: true
}

function parseCsvList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean)
    }
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
}

const parsers = {
    string: (val) => String(val),
    int: (val) => {
        const parsed = parseInt(val, 10)
        return isNaN(parsed) ? 0 : parsed
    },
    float: (val) => {
        const parsed = parseFloat(val)
        return isNaN(parsed) ? 0.0 : parsed
    },
    bool: (val) => {
        if (typeof val === 'boolean') return val
        if (typeof val === 'string') {
            const lower = val.toLowerCase().trim()
            if (lower === 'true' || lower === '1' || lower === 'yes') return true
            if (lower === 'false' || lower === '0' || lower === 'no') return false
        }
        return Boolean(val)
    },
    array: (val) => {
        if (Array.isArray(val)) return val
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val)
                return Array.isArray(parsed) ? parsed : []
            } catch {
                return []
            }
        }
        return []
    },
    object: (val) => {
        if (typeof val === 'object' && val !== null) return val
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val)
                return typeof parsed === 'object' ? parsed : {}
            } catch {
                return {}
            }
        }
        return {}
    },
    csv: (val) => parseCsvList(val)
}

function parseValue(val, type) {
    if (val === undefined || val === null) return val
    const parser = parsers[type]
    return parser ? parser(val) : val
}

const META = {
    wsUrl: { env: 'WS_URL', def: 'ws://localhost:3001', type: 'string' },
    wsToken: { env: 'WS_TOKEN', def: '', type: 'string' },
    qqProvider: {
        env: 'QQ_PROVIDER',
        def: 'napcat',
        type: 'string',
        get: function(overrides) {
            const raw = overrides.qqProvider !== undefined ? overrides.qqProvider : this.def
            const normalized = String(raw || '').trim().toLowerCase()
            return normalized === 'official' ? 'official' : 'napcat'
        }
    },
    qqOfficialAppId: { env: 'QQ_OFFICIAL_APP_ID', def: '', type: 'string' },
    qqOfficialClientSecret: {
        env: 'QQ_OFFICIAL_CLIENT_SECRET',
        def: '',
        type: 'string',
        get: function(overrides) {
            return overrides.qqOfficialClientSecret !== undefined
                ? String(overrides.qqOfficialClientSecret || '').trim()
                : this.def
        }
    },
    qqOfficialApiBase: { env: 'QQ_OFFICIAL_API_BASE', def: 'https://api.sgroup.qq.com', type: 'string' },
    qqOfficialTokenUrl: { env: 'QQ_OFFICIAL_TOKEN_URL', def: 'https://bots.qq.com/app/getAppAccessToken', type: 'string' },
    qqOfficialUseShardedGateway: { env: 'QQ_OFFICIAL_USE_SHARDED_GATEWAY', def: true, type: 'bool' },
    qqOfficialIntents: { env: 'QQ_OFFICIAL_INTENTS', def: 33554432, type: 'int' },
    qqOfficialMediaUploadMode: {
        env: 'QQ_OFFICIAL_MEDIA_UPLOAD_MODE',
        def: 'hybrid',
        type: 'string',
        get: function(overrides) {
            const raw = overrides.qqOfficialMediaUploadMode !== undefined
                ? overrides.qqOfficialMediaUploadMode
                : this.def
            const normalized = String(raw || '').trim().toLowerCase()
            return ['hybrid', 'url_only', 'file_data'].includes(normalized) ? normalized : 'hybrid'
        }
    },
    qqOfficialTempPublicBaseUrl: { env: 'QQ_OFFICIAL_TEMP_PUBLIC_BASE_URL', def: '', type: 'string' },
    qqOfficialRootOpenids: {
        env: 'QQ_OFFICIAL_ROOT_OPENIDS',
        def: '',
        type: 'csv',
        get: function(overrides) {
            const raw = overrides.qqOfficialRootOpenids !== undefined
                ? overrides.qqOfficialRootOpenids
                : this.def
            return parseCsvList(raw)
        }
    },
    qqOfficialAccountQpm: { env: 'QQ_OFFICIAL_ACCOUNT_QPM', def: 30, type: 'int' },
    qqOfficialGroupQpm: { env: 'QQ_OFFICIAL_GROUP_QPM', def: 20, type: 'int' },
    qqOfficialQueueMaxSize: { env: 'QQ_OFFICIAL_QUEUE_MAX_SIZE', def: 300, type: 'int' },
    qqOfficialGatewayAckTimeoutMs: { env: 'QQ_OFFICIAL_GATEWAY_ACK_TIMEOUT_MS', def: 90000, type: 'int' },

    pythonPath: {
        env: 'PYTHON_PATH',
        def: 'python3',
        type: 'string',
        get: function(overrides) {
            if ('pythonPath' in overrides) return overrides.pythonPath
            return this.def
        }
    },
    dashboardPort: { env: 'DASHBOARD_PORT', def: 3000, type: 'int' },
    dashboardPassword: { env: 'DASHBOARD_PASSWORD', def: 'admin', type: 'string' },
    dashboardAllowedOrigins: { env: 'DASHBOARD_ALLOWED_ORIGINS', def: '', type: 'string' },
    biliServerPort: { env: 'BILI_SERVER_PORT', def: 10001, type: 'int' },
    biliScriptPath: { env: null, def: './src/services/bili_server.py', type: 'string' },
    useBase64Send: { env: 'USE_BASE64_SEND', def: false, type: 'bool' },
    napcatTempPath: { env: 'NAPCAT_TEMP_PATH', def: '/app/.config/QQ/tmp/', type: 'string' },
    napcatReadPath: { env: 'NAPCAT_READ_PATH', def: '/app/.config/QQ/tmp/', type: 'string' },

    linkCacheTimeout: { env: null, def: 600, type: 'int' },
    dataCacheTTL: { env: 'DATA_CACHE_TTL', def: 3600, type: 'int' },
    subscriptionCheckInterval: { env: null, def: 60, type: 'int' },
    showId: { env: null, def: true, type: 'bool' },
    previewGradientColor1: { env: null, def: '#D8C7F1', type: 'string' },
    previewGradientColor2: { env: null, def: '#BFE6E2', type: 'string' },
    previewLayoutConfig: {
        env: null,
        def: {},
        type: 'object',
        get: function(overrides) {
            const value = overrides.previewLayoutConfig
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return {}
            }
            return JSON.parse(JSON.stringify(value))
        }
    },
    videoDownloadEnabled: { env: null, def: false, type: 'bool' },
    videoDownloadResolution: { env: null, def: '1080p', type: 'string' },
    videoDownloadMaxDuration: { env: null, def: 600, type: 'int' },
    videoDownloadAutoClean: { env: null, def: true, type: 'bool' },
    videoDownloadCleanTimeout: { env: null, def: 6, type: 'int' },

    blacklistedQQs: { env: null, def: [], type: 'array', lazyInit: true },
    enabledGroups: { env: null, def: [], type: 'array', lazyInit: true },
    providerScopedEnabledGroups: { env: null, def: {}, type: 'object', lazyInit: true },

    nightMode: {
        env: null,
        def: { mode: 'off', startTime: '21:00', endTime: '06:00' },
        type: 'object',
        lazyInit: true
    },
    labelConfig: {
        env: null,
        def: DEFAULT_LABEL_CONFIG,
        type: 'object',
        lazyInit: true,
        get: function(overrides) {
            const { ensureNormalizedLabelConfigObject } = require('./normalizers')
            if (!('labelConfig' in overrides) || typeof overrides.labelConfig !== 'object' || overrides.labelConfig === null || Array.isArray(overrides.labelConfig)) {
                overrides.labelConfig = { ...DEFAULT_LABEL_CONFIG }
            } else {
                ensureNormalizedLabelConfigObject(overrides.labelConfig)
            }
            return overrides.labelConfig
        }
    },
    groupConfigs: { env: null, def: {}, type: 'object', lazyInit: true }
}

module.exports = {
    META,
    parsers,
    parseValue,
    SUBSCRIPTION_AT_ALL_SOURCE_KEYS,
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS,
    DEFAULT_LABEL_CONFIG
}
