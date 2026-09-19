const notificationService = require('./notificationService')
const qqProviderRuntime = require('../providers/qq/runtime')

const ROLE_LEVEL = {
    unknown: 0,
    member: 1,
    admin: 2,
    owner: 3
}

function normalizeId(value) {
    const normalized = String(value || '').trim()
    return /^\d+$/.test(normalized) ? normalized : ''
}

function normalizeGroupId(value) {
    const normalized = normalizeId(value)
    if (!normalized) throw new Error('missing_group_id')
    return normalized
}

function normalizeRole(role) {
    const numericRole = Number(role)
    if (numericRole === 4) return 'owner'
    if (numericRole === 3 || numericRole === 2) return 'admin'
    if (numericRole === 1) return 'member'
    const normalized = String(role || 'unknown').trim().toLowerCase()
    return Object.prototype.hasOwnProperty.call(ROLE_LEVEL, normalized) ? normalized : 'unknown'
}

function roleLevel(role) {
    return ROLE_LEVEL[normalizeRole(role)] || 0
}

function isManagerRole(role) {
    return roleLevel(role) >= ROLE_LEVEL.admin
}

function ensureActionOk(response, action) {
    const retcode = response?.retcode
    if (response?.status === 'ok' && (retcode === 0 || retcode === undefined || retcode === null)) {
        return response
    }
    throw new Error(response?.wording || response?.message || `${action}_failed`)
}

function displayMember(member) {
    if (!member) return '未知成员'
    const name = member.card || member.nickname || member.userId || member.user_id || '未知成员'
    const userId = member.userId || member.user_id || ''
    return userId ? `${name}(${userId})` : name
}

function compactText(value, limit = 80) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? text.slice(0, limit) : text
}

function normalizeNoticeId(value) {
    const normalized = String(value || '').trim()
    if (!normalized) throw new Error('missing_notice_id')
    return normalized
}

function normalizeNoticeContent(value) {
    const normalized = String(value || '').replace(/\r\n/g, '\n').trim()
    if (!normalized) throw new Error('missing_notice_content')
    if (normalized.length > 2000) throw new Error('notice_content_too_long')
    return normalized
}

function normalizeNoticeImage(value) {
    return String(value || '').trim()
}

function boolToNapcatFlag(value) {
    return value ? 1 : 0
}

function normalizeMember(data = {}) {
    return {
        groupId: String(data.group_id || data.groupId || ''),
        userId: String(data.user_id || data.userId || data.uin || data.uid || ''),
        nickname: String(data.nickname || data.nick || ''),
        card: String(data.card || data.cardName || ''),
        role: normalizeRole(data.role),
        title: String(data.title || ''),
        shutUpTimestamp: Number(data.shut_up_timestamp || data.shutUpTimestamp || data.shutUpTime || 0) || 0,
        raw: data
    }
}

function normalizeGroup(data = {}) {
    return {
        groupId: String(data.group_id || data.groupId || ''),
        groupName: String(data.group_name || data.groupName || ''),
        memberCount: Number(data.member_count || data.memberCount || 0) || 0,
        maxMemberCount: Number(data.max_member_count || data.maxMemberCount || 0) || 0,
        wholeBanEnabled: Boolean(Number(data.group_all_shut || data.groupAllShut || 0)),
        raw: data
    }
}

function normalizeSystemRequest(item = {}) {
    return {
        requestId: String(item.request_id || item.requestId || ''),
        invitorUin: String(item.invitor_uin || item.invitorUin || ''),
        invitorNick: String(item.invitor_nick || item.invitorNick || ''),
        groupId: String(item.group_id || item.groupId || ''),
        groupName: String(item.group_name || item.groupName || ''),
        userId: String(item.requester_uin || item.requesterUin || item.user_id || item.userId || ''),
        requesterNick: String(item.requester_nick || item.requesterNick || ''),
        message: String(item.message || ''),
        checked: Boolean(item.checked),
        actor: String(item.actor || ''),
        raw: item
    }
}

function normalizeMessage(data = {}) {
    const senderUserId = data?.sender?.user_id ?? data?.sender?.userId ?? data?.user_id
    return {
        messageId: String(data.message_id || data.messageId || ''),
        groupId: String(data.group_id || data.groupId || ''),
        userId: String(senderUserId || ''),
        raw: data
    }
}

