const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const {
    assertWebuiManageableGroup,
    getKnownManageableGroupIds,
    getGroupIdsInBotGroupList,
    getKnownManageableNumericGroupIds,
    getNumericGroupIdsInBotGroupList,
    isInBotGroupList,
    isOfficialProviderMode
} = require('../shared/group-guard')
const { isNumericGroupId } = require('../shared/normalize')
const { dashLog } = require('../shared/logging')
const {
    assertExpectedGeneration,
    configErrorResponse,
    configErrorStatus,
    emptyMutationResult
} = require('../shared/config-mutation')

const router = express.Router()

// GET /api/groups - List all groups (including disabled and left ones)
router.get('/groups', async (req, res) => {
    try {
        const bot = global.bot
        const groupConfigs = sysConfig.groupConfigs || {}
        const allowOpaque = isOfficialProviderMode(sysConfig, bot)
        const enabledGroups = (typeof sysConfig.getEnabledGroupsForProvider === 'function'
            ? sysConfig.getEnabledGroupsForProvider(allowOpaque ? 'official' : 'napcat')
            : (Array.isArray(sysConfig.enabledGroups) ? sysConfig.enabledGroups : [])
        ).map(id => String(id))
        const enabledSet = new Set(enabledGroups)
        const whitelistMode = enabledGroups.length > 0
        const allGroupIds = getKnownManageableGroupIds(sysConfig, bot, { allowOpaque })

        // 官方 provider：对群名未知的群补拉群信息（best-effort；成功/失败都会缓存，
        // 失败多为 11253 无白名单权限，之后不再重复请求）。dashboard 因此无需等群消息事件也能显示群名。
        let officialProvider = null
        try {
            const provider = require('../../../../providers/qq/runtime').getCurrentProvider()
            if (provider && String(provider.id) === 'official' &&
                typeof provider.refreshGroupInfo === 'function' &&
                typeof provider.resolveGroupDisplayName === 'function') {
                officialProvider = provider
            }
        } catch (e) {
            officialProvider = null
        }
        if (officialProvider) {
            for (const groupId of allGroupIds) {
                const groupIdStr = String(groupId)
                if (officialProvider.resolveGroupDisplayName(groupIdStr)) continue
                try {
                    await officialProvider.refreshGroupInfo(groupIdStr)
                } catch (e) {
                    dashLog(req, 'info', 'group-info-refresh-failed', {
                        groupId: groupIdStr,
                        error: logger.getErrorMessage(e)
                    })
                }
            }
        }

        const groupsData = Array.from(allGroupIds)
            .sort((a, b) => {
                const aNumeric = isNumericGroupId(a)
                const bNumeric = isNumericGroupId(b)
                if (aNumeric && bNumeric) return Number(a) - Number(b)
                return String(a).localeCompare(String(b))
            })
            .map(groupId => {
            const groupIdStr = String(groupId)
            const groupIdNum = Number(groupIdStr)
            const groupInfo =
                bot?.groupList?.get(groupId) || (isNumericGroupId(groupIdStr) ? bot?.groupList?.get(groupIdNum) : null)
            const groupConfig = groupConfigs[groupIdStr] || {}
            const normalizedRules = sysConfig.normalizeSubscriptionAtAllRules(
                groupConfig.subscriptionAtAllRules
            )
            const configWithDefaults = {
                ...groupConfig,
                subscriptionAtAllRules: normalizedRules
            }

            let isInGroup = true
            if (bot && bot.groupList) {
                isInGroup = isInBotGroupList(bot, groupIdStr, { allowOpaque })
            } else {
                isInGroup = groupConfig.isInGroup !== false
            }

            return {
                id: groupIdStr,
                name: (officialProvider && officialProvider.resolveGroupDisplayName(groupIdStr)) ||
                    groupInfo?.group_name || `群组 ${groupIdStr}`,
                isEnabled: whitelistMode ? enabledSet.has(groupIdStr) : true,
                isInGroup,
                config: configWithDefaults
            }
        })

        dashLog(req, 'info', 'groups-fetched', {
            count: groupsData.length
        })
        const status = sysConfig.getStatus()
        res.set('X-Config-Generation', String(status.documentGeneration))
        res.json(groupsData)
    } catch (error) {
        dashLog(req, 'error', 'groups-fetch-failed', {
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to fetch groups' })
    }
})

// POST /api/groups/:id/toggle - Toggle group enabled status
router.post('/groups/:id/toggle', async (req, res) => {
    try {
        const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id',
            requireInGroup: true
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const groupIdStr = String(groupId)
        const allowOpaque = isOfficialProviderMode(sysConfig, global.bot)

        const providerScope = allowOpaque ? 'official' : 'napcat'
        const snapshot = sysConfig.getSnapshot()
        let enabledGroups = (providerScope === 'official'
            ? snapshot.providerScopedEnabledGroups?.official
            : snapshot.enabledGroups
        )
        enabledGroups = (Array.isArray(enabledGroups) ? enabledGroups : []).map(id => String(id))
        const enabledSet = new Set(enabledGroups)
        const currentlyEnabled = enabledGroups.length === 0 || enabledSet.has(groupIdStr)
        let isEnabled

        if (currentlyEnabled) {
            if (enabledGroups.length === 0) {
                // 运行时语义中空白名单表示“全部启用”，禁用单群时先显式展开当前在群列表
                enabledGroups = allowOpaque
                    ? Array.from(getGroupIdsInBotGroupList(global.bot, { allowOpaque: true }))
                    : Array.from(getNumericGroupIdsInBotGroupList(global.bot))
                if (enabledGroups.length === 0) {
                    // Bot 离线时回退到已知群集合，避免“返回禁用成功但空白名单仍表示全部启用”
                    enabledGroups = allowOpaque
                        ? Array.from(getKnownManageableGroupIds(sysConfig, global.bot, { allowOpaque: true }))
                        : Array.from(getKnownManageableNumericGroupIds(sysConfig, global.bot))
                }
            }
            enabledGroups = enabledGroups.filter(id => id !== groupIdStr)
            isEnabled = false
        } else {
            if (!enabledSet.has(groupIdStr)) {
                enabledGroups.push(groupIdStr)
            }
            isEnabled = true
        }

        enabledGroups = Array.from(new Set(enabledGroups))
        const path = allowOpaque
            ? ['providerScopedEnabledGroups', 'official']
            : ['enabledGroups']
        const result = await sysConfig.patch([
            { op: 'set', path, value: enabledGroups }
        ], { actor: 'dashboard', expectedGeneration })
        dashLog(req, 'info', 'group-toggled', {
            groupId,
            isEnabled
        })
        res.json({ ...result, message: `Group ${groupId} toggled`, isEnabled })
    } catch (error) {
        const payload = configErrorResponse(sysConfig, error)
        const statusCode = configErrorStatus(error)
        dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'group-toggle-failed', {
            groupId: req.params.id,
            code: payload.code
        })
        res.status(statusCode).json(payload)
    }
})

// POST /api/groups/:id/config - Update specific group config
router.post('/groups/:id/config', async (req, res) => {
    try {
        const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id',
            requireInGroup: true
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const groupIdStr = String(groupId)
        const updates = { ...req.body }
        delete updates.expectedGeneration

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' })
        }

        if (
            updates.hasOwnProperty('subscriptionAtAll') &&
            typeof updates.subscriptionAtAll !== 'boolean'
        ) {
            return res
                .status(400)
                .json({ error: 'subscriptionAtAll must be a boolean' })
        }

        if (updates.hasOwnProperty('subscriptionAtAllRules')) {
            if (updates.subscriptionAtAllRules === null) {
                // null = reset to default behavior (remove group override)
            } else if (
                !updates.subscriptionAtAllRules ||
                typeof updates.subscriptionAtAllRules !== 'object'
            ) {
                return res
                    .status(400)
                    .json({ error: 'subscriptionAtAllRules must be an object or null' })
            } else {
                updates.subscriptionAtAllRules = sysConfig.normalizeSubscriptionAtAllRules(
                    updates.subscriptionAtAllRules
                )
            }
        }

        if (updates.hasOwnProperty('showId') && typeof updates.showId !== 'boolean') {
            return res.status(400).json({ error: 'showId must be a boolean' })
        }

        if (updates.hasOwnProperty('linkCacheTimeout')) {
            const timeout = parseInt(updates.linkCacheTimeout, 10)
            if (isNaN(timeout) || timeout < 0) {
                return res.status(400).json({
                    error: 'linkCacheTimeout must be a non-negative integer'
                })
            }
            updates.linkCacheTimeout = timeout
        }

        if (updates.hasOwnProperty('nightMode')) {
            const nightMode = updates.nightMode

            if (!nightMode || typeof nightMode !== 'object') {
                return res.status(400).json({ error: 'nightMode must be an object' })
            }

            if (!['on', 'off', 'timed'].includes(nightMode.mode)) {
                return res.status(400).json({
                    error: 'nightMode.mode must be "on", "off", or "timed"'
                })
            }

            if (nightMode.mode === 'timed') {
                const timeRegex = /^\d{1,2}:\d{2}$/

                if (
                    !timeRegex.test(nightMode.startTime) ||
                    !timeRegex.test(nightMode.endTime)
                ) {
                    return res.status(400).json({ error: 'Time format must be HH:mm' })
                }

                const [startH, startM] = nightMode.startTime.split(':').map(Number)
                const [endH, endM] = nightMode.endTime.split(':').map(Number)

                if (
                    startH < 0 ||
                    startH > 23 ||
                    startM < 0 ||
                    startM > 59 ||
                    endH < 0 ||
                    endH > 23 ||
                    endM < 0 ||
                    endM > 59
                ) {
                    return res.status(400).json({
                        error: 'Time values out of range (00:00-23:59)'
                    })
                }
            }
        }

        const cleanedUpdates = { ...updates }
        if (
            updates.hasOwnProperty('subscriptionAtAllRules') &&
            updates.subscriptionAtAllRules === null
        ) {
            delete cleanedUpdates.subscriptionAtAllRules
        }

        const currentGroupConfigs = sysConfig.getSnapshot().groupConfigs || {}
        const groupConfig = { ...(currentGroupConfigs[groupIdStr] || {}) }
        if (updates.subscriptionAtAllRules === null) delete groupConfig.subscriptionAtAllRules
        Object.assign(groupConfig, cleanedUpdates)
        const result = await sysConfig.patch([
            { op: 'set', path: ['groupConfigs', groupIdStr], value: groupConfig }
        ], { actor: 'dashboard', expectedGeneration })
        const savedGroup = sysConfig.getSnapshot().groupConfigs?.[groupIdStr] || {}

        dashLog(req, 'info', 'group-config-updated', {
            groupId,
            keys: Object.keys(cleanedUpdates).join(',')
        })
        res.json({
            ...result,
            message: `Group ${groupId} configuration updated`,
            config: {
                ...savedGroup,
                subscriptionAtAllRules: sysConfig.normalizeSubscriptionAtAllRules(savedGroup.subscriptionAtAllRules)
            }
        })
    } catch (error) {
        const payload = configErrorResponse(sysConfig, error)
        const statusCode = configErrorStatus(error)
        dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'group-config-update-failed', {
            groupId: req.params.id,
            code: payload.code
        })
        res.status(statusCode).json(payload)
    }
})

