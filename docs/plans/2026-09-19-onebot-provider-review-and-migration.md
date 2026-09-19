# OneBot provider 二次复查与远端迁移

> 阶段性历史记录：登录前置阻断已在后续修改中取消，最终实现与验收以 `2026-09-19-final-provider-release-validation.md` 为准。

## 复查结论

复查范围为 setup.sh、默认 Compose、OneBot 兼容层、通知 action 调用、群请求规范化与 Agent 工具展示，以及对应测试。

- P2：首次实现探测最多额外消耗 3 秒，原先在探测结束后重新启动完整 action 超时，使调用超过约定预算；并发探测合并还可能使短超时调用等待长超时调用。已改为共享截止时间，并单独约束每位调用者等待探测的时长；超时后不再发送写请求。两项回归测试覆盖此情形。
- 部署交付风险：公开 Bot 镜像未包含本次兼容层。远端迁移使用基于当前运行镜像构建的专用补丁镜像，不依赖尚未发布的 latest。未来对外发布一键脚本时仍须同步发布应用镜像。
- 已检查 LLBot 公告删除动作映射只发送一次，过滤申请查询不冒充全部申请；SnowLuma 未分类请求不丢失、按群隔离且保留原始 flag。未执行群管理写操作。
- LLBot 工具隐藏采用惰性探测：首次查询不支持动作时会拒绝，识别后隐藏。此行为已明确文档化。

## 远端迁移基线

用户授权通过 SSH 别名 docker 替换。检查发现 Bot 实际选择 official，readiness 为 503；NapCat 虽运行，Bot 未使用它。迁移会同时设置 qq.provider=napcat（现有 OneBot 客户端名称）及 ws://llbot:3001。

现有部署由 Portainer 的 bot stack 管理。备份位置：`/data/AppData/bili-qq-bot/provider-migration-20260919/backup`。迁移保留原配置、Compose、容器 inspect 和旧镜像标签；不删除原 NapCat 数据。Bot 挂载及业务数据保持原路径，LLBot 共享 `/data/AppData/bili-qq-bot/napcat/qq/tmp`。

## 最终验收

迁移完成。用户要求默认优先 latest，setup.sh、默认 Compose 和远端 LLBot 服务均已改为 `linyuchen/llbot:latest`。本机重新从官方拉取 linux/amd64 镜像，digest 为 `sha256:81736042a6f690ead078dd8c19bccde8bec7bf7ca8d10f736c32ff8810ed43d1`，当前实际版本仍为 8.2.1；远端 Docker Hub 连接超时，因此通过 SSH docker save/load 传输官方镜像。

- 远端 LLBot 已恢复原测试账号会话，无需再次扫码；重建为 latest 后再次自动登录通过。
- 正式 Bot 使用 `bili-qq-bot:llbot-compat-20260919` 专用补丁镜像。其基线为原运行镜像，只覆盖此次四个兼容源码文件；未推送到镜像仓库。该本地标签为保留尚未发布的兼容层，并非固定 LLBot 版本。
- Portainer 原 stack 的 Compose 文件已同步新服务定义；NapCat 容器保留、停止、restart=no，避免重启抢占账号；业务数据与媒体路径保留。
- `/api/ready` HTTP 200，ready=true；Provider 就绪、LLBot online=true。真实群信息查询通过。
- 在此前授权测试群实发文字、图片、短视频各一次，返回成功及消息 ID，逐条回读消息段匹配。没有检查手机端播放，没有执行群管理写操作。
- 实际群请求规范化通过；LLBot 不支持的过滤申请查询返回 ONEBOT_ACTION_UNSUPPORTED。
- 本地 8 项兼容测试、20 项部署测试、9 项 provider/facade 测试通过；群管理权限/审批测试本地及远端补丁镜像均通过；远端模块加载检查通过。默认 latest 增加了明确回归断言。

回退材料保存在前述 backup 目录，旧 Bot 镜像另存为 `bili-qq-bot:pre-llbot-20260919`。如回退，应先停止新 Bot 和 LLBot，恢复备份配置及原 stack Compose，再恢复 NapCat 的 restart 策略并启动原服务。注意原配置选择 official 且原 readiness 已为 503，恢复旧配置本身不保证服务可用。

LLBot 管理面板仅绑定远端 127.0.0.1:3080，可用 `ssh -L 3080:127.0.0.1:3080 docker` 建立隧道；密码在远端 `/data/AppData/bili-qq-bot/llbot/data/webui_token.txt`。本记录不保存任何 Token、密码或消息正文。未进行 Git 工作流操作。

