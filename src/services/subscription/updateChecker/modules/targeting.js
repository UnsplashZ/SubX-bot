const deps = require('../adapters/deps')
const { subscriptionManager, config } = deps
const { normalizeSourceList } = require('../helpers/sourceMap')
const SubscriptionTargetResolver = require('../../subscriptionTargetResolver')

function normalizeId(value) {
    if (value === null || value === undefined) return ''
    return String(value).trim()
}

function compareContentId(a, b) {
    const left = normalizeId(a)
    const right = normalizeId(b)
    if (!left || !right) return 0
    try {
        const leftBig = BigInt(left.replace(/^cv/i, ''))
        const rightBig = BigInt(right.replace(/^cv/i, ''))
        if (leftBig > rightBig) return 1
        if (leftBig < rightBig) return -1
        return 0
    } catch (error) {
        const paddedLeft = left.padStart(32, '0')
        const paddedRight = right.padStart(32, '0')
        if (paddedLeft > paddedRight) return 1
        if (paddedLeft < paddedRight) return -1
        return 0
    }
}

function normalizeTimestamp(value) {
    if (value === null || value === undefined || value === '') return null
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
}

function getStateValue(state, keys, fallback = null) {
    if (state && typeof state === 'object') {
        for (const key of keys) {
            const parts = String(key).split('.')
            let value = state
            for (const part of parts) {
                value = value && typeof value === 'object' ? value[part] : undefined
            }
            if (value !== undefined && value !== null && value !== '') {
                return value
            }
        }
    }
    return fallback
}

