'use strict'

const {
    AT_ALL_SOURCE_KEYS: SUBSCRIPTION_AT_ALL_SOURCE_KEYS,
    AT_ALL_CATEGORY_KEYS: SUBSCRIPTION_AT_ALL_CATEGORY_KEYS,
    DEFAULT_LABEL_CONFIG,
    FLAT_KEY_TO_PATH,
    createDefaultConfig,
    resolveSchemaNode
} = require('./schemaV1')
const { createConfigService } = require('./configService')
const { publicValue } = require('./publicConfig')
const {
    normalizeSubscriptionAtAllRules,
    createDefaultSubscriptionAtAllRules,
    normalizeLabelConfig
} = require('./normalizers')
const groupConfig = require('./groupConfig')

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function getIn(value, path) {
    let current = value
    for (const segment of path) {
        if (current === undefined || current === null) return undefined
        current = current[segment]
    }
    return current
}

const service = createConfigService()
const compatState = {}
let initialized = false
let initializePromise = null

function syncCompatState(snapshot) {
    for (const [flatKey, yamlPath] of Object.entries(FLAT_KEY_TO_PATH)) {
        compatState[flatKey] = clone(getIn(snapshot, yamlPath))
    }
}

syncCompatState(createDefaultConfig())

const config = {
    service,

    async initialize(options = {}) {
        if (initializePromise) return initializePromise
        initializePromise = (async () => {
            await service.initialize({
                createIfMissing: Boolean(options.createIfMissing),
                initialConfig: options.initialConfig
            })
            initialized = true
            syncCompatState(service.getSnapshot())
            if (options.watch !== false) service.startWatcher()
            return this
        })().catch((error) => {
            initializePromise = null
            throw error
        })
        return initializePromise
    },

    isInitialized() {
        return initialized
    },

    async stop() {
        if (initialized) await service.stop()
    },

    async patch(patch, options = {}) {
        if (!initialized) throw new Error('ConfigService is not initialized')
        const result = await service.patch(patch, options)
        syncCompatState(service.getSnapshot())
        return result
    },

    async update(mutator, options = {}) {
        if (!initialized) throw new Error('ConfigService is not initialized')
        const result = await service.update(mutator, options)
        syncCompatState(service.getSnapshot())
        return result
    },

    async mutate(mutator, options = {}) {
        if (typeof mutator !== 'function') throw new TypeError('Configuration mutator must be a function')
        const maxAttempts = options.maxAttempts ?? 3
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const expectedGeneration = this.getStatus().documentGeneration
            let mutationResult
            try {
                await this.update((draft) => {
                    mutationResult = mutator(draft)
                }, {
                    ...options,
                    actor: options.actor || 'compat-mutation',
                    expectedGeneration
                })
                return mutationResult
            } catch (error) {
                if (error?.code !== 'CONFIG_GENERATION_CONFLICT' || attempt + 1 >= maxAttempts) throw error
            }
        }
        return undefined
    },

    async reload(options = {}) {
        if (!initialized) throw new Error('ConfigService is not initialized')
        const result = await service.reload(options)
        syncCompatState(service.getSnapshot())
        return result
    },

    async recover(options = {}) {
        if (!initialized) throw new Error('ConfigService is not initialized')
        const result = await service.recover(options)
        syncCompatState(service.getSnapshot())
        return result
    },

    registerReloadHandler(handler) {
        return service.registerReloadHandler(handler)
    },

    getStatus() {
        return initialized
            ? service.getStatus()
            : {
                valid: false,
                schemaVersion: 1,
                documentGeneration: 0,
                effectiveGeneration: 0,
                generation: 0,
                fingerprint: null,
                components: {}
            }
    },

    getPublicConfig() {
        return initialized ? service.getPublicSnapshot() : service.toPublicConfig(createDefaultConfig())
    },

    getSnapshot() {
        return initialized ? service.getSnapshot() : createDefaultConfig()
    },

    get(pathOrKey) {
        if (initialized) return service.get(pathOrKey)
        if (Object.prototype.hasOwnProperty.call(FLAT_KEY_TO_PATH, pathOrKey)) {
            return clone(compatState[pathOrKey])
        }
        const path = Array.isArray(pathOrKey)
            ? pathOrKey
            : String(pathOrKey || '').split('.').filter(Boolean)
        return clone(getIn(createDefaultConfig(), path))
    },

    getDocument() {
        return initialized ? service.getDocument() : null
    },

    toPublicError(error) {
        return service.toPublicError(error)
    },

    toPublicDiff(diff) {
        return service.toPublicDiff(diff)
    },

    getGroupConfig(groupId, key) {
        return groupConfig.getGroupConfig(this.groupConfigs, groupId, key, this[key])
    },

    async setGroupConfig(groupId, key, value) {
        const id = String(groupId)
        return this.mutate((draft) => {
            draft.groupConfigs[id] ||= {}
            draft.groupConfigs[id][key] = clone(value)
            return true
        }, { actor: 'compat-set-group-config' })
    },

    async appendGroupConfigArray(groupId, key, value) {
        const id = String(groupId)
        return this.mutate((draft) => {
            draft.groupConfigs[id] ||= {}
            const current = Array.isArray(draft.groupConfigs[id][key]) ? draft.groupConfigs[id][key] : []
            draft.groupConfigs[id][key] = current
            if (current.includes(value)) return false
            current.push(value)
            return true
        }, { actor: 'compat-append-group-config' })
    },

    async removeGroupConfigArray(groupId, key, value) {
        const id = String(groupId)
        return this.mutate((draft) => {
            const current = draft.groupConfigs?.[id]?.[key]
            if (!Array.isArray(current) || !current.includes(value)) return false
            draft.groupConfigs[id][key] = current.filter((item) => item !== value)
            return true
        }, { actor: 'compat-remove-group-config' })
    },

    getRootAdminQQ() {
        return String(this.rootAdminQQ || '').trim()
    },

    getOfficialRootOpenids() {
        return Array.isArray(this.qqOfficialRootOpenids)
            ? this.qqOfficialRootOpenids.map(String).map((item) => item.trim()).filter(Boolean)
            : []
    },

    isRootAdmin(userId) {
        const normalized = String(userId ?? '').trim()
        if (!normalized) return false
        if (this.getProviderScope() === 'official') {
            return this.getOfficialRootOpenids().includes(normalized)
        }
        return normalized === this.getRootAdminQQ()
    },

    isGroupAdmin(groupId, userId) {
        if (this.isRootAdmin(userId)) return true
        const admins = this.groupConfigs?.[String(groupId)]?.admins
        return Array.isArray(admins) && admins.map(String).includes(String(userId))
    },

    async addGroupAdmin(groupId, userId) {
        const key = String(groupId)
        const value = String(userId)
        return this.mutate((draft) => {
            draft.groupConfigs[key] ||= {}
            const admins = Array.isArray(draft.groupConfigs[key].admins) ? draft.groupConfigs[key].admins : []
            draft.groupConfigs[key].admins = admins
            if (admins.includes(value)) return false
            admins.push(value)
            return true
        }, { actor: 'compat-add-group-admin' })
    },

    async removeGroupAdmin(groupId, userId) {
        const key = String(groupId)
        const value = String(userId)
        return this.mutate((draft) => {
            const admins = draft.groupConfigs?.[key]?.admins
            if (!Array.isArray(admins) || !admins.map(String).includes(value)) return false
            draft.groupConfigs[key].admins = admins.filter((item) => String(item) !== value)
            return true
        }, { actor: 'compat-remove-group-admin' })
    },

    getProviderScope(provider = null) {
        const raw = provider || this.qqProvider || 'napcat'
        return String(raw).trim().toLowerCase() === 'official' ? 'official' : 'napcat'
    },

    getEnabledGroupsForProvider(provider = null) {
        const scope = this.getProviderScope(provider)
        if (scope === 'napcat') return Array.isArray(this.enabledGroups) ? this.enabledGroups : []
        const scoped = this.providerScopedEnabledGroups || {}
        return Array.isArray(scoped[scope])
            ? scoped[scope]
            : (Array.isArray(this.enabledGroups) ? this.enabledGroups : [])
    },

    isGroupEnabled(groupId) {
        return groupConfig.isGroupEnabled(this.getEnabledGroupsForProvider(), groupId)
    },

    async enableGroup(groupId) {
        const id = String(groupId)
        const scope = this.getProviderScope()
        return this.mutate((draft) => {
            const target = scope === 'napcat'
                ? (draft.enabledGroups ||= [])
                : ((draft.providerScopedEnabledGroups ||= {})[scope] ||= [...(draft.enabledGroups || [])])
            if (target.includes(id)) return false
            target.push(id)
            return true
        }, { actor: 'compat-enable-group' })
    },

    async disableGroup(groupId) {
        const id = String(groupId)
        const scope = this.getProviderScope()
        return this.mutate((draft) => {
            const target = scope === 'napcat'
                ? (draft.enabledGroups ||= [])
                : ((draft.providerScopedEnabledGroups ||= {})[scope] ||= [...(draft.enabledGroups || [])])
            const index = target.indexOf(id)
            if (index < 0) return false
            target.splice(index, 1)
            return true
        }, { actor: 'compat-disable-group' })
    },

    async ensureGroupConfig(groupId) {
        const id = String(groupId)
        const scope = this.getProviderScope()
        const existing = this.groupConfigs?.[id]
        if (existing) return existing
        await this.mutate((draft) => {
            if (draft.groupConfigs[id]) return false
            draft.groupConfigs[id] = {}
            const target = scope === 'napcat'
                ? (draft.enabledGroups ||= [])
                : ((draft.providerScopedEnabledGroups ||= {})[scope] ||= [...(draft.enabledGroups || [])])
            if (target.length > 0 && !target.includes(id)) target.push(id)
            return true
        }, { actor: 'compat-ensure-group-config' })
        return this.groupConfigs?.[id]
    },

    async applyOverridePatch(patch = {}) {
        const operations = Object.entries(patch)
            .filter(([key]) => Object.prototype.hasOwnProperty.call(FLAT_KEY_TO_PATH, key))
            .map(([key, value]) => ({ op: 'set', path: FLAT_KEY_TO_PATH[key], value: clone(value) }))
        if (operations.length === 0) return false
        await this.patch(operations, {
            actor: 'compat-override-patch',
            expectedGeneration: this.getStatus().documentGeneration
        })
        return true
    },

    async deleteKeys(keys = []) {
        const defaults = createDefaultConfig()
        const operations = keys
            .filter((key) => Object.prototype.hasOwnProperty.call(FLAT_KEY_TO_PATH, key))
            .map((key) => ({
                op: 'set',
                path: FLAT_KEY_TO_PATH[key],
                value: clone(getIn(defaults, FLAT_KEY_TO_PATH[key]))
            }))
        if (operations.length === 0) return false
        await this.patch(operations, {
            actor: 'compat-reset-keys',
            expectedGeneration: this.getStatus().documentGeneration
        })
        return true
    },

    getConfigSnapshot() {
        const snapshot = {}
        for (const [key, yamlPath] of Object.entries(FLAT_KEY_TO_PATH)) {
            const schemaNode = resolveSchemaNode(yamlPath)
            const value = clone(this[key])
            if (schemaNode?.secret) {
                snapshot[key] = value !== undefined && value !== null && value !== '' ? '[REDACTED]' : ''
                continue
            }
            snapshot[key] = publicValue(value, schemaNode)
        }
        return snapshot
    },

    getDashboardConfigSnapshot() {
        const keys = [
            'subscriptionCheckInterval', 'linkCacheTimeout', 'showId',
            'previewGradientColor1', 'previewGradientColor2',
            'videoDownloadEnabled', 'videoDownloadResolution',
            'videoDownloadMaxDuration', 'videoDownloadAutoClean',
            'videoDownloadCleanTimeout', 'wsUrl', 'qqProvider', 'qqOfficialAppId',
            'qqOfficialApiBase', 'qqOfficialTokenUrl',
            'qqOfficialUseShardedGateway', 'qqOfficialIntents',
            'qqOfficialGatewayAckTimeoutMs', 'qqOfficialMediaUploadMode',
            'qqOfficialTempPublicBaseUrl', 'qqOfficialRootOpenids',
            'qqOfficialAccountQpm', 'qqOfficialGroupQpm',
            'qqOfficialQueueMaxSize'
        ]
        const snapshot = Object.fromEntries(keys.map((key) => [key, clone(this[key])]))
        snapshot.qqOfficialClientSecretConfigured = Boolean(this.qqOfficialClientSecret)
        snapshot.wsTokenConfigured = Boolean(this.wsToken)
        snapshot.generation = this.getStatus().documentGeneration
        return snapshot
    }
}

