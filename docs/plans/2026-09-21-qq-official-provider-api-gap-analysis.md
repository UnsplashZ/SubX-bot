# QQ 官方 Provider 接口差距分析（对照 bot.q.qq.com API v2）

日期：2026-09-21
范围：`src/providers/qq/official*`、`src/config/authConfig.js`、QQ 机器人官方文档 API v2

## 实现状态（2026-09-21）

已实施（对应下文一.1 与一.2）：

- `/whoami` 命令（`src/commands/whoami.js`，别名 `/我的id`、`/openid`）：回复用户ID、群ID、官方 openid、群内角色与权限，并提示 root openid 配置方式
- 群管自动识别（`src/handlers/messageHandler.js`）：群主/管理员（`sender.role` 为 owner/admin）发言时自动 `addGroupAdmin` 持久化授权，先于群启用检查，保证群管可随时重新开启群功能；对 NapCat/官方双端生效
- 指令面板自动同步（`src/providers/qq/official/panelSync.js` + `openapiClient` 面板接口 + `officialProvider.start()`）：启动时按命令清单 reconcile c2c/group 两个 scope 的指令面板（按 remark `bili-qq-bot:auto-sync` 识别自有面板，差异时更新，缺失时创建）；配置项 `qqOfficialPanelSync`（env `QQ_OFFICIAL_PANEL_SYNC`，默认开）与 `qqOfficialPanelItems`（env `QQ_OFFICIAL_PANEL_ITEMS`，JSON 覆盖默认指令）
- 测试：`test/unit/messages/messageHandler-whoami-command.test.js`、`messageHandler-auto-group-admin.test.js`、`test/unit/providers/qq/official-panel-sync.test.js`

未实施：markdown/键盘/按钮回调、引用回复、@标签出站、C2C 事件补齐、群管理白名单接口等，见下文二。

## 一、三个问题的结论

### 1. 如何获取管理员 QQ id 并设置？

**官方 API 不存在真实 QQ 号**，所有身份都是 openid，且按 bot（AppID）隔离：

- `user_openid`：单聊场景用户标识
- `member_openid`：群聊场景成员标识
- `group_openid`：群标识
- 官方没有「QQ 号 ↔ openid」转换接口

已有机制（项目已实现）：

- `config.qqOfficialRootOpenids`（环境变量 `QQ_OFFICIAL_ROOT_OPENIDS`）+ `authConfig.isOfficialRootAdmin`，rootAdmin 判断已兼容 [authConfig.js](../..src/config/authConfig.js)

可补充（按性价比排序）：

1. **基于群事件自动识别群管**：`GROUP_AT_MESSAGE_CREATE` / `GROUP_MESSAGE_CREATE` 事件的 `author.member_role` 直接给出 `owner / admin / member`，eventMapper 已映射到 `sender.role`，可以让群主/群管自动获得群内管理员权限，免去手工配置。
2. **内置 whoami 命令**：用户私聊/群@机器人发命令，bot 回复其 `user_openid` / `member_openid` / `group_openid`，方便填充 `qqOfficialRootOpenids`。
3. 管理端（WebUI/dashboard）展示 idStore 中已观测到的 openid，供复制配置。

### 2. Bot 在 QQ 中没有机器人菜单和指令服务提示

这不是接入缺陷，默认需要在开放平台后台配置；但官方提供 API 可以程序化创建：

- **指令面板** `POST /v2/panels`（查询/创建/详情/修改/删除/修改关联对象）
  - 支持 c2c（单聊）、group（群聊）场景；c2c/group 支持全局或指定 openid 生效
  - 每个机器人最多 20 个面板；创建接口 10 QPM
- **自定义菜单**（单聊窗口底部菜单）：查询全局自定义菜单 / 修改全局自定义菜单

可补充：provider 启动（或命令变更）时按 bot 命令清单自动同步指令面板（c2c + group 两个 scope），让「指令服务提示」出现。

### 3. 群聊管理不支持

官方群管理 API 在 2025-2026 已扩展出一组接口，**但绝大多数是白名单/内邀能力**（报错码 11253「该接口仅白名单机器人可用」）：

