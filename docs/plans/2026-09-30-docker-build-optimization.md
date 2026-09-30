# Docker 构建流程优化

## Context

每次发版后用户拉取新镜像时经常需要下载大量大文件。排查发现运行时镜像层顺序不合理：`COPY src` 之后的层（chrome-headless-shell 约 216MB、dashboard dist）在每次发版时缓存全部失效，被迫重复下载未变更的大层。另外 `Dockerfile`（本地）与 `Dockerfile.action`（CI）长期双份维护，已出现修复只落一边的情况。

## Changes

1. **合并双 Dockerfile**：`Dockerfile.action` 合并进 `Dockerfile`，镜像源通过 build-arg 区分（`NPM_REGISTRY` / `APT_MIRROR` / `PIP_INDEX_URL`），CI 工作流改用统一 Dockerfile。
2. **层顺序按变更频率从低到高**：node_modules → /chs → package.json → mkdir → dashboard/dist → src。纯代码发版只需重拉末尾约 4MB 的 dist/src 小层。
3. **静态 ffmpeg**：替换 apt 版 ffmpeg（连带大量依赖库），改用 johnvansickle 静态构建（主源失败时回退 gh-proxy 的 BtbN 构建），运行时镜像 1.61GB → 1.17GB。
4. **CI 推送 zstd 压缩层**（`compression=zstd,compression-level=3,force-compression=true`），拉取体积进一步降低；Docker 23+ 支持，旧客户端自动回退 gzip。
5. **运行时升级 Node 24**（`node:24-bookworm-slim`），CI validate 同步使用 Node 24；`engines >=22.12.0` 不变，Node 22 本地开发仍可用。

## Verification

- 本地 `docker build`（arm64）成功，容器内冒烟通过：Node v24.21.0、ffmpeg 7.0.2-static、Chromium 143 headless shell、Python 依赖导入正常、noto 字体 289 条。
- `docker history` 确认大层（311MB apt+pip、216MB /chs、53MB node_modules）位于小层（dist 1.2MB、src 3MB）之下。
- `npm test` 全套 223 个测试文件在 Node v24.15.0 下通过。
- 注意：本地 Docker Desktop（containerd snapshotter）连续构建缓存命中差（每次仅 20 步 CACHED），属本机构建器 GC 行为，不影响推送后用户拉取层复用。

## Risks

- zstd 层需要 Docker 23+ 才能拉取（旧客户端回退失败时表现为无法 pull；部署文档要求近期 Docker 版本）。
- BtbN 回退源是 nightly 构建，版本不固定；主源 johnvansickle 为 release 构建。

## CI 流水线优化（2026-09-30 第二轮）

- 原 validate 与镜像构建重复安装依赖（npm ci ×4）、重复构建 dashboard（×3，arm64 还在 QEMU 模拟下跑）。
- validate 精简：去掉独立的 dashboard 生产构建（由镜像 dashboard-builder 阶段覆盖）、Puppeteer Chrome 加入 actions/cache。
- build-push 改为按架构矩阵并行：amd64 用 ubuntu-latest、arm64 用 ubuntu-24.04-arm（仓库公开，arm runner 免费），移除 QEMU；每个架构 push-by-digest，按架构隔离 gha 缓存 scope。
- 新增 merge-manifest 作业：合并双架构 digest 为单一 manifest 并打版本/latest 标签；版本解析与 git tag 收敛到此处，避免矩阵任务竞争创建 tag。