function getWs(options = {}) {
    return options.ws || global.bot?.ws || null
}

function getSelfId(options = {}) {
    return normalizeId(options.selfId || global.bot?.selfId)
}

function isOfficialProvider(options = {}) {
    const provider = options.ws || qqProviderRuntime.getCurrentProvider()
    return String(provider?.id || '').toLowerCase() === 'official'
}

class QqGroupAdminService {
    async callAction(action, params, options = {}) {
        const response = await notificationService.callAction(getWs(options), action, params, 'QqGroupAdmin', options.timeoutMs || 10000)
        return ensureActionOk(response, action)
    }

    async getMemberInfo({ groupId, userId, noCache = true }, options = {}) {
        const safeGroupId = normalizeGroupId(groupId)
        const safeUserId = normalizeId(userId)
        if (!safeUserId) throw new Error('invalid_target_user_id')
        const response = await this.callAction('get_group_member_info', {
            group_id: safeGroupId,
            user_id: safeUserId,
            no_cache: Boolean(noCache)
        }, options)
        return normalizeMember(response.data || {})
    }

    async getGroupInfo({ groupId }, options = {}) {
        const response = await this.callAction('get_group_info', {
            group_id: normalizeGroupId(groupId)
        }, options)
        return normalizeGroup(response.data || {})
    }

    async getGroupMuteList({ groupId }, options = {}) {
        const response = await this.callAction('get_group_shut_list', {
            group_id: normalizeGroupId(groupId)
        }, options)
        return (Array.isArray(response.data) ? response.data : []).map(normalizeMember)
    }

    async getEssenceMessages({ groupId }, options = {}) {
        const response = await this.callAction('get_essence_msg_list', {
            group_id: normalizeGroupId(groupId)
        }, options)
        return Array.isArray(response.data) ? response.data : []
    }

    async getGroupNotices({ groupId }, options = {}) {
        const response = await this.callAction('_get_group_notice', {
            group_id: normalizeGroupId(groupId)
        }, options)
        return Array.isArray(response.data) ? response.data : []
    }

    async getAtAllRemain({ groupId }, options = {}) {
        const response = await this.callAction('get_group_at_all_remain', {
            group_id: normalizeGroupId(groupId)
        }, options)
        return response.data || {}
    }

    async getGroupSystemMessages({ groupId, count = 50 }, options = {}) {
        const safeGroupId = normalizeGroupId(groupId)
        const response = await this.callAction('get_group_system_msg', {
            count: Math.max(1, Math.min(100, Math.trunc(Number(count) || 50)))
        }, options)
        return this.filterSystemMessagesByGroup(response.data || {}, safeGroupId)
    }

    async getGroupIgnoredNotifies({ groupId }, options = {}) {
        const safeGroupId = normalizeGroupId(groupId)
        const response = await this.callAction('get_group_ignored_notifies', {}, options)
        return this.filterSystemMessagesByGroup(response.data || {}, safeGroupId)
    }

    filterSystemMessagesByGroup(data, groupId) {
        // SnowLuma returns a mixed inbox without an explicit request subtype.
        // Preserve it without guessing from inviter IDs or opaque request flags.
        if (Array.isArray(data)) {
            return {
                invitedRequests: [],
                joinRequests: [],
                unclassifiedRequests: data.map(normalizeSystemRequest).filter((item) => item.groupId === groupId)
            }
        }
        const invited = Array.isArray(data.invited_requests) ? data.invited_requests
            : Array.isArray(data.InvitedRequest) ? data.InvitedRequest : []
        const joins = Array.isArray(data.join_requests) ? data.join_requests : []
        return {
            invitedRequests: invited.map(normalizeSystemRequest).filter((item) => item.groupId === groupId),
            joinRequests: joins.map(normalizeSystemRequest).filter((item) => item.groupId === groupId)
        }
    }

    async listMembers({ groupId, noCache = false }, options = {}) {
        const response = await this.callAction('get_group_member_list', {
            group_id: normalizeGroupId(groupId),
            no_cache: Boolean(noCache)
        }, options)
        return (Array.isArray(response.data) ? response.data : []).map(normalizeMember)
    }

