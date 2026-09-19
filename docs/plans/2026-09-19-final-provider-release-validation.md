# 四入口部署最终验收与提交门禁

## 最终范围

LLBot（默认 latest）、NapCat latest、已有 SnowLuma OneBot、QQ 官方入口。SnowLuma 按既有实例连接，未把其原生组件自动安装打包进脚本；官方入口新增独立菜单，可输入 AppID/ClientSecret 或先保留空值进入面板。

## 复查修复

- QQ 离线时保留管理面板，QQ 接入启动/拉取失败不阻止 Bot 独立启动；存活检查必须通过，业务 readiness 单独提示。HTTP 探测有 3 秒超时。
- LLBot 群公告动作名、过滤请求不支持提示；SnowLuma 混合请求保留与跨群过滤；实现探测共享超时预算，避免调用超时后继续发写请求。
- 新增 LLBot/OneBot 运行目录的 Git 与 Docker 忽略规则。
- 全量测试发现 CLI 只识别 NapCat 模板，已扩展 LLBot 模板、保留现有外部网关，不意外生成第二个 NapCat；官方切换清理受管 LLBot 依赖，保留用户字段并校验所有权漂移。渲染 healthcheck 使用 live，不以 QQ 是否在线决定容器健康。

## 已验证

- Dockerfile 完整真实构建，包括 Node 生产依赖、前端 build、Python/Chromium/FFmpeg 运行依赖。源码修复后重新构建，通过本机临时 registry 实际 push/pull 给脚本使用。
- 全量 npm test：238 个测试文件通过（使用仓库 runner 的运行数据隔离和现有 venv）。后续四入口/CLI 最终定向测试 41 项通过。
- 默认 Compose 和脚本生成配置通过真实 docker compose config；默认 LLBot 空目录首次安装、重复升级退出 0，配置散列不变、数据哨兵保留。
- QQ 离线：实际镜像 live=200、ready=503、登录=200、保存配置=200、healthy、重启 0。
- 外部测试服务：脚本实际安装通过，真实 Bot ready=true；该项是协议 fixture，不冒充真实账号验证。
- 官方：用现有私有凭据完整执行菜单 4，脚本退出 0，面板可用；真实 Token 获取成功，但 gateway HTTP 401 / 11298（出口 IP 不在白名单）。用户明确要求跳过此项真实连接，不以此阻止最终提交。

## 待收口

LLBot 最终镜像已真实复核：ready=200/true，get_status online=true，get_version_info=8.2.1，get_group_list 成功。NapCat latest 已实际执行脚本首次安装与升级、面板 healthy，但等待用户扫码；SnowLuma 网关已准备，等待 NapCat 完成后再登录。官方连接按用户要求跳过 IP 白名单阻断。剩余两项真实登录未完成；用户随后明确授权全部提交并推送，按此授权交付，未将未完成项标为通过。已停止本机 QQ 测试实例并启动远端 LLBot，避免持续占用停机窗口。

本机证据目录 `/tmp/bili-final-validation-20260919` 为私有临时数据，不提交账号配置、密码、日志或二维码。此报告不包含密钥及消息内容。

## 提交授权

用户最终明确授权全部提交并推送。版本按 main 分支规则从 v3.25.10 升级为 v3.26.0（四入口部署功能调整）。最终全量测试 238 个文件通过；Git 提交不包含临时账号数据、二维码、媒体或运行日志。
