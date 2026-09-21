const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const config = require('../config');
const linkService = require('../services/link');
const commandManager = require('../commands');
const imageGenerator = require('../services/imageGenerator'); // Used in handleGroupIncrease
const requestApprovalService = require('../services/requestApprovalService');
const { CAPABILITIES, hasCapability } = require('../providers/qq/capabilities');
const { isQqTransportReady } = require('../providers/qq/readiness');
const { botOperationRegistry } = require('../services/runtime/botOperationRegistry');

// 表情 ID 常量（NapCat set_msg_emoji_like）
// NapCat 规则：emoji_id.length > 3 自动使用 emoji_type=2（Unicode 表情），否则为 QQ 系统表情
// Unicode 表情传十进制码点字符串即可
const LINK_EMOJI = {
    THINKING: '128074',  // 👊 拳头 —— 链接处理开始
    OK:       '128076',  // 👌 好的 —— 全部链接处理成功
    CRYING:   '10060',   // ❌ 错误 —— 至少一个链接处理失败
    SHUSH:    '128164',  // 💤 睡觉 —— 全部链接在冷却期，跳过
}

// @bot 兜底提示：@ 了 bot 但既非命令也非链接时的回复
const AT_FALLBACK_HINT = '在的～发送 /菜单 查看全部功能，或直接发送 B站链接 自动解析预览。'
const AT_FALLBACK_COOLDOWN_MS = 60000
const atFallbackLastSentAt = new Map()

