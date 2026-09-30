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
- validate 精简：Puppeteer Chrome 加入 actions/cache；dashboard 生产构建仍需保留
  （dashboard-listener-swap 等测试直接读取 dashboard/dist 产物）。
- build-push 改为按架构矩阵并行：amd64 用 ubuntu-latest、arm64 用 ubuntu-24.04-arm（仓库公开，arm runner 免费），移除 QEMU；每个架构 push-by-digest，按架构隔离 gha 缓存 scope。
- 新增 merge-manifest 作业：合并双架构 digest 为单一 manifest 并打版本/latest 标签；版本解析与 git tag 收敛到此处，避免矩阵任务竞争创建 tag。

## 迭代修复记录（同日发布 v3.32.1 → v3.32.4）

- v3.32.1：validate 去掉 dashboard 构建导致 dashboard-listener-swap 测试失败（该测试读取 dashboard/dist 产物），v3.32.2 恢复。
- v3.32.2：arm64 腿 johnvansickle 下载静默损坏（curl 退出码 0 但内容非 xz），v3.32.3 改为校验 xz 魔数后使用、失败自动切 gh-proxy 的 BtbN 回退源。
- v3.32.3：GITHUB_TOKEN 的 permissions 不支持 workflows 键导致 workflow 校验失败，v3.32.4 回退；tag 推送失败降级为告警（镜像已先行发布），实际后续观察 tag 推送成功。
- v3.32.0 的 git tag/Release 由维护者手动补打（镜像本身已发布）。

## 最终验证（v3.32.4 全流程绿灯）

validate 3m26s → 双架构构建并行 1m28s/1m39s（原生 runner，无 QEMU）→ 合并 manifest 32s → release 10s。镜像 amd64+arm64 manifest 正常，v3.32.4 tag 指向正确提交。