for (const [flatKey] of Object.entries(FLAT_KEY_TO_PATH)) {
    Object.defineProperty(config, flatKey, {
        enumerable: true,
        configurable: true,
        get() {
            return clone(compatState[flatKey])
        },
        set() {
            throw new TypeError('Direct configuration assignment is not supported; use config.patch() or config.update()')
        }
    })
}

Object.defineProperty(config, '__getMutableCompatStateForTests', {
    enumerable: false,
    value() {
        return compatState
    }
})

service.on('changed', () => {
    if (initialized) syncCompatState(service.getSnapshot())
})
service.on('snapshotPublished', (snapshot) => {
    if (initialized) syncCompatState(snapshot)
})

config.isVideoDownloadEnabledForGroup = function(groupId) {
    const current = config.groupConfigs?.[String(groupId)]
    return current && 'videoDownloadEnabled' in current
        ? current.videoDownloadEnabled
        : config.videoDownloadEnabled
}

config.getVideoDownloadResolutionForGroup = function(groupId) {
    const current = config.groupConfigs?.[String(groupId)]
    return current && 'videoDownloadResolution' in current
        ? current.videoDownloadResolution
        : config.videoDownloadResolution
}

config.getVideoDownloadMaxDurationForGroup = function(groupId) {
    const current = config.groupConfigs?.[String(groupId)]
    return current && 'videoDownloadMaxDuration' in current
        ? current.videoDownloadMaxDuration
        : config.videoDownloadMaxDuration
}

config.createDefaultSubscriptionAtAllRules = createDefaultSubscriptionAtAllRules
config.normalizeSubscriptionAtAllRules = normalizeSubscriptionAtAllRules
config.SUBSCRIPTION_AT_ALL_SOURCE_KEYS = SUBSCRIPTION_AT_ALL_SOURCE_KEYS
config.SUBSCRIPTION_AT_ALL_CATEGORY_KEYS = SUBSCRIPTION_AT_ALL_CATEGORY_KEYS
config.DEFAULT_LABEL_CONFIG = DEFAULT_LABEL_CONFIG
config.normalizeLabelConfig = normalizeLabelConfig

module.exports = config
