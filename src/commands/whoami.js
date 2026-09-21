const config = require('../config');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');

function commandLog(level, message, fields = {}) {
    logger.logEvent(level, 'BOT', 'cmd:whoami', message, fields);
}

function buildIdentityLines(context) {
    const { groupId, userId, messageData } = context;
    const official = messageData?.official || {};
    const senderRole = String(messageData?.sender?.role || '').trim();
    const isPrivateGroup = typeof groupId === 'string' && groupId.startsWith('private_');

    const lines = [];
    lines.push('【身份信息】');
    lines.push(`用户ID: ${userId || '(未知)'}`);
    const senderNickname = String(messageData?.sender?.nickname || '').trim();
    if (senderNickname) {
        lines.push(`昵称: ${senderNickname}`);
    }
    if (isPrivateGroup) {
        lines.push('场景: 私聊');
    } else if (groupId) {
        lines.push(`群ID: ${groupId}`);
    }
    if (senderRole) {
        const roleText = { owner: '群主', admin: '管理员', member: '成员' }[senderRole] || senderRole;
        lines.push(`群内角色: ${roleText}`);
    }

    const hasOfficialIds = Boolean(official.memberOpenId || official.userOpenId || official.groupOpenId);
    if (hasOfficialIds) {
        lines.push('官方OpenID:');
        if (official.memberOpenId) lines.push(`- member_openid: ${official.memberOpenId}`);
        if (official.userOpenId) lines.push(`- user_openid: ${official.userOpenId}`);
        if (official.groupOpenId) lines.push(`- group_openid: ${official.groupOpenId}`);
    }

    const permissionParts = [];
    if (config.isRootAdmin(userId)) permissionParts.push('全局管理员');
    if (!isPrivateGroup && groupId && config.isGroupAdmin(groupId, userId)) permissionParts.push('群管理员');
    lines.push(`权限: ${permissionParts.length > 0 ? permissionParts.join('、') : '普通用户'}`);

    if (hasOfficialIds) {
        lines.push('提示: 将 openid 填入 QQ_OFFICIAL_ROOT_OPENIDS 可设为全局管理员。');
    }
    return lines;
}

class WhoamiCommand {
    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;
        const trimmed = String(rawMessage || '').trim();
        if (!['/whoami', '/我的id', '/我的ID', '/openid'].includes(trimmed)) {
            return false;
        }

        try {
            const lines = buildIdentityLines(context);
            this.sendGroupMessage(ws, groupId, userId, [{ type: 'text', data: { text: lines.join('\n') } }]);
        } catch (e) {
            commandLog('error', 'whoami-failed', {
                error: logger.getErrorMessage(e),
                groupId,
                userId
            });
        }
        return true;
    }

    sendGroupMessage(ws, groupId, userId, messageChain) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'WhoamiCommand', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'WhoamiCommand', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'WhoamiCommand', true);
        } else {
            commandLog('warn', 'send-skipped', {
                reason: 'missing_target'
            });
        }
    }
}

module.exports = new WhoamiCommand();
module.exports._buildIdentityLines = buildIdentityLines;