    async searchMembers({ groupId, query, limit = 8 }, options = {}) {
        const safeQuery = String(query || '').trim().toLowerCase()
        if (!safeQuery) throw new Error('missing_member_query')
        const members = await this.listMembers({ groupId, noCache: false }, options)
        return members
            .filter((member) => (
                member.userId.includes(safeQuery) ||
                member.nickname.toLowerCase().includes(safeQuery) ||
                member.card.toLowerCase().includes(safeQuery)
            ))
            .slice(0, Math.max(1, Math.min(20, Math.trunc(Number(limit) || 8))))
    }

    async getMessageInfo({ messageId }, options = {}) {
        const safeMessageId = String(messageId || '').trim()
        if (!safeMessageId) throw new Error('missing_message_id')
        const response = await this.callAction('get_msg', { message_id: safeMessageId }, options)
        return normalizeMessage(response.data || {})
    }

    async assertBotCanManage(groupId, options = {}) {
        const selfId = getSelfId(options)
        if (!selfId) throw new Error('bot_self_id_unavailable')
        const botMember = await this.getMemberInfo({ groupId, userId: selfId, noCache: true }, options)
        if (!isManagerRole(botMember.role)) {
            throw new Error('bot_not_group_admin')
        }
        return botMember
    }

    async assertActorCanManageGroup(groupId, options = {}) {
        const safeGroupId = normalizeGroupId(groupId)
        const actor = options.actor || {}
        const botMember = await this.assertBotCanManage(safeGroupId, options)
        if (actor.isRoot) return { groupId: safeGroupId, botMember, actorMember: { userId: String(actor.userId || ''), role: 'owner' } }
        const actorMember = await this.getMemberInfo({ groupId: safeGroupId, userId: actor.userId, noCache: true }, options)
        if (!isManagerRole(actorMember.role)) throw new Error('actor_not_group_admin')
        return { groupId: safeGroupId, botMember, actorMember }
    }

    assertActorCanManageTarget({ actor, actorMember, botMember, targetMember, action = 'manage' }) {
        const actorIsRoot = Boolean(actor?.isRoot)
        const actorRole = normalizeRole(actorMember?.role || actor?.qqRole)
        const botRole = normalizeRole(botMember?.role)
        const targetRole = normalizeRole(targetMember?.role)
        if (!actorIsRoot && !isManagerRole(actorRole)) throw new Error('actor_not_group_admin')
        if (targetRole === 'owner') throw new Error('target_is_group_owner')
        if (roleLevel(botRole) <= roleLevel(targetRole)) {
            throw new Error('bot_role_not_higher_than_target')
        }
        if (!actorIsRoot && roleLevel(actorRole) <= roleLevel(targetRole)) {
            throw new Error('actor_role_not_higher_than_target')
        }
        if (action === 'kick' && String(actor?.userId || '') === String(targetMember?.userId || '')) {
            throw new Error('cannot_kick_self')
        }
    }

    async buildModerationContext({ groupId, targetUserId, actor }, options = {}) {
        const safeGroupId = normalizeGroupId(groupId)
        const safeTargetUserId = normalizeId(targetUserId)
        if (!safeTargetUserId) throw new Error('invalid_target_user_id')
        const selfId = getSelfId(options)
        if (selfId && safeTargetUserId === selfId) throw new Error('cannot_manage_bot_self')
        const [botMember, actorMember, targetMember] = await Promise.all([
            this.assertBotCanManage(safeGroupId, options),
            actor?.isRoot
                ? Promise.resolve({ userId: String(actor.userId || ''), role: 'owner', nickname: 'Root' })
                : this.getMemberInfo({ groupId: safeGroupId, userId: actor?.userId, noCache: true }, options),
            this.getMemberInfo({ groupId: safeGroupId, userId: safeTargetUserId, noCache: true }, options)
        ])
        return { groupId: safeGroupId, targetUserId: safeTargetUserId, botMember, actorMember, targetMember }
    }