module.exports = {
    createSubscriptionTargetResolver() {
        return new SubscriptionTargetResolver({ subscriptionManager, config })
    },

    createGroupSourceMap(groupIds = [], sources = ['manual']) {
        const map = new Map()
        const normalizedSources = normalizeSourceList(sources)
        const fallbackSources = normalizedSources.length > 0 ? normalizedSources : ['manual']

        for (const groupId of groupIds || []) {
            const gid = String(groupId)
            if (!gid) continue
            const sourceSet = new Set()
            fallbackSources.forEach(source => sourceSet.add(source))
            map.set(gid, sourceSet)
        }

        return map
    },

    mergeGroupSourceMap(targetMap, groupId, sources) {
        if (!targetMap || !groupId) return
        const gid = String(groupId)
        const normalizedSources = normalizeSourceList(sources)
        const sourceList = normalizedSources.length > 0 ? normalizedSources : ['manual']

        if (!targetMap.has(gid)) {
            targetMap.set(gid, new Set(sourceList))
            return
        }

        const existing = targetMap.get(gid)
        sourceList.forEach(source => existing.add(source))
    },

    getGroupIdsFromSourceMap(sourceMap) {
        if (!(sourceMap instanceof Map)) return []
        return Array.from(sourceMap.keys())
    },

    normalizeGroupSourceMap(groupTargets, fallbackSource = 'manual') {
        if (groupTargets instanceof Map) {
            const cloned = new Map()
            for (const [groupId, sources] of groupTargets.entries()) {
                this.mergeGroupSourceMap(cloned, groupId, Array.isArray(sources) ? sources : Array.from(sources || []))
            }
            return cloned
        }

        if (Array.isArray(groupTargets)) {
            return this.createGroupSourceMap(groupTargets, [fallbackSource])
        }

        if (groupTargets && typeof groupTargets === 'object') {
            const normalized = new Map()
            for (const [groupId, sources] of Object.entries(groupTargets)) {
                this.mergeGroupSourceMap(normalized, groupId, Array.isArray(sources) ? sources : [sources])
            }
            return normalized
        }

        return new Map()
    },

    filterGroupSourceMapByGroups(sourceMap, allowedGroups) {
        const allowed = new Set((allowedGroups || []).map(gid => String(gid)))
        const filtered = new Map()
        if (!(sourceMap instanceof Map) || allowed.size === 0) return filtered

        for (const [groupId, sources] of sourceMap.entries()) {
            const gid = String(groupId)
            if (!allowed.has(gid)) continue
            this.mergeGroupSourceMap(filtered, gid, Array.from(sources || []))
        }

        return filtered
    },

    async getUnifiedUserState(uid) {
        const store = deps.subscriptionStateStore
        if (store && typeof store.getUserState === 'function') {
            return await store.getUserState(String(uid))
        }
        return null
    },

    getDynamicAnchor(state, fallback = null) {
        return getStateValue(state, ['dynamic.lastDynamicId', 'lastDynamicId', 'dynamicId'], fallback)
    },

    getVideoAnchor(state, fallback = null) {
        return {
            videoId: getStateValue(state, ['video.videoId', 'lastVideoId', 'videoId'], fallback?.videoId || null),
            videoCreated: getStateValue(state, ['video.lastCreated', 'lastVideoCreated', 'videoCreated'], fallback?.videoCreated ?? null)
        }
    },

    getArticleAnchor(state, fallback = null) {
        return {
            articleId: getStateValue(state, ['article.articleId', 'lastArticleId', 'articleId'], fallback?.articleId || null),
            articlePublishTime: getStateValue(
                state,
                ['article.lastPublishTime', 'lastArticlePublishTime', 'articlePublishTime'],
                fallback?.articlePublishTime ?? null
            )
        }
    },

    getLiveAnchor(state, fallback = null) {
        return {
            liveStatus: getStateValue(state, ['live.lastStatus', 'lastLiveStatus', 'liveStatus'], fallback?.liveStatus ?? 0),
            roomId: getStateValue(state, ['live.roomId', 'roomId', 'lastRoomId'], fallback?.roomId || null)
        }
    },

    async advanceDynamicState(userItemOrUid, dynamicId) {
        const uid = typeof userItemOrUid === 'object' ? userItemOrUid.uid : userItemOrUid
        if (!uid || !dynamicId) return
        const store = deps.subscriptionStateStore
        if (store && typeof store.advanceDynamic === 'function') {
            await store.advanceDynamic(String(uid), String(dynamicId), { source: 'updateChecker' })
            return
        }
        if (typeof userItemOrUid === 'object' && userItemOrUid.manualSub) {
            await subscriptionManager.updateUserSub(uid, { lastDynamicId: String(dynamicId) })
        }
        if (typeof userItemOrUid === 'object' && userItemOrUid.cookieFollower) {
            await subscriptionManager.updateCookieFollowerState(userItemOrUid.accountUid, uid, { lastDynamicId: String(dynamicId) })
        }
    },

    async advanceVideoState(userItem, videoState) {
        const uid = userItem?.uid
        if (!uid) return
        const store = deps.subscriptionStateStore
        if (store && typeof store.advanceVideo === 'function') {
            await store.advanceVideo(String(uid), {
                videoId: videoState.videoId || null,
                lastCreated: videoState.videoCreated ?? null
            }, { source: 'updateChecker' })
            return
        }
        await this.updateVideoLegacyState(userItem, videoState)
    },

    async advanceArticleState(userItem, articleState) {
        const uid = userItem?.uid
        if (!uid) return
        const store = deps.subscriptionStateStore
        if (store && typeof store.advanceArticle === 'function') {
            await store.advanceArticle(String(uid), {
                articleId: articleState.articleId || null,
                lastPublishTime: articleState.articlePublishTime ?? null
            }, { source: 'updateChecker' })
            return
        }
        await this.updateArticleLegacyState(userItem, articleState)
    },

    async advanceLiveState(userItemOrUid, liveState) {
        const uid = typeof userItemOrUid === 'object' ? userItemOrUid.uid : userItemOrUid
        if (!uid) return
        const store = deps.subscriptionStateStore
        if (store && typeof store.advanceLive === 'function') {
            await store.advanceLive(String(uid), {
                lastStatus: liveState.liveStatus,
                roomId: liveState.roomId || null
            }, { source: 'updateChecker' })
            return
        }
        if (typeof userItemOrUid === 'object' && userItemOrUid.manualSub) {
            const manualPatch = { lastLiveStatus: liveState.liveStatus }
            if (liveState.roomId && String(userItemOrUid.manualSub.roomId || '') !== String(liveState.roomId)) {
                manualPatch.roomId = liveState.roomId
            }
            await subscriptionManager.updateUserSub(uid, {
                ...manualPatch
            })
        }
        if (typeof userItemOrUid === 'object' && userItemOrUid.cookieFollower) {
            const cookiePatch = { lastLiveStatus: liveState.liveStatus }
            if (liveState.roomId && String(userItemOrUid.cookieFollower.roomId || '') !== String(liveState.roomId)) {
                cookiePatch.roomId = liveState.roomId
            }
            await subscriptionManager.updateCookieFollowerState(userItemOrUid.accountUid, uid, {
                ...cookiePatch
            })
        }
    },

    compareContentId,

    async ensureTargetBaselinesForUser(userItemOrUid, targetGroupSourceMap, unifiedState = null) {
        const uid = typeof userItemOrUid === 'object' ? userItemOrUid?.uid : userItemOrUid
        const groupIds = this.getGroupIdsFromSourceMap(targetGroupSourceMap)
        const store = deps.subscriptionStateStore
        if (!uid || groupIds.length === 0 || !store || typeof store.ensureTargetBaselines !== 'function') {
            return unifiedState
        }

        const currentState = unifiedState || (typeof store.getUserState === 'function'
            ? await store.getUserState(String(uid))
            : null)
        const result = await store.ensureTargetBaselines(String(uid), groupIds, currentState || {})
        return result?.state || currentState
    },

    isContentAfterTargetBaseline({ contentType, contentId, contentTime = null, baseline = null }) {
        if (!baseline || baseline.active === false) return true
        if (baseline.baselineSource === 'existing_target') return true

        const baselineId = normalizeId(baseline.baselineId)
        const normalizedContentId = normalizeId(contentId)
        if (contentType === 'dynamic') {
            if (!baselineId) return false
            return compareContentId(normalizedContentId, baselineId) > 0
        }

        if (contentType === 'video' || contentType === 'article') {
            const baselineTime = normalizeTimestamp(baseline.baselineTime)
            const normalizedContentTime = normalizeTimestamp(contentTime)
            if (baselineTime !== null && normalizedContentTime !== null) {
                return normalizedContentTime > baselineTime
            }
            return false
        }

        if (contentType === 'live') {
            const baselineRoomId = normalizeId(baseline.baselineRoomId)
            const baselineStatus = normalizeTimestamp(baseline.baselineStatus)
            if (baselineStatus === 1 && baselineRoomId && baselineRoomId === normalizedContentId) {
                return false
            }
            return true
        }

        return true
    },

    filterUndeliveredGroupsByTargetBaseline({ uid, contentType, contentId, contentTime = null, groupIds = [] }) {
        const store = deps.subscriptionStateStore
        if (!uid || !store || typeof store.getUserState !== 'function' || typeof store.getTargetBaseline !== 'function') {
            return groupIds
        }

        const userState = store.getUserState(String(uid))
        return (groupIds || []).filter(groupId => {
            const baseline = store.getTargetBaseline(userState, String(groupId), contentType)
            return this.isContentAfterTargetBaseline({
                contentType,
                contentId,
                contentTime,
                baseline
            })
        })
    },

    async getUndeliveredGroupSourceMap(paramsOrContentType, legacyContentId, legacyTargetGroupSourceMap) {
        const params = typeof paramsOrContentType === 'object' && paramsOrContentType !== null
            ? paramsOrContentType
            : {
                contentType: paramsOrContentType,
                contentId: legacyContentId,
                targetGroupSourceMap: legacyTargetGroupSourceMap
            }
        const {
            uid,
            contentType,
            contentId,
            contentTime = null,
            deliveryPart = 'main',
            targetGroupSourceMap,
            ledgerTargetGroupSourceMap = targetGroupSourceMap
        } = params
        const groupIds = this.getGroupIdsFromSourceMap(targetGroupSourceMap)
        const ledgerGroupIds = this.getGroupIdsFromSourceMap(ledgerTargetGroupSourceMap)
        if (groupIds.length === 0 || !contentId) return new Map()

        let undeliveredGroups = null
        const store = deps.subscriptionDeliveryStore
        if (deliveryPart === 'auto-download') {
            // Only retry explicit attempts; missing legacy media records are not evidence of failure.
            if (!store || typeof store.getRetryableGroups !== 'function') return new Map()
            undeliveredGroups = await store.getRetryableGroups(groupIds, contentType, String(contentId), deliveryPart)
        } else if (store && typeof store.getDeliveryCoverage === 'function') {
            const coverageGroupIds = ledgerGroupIds.length > 0 ? ledgerGroupIds : groupIds
            const coverage = await store.getDeliveryCoverage(coverageGroupIds, contentType, String(contentId), deliveryPart)
            // Ledger retry is only valid after at least one target group has a
            // persistent delivery/tombstone record. Legacy anchors and expired
            // ledgers must not be interpreted as "all groups need historical replay".
            if (!coverage.hasAnyRecord) {
                return new Map()
            }
            undeliveredGroups = coverage.undeliveredGroups
        } else if (store && typeof store.getUndeliveredGroups === 'function') {
            undeliveredGroups = await store.getUndeliveredGroups(groupIds, contentType, String(contentId), deliveryPart)
        } else if (store && typeof store.hasDelivered === 'function') {
            undeliveredGroups = []
            let hasAnyRecord = false
            for (const groupId of groupIds) {
                const delivered = await store.hasDelivered(String(groupId), contentType, String(contentId), deliveryPart)
                if (delivered) {
                    hasAnyRecord = true
                } else {
                    undeliveredGroups.push(groupId)
                }
            }
            if (!hasAnyRecord) return new Map()
        } else {
            return new Map()
        }

        const retryableGroups = this.filterUndeliveredGroupsByTargetBaseline({
            uid,
            contentType,
            contentId,
            contentTime,
            groupIds: undeliveredGroups || []
        })
        return this.filterGroupSourceMapByGroups(targetGroupSourceMap, retryableGroups)
    },

    async recordDeliveredGroups(contentType, contentId, groupIds, deliveryPart = 'main') {
        const deliveredGroups = Array.isArray(groupIds)
            ? groupIds.map(gid => String(gid)).filter(Boolean)
            : []
        const store = deps.subscriptionDeliveryStore
        if (!store || typeof store.recordDeliveredBatch !== 'function' || deliveredGroups.length === 0 || !contentId) {
            return
        }
        await store.recordDeliveredBatch(deliveredGroups.map(groupId => ({
            groupId,
            type: contentType,
            contentId: String(contentId),
            ...(deliveryPart === 'main' ? {} : { deliveryPart }),
            meta: { source: 'updateChecker' }
        })))
    },

    async recordNotifyDeliveredGroups(contentType, contentId, notifyResult, extraGroups = []) {
        const deliveredGroups = [
            ...(Array.isArray(notifyResult?.successGroups) ? notifyResult.successGroups : []),
            ...(Array.isArray(notifyResult?.dedupSkippedGroups) ? notifyResult.dedupSkippedGroups : []),
            ...(Array.isArray(notifyResult?.disabledSkippedGroups) ? notifyResult.disabledSkippedGroups : []),
            ...(Array.isArray(extraGroups) ? extraGroups : [])
        ]
        await this.recordDeliveredGroups(contentType, contentId, deliveredGroups)
        const fallbackGroups = Array.isArray(notifyResult?.fallbackUsedGroups)
            ? notifyResult.fallbackUsedGroups
            : []
        await this.recordDeliveredGroups(contentType, contentId, fallbackGroups, 'fallback-text')
    },

    /**
     * 构建需要检查视频/专栏的统一用户列表
     * 合并手动订阅用户 + Cookie同步用户，自动去重
     * @param {Set} activeGroups - 活跃群组集合
     * @returns {Array<{uid, name, targetGroups, source, manualSub?, cookieFollower?, accountUid?}>} 用户检查列表
     */
    buildUserCheckList(activeGroups) {
        return this.createSubscriptionTargetResolver().resolve(activeGroups)
    },

    collectFeedCoveredUids(accountUid, activeGroups = null) {
        const followers = subscriptionManager.cookieFollowings[String(accountUid)] || []
        const uidSet = new Set()

        for (const follower of followers) {
            const fid = subscriptionManager.getFollowerId(follower)
            if (!fid) continue

            // This includes both:
            // 1. Cookie sync + tag matching groups
            // 2. Manual subscription groups (regardless of tag)
            const targetGroups = this.findTargetGroupsForUser(accountUid, follower, activeGroups)
            if (targetGroups.length > 0) {
                uidSet.add(fid)
            }
        }

        return Array.from(uidSet)
    },

    findTargetGroupSourceMapForUser(accountUid, follower, activeGroups = null) {
        return this.createSubscriptionTargetResolver().resolveForFollower(accountUid, follower, activeGroups)
    },

    findTargetGroupSourceMapForUid(uid, activeGroups = null) {
        const normalizedUid = normalizeId(uid)
        if (!normalizedUid) return new Map()

        const target = this.createSubscriptionTargetResolver()
            .resolve(activeGroups)
            .find(item => normalizeId(item?.uid) === normalizedUid)
        return this.normalizeGroupSourceMap(target?.targetGroupSourceMap || new Map())
    },

    findTargetGroupsForUser(accountUid, follower, activeGroups = null) {
        const sourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups)
        return this.getGroupIdsFromSourceMap(sourceMap)
    }
}
