# 一键脚本隔离运行验收

> 阶段性历史记录：登录前置阻断已在后续修改中取消，最终实现与验收以 `2026-09-19-final-provider-release-validation.md` 为准。

日期：2026-09-19。

## 环境与方法

在本机 Docker Desktop 实际执行仓库原始 `bash setup.sh`，使用独立临时目录 `/tmp/bili-setup-isolated-20260919`、独立 Compose 项目 `bili-isolated-llbot` 和 `bili-isolated-external`，独立配置、数据、网络和宿主机端口。没有替换 docker 命令，没有跳过镜像拉取、配置 CLI、容器启动或健康检查。macOS 非 root 运行使用现有 BILI_SETUP_TEST_MODE=1，仅跳过脚本 root 身份检查；因此不代表 Linux sudo/root 路径的完整验收。

Bot 使用脚本默认公开 `unsplash/bili-qq-bot:latest`，LLBot 使用 `linyuchen/llbot:latest`，均真实拉取。外部模式使用本机 WebSocket 协议测试服务，仅返回虚构身份、在线状态和空群列表，不连接 QQ，不执行消息发送。此服务用于验证脚本和真实 Bot 的安装/readiness 链路，不能替代真实 QQ 协议兼容验收。

## 结果

| 场景 | 结果 |
| --- | --- |
| 空目录默认 LLBot 安装 | 生成 Compose、账号配置、随机面板密码、YAML，真实 LLBot 容器启动；未提供真实账号凭据，登录探测超时，退出码 1，正确阻止 Bot 启动 |
| 空目录外部 OneBot 安装 | 真实鉴权探测通过，Bot 创建并启动，健康检查通过，脚本退出码 0，输出部署完成 |
| 自定义面板宿主机端口 | `http://127.0.0.1:25432/api/ready` 返回 ready=true |
| 重复运行升级 | 退出码 0；config.yaml、Compose、.env 的 SHA-256 前后相同；data 中哨兵文件保留 |
| 错误 Token 升级 | 退出码 1，明确提示尚未重建 Bot；原容器 ID 和 StartedAt 均不变；测试后恢复原配置 |
| 部署回归测试 | 20 项全部通过 |
| 正式环境隔离确认 | SSH docker 上既有 Bot 的 /api/ready 仍返回 ready=true；未更改其部署 |

## 覆盖边界与清理

本轮未使用第二个真实 QQ，未完成默认 LLBot 首次 Auth Token/扫码后整个 setup.sh 成功退出的全流程，也未重新做 NapCat 真实扫码。此前已有 LLBot 真实连接、媒体发送和远端运行证据，但不能冒充本轮首次扫码验收。

脚本固定 Bot 容器名 bili-qq-bot，因此本轮确认本机没有同名容器后才运行，并将两个安装场景分开；不同 Compose 项目本身不能解决同名 Bot 容器冲突。测试不会影响另一 Docker 主机的正式容器。

测试结束使用各自 Compose 项目 down 清理容器和网络，停止协议测试服务；保留临时目录中的配置和日志供复核，权限收紧为当前用户可读写。本轮只新增本报告，没有修改产品脚本或代码，没有 Git 操作。
