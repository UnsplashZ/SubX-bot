export const GENERAL_CONFIG_DEFAULTS = {
    subscriptionCheckInterval: 300,
    linkCacheTimeout: 600,
    showId: true
}

export const DEFAULT_VIDEO_DOWNLOAD_CONFIG = {
    videoDownloadEnabled: false,
    videoDownloadResolution: '1080p',
    videoDownloadMaxDuration: 600,
    videoDownloadAutoClean: true,
    videoDownloadCleanTimeout: 6
}

export const DEFAULT_QQ_PROVIDER_CONFIG = {
    qqProvider: 'napcat',
    wsUrl: 'ws://localhost:3001',
    wsToken: '',
    wsTokenConfigured: false,
    qqOfficialAppId: '',
    qqOfficialClientSecret: '',
    qqOfficialClientSecretConfigured: false,
    qqOfficialApiBase: 'https://api.sgroup.qq.com',
    qqOfficialTokenUrl: 'https://bots.qq.com/app/getAppAccessToken',
    qqOfficialUseShardedGateway: true,
    qqOfficialIntents: 33554432,
    qqOfficialMediaUploadMode: 'hybrid',
    qqOfficialTempPublicBaseUrl: '',
    qqOfficialRootOpenids: [],
    qqOfficialAccountQpm: 30,
    qqOfficialGroupQpm: 20,
    qqOfficialQueueMaxSize: 300
}

function extractConfig(source, defaults) {
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, source?.[key] ?? fallback]))
}

function readDocumentGeneration(source) {
    const generation = source?.documentGeneration ?? source?.generation
    return Number.isSafeInteger(generation) ? generation : null
}

export async function fetchConsistentSettingsSnapshot(fetchConfig, fetchStatus, { maxAttempts = 3 } = {}) {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
        throw new TypeError('maxAttempts must be a positive safe integer')
    }

    let lastConfigGeneration = null
    let lastStatusGeneration = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const [snapshot, status] = await Promise.all([fetchConfig(), fetchStatus()])
        lastConfigGeneration = readDocumentGeneration(snapshot)
        lastStatusGeneration = readDocumentGeneration(status)
        if (lastConfigGeneration !== null && lastConfigGeneration === lastStatusGeneration) {
            return { snapshot, status }
        }
    }

    throw new Error(
        `Unable to read a consistent config snapshot after ${maxAttempts} attempts ` +
        `(config generation ${lastConfigGeneration ?? 'unknown'}, status generation ${lastStatusGeneration ?? 'unknown'})`
    )
}

export function createHydratedSettingsState(snapshot = {}, status = {}) {
    const generation = readDocumentGeneration(snapshot)
    const statusGeneration = readDocumentGeneration(status)
    if (statusGeneration !== null && generation !== statusGeneration) {
        throw new Error(
            `Config snapshot generation ${generation ?? 'unknown'} does not match status generation ${statusGeneration}`
        )
    }

    return {
        generalConfig: extractConfig(snapshot, GENERAL_CONFIG_DEFAULTS),
        videoDownloadConfig: extractConfig(snapshot, DEFAULT_VIDEO_DOWNLOAD_CONFIG),
        qqProviderConfig: {
            ...extractConfig(snapshot, DEFAULT_QQ_PROVIDER_CONFIG),
            wsToken: '',
            qqOfficialClientSecret: '',
            qqOfficialRootOpenids: Array.isArray(snapshot.qqOfficialRootOpenids)
                ? snapshot.qqOfficialRootOpenids
                : []
        },
        configStatus: {
            ...(status || {}),
            ...(generation !== null
                ? { documentGeneration: generation, generation }
                : {})
        }
    }
}
