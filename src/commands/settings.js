const config = require('../config');
const biliApi = require('../services/biliApi');
const QRCode = require('qrcode');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const subscriptionService = require('../services/subscriptionService');
const imageGenerator = require('../services/imageGenerator');

function commandLog(level, message, fields = {}) {
    logger.logEvent(level, 'BOT', 'cmd:settings', message, fields);
}

// 解析拉黑/解禁目标 ID：
// 1. 显式参数（纯 QQ 号 / openid，或 CQ at 码 [CQ:at,qq=123] / 官方占位符 <@openid>、<@!openid>）
// 2. NapCat/onebot11 消息 at 段（segment.data.qq，排除 @all）
// 3. 官方 provider 的 mentions 数组（official.raw.mentions，排除 bot 自身）
function parseAtToken(token) {
    const value = String(token || '').trim();
    if (!value) return '';
    const cq = value.match(/^\[CQ:at,qq=(\d+)\]$/);
    if (cq) return cq[1];
    const official = value.match(/^<@!?([^>\s]+)>$/);
    if (official) return official[1];
    return value;
}

function resolveBlacklistTarget(argToken, messageData = {}) {
    const selfId = String(messageData?.self_id || '').trim();
    const isSelf = (id) => selfId && String(id) === selfId;
    const fromToken = parseAtToken(argToken);
    if (fromToken && !isSelf(fromToken)) return fromToken;

    const segments = Array.isArray(messageData?.message) ? messageData.message : [];
    for (const segment of segments) {
        const qq = segment?.type === 'at' ? String(segment?.data?.qq || '') : '';
        if (/^\d+$/.test(qq) && !isSelf(qq)) return qq;
    }

    const mentions = Array.isArray(messageData?.official?.raw?.mentions)
        ? messageData.official.raw.mentions
        : [];
    for (const mention of mentions) {
        const id = String(mention?.id || '').trim();
        if (id && mention?.bot !== true && !isSelf(id)) return id;
    }

    return '';
}

function expectedGeneration() {
    return config.getStatus().documentGeneration;
}

async function setConfigPath(path, value) {
    return config.patch([{ op: 'set', path, value }], {
        actor: 'qq-command:settings',
        expectedGeneration: expectedGeneration()
    });
}

async function setGroupConfigPath(groupId, key, value) {
    return setConfigPath(['groupConfigs', String(groupId), key], value);
}

async function setGroupEnabled(groupId, enabled) {
    const target = String(groupId);
    const scope = config.getProviderScope();
    const current = [...config.getEnabledGroupsForProvider(scope)].map(String);
    if (enabled) {
        if (current.length === 0 || current.includes(target)) return true;
        const next = [...new Set([...current, target])];
        const path = scope === 'napcat' ? ['enabledGroups'] : ['providerScopedEnabledGroups', scope];
        await setConfigPath(path, next);
        return true;
    }

    let next = current.filter(id => id !== target);
    if (current.length === 0) {
        const known = new Set([
            ...Object.keys(config.groupConfigs || {}),
            ...Array.from(global.bot?.groupList?.keys?.() || []).map(String)
        ]);
        known.delete(target);
        next = [...known];
        if (next.length === 0) return false;
    }
    const path = scope === 'napcat' ? ['enabledGroups'] : ['providerScopedEnabledGroups', scope];
    await setConfigPath(path, next);
    return true;
}

class SettingsCommand {
    constructor() {
        // Login pending map: key -> true
        this.loginPending = new Map();
    }

