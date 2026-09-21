function normalizeContent(content) {
    return String(content || '').replace(/\r\n/g, '\n')
}

function stripLeadingBotMention(content, selfId = '', options = {}) {
    let text = normalizeContent(content)
    const original = text
    const escapedSelfId = String(selfId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (escapedSelfId) {
        text = text.replace(new RegExp(`^[\\s\\u200B]*<@!?${escapedSelfId}>[\\s\\u200B]*`, 'i'), '')
        if (text === original) {
            text = text.replace(new RegExp(`^[\\s\\u200B]*@${escapedSelfId}[\\s\\u200B]+`, 'i'), '')
        }
    }
    if (!options.onlySelf) {
        text = text.replace(/^\s*(?:<@!?[^>]+>|@[^\s]+\s*)\s*/, '')
    }
    return {
        content: text || original,
        mentionedSelf: text !== original
    }
}

function resolveMentionsBot(data = {}, selfId = '') {
    const mentions = Array.isArray(data.mentions) ? data.mentions : []
    return mentions.some((mention) =>
        mention?.bot === true || (selfId && String(mention?.id || '') === String(selfId))
    )
}

function stripLeadingMentionForIds(content, ids = []) {
    let text = content
    for (const id of ids) {
        const escaped = String(id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (!escaped) continue
        const byTag = text.replace(new RegExp(`^[\\s\\u200B]*<@!?${escaped}>[\\s\\u200B]*`, 'i'), '')
        if (byTag !== text) {
            text = byTag
            break
        }
        const byText = text.replace(new RegExp(`^[\\s\\u200B]*@${escaped}[\\s\\u200B]+`, 'i'), '')
        if (byText !== text) {
            text = byText
            break
        }
    }
    return text
}

function normalizeMessageContent(data = {}, eventType = '', selfId = '') {
    const content = normalizeContent(data.content)
    if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
        return stripLeadingBotMention(content, selfId)
    }
    if (eventType === 'GROUP_MESSAGE_CREATE') {
        // 全量模式下平台不保证去除@机器人前缀，且占位符用的是机器人的
        // member_openid（<@openid> 无感叹号）而非 appid，需结合 mentions 数组判断：
        // 只剥离 mentions 中 bot=true（或 id===selfId）条目对应的前缀，避免误剥他人
        const mentions = Array.isArray(data.mentions) ? data.mentions : []
        const mentionedSelf = resolveMentionsBot(data, selfId)
        const botMentionIds = [...new Set([
            ...mentions.filter((mention) => mention?.bot === true).map((mention) => String(mention?.id || '')),
            String(selfId || '')
        ].filter(Boolean))]
        const stripped = stripLeadingMentionForIds(content, botMentionIds)
        if (stripped !== content) {
            return { content: stripped, mentionedSelf: true }
        }
        if (!mentionedSelf) {
            return { content, mentionedSelf: false }
        }
        // mentions 表明 @ 了 bot，但 content 是 @昵称 文本格式：剥离去首个@ token
        const withoutNickname = content.replace(/^@[^\s]+\s*/, '')
        if (withoutNickname && withoutNickname !== content) {
            return { content: withoutNickname, mentionedSelf: true }
        }
        return { content, mentionedSelf: true }
    }
    return { content, mentionedSelf: false }
}

function buildMessageSegments(data = {}, options = {}) {
    const segments = []
    if (options.mentionedSelf) {
        segments.push({ type: 'at', data: { qq: String(options.selfId || 'all') } })
    }
    const content = normalizeContent(options.content !== undefined ? options.content : data.content)
    if (content) {
        segments.push({ type: 'text', data: { text: content } })
    }
    const attachments = Array.isArray(data.attachments) ? data.attachments : []
    for (const item of attachments) {
        const url = item.url || item.file_url || item.fileUrl
        const contentType = String(item.content_type || item.contentType || '').toLowerCase()
        if (!url) continue
        if (contentType.startsWith('image/')) {
            segments.push({ type: 'image', data: { file: url, url } })
        } else if (contentType.startsWith('video/')) {
            segments.push({ type: 'video', data: { file: url, url } })
        }
    }
    return segments
}

function resolveUserOpenId(data = {}) {
    return data.author?.user_openid ||
        data.author?.openid ||
        data.user_openid ||
        data.openid ||
        ''
}

function resolveMemberOpenId(data = {}) {
    return data.author?.member_openid ||
        data.member_openid ||
        data.member?.member_openid ||
        data.memberOpenid ||
        data.memberOpenId ||
        ''
}

function resolveGroupOpenId(data = {}) {
    return data.group_openid || data.group_id || data.groupOpenid || data.groupOpenId || ''
}

function mapMessageEvent(event) {
    const data = event.d || {}
    const type = event.t || ''
    const groupOpenId = resolveGroupOpenId(data)
    const userOpenId = resolveUserOpenId(data)
    const memberOpenId = resolveMemberOpenId(data)
    const messageId = String(data.id || data.msg_id || data.message_id || event.id || '')
    const normalizedContent = normalizeMessageContent(data, type, event.selfId || '')
    const rawMessage = normalizedContent.content
    const messageType = type === 'C2C_MESSAGE_CREATE' ? 'private' : 'group'
    const actorOpenId = messageType === 'private' ? userOpenId : (memberOpenId || userOpenId)
    const payload = {
        post_type: 'message',
        message_type: messageType,
        sub_type: 'normal',
        time: data.timestamp ? Math.floor(new Date(data.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
        self_id: event.selfId || '',
        user_id: actorOpenId,
        group_id: messageType === 'group' ? groupOpenId : undefined,
        message_id: messageId,
        raw_message: rawMessage,
        message: buildMessageSegments(data, {
            content: rawMessage,
            mentionedSelf: normalizedContent.mentionedSelf || type === 'GROUP_AT_MESSAGE_CREATE',
            selfId: event.selfId || ''
        }),
        sender: {
            user_id: actorOpenId,
            nickname: data.author?.nickname || data.author?.member_name || '',
            card: data.author?.member_name || '',
            role: data.member?.role || data.author?.member_role || data.author?.role || 'member'
        },
        official: {
            eventId: event.id || data.event_id || '',
            eventType: type,
            msgId: messageId,
            msgSeq: data.msg_seq ?? null,
            groupOpenId,
            memberOpenId,
            userOpenId,
            mentionedSelf: normalizedContent.mentionedSelf || type === 'GROUP_AT_MESSAGE_CREATE',
            raw: data
        }
    }
    return payload
}

function mapGroupRobotEvent(event, noticeType) {
    const data = event.d || {}
    const groupOpenId = resolveGroupOpenId(data)
    return {
        post_type: 'notice',
        notice_type: noticeType,
        sub_type: noticeType === 'group_decrease' ? 'kick_me' : 'approve',
        self_id: event.selfId || '',
        group_id: groupOpenId,
        user_id: event.selfId || '',
        operator_id: '',
        time: Math.floor(Date.now() / 1000),
        official: {
            eventId: event.id || '',
            eventType: event.t || '',
            groupOpenId,
            raw: data
        }
    }
}

function mapReachabilityEvent(event, reachable) {
    const data = event.d || {}
    const groupOpenId = resolveGroupOpenId(data)
    return {
        post_type: 'notice',
        notice_type: 'group_reachability',
        group_id: groupOpenId,
        self_id: event.selfId || '',
        reachable,
        reason: reachable ? 'GROUP_MSG_RECEIVE' : 'GROUP_MSG_REJECT',
        time: Math.floor(Date.now() / 1000),
        official: {
            eventId: event.id || '',
            eventType: event.t || '',
            groupOpenId,
            raw: data
        }
    }
}

function mapOfficialEvent(event, options = {}) {
    const normalized = {
        ...event,
        selfId: options.selfId || event.selfId || ''
    }
    const type = normalized.t || ''
    if (['C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE'].includes(type)) {
        return mapMessageEvent(normalized)
    }
    if (type === 'GROUP_ADD_ROBOT') return mapGroupRobotEvent(normalized, 'group_increase')
    if (type === 'GROUP_DEL_ROBOT') return mapGroupRobotEvent(normalized, 'group_decrease')
    if (type === 'GROUP_MSG_RECEIVE') return mapReachabilityEvent(normalized, true)
    if (type === 'GROUP_MSG_REJECT') return mapReachabilityEvent(normalized, false)
    return null
}

module.exports = {
    mapOfficialEvent,
    buildMessageSegments,
    normalizeMessageContent,
    stripLeadingBotMention,
    resolveUserOpenId,
    resolveMemberOpenId,
    resolveGroupOpenId
}