// DELETE /api/groups/:id - Delete config for a left group
router.delete('/groups/:id', async (req, res) => {
    try {
        const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id'
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const groupIdStr = String(groupId)

        if (guarded.isInGroup) {
            return res.status(400).json({
                error: 'Can only delete configs for groups that bot has left'
            })
        }

        const snapshot = sysConfig.getSnapshot()
        const operations = []

        if (Object.prototype.hasOwnProperty.call(snapshot.groupConfigs || {}, groupIdStr)) {
            operations.push({ op: 'remove', path: ['groupConfigs', groupIdStr] })
        }

        const allowOpaque = isOfficialProviderMode(sysConfig, global.bot)
        const enabledGroups = allowOpaque
            ? snapshot.providerScopedEnabledGroups?.official
            : snapshot.enabledGroups
        if (Array.isArray(enabledGroups) && enabledGroups.includes(groupIdStr)) {
            operations.push({
                op: 'set',
                path: allowOpaque ? ['providerScopedEnabledGroups', 'official'] : ['enabledGroups'],
                value: enabledGroups.filter((id) => String(id) !== groupIdStr)
            })
        }

        if (operations.length === 0) {
            return res.status(404).json({ error: 'Group config not found' })
        }

        const result = await sysConfig.patch(operations, { actor: 'dashboard', expectedGeneration })
        const subscriptionManager = require('../../../../services/subscription/subscriptionManager')
        try {
            await subscriptionManager.removeGroupFromAllSubscriptions(groupId)
        } catch (cleanupError) {
            const rollback = []
            if (Object.prototype.hasOwnProperty.call(snapshot.groupConfigs || {}, groupIdStr)) {
                rollback.push({ op: 'set', path: ['groupConfigs', groupIdStr], value: snapshot.groupConfigs[groupIdStr] })
            }
            if (Array.isArray(enabledGroups) && enabledGroups.includes(groupIdStr)) {
                rollback.push({
                    op: 'set',
                    path: allowOpaque ? ['providerScopedEnabledGroups', 'official'] : ['enabledGroups'],
                    value: enabledGroups
                })
            }
            try {
                if (rollback.length > 0) {
                    await sysConfig.patch(rollback, {
                        actor: 'dashboard-rollback',
                        expectedGeneration: result.documentGeneration
                    })
                }
            } catch (rollbackError) {
                logger.logEvent('error', 'DASH', req.logScope || 'group-delete', 'group-config-delete-rollback-failed', {
                    code: rollbackError?.code || 'CONFIG_ROLLBACK_ERROR'
                })
            }
            const error = new Error('Failed to remove group subscriptions')
            error.code = 'GROUP_SUBSCRIPTION_CLEANUP_FAILED'
            throw error
        }

        dashLog(req, 'info', 'group-config-deleted', {
            groupId
        })
        res.json({ ...result, success: true, message: `Config for group ${groupId} deleted` })
    } catch (error) {
        const payload = configErrorResponse(sysConfig, error)
        const statusCode = configErrorStatus(error)
        dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'group-config-delete-failed', {
            groupId: req.params.id,
            code: payload.code
        })
        res.status(statusCode).json(payload)
    }
})

module.exports = router