| 接口 | 路径 | 可用性 |
|---|---|---|
| 获取群基本信息 | `GET /v2/groups/{gid}/info` | 白名单 |
| 获取机器人群内状态 | `GET /v2/groups/{gid}/bot_state` | 白名单 |
| 获取群成员列表 | `GET /v2/groups/{gid}/members` | 内邀+白名单，每次 30 条分页 |
| 获取群成员信息 / 群成员批量移除 / 群黑名单查询与操作 | `/v2/groups/{gid}/...` | 内邀 |
| 查询群禁言状态 / 设置群成员禁言 | `/v2/groups/{gid}/...` | 白名单 |
| 入群申请列表拉取 / 入群申请审批 / 入群自动审批 | `/v2/groups/{gid}/...` | 白名单 |
| 用户申请加群事件 `GROUP_JOIN_REQUEST` | 事件（1<<25 内） | 需确认 |

建议：在 `capabilities.js` 中将 `groupModeration` 等标为受限可选能力，在 `callAction` 中实现对应 action（`set_group_ban`、`get_group_member_list`、`get_group_info` 等），调用时遇 11253 返回明确错误提示（引导申请白名单），实现「优雅降级」而非「不支持」。

## 二、其他可补充的能力（对照现有实现）

现有 `openapiClient` 仅覆盖：发消息（群/单聊）、传媒体、撤回。`messageSender` 仅支持 `msg_type=0`（文本）和 `msg_type=7`（富媒体）。

| 能力 | 官方支持 | 现状 | 建议 |
|---|---|---|---|
| Markdown 消息 `msg_type=2` | 支持（模板权限需申请） | 未实现 | 高优先级：长文本排版、图文混排 |
| 内嵌键盘/按钮 `keyboard` | 支持（跳转/回调/指令按钮，含权限与二次确认） | 未实现 | 配合 INTERACTION 可做确认交互 |
| 按钮回调 `INTERACTION_CREATE` | 支持（intent `1<<26`） | 未订阅未映射 | 订阅 intent + 事件映射 + event_id 被动回复 |
| 引用回复 `message_reference` | 支持（消息场景 ext 提供 `msg_idx`/`ref_msg_idx`） | 未实现 | 入站解析 message_scene.ext，出站支持引用 |
| @ 某人 | 文本/markdown 内嵌 `<qqbot-at-user id="openid"/>` | `at` 段被丢弃 | 出站时将 at 段渲染为标签 |
| FRIEND_ADD / FRIEND_DEL / C2C_MSG_RECEIVE / C2C_MSG_REJECT | 事件（已在订阅的 `1<<25` 内） | 未映射 | 补齐映射，c2c reachability 可用于主动消息降级判断 |
| 群消息全量模式 `GROUP_MESSAGE_CREATE` | 需单独申请权限 | eventMapper 已支持映射 | 申请权限后开启，提升群消息覆盖 |
| 入站 `mentions` / `msg_elements` / `ark_data` | 事件字段 | 仅解析 attachments | 按需补充 |
| 表情表态 | **仅频道可用**，群/单聊不支持 | 保持关闭 | 无需处理 |
| 撤回消息 | 支持（hidetip） | 已实现 ✓ | — |
| 富媒体上传（图/视频） | 支持 | 已实现 ✓ | 可扩展语音/文件（若业务需要） |
| 群信息 `/v2/groups/{id}/info` | 白名单接口（11253 = 无权限） | 已实现 ✓（`getGroupInfo` + `refreshGroupInfo`，best-effort 容错；`callAction get_group_info`） | 配合 `QQ_OFFICIAL_GROUP_ALIASES` 手动别名；`/管理 群列表` 展示群名 + 群主/管理员花名册 |
| 用户/成员昵称展示 | 事件 `author.username` | 已实现 ✓（eventMapper → sender.nickname → idStore；`/whoami` 展示昵称） | 群成员花名册来自事件观测，非全量成员列表 |
| ARK / Embed 卡片 | 模板权限受限 | 未实现 | 低优先级 |

## 三、频控与被动消息约束（实现时注意）

- 群消息被动回复有效期 5 分钟，每条消息最多回复 5 次；主动消息：认证 bot 60 QPM / 未认证 30 QPM，单群 20 QPM、每群每天 1000 条上限
- 发消息接口 100 QPS；指令面板创建 10 QPM
- `msg_id` + `msg_seq` 去重机制已部分实现（messageIdStore）

## 参考

- API 调用指南：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html
- 事件订阅与通知：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
- 发送群聊消息：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
- 群@机器人消息事件：https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html
- 自定义菜单与指令面板：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/menu-panel/
- 创建指令面板：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_panels.post.html
- 获取群成员列表：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members.get.html
- 获取机器人群内状态：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html
- 互动事件：https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/interaction_create.html
- 文本交互（@标签/指令标签）：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/text-chain.html
