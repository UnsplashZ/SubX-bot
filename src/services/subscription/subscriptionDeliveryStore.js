'use strict'

const path = require('path')
const storageUtils = require('../../utils/storageUtils')

const SCHEMA_VERSION = 1
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function normalizePart(value) {
    if (value === null || value === undefined) return ''
    return String(value).trim()
}

function normalizeTime(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : fallback
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function isCovered(record) {
    return Boolean(record && (record.status === 'delivered' || record.status === 'skipped'))
}

class SubscriptionDeliveryStore {
    constructor(options = {}) {
        this.dataDir = options.dataDir || path.join(process.cwd(), 'data')
        this.deliveryFile = options.deliveryFile || path.join(this.dataDir, 'subscription_delivery.json')
        this.retentionMs = options.retentionMs || DEFAULT_RETENTION_MS
        this.now = typeof options.now === 'function' ? options.now : () => Date.now()
        this.schemaVersion = SCHEMA_VERSION

        this.records = {}
        this._loaded = false
        this._loadingPromise = null
        this._operationChain = Promise.resolve()
    }

    static makeKey(groupId, type, contentId, deliveryPart = 'main') {
        const normalizedGroupId = normalizePart(groupId)
        const normalizedType = normalizePart(type)
        const normalizedContentId = normalizePart(contentId)
        if (!normalizedGroupId || !normalizedType || !normalizedContentId) return ''
        const normalizedDeliveryPart = normalizePart(deliveryPart) || 'main'
        const baseKey = `${normalizedGroupId}:${normalizedType}:${normalizedContentId}`
        return normalizedDeliveryPart === 'main' ? baseKey : `${baseKey}:${normalizedDeliveryPart}`
    }

    makeKey(groupId, type, contentId, deliveryPart = 'main') {
        return SubscriptionDeliveryStore.makeKey(groupId, type, contentId, deliveryPart)
    }

    async ensureLoaded() {
        if (this._loaded) return
        if (this._loadingPromise) return this._loadingPromise

        this._loadingPromise = this.load()
        try {
            await this._loadingPromise
        } finally {
            this._loadingPromise = null
        }
    }

    async load() {
        const data = await storageUtils.safeReadJSON(this.deliveryFile, {
            schemaVersion: this.schemaVersion,
            records: {}
        })

        this.records = this._normalizeRecords(data && data.records)
        this._loaded = true
        return this.getSnapshot()
    }

    async reload() {
        await this._operationChain
        this._loaded = false
        this._loadingPromise = null
        return this.load()
    }

    getSnapshot() {
        return {
            schemaVersion: this.schemaVersion,
            records: clone(this.records)
        }
    }

    async hasDelivered(groupId, type, contentId, deliveryPart = 'main') {
        await this._operationChain
        await this.ensureLoaded()
        const key = this.makeKey(groupId, type, contentId, deliveryPart)
        return Boolean(key && isCovered(this.records[key]))
    }

    async getUndeliveredGroups(groupIds, type, contentId, deliveryPart = 'main') {
        await this._operationChain
        await this.ensureLoaded()
        const groups = Array.isArray(groupIds) ? groupIds : []
        return groups
            .map(groupId => normalizePart(groupId))
            .filter(groupId => groupId && !isCovered(this.records[this.makeKey(groupId, type, contentId, deliveryPart)]))
    }

    async getRetryableGroups(groupIds, type, contentId, deliveryPart = 'auto-download') {
        await this._operationChain
        await this.ensureLoaded()
        return (groupIds || []).map(normalizePart).filter(groupId => {
            const record = this.records[this.makeKey(groupId, type, contentId, deliveryPart)]
            return record && ['pending', 'failed'].includes(record.status)
        })
    }

    async getDeliveryCoverage(groupIds, type, contentId, deliveryPart = 'main') {
        await this._operationChain
        await this.ensureLoaded()
        const groups = Array.isArray(groupIds) ? groupIds : []
        const deliveredGroups = []
        const undeliveredGroups = []
        let hasAnyRecord = false

        for (const groupId of groups) {
            const normalizedGroupId = normalizePart(groupId)
            if (!normalizedGroupId) continue
            const record = this.records[this.makeKey(normalizedGroupId, type, contentId, deliveryPart)]
            if (record) hasAnyRecord = true
            if (isCovered(record)) {
                deliveredGroups.push(normalizedGroupId)
            } else {
                undeliveredGroups.push(normalizedGroupId)
            }
        }

        return {
            deliveredGroups,
            undeliveredGroups,
            hasAnyRecord
        }
    }

    async recordDelivered(record) {
        return this._enqueueMutation(async () => {
            const normalized = this._normalizeRecord(record)
            if (!normalized) {
                return { changed: false, reason: 'invalid_input' }
            }

            this.records[normalized.key] = normalized
            await this._saveUnlocked()
            return { changed: true, record: clone(normalized) }
        })
    }

    async save() {
        return this._enqueueMutation(async () => {
            await this._saveUnlocked()
            return true
        })
    }

    async recordDeliveredBatch(records) {
        const input = Array.isArray(records) ? records : []
        return this.recordDeliveryBatch(input.map(record => ({ ...record, status: 'delivered' })))
    }

    async recordDeliveryBatch(records) {
        return this._enqueueMutation(async () => {
            const input = Array.isArray(records) ? records : []
            let changed = 0

            for (const record of input) {
                const normalized = this._normalizeRecord(record)
                if (!normalized) continue
                this.records[normalized.key] = normalized
                changed += 1
            }

            if (changed > 0) {
                await this._saveUnlocked()
            }

            return { changed }
        })
    }

    async cleanupExpired(now = this.now()) {
        return this._enqueueMutation(async () => {
            const nowMs = normalizeTime(now, this.now())
            const cutoff = nowMs - this.retentionMs
            let removed = 0

            for (const [key, record] of Object.entries(this.records)) {
                const deliveredAt = normalizeTime(record.deliveredAt, 0)
                if (deliveredAt < cutoff) {
                    delete this.records[key]
                    removed += 1
                }
            }

            if (removed > 0) {
                await this._saveUnlocked()
            }

            return { removed }
        })
    }

    async _enqueueMutation(fn) {
        const next = this._operationChain.then(async () => {
            await this.ensureLoaded()
            return fn()
        })
        this._operationChain = next.catch(() => {})
        return next
    }

    async _saveUnlocked() {
        const payload = {
            schemaVersion: this.schemaVersion,
            records: this.records
        }
        await storageUtils.asyncWriteWithBackup(this.deliveryFile, payload)
    }

    _normalizeRecords(rawRecords) {
        if (!rawRecords || typeof rawRecords !== 'object' || Array.isArray(rawRecords)) {
            return {}
        }

        const records = {}
        for (const [key, rawRecord] of Object.entries(rawRecords)) {
            const normalized = this._normalizeRecord({ ...rawRecord, key })
            if (!normalized) continue
            records[normalized.key] = normalized
        }
        return records
    }

    _normalizeRecord(record) {
        if (!record || typeof record !== 'object') return null

        const groupId = normalizePart(record.groupId)
        const type = normalizePart(record.type)
        const contentId = normalizePart(record.contentId)
        const deliveryPart = normalizePart(record.deliveryPart || record.meta?.deliveryPart) || 'main'
        const key = this.makeKey(groupId, type, contentId, deliveryPart)

        if (!groupId || !type || !contentId || !key) return null

        return {
            key,
            groupId,
            type,
            contentId,
            deliveryPart,
            status: ['pending', 'failed', 'skipped', 'delivered'].includes(record.status) ? record.status : 'delivered',
            deliveredAt: normalizeTime(record.deliveredAt, this.now()),
            meta: record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta)
                ? { ...record.meta }
                : {}
        }
    }
}

const subscriptionDeliveryStore = new SubscriptionDeliveryStore()

module.exports = subscriptionDeliveryStore
module.exports.SubscriptionDeliveryStore = SubscriptionDeliveryStore
module.exports.DEFAULT_RETENTION_MS = DEFAULT_RETENTION_MS
