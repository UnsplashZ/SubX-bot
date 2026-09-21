# 2026-09-21 冗余代码与文档清理

## 背景

近期对功能做了大量移除与调整（v3.27.0 移除 Agent 子系统、v3.28.0 移除预览编辑器、部署从 NapCat 切换到 LLBot 默认）。本次全仓排查（219 个单测文件基线全部通过）后确认以下冗余/无效内容，经用户批准（"全做"）执行清理。

## 执行项

### 1. 删除死代码

- `src/services/qqAccountService.js` —— 全仓零引用（QQ 在线状态预设服务，残留自功能调整）。
- `src/utils/proxyUtils.js` —— 生产零引用；config schema 已无 proxy 字段；仅被 `test/unit/services/utility-logging.test.js` 引用。
- `test/unit/services/utility-logging.test.js` —— 仅移除其中 proxyUtils 相关断言与日志检查（其余 regexMonitor/subscriptionService/biliApi 部分保留）。

### 2. 迁移 previewLab（生产无用的开发工具）

- `src/services/previewLab/`（约 2000 行）仅被 `test/tools/preview-lab.js` / `test/tools/preview-lab-web.js` 使用，但因 `COPY src ./src` 会打进 Docker 镜像。
- 迁移到 `test/tools/preview-lab/`，同步修正 `test/tools/preview-lab*.js` 的 require 路径。
- `previewLab` 内部对 `src/` 生产代码的相对引用（如 `../../utils/logger`）需改为以仓库根为基准的路径。

### 3. 更新 `.dockerignore`

- 补充 `.codegraph/`（约 31 MB）、`.playwright-mcp/`、`.pytest_cache/`、`.superpowers/`，避免本地工具目录进入构建上下文。

### 4. 文档修正

- `dashboard/README.md` —— 移除"新 Agent 的配置与记忆管理"描述（Agent 子系统已于 v3.27.0 移除）。
- `CLAUDE.md` —— 更新 NapCat 中心化段落：项目名、部署描述（LLBot 默认、四种 QQ 接入）、卷挂载示例、目录树中 `napcat/` 条目。

### 5. 删除根目录 `napcat/` 旧数据

- 2026-03 的 NapCat 数据（`napcat/config`、`napcat/qq`），已不在任何 compose 挂载中。经用户确认删除。

## 不做的事（已确认保留）

- `previewLayout/`、`previewTemplate/` —— 渲染链路 load-bearing（编辑器移除后仍承担 legacy patch 回退与模板渲染）。
- `requirements.txt` 中 APScheduler/PyJWT/brotli 等 —— bilibili-api-python 的传递依赖。
- 两个 `atomic_writer.py` —— config 与 migrations 各自的不同实现，均被引用。
- `Dockerfile` / `docker-compose.yml` / `Dockerfile.action` —— 与新部署结构一致，无需改动。
- `docs/plans/` 历史计划文档 —— 按仓库规则不主动归档。

## 验证

- `npm test`（219 个单测文件全量通过）。
