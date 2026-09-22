# Docker 镜像体积优化分析（2026-09-22）

## 现状

- 镜像 `unsplash/bili-qq-bot:latest`（arm64）：**2.12 GB**
- 分层：apt 层 1.06 GB（Chromium 272 MB + chromium-common 86 MB + libllvm15 109 MB + fonts-noto-cjk 91 MB + fonts-noto-core 43 MB + ffmpeg 链 ~28 MB）、pip 层 141 MB、node 运行时 ~260 MB、node_modules 52.6 MB、业务代码 ~4 MB

## 字体结论

- 现有清理规则 `rm -f /usr/share/fonts/truetype/noto/NotoSerif*.ttf` **从未命中任何文件**（Serif CJK 在 `opentype/noto/` 下且为 `.ttc`），是历史遗留无效规则
- 实际渲染字体链（`src/utils/designSystem.js:46`）：`"Noto Sans CJK SC", "Noto Sans Sinhala", "Noto Color Emoji", sans-serif`
  - 中文 → NotoSansCJK-Regular.ttc（fonts-noto-cjk）
  - 西文/数字 → NotoSans-Regular.ttf（fonts-noto-core）
  - emoji → NotoColorEmoji.ttf
- fonts-noto-core 仅 43 MB（占 2%），删掉会改变卡片中西文/数字观感（回退 DejaVu），**建议保留**；真正该删的是 53 MB 的 NotoSerifCJK-*.ttc

## chrome-headless-shell 实测（arm64）

测试环境：容器内，puppeteer 25.0.4（内置 pin Chrome 148.0.7778.167）

| 验证项 | 结果 |
| --- | --- |
| 渲染对比（中文/西文/emoji 卡片） | headless shell 与系统 Chromium **MD5 完全一致** |
| 来源 | npmmirror `playwright/builds/chromium/1243/chromium-headless-shell-linux-arm64.zip`（Chromium 153.0.8010.12）；chrome-for-testing 镜像站**无 arm64**，只有 linux64 |
| ldd 依赖 | 当前镜像无缺失；不需要 gtk/llvm/mesa |
| strip --strip-unneeded | 343 MB → **217 MB**，渲染仍逐像素一致 |
| 卸载系统 chromium + autoremove | 释放 **442 MB** |
| 净收益 | **约 225 MB**（442 − 217） |

可选再裁：删除 `libvk_swiftshader.so` 等 Vulkan/WebGL 组件再省 ~24 MB（卡片无 WebGL，但有极低风险）。

### 风险与代价

- 浏览器版本（153）与 puppeteer pin（148）不一致：实测可启动、渲染正常，但 puppeteer 大版本升级时需复测
- 构建期从 npmmirror 下载 ~112 MB zip，建议用 BuildKit cache mount 缓存
- 需在 Dockerfile 显式保留 headless shell 的运行库：libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxkbcommon0 libasound2 libdbus-1-3 libgbm1 libdrm2
- headless shell 仅支持无头模式（Docker 内本来如此）

## 快速收益项（已获批准）

1. 修复字体清理规则：删除 `NotoSerifCJK-*.ttc`（~53 MB）
2. requirements.txt 移除 pytest（连带 pygments，~12 MB）
3. pip 装完依赖后 `apt-get purge python3-pip`（~22 MB）
4. 移除无人使用的 uv（~1–40 MB）

预计合计：~90–130 MB；叠加 headless shell 后总计 ~350 MB（2.12 GB → ~1.77 GB，-16%）。

## 最终落地结果（2026-09-22 验证）

**镜像体积：2.12 GB → 1.61 GB（-510 MB，-24%）**，本地 `docker build -f Dockerfile` 实测。

| 验证项 | 结果 |
| --- | --- |
| 卡片渲染（中文/西文/emoji，与旧 Chromium 124 baseline 对比） | 视觉逐像素一致（143 vs 124 仅有不可见的抗锯齿差异） |
| 字体解析 | 与旧镜像行为完全一致（`fc-match sans-serif:lang=zh` 两镜像均先命中 NotoSans，按字形回退到 CJK） |
| Python 依赖导入（bilibili_api/PIL/lxml/aiohttp/Cryptodome/yaml/qrcode） | 通过 |
| ffmpeg | 5.1.9 正常 |
| pip3 / uv / chromium / pytest | 均已移除 |
| `docker build --check`（两个 Dockerfile） | 无警告 |

构建期注意事项：
- pip 源：tuna 镜像缺失 aiohttp==3.13.3（同步滞后），本地构建 Dockerfile 改用 aliyun 源，CI 用 Dockerfile.action + 官方 pypi
- browser 阶段的 `--version` 冒烟检查需要完整运行库（libglib2.0-0、libnss3 等），已随阶段安装
- playwright 构建号 1200 同时提供 x64/arm64（1243 仅 arm64），CI 双架构构建可用

## 测试产物

- `test/temp_docker_opt/render_test.js`：渲染对比脚本
- `test/temp_docker_opt/shot_chromium.png` / `shot_headless.png` / `shot_stripped.png`：三张对比截图（MD5 一致）