    async muteMember({ groupId, targetUserId, duration }, options = {}) {
        const seconds = Math.max(1, Math.min(24 * 60 * 60, Math.trunc(Number(duration) || 0)))
        const context = await this.buildModerationContext({ groupId, targetUserId, actor: options.actor }, options)
        this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'mute' })
        await this.callAction('set_group_ban', {
            group_id: context.groupId,
            user_id: context.targetUserId,
            duration: seconds
        }, options)
        return {
            message: `已禁言 ${displayMember(context.targetMember)} ${seconds} 秒。`,
            data: { groupId: context.groupId, targetUserId: context.targetUserId, duration: seconds }
        }
    }

    async unmuteMember({ groupId, targetUserId }, options = {}) {
        const context = await this.buildModerationContext({ groupId, targetUserId, actor: options.actor }, options)
        this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'unmute' })
        await this.callAction('set_group_ban', {
            group_id: context.groupId,
            user_id: context.targetUserId,
            duration: 0
        }, options)
        return {
            message: `已解除 ${displayMember(context.targetMember)} 的禁言。`,
            data: { groupId: context.groupId, targetUserId: context.targetUserId, duration: 0 }
        }
    }

    async kickMember({ groupId, targetUserId, rejectAddRequest = false }, options = {}) {
        const context = await this.buildModerationContext({ groupId, targetUserId, actor: options.actor }, options)
        this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'kick' })
        await this.callAction('set_group_kick', {
            group_id: context.groupId,
            user_id: context.targetUserId,
            reject_add_request: Boolean(rejectAddRequest)
        }, options)
        return {
            message: `已将 ${displayMember(context.targetMember)} 移出本群。`,
            data: { groupId: context.groupId, targetUserId: context.targetUserId, rejectAddRequest: Boolean(rejectAddRequest) }
        }
    }

    async setMemberCard({ groupId, targetUserId, card }, options = {}) {
        const safeCard = compactText(card, 60)
        const context = await this.buildModerationContext({ groupId, targetUserId, actor: options.actor }, options)
        this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'set_card' })
        await this.callAction('set_group_card', {
            group_id: context.groupId,
            user_id: context.targetUserId,
            card: safeCard
        }, options)
        return {
            message: safeCard
                ? `已将 ${displayMember(context.targetMember)} 的群名片改为「${safeCard}」。`
                : `已清空 ${displayMember(context.targetMember)} 的群名片。`,
            data: { groupId: context.groupId, targetUserId: context.targetUserId, card: safeCard }
        }
    }

    async setWholeBan({ groupId, enabled }, options = {}) {
        const context = await this.assertActorCanManageGroup(groupId, options)
        await this.callAction('set_group_whole_ban', {
            group_id: context.groupId,
            enable: Boolean(enabled)
        }, options)
        return {
            message: `已${enabled ? '开启' : '关闭'}群 ${context.groupId} 的全员禁言。`,
            data: { groupId: context.groupId, enabled: Boolean(enabled) }
        }
    }

    async assertMessageInGroup({ groupId, messageId }, options = {}) {
        const safeGroupId = normalizeGroupId(groupId)
        const messageInfo = await this.getMessageInfo({ messageId }, options)
        if (!messageInfo.groupId) throw new Error('message_group_unavailable')
        if (messageInfo.groupId !== safeGroupId) throw new Error('message_cross_group_denied')
        return messageInfo
    }

    async setEssenceMessage({ groupId, messageId }, options = {}) {
        await this.assertActorCanManageGroup(groupId, options)
        await this.assertMessageInGroup({ groupId, messageId }, options)
        await this.callAction('set_essence_msg', { message_id: String(messageId).trim() }, options)
        return {
            message: `已将消息 ${messageId} 设置为群精华。`,
            data: { groupId: normalizeGroupId(groupId), messageId: String(messageId).trim() }
        }
    }

    async deleteEssenceMessage({ groupId, messageId }, options = {}) {
        await this.assertActorCanManageGroup(groupId, options)
        await this.assertMessageInGroup({ groupId, messageId }, options)
        await this.callAction('delete_essence_msg', { message_id: String(messageId).trim() }, options)
        return {
            message: `已将消息 ${messageId} 移出群精华。`,
            data: { groupId: normalizeGroupId(groupId), messageId: String(messageId).trim() }
        }
    }

    async sendGroupNotice({
        groupId,
        content,
        image = '',
        pinned = false,
        type = 1,
        confirmRequired = true,
        isShowEditCard = false,
        tipWindowType = 0
    }, options = {}) {
        const context = await this.assertActorCanManageGroup(groupId, options)
        const safeContent = normalizeNoticeContent(content)
        const safeImage = normalizeNoticeImage(image)
        const params = {
            group_id: context.groupId,
            content: safeContent,
            pinned: boolToNapcatFlag(pinned),
            type: Math.trunc(Number(type) || 1),
            confirm_required: boolToNapcatFlag(confirmRequired),
            is_show_edit_card: boolToNapcatFlag(isShowEditCard),
            tip_window_type: Math.trunc(Number(tipWindowType) || 0)
        }
        if (safeImage) params.image = safeImage
        await this.callAction('_send_group_notice', params, options)
        return {
            message: `已发布群 ${context.groupId} 的群公告。`,
            data: { groupId: context.groupId, content: safeContent, image: safeImage, pinned: Boolean(pinned) }
        }
    }

    async deleteGroupNotice({ groupId, noticeId }, options = {}) {
        const context = await this.assertActorCanManageGroup(groupId, options)
        const safeNoticeId = normalizeNoticeId(noticeId)
        await this.callAction('_del_group_notice', {
            group_id: context.groupId,
            notice_id: safeNoticeId
        }, options)
        return {
            message: `已删除群 ${context.groupId} 的群公告 ${safeNoticeId}。`,
            data: { groupId: context.groupId, noticeId: safeNoticeId }
        }
    }

    async replaceGroupNotice(args = {}, options = {}) {
        normalizeNoticeId(args.noticeId)
        normalizeNoticeContent(args.content)
        const deleteResult = await this.deleteGroupNotice(args, options)
        const sendResult = await this.sendGroupNotice(args, options)
        return {
            message: `已替换群 ${sendResult.data.groupId} 的群公告 ${deleteResult.data.noticeId}。`,
            data: {
                groupId: sendResult.data.groupId,
                noticeId: deleteResult.data.noticeId,
                content: sendResult.data.content,
                image: sendResult.data.image,
                pinned: sendResult.data.pinned
            }
        }
    }

    async deleteMessage({ messageId }, options = {}) {
        const safeMessageId = String(messageId || '').trim()
        if (!safeMessageId) throw new Error('missing_message_id')
        if (isOfficialProvider(options)) {
            const response = await notificationService.callAction(options.ws || null, 'delete_msg', {
                message_id: safeMessageId,
                group_id: options.groupId || '',
                user_id: options.userId || ''
            }, 'QqGroupAdmin', options.timeoutMs || 10000)
            return {
                message: `已请求撤回消息 ${safeMessageId}。`,
                data: {
                    messageId: safeMessageId,
                    officialMessageId: response?.data?.official_message_id || ''
                }
            }
        }
        const groupId = options.groupId ? normalizeGroupId(options.groupId) : ''
        if (groupId) {
            const selfId = getSelfId(options)
            const messageInfo = await this.getMessageInfo({ messageId: safeMessageId }, options)
            if (!messageInfo.groupId) throw new Error('message_group_unavailable')
            if (messageInfo.groupId !== groupId) throw new Error('message_cross_group_denied')
            const resolvedTargetUserId = normalizeId(messageInfo.userId)
            if (!resolvedTargetUserId) throw new Error('message_sender_unavailable')
            if (resolvedTargetUserId && resolvedTargetUserId !== selfId) {
                const context = await this.buildModerationContext({ groupId, targetUserId: resolvedTargetUserId, actor: options.actor }, options)
                this.assertActorCanManageTarget({ actor: options.actor, actorMember: context.actorMember, botMember: context.botMember, targetMember: context.targetMember, action: 'delete_message' })
            } else {
                await this.assertBotCanManage(groupId, options)
            }
        }
        await this.callAction('delete_msg', { message_id: safeMessageId }, options)
        return {
            message: `已撤回消息 ${safeMessageId}。`,
            data: { messageId: safeMessageId }
        }
    }
}

module.exports = new QqGroupAdminService()
module.exports._private = {
    normalizeRole,
    roleLevel,
    isManagerRole,
    normalizeMember,
    normalizeGroup,
    normalizeMessage
}
