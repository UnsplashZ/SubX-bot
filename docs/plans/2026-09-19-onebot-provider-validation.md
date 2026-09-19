# QQ 接入实现实测与部署选择

> 阶段性历史记录：登录前置阻断已在后续修改中取消，最终实现与验收以 `2026-09-19-final-provider-release-validation.md` 为准。

日期：2026-09-19。状态：本轮连接、实发及部署选择验证完成；自动恢复与业务端到端限制见下文。

## 目标与边界

验证 LLBot 与 SnowLuma 能否接入现有 OneBot v11 客户端；验证通过后，为一键部署提供实现选择，优先 LLBot。保留已有安装的配置和数据，不自动将已有 NapCat 安装切换到其他实现。本次未进行 Git 操作。

## 固定版本与官方来源

- [LLBot v8.2.1](https://github.com/LLOneBot/LuckyLilliaBot/releases/tag/v8.2.1)：macOS ARM64 CLI；Docker `linyuchen/llbot:8.2.1`，拉取 digest `sha256:81736042a6f690ead078dd8c19bccde8bec7bf7ca8d10f736c32ff8810ed43d1`。
- [SnowLuma v1.14.17](https://github.com/SnowLuma/SnowLuma/releases/tag/v1.14.17)：Docker `motricseven7/snowluma:v1.14.17`，拉取 digest `sha256:001fef603420eca492826caaee5f0f243f439683eed59aa4abac31691d73a280`。
- [SnowLuma 官方 Docker 框架](https://github.com/SnowLuma/SnowLuma.Docker.Framework)：完整镜像包含 Linux QQ、SnowLuma 与 noVNC。

## 已验证：LLBot 原生版本

使用独立临时目录、仅监听本机的 WebUI 和 OneBot WebSocket，用户完成真实 QQ 扫码。使用本项目 `src/providers/qq/napcatProvider.js` 实际连接：`waitUntilReady()` 成功，`isRuntimeReady()` 为 true。

以下接口均收到 `status: ok, retcode: 0`：

- `get_version_info`：`app_name=LLOneBot`、`protocol_version=v11`、`app_version=8.2.1`。
- `get_login_info`、`get_status`（online=true）、`get_group_list`。
- `get_group_info`、`get_group_member_list`、`get_group_shut_list`。
- `get_essence_msg_list`、`_get_group_notice`、`get_group_at_all_remain`。
- `get_group_system_msg`：返回字段为 `invited_requests`、`join_requests`。

真实调用 `get_group_ignored_notifies` 返回 `status: failed, retcode: 1404`。因此不能宣称原样支持全部群管理功能。

首次扫码阶段原生进程曾退出，退出码 1；日志存在二维码过期记录，但没有足够证据确定退出根因。重新以独立进程启动后，用户登录成功，完成上述实测。原生测试完成后已停止该临时进程。

## 已定位的兼容差异

1. LLBot v8.2.1 注册的删除公告接口是 `_delete_group_notice`；本项目使用 `_del_group_notice`。此项为发布标签源码核对，未实际删除公告。
2. LLBot 不支持 `get_group_ignored_notifies`，真实响应已验证。上游 `get_group_system_msg` 合并普通和过滤请求，但不能直接当作“仅过滤请求”的等价替代。
3. 本项目 `filterSystemMessagesByGroup()` 读取 `InvitedRequest`，LLBot 实际返回 `invited_requests`，会漏掉邀请。
4. SnowLuma 标签源码中包含本次核对的 30 个目标动作名称，但动作存在不代表真实调用或返回结构兼容。其 `get_group_ignored_notifies` 返回数组，与本项目当前按对象读取的方式不同。

## 已验证：LLBot Docker 与部署产物

用户完成 Docker 实例扫码后，使用本项目 `NapcatProvider` 实际连接，登录身份探测通过。版本、在线状态、群列表、群信息、成员列表、禁言列表、精华消息、公告、全体成员额度、群申请查询均返回成功；`get_group_ignored_notifies` 仍返回 1404。

- 错误 Token 实测返回 1403，WebSocket 以 1008 关闭。
- 删除并重建本次测试容器，保留 data 挂载并设置 `AUTO_LOGIN_QQ`，无需再次扫码，项目 Provider 登录探测通过。
- 调用修改后 `setup.sh` 的真实 `generate_config_yaml()`，使用已有本地 Bot 镜像生成配置，再执行真实 `wait_for_onebot_login()`：成功。将 Token 临时改错后，该探测返回失败；随后恢复测试配置。
- 调用修改后脚本的 `write_llbot_config()` 和 `write_compose_template()` 生成另一套隔离部署产物，持久化已登录测试会话并启动官方 LLBot 镜像；从生成的 Bot 服务网络连接 `ws://llbot:3001`，鉴权和登录身份验证成功。
- 脚本生成的 LLBot 服务与 Bot 服务共享 `onebot/media`，容器内均为 `/app/.config/QQ/tmp`；已实际在 LLBot 容器写入校验文件，再从 Bot 容器读取比对并清理，通过。后续已获授权并完成真实媒体发送，见实发章节。
- `bash -n setup.sh`、真实 `docker compose config -q` 通过；`test/unit/deployment/setup-state-machine.test.js` 共 20 项测试通过，覆盖默认 LLBot、保留 NapCat、已有 LLBot 升级、外部连接、登录失败阻断与旧配置迁移路径。

## 当前待验证

- 用户已在 LLBot 测试完成并停止后登录 SnowLuma，实测结果见下文。
- 接收用户入站消息的业务处理、持续断线重连尚未验证。群管理写操作未执行。
- 用户已明确授权兼容层修改及实发测试，并指定唯一测试群；未授权群公告、禁言、踢人等管理写操作。

## 已验证：群聊实发与兼容层

使用实际生成的 Compose，通过 Bot 容器挂载当前项目源代码，调用本项目 `NotificationService.callAction()`，向用户指定的唯一测试群各发送一条文字、一张图片和一个 2 秒 H.264 视频。三次 `send_group_msg` 均返回 `status=ok, retcode=0` 与消息 ID；逐条 `get_msg` 回读成功，消息段类型分别为 `text`、`image`、`video`。这证明服务端发送与回读成功，不代表已检查手机端视频播放。

兼容层修改：

- 新增按 WebSocket 连接缓存的 `get_version_info` 实现探测，合并并发探测，探测失败允许重试。
- LLBot 的 `_del_group_notice` 映射为 `_delete_group_notice`，只发送一次实际删除请求；其他实现保留原动作名。
- LLBot 的 `get_group_ignored_notifies` 明确拒绝并返回 `ONEBOT_ACTION_UNSUPPORTED`，不以全部申请冒充过滤申请；识别后隐藏对应 Agent 工具。
- 群系统消息同时兼容 `InvitedRequest` 和 `invited_requests`；SnowLuma 数组混合申请和邀请且没有显式类型字段，统一保留为 `unclassifiedRequests`，保留原始 flag、不解析不透明 flag 或猜测类型，仍按指定群过滤；Agent 格式化将其计入总数并展示。

修改后代码对真实 LLBot 的群系统消息查询和规范化通过；不支持动作被本地明确阻断；Agent 工具隐藏与其他群查询保留已实测。6 项兼容性单元测试及原有群管理权限/审批链路验证通过。公告删除适配使用模拟 WebSocket 验证动作名、参数不变、仅发送一次，未删除真实公告。

生产镜像尚未构建或发布：新脚本使用旧镜像时不包含本次新增的兼容层，需在后续授权发布中一并交付。

## 部署实现注意事项

- `setup.sh` 已增加 LLBot（默认）、NapCat、已有 OneBot 三个选项；初测使用 LLBot 8.2.1；用户后续要求优先 latest，默认镜像现为 `linyuchen/llbot:latest`，本次重新拉取实际仍为 8.2.1。仓库默认 Compose 与生成模板一致。
- 已有安装通过 Compose 服务列表决定启动哪个接入服务，不自动切换实现，不改写配置、镜像引用或业务数据。旧版配置仍由应用启动迁移，最终 readiness 验收。
- LLBot 使用 `ob11.connect` 配置，账号配置放在 `/app/llbot/data/config_<QQ>.json`，重启自动登录由 `AUTO_LOGIN_QQ` 控制；需要持久化整个 data 目录。
- 登录就绪应通过带鉴权的 OneBot `get_login_info` 验证，不能仅凭 WebUI 或 TCP 端口开放。
- SnowLuma v1.14.17 首次使用页面的 EULA 5.4 明确提及自动化脚本部署需要书面授权；在未核实授权前，部署方案优先考虑连接用户已有 SnowLuma 实例，协议接受由用户本人决定。

本记录不包含账号、群号、密码、Token、二维码链接或消息正文。

## 已验证：SnowLuma Docker

用户登录后，真实项目 Provider 就绪，`get_version_info` 返回 SnowLuma / 1.14.17-node / v11，`get_status` 为 online=true。

- 登录、版本、状态、群列表、群信息、成员列表、禁言列表、精华、公告、全体成员额度、群系统消息与过滤请求均真实调用成功。
- 经项目 NotificationService 向用户指定测试群发送文字、PNG、2 秒 H.264 视频，三项返回成功和消息 ID，`get_msg` 回读分别包含 text/image/video。媒体预先复制到 SnowLuma 容器可读目录；不能据此宣称任意跨主机路径共享已验证。
- 错误 Token 在 WebSocket 握手阶段返回 HTTP 401。
- 修改后 setup.sh 的真实 `wait_for_onebot_login()` 从隔离 Bot 容器通过 `host.docker.internal:25101` 连接成功，证明已有 OneBot 模式的容器网络、配置及 Token 可用。
- 系统消息和过滤请求实际均为数组；标签源码证实系统消息混合申请和邀请。已修正为未分类记录，并补充跨群隔离、原始 flag 保留及 Agent 展示测试。

### 失败与未验证

完整执行 `docker restart` 后 QQ/SnowLuma 均 RUNNING，但容器 3001 未监听，项目连接报 ECONNRESET。自动登录与 OneBot 恢复未通过；尚不能确定是否需要用户在 QQ 界面重新登录。浏览器检查工具当时因 auth method 错误不可用，未据此推断具体登录界面。现有容器及账号数据保留，不移除、不重建。

此次两种实现均未验证真实入站消息触发业务回复、长时间自动断线重连或手机端视频播放。禁言、踢人、公告增删等群管理写操作未执行；动作名称的源码对照及模拟测试不等于真实写操作验收。当前项目是 OneBot v11 客户端加实现扩展，不能宣称完整覆盖所有 OneBot 接口或所有实现完全等价。

最终检查：兼容性 6 项 + 部署状态机 20 项通过，群管理权限/审批测试（含未分类请求展示）通过，两项通知日志回归脚本通过，`bash -n setup.sh` 通过。未提交、推送、构建或发布生产镜像。

后续二次复查、超时修复、latest 策略及 SSH docker 正式迁移结果见 [复查与迁移记录](2026-09-19-onebot-provider-review-and-migration.md)。
