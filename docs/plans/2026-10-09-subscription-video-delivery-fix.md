# 订阅视频下载投递修复（2026-10-09）

## 问题与验证

- Docker 服务器上的 `bili-qq-bot` 成功下载视频，但 LLBot Highway 上传返回 `102902`。
- 原消息发送 facade 在 WebSocket 写入后即认为发送成功，错误记录 `video-sent` 和自动下载投递成功，并清理文件。
- `BV1zLap6VEz1` 实测 1080p+ 文件为 103,396,602 字节，多次上传被拒绝；720p 文件为 43,721,760 字节，发送成功。该结果验证降分辨率绕过本次拒绝，尚未证明 QQ/LLBot 内部拒绝的具体原因或统一大小上限。

## 修复行为

- 群聊/私聊发送等待匹配 `echo` 的 OneBot 回执，验证 `status` 与 `retcode`；视频回执最多等待 5 分钟。
- 自动下载台账独立记录 `pending`、`failed`、`delivered`、`skipped`，兼容旧记录默认成功的语义。
- 轮询最近视频列表，对明确失败/未完成的投递按群补偿；不重复卡片，不将缺失的旧台账当作失败证据。
- 媒体发送只面向本次卡片成功或去重覆盖的群；已完成的视频投递不再重复。
- Highway `102902` 拒绝时，依次尝试低于原分辨率的 720p、480p、360p；只重试被拒绝的群。其他错误通过下一轮补偿处理。
- 上传期间持续占用下载并发配额；全部发送失败时保留文件。
- 时长限制仍为当前配置的 600 秒，超限是配置性跳过。

## 检查结果

- 47 项发送、下载、台账、订阅补偿、基线与运行时定向 Mocha 测试通过。
- 23 项状态推进与 OneBot 兼容性 Mocha 测试通过。
- 两个通知/下载日志验证脚本通过；`git diff --check` 通过。
- `BV1zLap6VEz1` 与 `BV1rgap62Ez5` 已补发至原订阅群，720p 均收到 `retcode=0`。
- 两条自动下载记录已更新为实际确认的投递，记录 `source=confirmed-video-repair`、`resolution=720p`、`onebotRetcode=0`。

## 部署记录

- 仅修改 Bot，不修改 LLBot。
- 服务器本地修复镜像：`unsplash/bili-qq-bot:video-delivery-fix-20261009`。
- 镜像 ID：`sha256:7f1fc3b862842c3688de4650b5716554162643e245975f38d8adcd94eea8d19b`。
- 原 Compose 项目 `bot` 的 `bili-qq-bot` 服务已切换到修复镜像并重建。
- 原文件、Compose 与投递记录备份：服务器 `/data/AppData/bili-qq-bot/backups/20261009-video-delivery-fix/`。
- 部署后核对 5 个修改的生产文件与本地内容一致；机器人连接、订阅调度、Dashboard 与 Python 健康检查正常。
- 修复代码纳入 `v3.32.10`；服务器本地修复镜像与 Git 提交独立管理，尚未发布到镜像仓库。