    async pollLoginStatus(key, ws, groupId) {
        const POLL_INTERVAL = 5000; // 5 seconds
        const MAX_DURATION = 30000; // 30 seconds
        const startTime = Date.now();

        const timer = setInterval(async () => {
            // Check if key is still pending (might be manually verified or cancelled)
            if (!this.loginPending.has(key)) {
                clearInterval(timer);
                return;
            }

            // Check timeout
            if (Date.now() - startTime > MAX_DURATION) {
                clearInterval(timer);
                this.loginPending.delete(key);
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `自动登录检测超时。如果您已扫码，请手动输入: /设置 验证 ${key}` } }]);
                return;
            }

            try {
                // 统一使用全局 Cookie 登录
                const res = await biliApi.checkLogin(key, null);
                if (res.status === 'success') {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '登录成功！全局凭据已保存。' } }]);
                    this.loginPending.delete(key);
                    clearInterval(timer);
                } else if (res.code === 86038) { // QRCode Expired
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '二维码已过期，请重新获取。' } }]);
                     this.loginPending.delete(key);
                     clearInterval(timer);
                }
                // Other statuses (waiting for scan/confirm) -> continue polling
            } catch (e) {
                commandLog('error', 'login-poll-failed', {
                    error: logger.getErrorMessage(e),
                    key,
                    groupId
                });
            }
        }, POLL_INTERVAL);
    }

    async handle(context) {
        const { ws, groupId, userId, rawMessage } = context;

        // 统一指令入口：/设置
        const trimmedMessage = rawMessage.trim();
        const isPrivateGroup = typeof groupId === 'string' && groupId.startsWith('private_');
        if (trimmedMessage === '/设置' || trimmedMessage.startsWith('/设置 ')) {
            if (isPrivateGroup) {
                this.sendGroupMessage(ws, groupId, [{
                    type: 'text',
                    data: { text: '私聊仅支持链接解析/下载，不支持群配置与订阅管理。请在目标群聊或 WebUI 操作。' }
                }]);
                return true;
            }
             if (!config.isGroupAdmin(groupId, userId)) {
                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员或全局管理员使用。' } }]);
                return true;
            }

            const parts = trimmedMessage.split(/\s+/);
            const subCommand = parts[1]; // 帮助, 登录, 验证, 功能, 黑名单, 缓存, 轮询, 标签, 深色模式, etc.

            if (!subCommand) {
                 this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定设置指令。发送 /设置 帮助 查看列表。' } }]);
                 return true;
            }

            // 1. 帮助菜单 (/设置 帮助)
            if (subCommand === '帮助') {
                try {
                    const base64Image = await imageGenerator.generateHelpCard('admin', groupId);
                    this.sendGroupMessage(ws, groupId, [{ type: 'image', data: { file: `base64://${base64Image}` } }]);
                } catch (e) {
                    commandLog('error', 'admin-help-card-generate-failed', {
                        error: logger.getErrorMessage(e),
                        groupId
                    });
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: 'Admin menu generation failed.' } }]);
                }
                return true;
            }

            // New: 管理员 (/设置 管理员 <add|remove> <qq>)
            if (subCommand === '管理员') {
                if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return true;
                }
                let action = parts[2];
                const targetQQ = parts[3];

                if (action === '添加') action = 'add';
                if (action === '移除') action = 'remove';

                if (action === 'add' && targetQQ) {
                    if (await config.addGroupAdmin(groupId, targetQQ)) {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 添加为本群管理员。` } }]);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `添加失败。可能已存在。` } }]);
                    }
                } else if (action === 'remove' && targetQQ) {
                    if (await config.removeGroupAdmin(groupId, targetQQ)) {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已移除 ${targetQQ} 的本群管理员权限。` } }]);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `移除失败。可能不存在。` } }]);
                    }
                } else {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 管理员 <add|remove> <qq>' } }]);
                }
                return true;
            }

            // 2. 登录 (/设置 登录)
            if (subCommand === '登录') {
                 try {
                    const res = await biliApi.getLoginUrl();
                    if (res.status === 'success') {
                        const url = res.data.url;
                        const key = res.data.key;

                        // Store pending login
                        this.loginPending.set(key, true);

                        const qrDataUrl = res.data.image || await QRCode.toDataURL(url, {
                            errorCorrectionLevel: 'M',
                            margin: 4,
                            width: 320
                        });
                        const base64Image = qrDataUrl.replace(/^data:image\/png;base64,/, '');
                        const hint = parts[2] ? '\n提示：当前版本仅支持全局 Cookie 登录，已忽略群号参数。' : '';
                        this.sendGroupMessage(ws, groupId, [
                            { type: 'text', data: { text: `请在30秒内使用B站APP扫描登录（全局Cookie）。\n机器人将自动检测登录状态，如超时请手动输入: /设置 验证 ${key}${hint}` } },
                            { type: 'image', data: { file: `base64://${base64Image}` } }
                        ]);

                        // Start polling
                        this.pollLoginStatus(key, ws, groupId);
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '获取登录URL失败。' } }]);
                    }
                } catch (e) {
                    commandLog('error', 'login-start-failed', {
                        error: logger.getErrorMessage(e),
                        groupId
                    });
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '登录错误，请检查日志。' } }]);
                }
                return true;
            }

            // 3. 验证 (/设置 验证 <key>)
            if (subCommand === '验证') {
                const key = parts[2];
                if (!key) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请提供密钥: /设置 验证 <key>' } }]);
                    return true;
                }

                try {
                    // 统一使用全局 Cookie 登录
                    const res = await biliApi.checkLogin(key, null);
                    if (res.status === 'success') {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '登录成功！全局凭据已保存。' } }]);
                         this.loginPending.delete(key);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `登录状态: ${res.message}` } }]);
                    }
                } catch (e) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '检查登录状态时出错。' } }]);
                }
                return true;
            }

            // 4. 功能开关 (/设置 功能 <开|关> [群号])
            if (subCommand === '功能') {
                const action = parts[2];
                let targetGroupId = parts[3];

                if (!targetGroupId) {
                    targetGroupId = groupId;
                }
                if (!targetGroupId) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定群号或在群聊中使用。' } }]);
                     return true;
                }
                
                // Only Root can change other groups' config? 
                // Spec: "Root Admin... manage all group configs". "Group Admin... adjust this group config".
                // Ensure type safety when comparing IDs
                if (targetGroupId.toString() !== groupId.toString() && !config.isRootAdmin(userId)) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：您只能管理当前群组的配置。' } }]);
                    return true;
                }

                if (action === '开') {
                    await setGroupEnabled(targetGroupId, true);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已开启群 ${targetGroupId} 的Bot权限。` } }]);
                } else if (action === '关') {
                    const changed = await setGroupEnabled(targetGroupId, false);
                    this.sendGroupMessage(ws, groupId, [{
                        type: 'text',
                        data: { text: changed
                            ? `已关闭群 ${targetGroupId} 的Bot权限。`
                            : '当前没有其他已知群，无法用白名单表达“仅关闭本群”；请在 WebUI 中配置群白名单。' }
                    }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '指令格式错误。请使用：/设置 功能 <开|关> [群号]' } }]);
                }
                return true;
            }

            // 5. 黑名单 (/设置 黑名单 <add|remove|list> [qq|@目标])
            if (subCommand === '黑名单') {
                let action = parts[2];
                const targetQQ = resolveBlacklistTarget(parts[3], context.messageData);
                
                // Map Chinese actions to English
                if (action === '添加') action = 'add';
                if (action === '移除') action = 'remove';
                if (action === '列表') action = 'list';
                
                // Root -> Global, Group Admin -> Group
                const isRoot = config.isRootAdmin(userId);
                
                if (action === 'add' && targetQQ) {
                    if (isRoot) {
                        if (!config.blacklistedQQs.includes(targetQQ)) {
                            await setConfigPath(['blacklistedQQs'], [...config.blacklistedQQs, targetQQ]);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 添加到全局黑名单。` } }]);
                        } else {
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 已经在全局黑名单中。` } }]);
                        }
                    } else {
                        // Group Admin
                        if (groupId) {
                            const groupBlacklist = config.groupConfigs[groupId]?.blacklistedQQs || [];
                            if (!groupBlacklist.includes(targetQQ)) {
                                await setGroupConfigPath(groupId, 'blacklistedQQs', [...groupBlacklist, targetQQ]);
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 添加到本群黑名单。` } }]);
                            } else {
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 已经在本群黑名单中。` } }]);
                            }
                        }
                    }
                } else if (action === 'remove' && targetQQ) {
                    if (isRoot) {
                        const index = config.blacklistedQQs.indexOf(targetQQ);
                        if (index > -1) {
                            await setConfigPath(['blacklistedQQs'], config.blacklistedQQs.filter(item => item !== targetQQ));
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 移出全局黑名单。` } }]);
                        } else {
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 不在全局黑名单中。` } }]);
                        }
                    } else {
                        // Group Admin
                        if (groupId && config.groupConfigs[groupId] && config.groupConfigs[groupId].blacklistedQQs) {
                             const index = config.groupConfigs[groupId].blacklistedQQs.indexOf(targetQQ);
                             if (index > -1) {
                                await setGroupConfigPath(
                                    groupId,
                                    'blacklistedQQs',
                                    config.groupConfigs[groupId].blacklistedQQs.filter(item => item !== targetQQ)
                                );
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已将 ${targetQQ} 移出本群黑名单。` } }]);
                             } else {
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 不在本群黑名单中。` } }]);
                             }
                        } else {
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `${targetQQ} 不在本群黑名单中。` } }]);
                        }
                    }
                } else if (action === 'list') {
                    let msg = '【黑名单列表】\n';
                    
                    // Group Blacklist
                    if (groupId) {
                        const groupConfig = config.groupConfigs[groupId];
                        const groupBlacklist = (groupConfig && groupConfig.blacklistedQQs) ? groupConfig.blacklistedQQs : [];
                        msg += `\n[本群黑名单]\n${groupBlacklist.length > 0 ? groupBlacklist.join('\n') : '(空)'}\n`;
                    }

                    // Global Blacklist (Root only)
                    if (isRoot) {
                        const globalBlacklist = config.blacklistedQQs || [];
                        msg += `\n[全局黑名单]\n${globalBlacklist.length > 0 ? globalBlacklist.join('\n') : '(空)'}\n`;
                    }

                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: msg } }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 黑名单 <add|remove|list> [QQ号|OpenID]，add/remove 也可直接 at 目标' } }]);
                }
                return true;
            }

            // 6. 冷却 (/设置 冷却 <秒数>)
            if (subCommand === '冷却') {
                 const value = parseInt(parts[2]);
                 if (!isNaN(value)) {
                    if (groupId) {
                        await setGroupConfigPath(groupId, 'linkCacheTimeout', value);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群相同链接解析冷却时间已设置为 ${value} 秒。` } }]);
                    } else {
                        // Only Root can set Global
                        if (config.isRootAdmin(userId)) {
                            await setConfigPath(['cache', 'linkTtlSeconds'], value);
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局相同链接解析冷却时间已设置为 ${value} 秒。` } }]);
                        } else {
                             this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `权限不足：全局配置仅限全局管理员 (Root) 使用。` } }]);
                        }
                    }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请输入有效的秒数。' } }]);
                 }
                 return true;
            }

            // 7. 轮询 (/设置 轮询 <秒数>)
            if (subCommand === '轮询') {
                if (!config.isRootAdmin(userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限全局管理员 (Root) 使用。' } }]);
                     return true;
                }
                const value = parseInt(parts[2]);
                if (!isNaN(value) && value > 0) {
                    await setConfigPath(['subscription', 'checkIntervalSeconds'], value);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局订阅轮询间隔已设置为 ${value} 秒。` } }]);
                } else {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请输入有效的正整数秒数。' } }]);
                }
                return true;
            }

            // 8. 关注同步 (/设置 关注同步 <开|关> 或 /设置 关注同步 <添加|删除> <B站分组名>)
            if (subCommand === '关注同步') {
                const action = parts[2];
                const groupName = parts[3]; 

                if (action === '开') {
                    await setGroupConfigPath(groupId, 'enableCookieSync', true);
                    let currentGroups = config.getGroupConfig(groupId, 'cookieSyncGroupNames');
                    if (typeof currentGroups === 'string') {
                        currentGroups = currentGroups.split(',').map(item => String(item).trim()).filter(Boolean);
                    } else if (Array.isArray(currentGroups)) {
                        currentGroups = currentGroups.map(item => String(item).trim()).filter(Boolean);
                    } else {
                        currentGroups = [];
                    }
                    
                    if (currentGroups.length === 0) {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '已开启关注同步功能。当前生效分组：全部分组（不过滤）。如需按分组过滤，请使用 /设置 关注同步 添加 <分组名>。' } }]);
                    } else {
                         this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已开启关注同步功能。当前生效分组：${currentGroups.join(', ')}。` } }]);
                    }
                    // Trigger refresh
                    subscriptionService.refreshCookieFollowings();

                } else if (action === '关') {
                    await setGroupConfigPath(groupId, 'enableCookieSync', false);
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '已关闭关注同步功能。' } }]);

                } else if (action === '添加') {
                    if (!groupName) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定要添加的分组名。' } }]);
                        return true;
                    }
                    const currentNames = config.getGroupConfig(groupId, 'cookieSyncGroupNames') || [];
                    const added = !currentNames.includes(groupName);
                    if (added) {
                        await setGroupConfigPath(groupId, 'cookieSyncGroupNames', [...currentNames, groupName]);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已添加同步分组：${groupName}。` } }]);
                        // Refresh if enabled
                        if (config.getGroupConfig(groupId, 'enableCookieSync')) {
                            subscriptionService.refreshCookieFollowings();
                        }
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `分组 ${groupName} 已存在。` } }]);
                    }

                } else if (action === '删除') {
                    if (!groupName) {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请指定要删除的分组名。' } }]);
                        return true;
                    }
                    const currentNames = config.getGroupConfig(groupId, 'cookieSyncGroupNames') || [];
                    const removed = currentNames.includes(groupName);
                    if (removed) {
                        await setGroupConfigPath(groupId, 'cookieSyncGroupNames', currentNames.filter(item => item !== groupName));
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `已移除同步分组：${groupName}。` } }]);
                         // Refresh if enabled
                        if (config.getGroupConfig(groupId, 'enableCookieSync')) {
                            subscriptionService.refreshCookieFollowings();
                        }
                    } else {
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `未找到分组 ${groupName}。` } }]);
                    }

                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法:\n/设置 关注同步 <开|关>\n/设置 关注同步 <添加|删除> <B站分组名>' } }]);
                }
                return true;
            }

            // 9. 订阅推送AT全体 (/设置 推送AT全体 <开|关>)
            if (subCommand === '推送AT全体' || subCommand === '推送at全体' || subCommand === 'AT全体' || subCommand === 'at全体') {
                const switchState = parts[2];

                if (typeof groupId === 'string' && groupId.startsWith('private_')) {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '请在群聊中使用此命令。' } }]);
                    return true;
                }

                if (switchState === '开' || switchState === '关') {
                    const isEnabled = switchState === '开';
                    await setGroupConfigPath(groupId, 'subscriptionAtAll', isEnabled);
                    this.sendGroupMessage(ws, groupId, [{
                        type: 'text',
                        data: {
                            text: `本群订阅推送@全体成员已${switchState}。将对订阅与关注同步更新推送生效。细粒度规则请在 WebUI 配置。`
                        }
                    }]);
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 推送AT全体 <开|关>' } }]);
                }
                return true;
            }

            // 10. 标签 (/设置 标签 <类型> <开|关>)
            if (subCommand === '标签') {
                 const category = parts[2]; 
                 const switchState = parts[3]; 

                 const categoryMap = {
                     '视频': 'video', 'video': 'video',
                     '番剧': 'bangumi', 'bangumi': 'bangumi',
                     '专栏': 'article', 'article': 'article',
                     '直播': 'live', 'live': 'live',
                     '动态': 'dynamic', 'dynamic': 'dynamic',
                     '用户': 'user', 'user': 'user',
                     '电影': 'movie', 'movie': 'movie',
                     '电视剧': 'tv', 'tv': 'tv',
                     '国创': 'guocha', 'guocha': 'guocha',
                     '纪录片': 'doc', 'doc': 'doc',
                     '综艺': 'variety', 'variety': 'variety'
                 };
                 const key = categoryMap[category];
                 
                 if (key && (switchState === '开' || switchState === '关')) {
                     const isEnabled = (switchState === '开');
                     if (groupId) {
                        const currentLabel = config.getGroupConfig(groupId, 'labelConfig') || { ...config.labelConfig };
                        await setGroupConfigPath(groupId, 'labelConfig', { ...currentLabel, [key]: isEnabled });
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群 ${category} 标签显示已${switchState}。` } }]);
                     } else {
                        await setConfigPath(['rendering', 'labels'], { ...(config.labelConfig || {}), [key]: isEnabled });
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局 ${category} 标签显示已${switchState}。` } }]);
                     }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 标签 <视频|番剧|专栏|直播|动态|用户> <开|关>' } }]);
                 }
                 return true;
            }

            // 11. 深色模式 (/设置 深色模式 <开|关|定时>)
            if (subCommand === '深色模式') {
                const mode = parts[2];
                if (['开', '关', '定时'].includes(mode)) {
                     if (mode === '开') {
                        if (groupId) {
                            const existing = config.getGroupConfig(groupId, 'nightMode') || { ...config.nightMode };
                            await setGroupConfigPath(groupId, 'nightMode', { ...existing, mode: 'on' });
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群深色模式已强制开启。' } }]);
                        } else {
                            await setConfigPath(['rendering', 'nightMode'], { ...config.nightMode, mode: 'on' });
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '全局深色模式已强制开启。' } }]);
                        }
                    } else if (mode === '关') {
                        if (groupId) {
                            const existing = config.getGroupConfig(groupId, 'nightMode') || { ...config.nightMode };
                            await setGroupConfigPath(groupId, 'nightMode', { ...existing, mode: 'off' });
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '本群深色模式已强制关闭。' } }]);
                        } else {
                            await setConfigPath(['rendering', 'nightMode'], { ...config.nightMode, mode: 'off' });
                            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '全局深色模式已强制关闭。' } }]);
                        }
                    } else if (mode === '定时') {
                        const timeRange = parts[3];
                        if (timeRange && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(timeRange)) {
                            const [start, end] = timeRange.split('-');
                            if (groupId) {
                                await setGroupConfigPath(groupId, 'nightMode', { mode: 'timed', startTime: start, endTime: end });
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群深色模式已设置为定时开启：${start} 至 ${end}。` } }]);
                            } else {
                                await setConfigPath(['rendering', 'nightMode'], { mode: 'timed', startTime: start, endTime: end });
                                this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局深色模式已设置为定时开启：${start} 至 ${end}。` } }]);
                            }
                        } else {
                             this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '格式错误。请使用: /设置 深色模式 定时 21:30-07:30' } }]);
                        }
                    }
                } else {
                    this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 深色模式 <开|关|定时> [开始时间-结束时间]' } }]);
                }
                return true;
            }

            // 14. 显示UID (/设置 显示UID <开|关>)
            if (subCommand === '显示UID' || subCommand === 'UID') {
                 if (!config.isGroupAdmin(groupId, userId)) {
                     this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '权限不足：此命令仅限群管理员使用。' } }]);
                     return true;
                 }
                 const switchState = parts[2];
                 if (switchState === '开' || switchState === '关') {
                     const isEnabled = (switchState === '开');
                     if (groupId) {
                        await setGroupConfigPath(groupId, 'showId', isEnabled);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `本群 UID 显示已${switchState}。` } }]);
                     } else {
                        await setConfigPath(['rendering', 'showId'], isEnabled);
                        this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: `全局 UID 显示已${switchState}。` } }]);
                     }
                 } else {
                      this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '使用方法: /设置 显示UID <开|关>' } }]);
                 }
                 return true;
            }

            this.sendGroupMessage(ws, groupId, [{ type: 'text', data: { text: '未知设置指令。请发送 /设置 帮助 查看可用指令。' } }]);
            return true;
        }

        return false;
    }

    sendGroupMessage(ws, groupId, messageChain, userId = null) {
        if (typeof groupId === 'string' && groupId.startsWith('private_')) {
            const realUserId = groupId.replace('private_', '');
            notificationService.sendPrivateMessage(ws, realUserId, messageChain, 'SettingsCommand', true);
            return;
        }

        if (groupId) {
            notificationService.sendGroupMessage(ws, groupId, messageChain, 'SettingsCommand', true);
        } else if (userId) {
            notificationService.sendPrivateMessage(ws, userId, messageChain, 'SettingsCommand', true);
        } else {
            commandLog('warn', 'send-skipped', {
                reason: 'missing_target'
            });
        }
    }
}

module.exports = new SettingsCommand();
module.exports._resolveBlacklistTarget = resolveBlacklistTarget;
module.exports._parseAtToken = parseAtToken;
