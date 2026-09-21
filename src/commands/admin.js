const config = require('../config');
const logger = require('../utils/logger');
const subscriptionService = require('../services/subscriptionService');
const notificationService = require('../services/notificationService');

function commandLog(level, message, fields = {}) {
    logger.logEvent(level, 'BOT', 'cmd:admin', message, fields);
}

class AdminCommand {
    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;
        const isPrivateGroup = typeof groupId === 'string' && groupId.startsWith('private_');

        // 12. 管理 (/管理 <群列表|清理> [群号])
        if (rawMessage.startsWith('/管理 ') || rawMessage.startsWith('/admin ')) {
            if (isPrivateGroup) {
                this.sendGroupMessage(ws, groupId, [{
                    type: 'text',
                    data: { text: '私聊仅支持链接解析/下载，不支持群配置与订阅管理。请在目标群聊或 WebUI 操作。' }
                }]);
                return true;
            }
            if (!config.isRootAdmin(userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                return true;
            }
            const parts = rawMessage.trim().split(/\s+/);
            const subCommand = parts[1];

            if (subCommand === '群列表' || subCommand === 'list') {
                 // Ensure subscriptions are loaded before accessing
                 await subscriptionService.ensureLoaded();

                 // Gather stats
                 const stats = new Map(); // groupId -> { hasConfig, hasSubs, hasBlacklist }

                 // 1. Check Configs
                 if (config.groupConfigs) {
                     Object.keys(config.groupConfigs).forEach(gid => {
                         const strGid = gid.toString();
                         if (!stats.has(strGid)) stats.set(strGid, { hasConfig: false, hasSubs: false, hasBlacklist: false });
                         const c = config.groupConfigs[gid];
                         if (c) {
                             stats.get(strGid).hasConfig = true;
                             if (c.blacklistedQQs && c.blacklistedQQs.length > 0) {
                                 stats.get(strGid).hasBlacklist = true;
                             }
                         }
                     });
                 }

                 // 2. Check Subscriptions
                 const allSubs = subscriptionService.userSubs.concat(subscriptionService.bangumiSubs || []);
                 allSubs.forEach(sub => {
                     sub.groupIds.forEach(gid => {
                          const strGid = gid.toString();
                          if (!stats.has(strGid)) stats.set(strGid, { hasConfig: false, hasSubs: false, hasBlacklist: false });
                          stats.get(strGid).hasSubs = true;
                     });
                 });

                 let msg = '【Bot群组状态】\n群号 | 订阅 | 配置 | 黑名单\n';

                 // 官方 provider：尽量把 openid 解析成群名称，并补充群主/管理员信息
                 let officialProvider = null;
                 try {
                     const runtime = require('../providers/qq/runtime');
                     const provider = runtime.getCurrentProvider();
                     if (provider && String(provider.id) === 'official' &&
                         typeof provider.refreshGroupInfo === 'function') {
                         officialProvider = provider;
                     }
                 } catch (e) {
                     officialProvider = null;
                 }

                 for (const [key, val] of stats.entries()) {
                     let displayId = key;
                     let rosterLine = '';
                     if (officialProvider) {
                         try {
                             await officialProvider.refreshGroupInfo(key);
                             const displayName = officialProvider.resolveGroupDisplayName(key);
                             if (displayName) displayId = `${displayName} (${key.slice(0, 8)}…)`;
                             const roster = officialProvider.getGroupRoster(key);
                             const rosterParts = [];
                             if (roster.ownerNickname) rosterParts.push(`群主: ${roster.ownerNickname}`);
                             if (roster.adminNicknames && roster.adminNicknames.length > 0) {
                                 rosterParts.push(`管理员: ${roster.adminNicknames.slice(0, 5).join('、')}`);
                             }
                             rosterParts.push(`观测成员: ${roster.memberCount}`);
                             if (rosterParts.length > 0) rosterLine = `   └ ${rosterParts.join(' · ')}`;
                         } catch (e) {
                             commandLog('warn', 'group-list-display-failed', { groupId: key, error: logger.getErrorMessage(e) });
                         }
                     }
                     msg += `${displayId} | ${val.hasSubs?'√':'x'} | ${val.hasConfig?'√':'x'} | ${val.hasBlacklist?'√':'x'}\n`;
                     if (rosterLine) msg += `${rosterLine}\n`;
                 }
                 
                 if (stats.size === 0) msg += '(无记录)';
                 this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: msg } }]);
                 return true;

            } else if (subCommand === '清理' || subCommand === 'clean') {
                const targetGid = parts[2];
                if (!targetGid) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定要清理的群号: /管理 清理 <群号>' } }]);
                    return true;
                }
                
                // 1. Remove Config
                let configRemoved = false;
                if (config.groupConfigs && config.groupConfigs[targetGid]) {
                    await config.mutate((draft) => {
                        if (!draft.groupConfigs[targetGid]) return false;
                        delete draft.groupConfigs[targetGid];
                        return true;
                    }, { actor: 'admin-clean-group' });
                    configRemoved = true;
                }

                // 2. Remove Subscriptions
                const subsRemoved = await subscriptionService.removeAllGroupSubscriptions(targetGid);

                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `群 ${targetGid} 清理完成。\n配置删除: ${configRemoved?'是':'否'}\n订阅移除: ${subsRemoved?'是':'否'}` } }]);
                return true;
            } else {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '未知指令。可用: /管理 <群列表|清理> [群号]' } }]);
                return true;
            }
        }

        return false;
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'AdminCommand', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'AdminCommand', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'AdminCommand', true);
        } else {
            commandLog('warn', 'send-skipped', {
                reason: 'missing_target'
            });
        }
    }
}

module.exports = new AdminCommand();