function parsePositiveInteger(value, fallback) {
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const processedMessageIds = new Map()

function getMessageDedupConfig() {
    const current = config.get?.('messageDedup') || {}
    return {
        enabled: current.enabled !== false,
        ttlMs: parsePositiveInteger(current.ttlMs, 120000),
        maxEntries: parsePositiveInteger(current.maxEntries, 50000)
    }
}

function markMessageIfNew(dedupKey, now = Date.now()) {
    const dedup = getMessageDedupConfig()
    if (!dedup.enabled) return true
    for (const [key, timestamp] of processedMessageIds) {
        if (now - timestamp <= dedup.ttlMs) break
        processedMessageIds.delete(key)
    }

    if (processedMessageIds.has(dedupKey)) {
        return false
    }

    processedMessageIds.set(dedupKey, now)
    if (processedMessageIds.size > dedup.maxEntries) {
        const oldestKey = processedMessageIds.keys().next().value
        if (oldestKey !== undefined) {
            processedMessageIds.delete(oldestKey)
        }
    }
    return true
}

function buildMessageDedupKey(messageData, groupId, userId, messageId) {
    const official = messageData?.official || null
    if (official) {
        const eventId = String(official.eventId || '').trim()
        if (eventId) return `official:event:${eventId}`
        const msgId = String(official.msgId || messageId || '').trim()
        const msgSeq = official.msgSeq !== undefined && official.msgSeq !== null ? String(official.msgSeq) : ''
        const targetId = String(official.groupOpenId || official.userOpenId || groupId || '').trim()
        if (msgId || msgSeq) return `official:message:${targetId}:${msgId}:${msgSeq}:${userId || 'unknown'}`
    }
    const scopeId = groupId || `private_${userId || 'unknown'}`
    return `${scopeId}:${userId || 'unknown'}:${messageId}`
}

function buildSendContextFromMessage(messageData = {}) {
    const official = messageData.official || null
    if (!official) return {}
    return {
        official: {
            msg_id: official.msgId || messageData.message_id || '',
            event_id: official.eventId || '',
            msg_seq: official.msgSeq ?? null
        }
    }
}

function uniqueActorIds(ids = []) {
    const result = []
    for (const id of ids) {
        const value = String(id || '').trim()
        if (value && !result.includes(value)) result.push(value)
    }
    return result
}

function getActorAuthIds(messageData = {}, fallbackUserId = '') {
    const official = messageData.official || {}
    return uniqueActorIds([
        fallbackUserId,
        official.memberOpenId,
        official.userOpenId,
        messageData.sender?.user_id,
        messageData.sender?.userId
    ])
}

function isAnyRootAdmin(actorIds) {
    return actorIds.some((id) => config.isRootAdmin(id))
}

function isAnyGroupAdmin(groupId, actorIds) {
    return actorIds.some((id) => config.isGroupAdmin(groupId, id))
}

function isAnyListed(list, actorIds) {
    const normalized = Array.isArray(list) ? list.map((item) => String(item)) : []
    return actorIds.some((id) => normalized.includes(String(id)))
}

function pickPermissionUserId(groupId, actorIds, fallbackUserId) {
    return actorIds.find((id) => config.isRootAdmin(id)) ||
        actorIds.find((id) => groupId && config.isGroupAdmin(groupId, id)) ||
        fallbackUserId
}

class MessageHandler {
    /**
     * Send a private message to a user
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} userId - User ID
     * @param {string} message - Message text
     */
    sendPrivateMessage(ws, userId, message) {
        if (!isQqTransportReady(ws)) {
            logger.logEvent('warn', 'BOT', '', 'send-private-skipped', {
                userId,
                reason: 'transport_not_ready'
            });
            return;
        }

        notificationService.sendPrivateMessage(ws, userId, [{ type: 'text', data: { text: message } }], 'MessageHandler', true);
    }

    sendEmojiReaction(ws, messageId, emojiId, set = true) {
        if (ws && !hasCapability(ws, CAPABILITIES.emojiReaction) && String(ws.id || '').toLowerCase() === 'official') {
            logger.logEvent('debug', 'BOT', '', 'emoji-reaction-skipped', {
                messageId,
                emojiId,
                reason: 'unsupported_provider'
            })
            return
        }
        if (!isQqTransportReady(ws)) {
            logger.logEvent('warn', 'BOT', '', 'emoji-reaction-skipped', {
                messageId,
                emojiId,
                reason: 'transport_not_ready'
            })
            return
        }
        if (!messageId) {
            logger.logEvent('debug', 'BOT', '', 'emoji-reaction-skipped', {
                emojiId,
                reason: 'missing_message_id'
            })
            return
        }
        try {
            ws.send(JSON.stringify({
                action: 'set_msg_emoji_like',
                params: {
                    message_id: messageId,
                    emoji_id: String(emojiId),
                    set: set
                }
            }))
        } catch (e) {
            logger.logEvent('warn', 'BOT', '', 'emoji-reaction-failed', {
                messageId,
                emojiId,
                error: logger.getErrorMessage(e)
            })
        }
    }

    async handleMessage(ws, messageData) {
        const run = () => notificationService.runWithSendContext(
            buildSendContextFromMessage(messageData),
            () => this._handleMessage(ws, messageData)
        )
        if (botOperationRegistry.getContext()) return run()
        return botOperationRegistry.runBotOperation('message', run, { transport: ws })
    }

    async _handleMessage(ws, messageData) {
        const message = messageData.message;
        const messageSegments = Array.isArray(message) ? message : [];
        let rawMessage = String(messageData.raw_message || '');
        // 去掉开头的 @bot 前缀（NapCat CQ at 段；官方端已在 eventMapper 剥离），
        // 让 "@bot /命令" 与直接发 "/命令" 等价
        rawMessage = this.stripLeadingSelfAtPrefix(messageData, rawMessage);
        const userId = messageData.user_id ? String(messageData.user_id) : null;
        const actorAuthIds = getActorAuthIds(messageData, userId);
        let groupId = messageData.group_id ? String(messageData.group_id) : null;
        const messageId = messageData.message_id != null ? String(messageData.message_id) : '';

        // Prevent self-trigger
        if (userId === String(messageData.self_id)) {
            return;
        }

        // Private chat permission check
        if (messageData.message_type === 'private') {
            const isRootAdmin = isAnyRootAdmin(actorAuthIds);

            if (!isRootAdmin) {
                // Non-root admin: reject with message
                this.sendPrivateMessage(ws, userId, '此功能仅限管理员使用');
                logger.logEvent('info', 'BOT', logger.createMessageScope(`private_${userId || 'unknown'}`, userId || 'unknown', messageId || Date.now()), 'private-rejected', {
                    userId,
                    reason: 'non_root_admin'
                });
                return;
            }

            // Root admin: allow and use virtual groupId
            groupId = `private_${userId}`;
            logger.logEvent('info', 'BOT', logger.createMessageScope(groupId, userId || 'unknown', messageId || Date.now()), 'private-routed', {
                userId,
                virtualGroupId: groupId
            });

            // 审批拦截：Root Admin 私聊回复“是/否”优先处理好友/群申请
            const consumedByApproval = await requestApprovalService.tryHandleAdminDecision(ws, messageData);
            if (consumedByApproval) {
                return;
            }
        }

        const traceContext = {
            scope: messageData.traceContext?.scope || logger.createMessageScope(groupId || 'unknown', userId || 'unknown', messageId || Date.now()),
            receivedLogged: Boolean(messageData.traceContext?.receivedLogged)
        };

        if (messageId || messageData.official) {
            const dedupKey = buildMessageDedupKey(messageData, groupId, userId, messageId)
            if (!markMessageIfNew(dedupKey)) {
                logger.logEvent('info', 'BOT', traceContext.scope, 'duplicate-ignored', {
                    dedupKey
                })
                return
            }
        }

        if (!traceContext.receivedLogged) {
            logger.logEvent('info', 'BOT', traceContext.scope, 'recv', {
                groupId,
                userId,
                messageType: messageData.message_type,
                eventType: messageData.official?.eventType || '',
                preview: rawMessage.substring(0, 100)
            });
        }

        // Auto-create group configuration if not exists (skip for private messages)
        const isPrivateMsg = typeof groupId === 'string' && groupId.startsWith('private_');
        if (groupId && !isPrivateMsg) {
            await config.ensureGroupConfig(groupId);
        }

        // 检查用户是否在黑名单中 (Global + Group Isolation)
        // 1. Check Global Blacklist (System Ban)
        const userIdStr = String(userId);
        const globalBlacklist = Array.isArray(config.blacklistedQQs) ? config.blacklistedQQs : [];
        if (isAnyListed(globalBlacklist, actorAuthIds.length > 0 ? actorAuthIds : [userIdStr])) {
            logger.logEvent('info', 'BOT', traceContext.scope, 'ignored', {
                userId,
                reason: 'global_blacklist'
            });
            return;
        }
        // 2. Check Group Blacklist (Group Ban)
        if (groupId) {
             const groupConfig = config.groupConfigs[groupId];
             const groupBlacklist = Array.isArray(groupConfig?.blacklistedQQs) ? groupConfig.blacklistedQQs : [];
             if (isAnyListed(groupBlacklist, actorAuthIds.length > 0 ? actorAuthIds : [userIdStr])) {
                 logger.logEvent('info', 'BOT', traceContext.scope, 'ignored', {
                    groupId,
                    userId,
                    reason: 'group_blacklist'
                 });
                 return;
             }
        }

        // 群管自动识别：群主/管理员发言时自动授予群管理员权限（免手工配置）
        // 依据消息事件中的 sender.role（官方: author.member_role；NapCat: sender.role）
        const isPrivateBeforeRoleGrant = typeof groupId === 'string' && groupId.startsWith('private_');
        if (groupId && !isPrivateBeforeRoleGrant && userId) {
            const senderRole = String(messageData.sender?.role || '').trim().toLowerCase();
            if (senderRole === 'owner' || senderRole === 'admin') {
                try {
                    const granted = await config.addGroupAdmin(groupId, userId);
                    if (granted) {
                        logger.logEvent('info', 'BOT', traceContext.scope, 'group-admin-auto-granted', {
                            groupId,
                            userId,
                            senderRole
                        });
                    }
                } catch (e) {
                    logger.logEvent('warn', 'BOT', traceContext.scope, 'group-admin-auto-grant-failed', {
                        groupId,
                        userId,
                        error: logger.getErrorMessage(e)
                    });
                }
            }
        }

        // 检查群组是否启用
        // Skip check for private messages (virtual groups)
        const isPrivate = typeof groupId === 'string' && groupId.startsWith('private_');
        if (groupId && !isPrivate && !config.isGroupEnabled(groupId)) {
            // 特例：允许管理员重新开启功能
            const isEnableCmd = rawMessage.trim().replace(/\s+/g, ' ').startsWith('/设置 功能 开');
            
            if (isEnableCmd && (isAnyGroupAdmin(groupId, actorAuthIds) || isAnyRootAdmin(actorAuthIds))) {
                logger.logEvent('info', 'BOT', traceContext.scope, 'enable-request', {
                    groupId,
                    userId
                });
                // Continue to process the message
            } else {
                logger.logEvent('info', 'BOT', traceContext.scope, 'ignored', {
                    groupId,
                    userId,
                    reason: 'group_disabled'
                });
                return;
            }
        }

        const preparedLinks = await linkService.prepareIncomingMessageLinks({
            rawMessage,
            messageSegments,
            groupId,
            traceContext
        })
        rawMessage = preparedLinks.rawMessage

        // ========== Command Dispatch ==========
        const permissionUserId = pickPermissionUserId(groupId, actorAuthIds, userId)
        const commandContext = {
            ws,
            groupId,
            userId: permissionUserId,
            rawMessage,
            messageData,
            traceContext
        };

        if (await commandManager.dispatch(commandContext)) {
            return;
        }

        // ========== Link Processing ==========
        if (preparedLinks.descriptors.length > 0) {
            const allDescriptorsCached = preparedLinks.descriptors.every((descriptor) => linkService.isCached(descriptor.cacheKey))
            if (allDescriptorsCached) {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.SHUSH)
                return
            }

            this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING)

            const linkResult = await linkService.handleIncomingMessageLinks({
                ws,
                groupId,
                userId,
                descriptors: preparedLinks.descriptors,
                traceContext,
                messageId
            })

            this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING, false)

            if (linkResult.failureCount > 0) {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.CRYING)
            } else {
                this.sendEmojiReaction(ws, messageId, LINK_EMOJI.OK)
            }

            return
        }

        // ========== @Bot Fallback Hint ==========
        // 群里 @ 了 bot 但内容既非命令也非链接时，回复使用提示（带群级冷却防刷屏）
        if (groupId && !isPrivate && this.messageMentionsBot(messageData)) {
            const now = Date.now()
            const lastSentAt = atFallbackLastSentAt.get(groupId) || 0
            if (now - lastSentAt >= AT_FALLBACK_COOLDOWN_MS) {
                atFallbackLastSentAt.set(groupId, now)
                logger.logEvent('info', 'BOT', traceContext.scope, 'at-fallback-hint-sent', {
                    groupId,
                    userId
                })
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: AT_FALLBACK_HINT } }], userId)
            }
        }
    }

    stripLeadingSelfAtPrefix(messageData = {}, rawMessage = '') {
        const selfId = String(messageData.self_id || '')
        if (!selfId || !rawMessage) return rawMessage
        const segments = Array.isArray(messageData.message) ? messageData.message : []
        const first = segments[0]
        if (first?.type !== 'at' || String(first.data?.qq || '') !== selfId) return rawMessage
        const restText = segments.slice(1)
            .filter((segment) => segment?.type === 'text')
            .map((segment) => segment.data?.text || '')
            .join('')
        const trimmed = restText.trim()
        // 只有 @bot 没有后续文本时保留原始内容（走兜底提示）
        return trimmed || rawMessage
    }

    messageMentionsBot(messageData = {}) {
        if (messageData.official?.mentionedSelf) return true
        const selfId = String(messageData.self_id || '')
        if (!selfId) return false
        const segments = Array.isArray(messageData.message) ? messageData.message : []
        return segments.some((segment) =>
            segment?.type === 'at' && String(segment.data?.qq || '') === selfId
        )
    }

    // 将base64图片保存为临时文件并返回文件路径
    saveImageAsFile(base64Data) {
        return notificationService.saveImageAsFile(base64Data, 'MessageHandler');
    }

    // 清理文本,移除可能导致编码问题的字符
    cleanText(text) {
        return notificationService.cleanText(text);
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'MessageHandler', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'MessageHandler', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'MessageHandler', true);
        } else {
            logger.logEvent('warn', 'BOT', '', 'send-message-skipped', {
                reason: 'missing_target'
            });
        }
    }

    async sendGroupMessageWithResponse(ws, groupId, messageChain, userId = null) {
        const safeMessageChain = notificationService.processMessageChain(messageChain, 'MessageHandler', { transport: ws });

        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            if (!realUserId) {
                return null;
            }
            return notificationService.callAction(ws, 'send_private_msg', {
                user_id: realUserId,
                message: safeMessageChain
            }, 'MessageHandler', 10000);
        }

        if (groupId) {
            return notificationService.callAction(ws, 'send_group_msg', {
                group_id: groupId,
                message: safeMessageChain
            }, 'MessageHandler', 10000);
        }

        if (userId) {
            return notificationService.callAction(ws, 'send_private_msg', {
                user_id: userId,
                message: safeMessageChain
            }, 'MessageHandler', 10000);
        }

        return null;
    }

    async handleGroupIncrease(ws, payload) {
        if (!botOperationRegistry.getContext()) {
            return botOperationRegistry.runBotOperation(
                'group-increase',
                () => this.handleGroupIncrease(ws, payload),
                { transport: ws }
            )
        }
        const { group_id, user_id, self_id } = payload;
        
        // Only respond if the bot itself joined
        if (user_id === self_id) {
            logger.logEvent('info', 'BOT', logger.createScope('svc', 'lifecycle'), 'group-greeting-start', {
                groupId: group_id
            });
            
            // 1. Send text greeting
            const greeting = "大家好！我是 Bilibili 助手 Bot。发送 B 站链接即可自动解析预览，发送 /菜单 查看更多功能。";
            this.sendGroupMessage(ws, group_id, [{ type: 'text', data: { text: greeting } }]);
            
            // 2. Send help menu
            try {
                const base64Image = await imageGenerator.generateHelpCard('user', group_id);
                this.sendGroupMessage(ws, group_id, [
                    { type: 'image', data: { file: `base64://${base64Image}` } }
                ]);
            } catch (e) {
                logger.logEvent('error', 'BOT', logger.createScope('svc', 'lifecycle'), 'group-greeting-card-failed', {
                    groupId: group_id,
                    error: logger.getErrorMessage(e)
                });
            }
        }
    }
}

module.exports = new MessageHandler();
module.exports._markMessageIfNew = markMessageIfNew
module.exports._processedMessageIds = processedMessageIds
module.exports._buildMessageDedupKey = buildMessageDedupKey
module.exports._atFallbackLastSentAt = atFallbackLastSentAt
