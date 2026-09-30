# syntax=docker/dockerfile:1
#
# 统一构建入口（本地与 CI 共用）。
# 国内构建可通过 build-arg 切换镜像源，例如：
#   docker build \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg APT_MIRROR=mirrors.tuna.tsinghua.edu.cn \
#     --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
#     -t subx-bot .

ARG NODE_IMAGE=node:24-bookworm-slim
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG APT_MIRROR=""
ARG PIP_INDEX_URL=https://pypi.org/simple

# 阶段1：安装后端 Node 生产依赖（仅保留运行所需包）
FROM ${NODE_IMAGE} AS deps
ARG NPM_REGISTRY

WORKDIR /app

# 跳过 Puppeteer 自带 Chromium 下载，统一使用独立下载的 headless shell
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true

# 仅拷贝依赖清单以利用 Docker 缓存
COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force


# 阶段2：构建 dashboard 前端静态资源
FROM ${NODE_IMAGE} AS dashboard-builder
ARG NPM_REGISTRY

WORKDIR /app/dashboard

# 先安装 dashboard 依赖（加速二次构建）
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
    && npm ci --no-audit --no-fund \
    && npm cache clean --force

COPY src/shared /app/src/shared
# 拷贝 dashboard 源码并执行生产构建（输出 dist）
COPY dashboard/ ./
RUN npm run build


# 阶段3：下载并裁剪 chrome-headless-shell（替代完整 Chromium，体积更小）
# npmmirror 的 chrome-for-testing 无 arm64 包，playwright 构建同时提供 x64/arm64
FROM ${NODE_IMAGE} AS browser

ARG TARGETARCH
ENV PW_BUILD=1200

RUN set -eux; \
    arch="${TARGETARCH:-amd64}"; \
    case "${arch}" in \
        amd64) zip="chromium-headless-shell-linux.zip" ;; \
        arm64) zip="chromium-headless-shell-linux-arm64.zip" ;; \
        *) echo "unsupported arch: ${arch}"; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl unzip binutils ca-certificates \
      libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
      libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxi6 \
      libxrandr2 libxrender1 libxkbcommon0 libasound2 libdbus-1-3 libgbm1 libdrm2; \
    curl -fsSL -o /tmp/chs.zip "https://registry.npmmirror.com/-/binary/playwright/builds/chromium/${PW_BUILD}/${zip}"; \
    unzip -q /tmp/chs.zip -d /tmp; \
    srcdir="$(find /tmp -maxdepth 1 -mindepth 1 -type d | head -1)"; \
    mv "${srcdir}" /chs; \
    if [ -f /chs/chrome-headless-shell ]; then mv /chs/chrome-headless-shell /chs/headless_shell; fi; \
    strip --strip-unneeded /chs/headless_shell; \
    rm -f /tmp/chs.zip; \
    chmod +x /chs/headless_shell; \
    /chs/headless_shell --version


# 阶段4：运行时镜像（只包含运行必需内容）
FROM ${NODE_IMAGE} AS runtime

WORKDIR /app

ARG TARGETARCH
ARG APT_MIRROR
ARG PIP_INDEX_URL

# 可选：切换 apt 源（如 APT_MIRROR=mirrors.tuna.tsinghua.edu.cn）
RUN set -eux; \
    if [ -n "${APT_MIRROR}" ]; then \
        rm -f /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; \
        printf '%s\n' \
          "deb http://${APT_MIRROR}/debian/ bookworm main contrib non-free non-free-firmware" \
          "deb http://${APT_MIRROR}/debian/ bookworm-updates main contrib non-free non-free-firmware" \
          "deb http://${APT_MIRROR}/debian/ bookworm-backports main contrib non-free non-free-firmware" \
          "deb http://${APT_MIRROR}/debian-security bookworm-security main contrib non-free non-free-firmware" \
          > /etc/apt/sources.list; \
    fi

## 安装系统依赖 + 静态 ffmpeg + Python 依赖（单一 RUN，同层清理缓存）
##  headless shell 运行库替代完整 Chromium 的 gtk/llvm/mesa 依赖链
##  静态 ffmpeg 无额外依赖库，比 apt 版显著更小
##  johnvansickle 为主源（CI 可达），国内构建失败时回退 gh-proxy 的 BtbN 构建
COPY requirements.txt ./
RUN set -eux; \
    arch="${TARGETARCH:-amd64}"; \
    case "${arch}" in \
        amd64) btbn="linux64" ;; \
        arm64) btbn="linuxarm64" ;; \
        *) echo "unsupported arch: ${arch}"; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      curl \
      xz-utils \
      ca-certificates \
      fontconfig \
      fonts-noto-cjk \
      fonts-noto-core \
      fonts-noto-color-emoji \
      fonts-symbola \
      libnss3 \
      libnspr4 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libatspi2.0-0 \
      libx11-6 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxkbcommon0 \
      libasound2 \
      libdbus-1-3 \
      libgbm1 \
      libdrm2; \
    for url in \
        "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch}-static.tar.xz" \
        "https://gh-proxy.org/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${btbn}-gpl.tar.xz"; do \
        rm -f /tmp/ffmpeg.tar.xz; \
        if curl -fsSL --http1.1 --retry 5 --retry-all-errors -C - -o /tmp/ffmpeg.tar.xz "$url" \
            && [ "$(od -An -N6 -tx1 /tmp/ffmpeg.tar.xz | tr -d ' \n')" = "fd377a585a00" ]; then \
            break; \
        fi; \
    done; \
    [ "$(od -An -N6 -tx1 /tmp/ffmpeg.tar.xz 2>/dev/null | tr -d ' \n')" = "fd377a585a00" ] || { echo "no valid ffmpeg archive downloaded"; exit 1; }; \
    tar -xJf /tmp/ffmpeg.tar.xz -C /tmp; \
    install -m 0755 "$(find /tmp -maxdepth 2 -type f -name ffmpeg | head -1)" /usr/local/bin/ffmpeg; \
    rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-*-static /tmp/ffmpeg-master-latest-*; \
    ffmpeg -version; \
    pip3 install --no-cache-dir -r requirements.txt --break-system-packages -i "${PIP_INDEX_URL}"; \
    apt-get purge -y python3-pip curl xz-utils; \
    apt-get autoremove -y; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*; \
    rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/*; \
    rm -f /usr/share/fonts/opentype/noto/NotoSerifCJK-*.ttc; \
    rm -f requirements.txt; \
    fc-cache -fv

# 运行时环境变量：生产模式 + Puppeteer 浏览器路径
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/chs/headless_shell

## 按变更频率从低到高拷贝：依赖与浏览器几乎不变，源码每次发版都变。
## 这样纯代码发版只需重新下载末尾的 dist/src 小层。
COPY --from=deps /app/node_modules ./node_modules
COPY --from=browser /chs /chs
COPY package.json package-lock.json ./
RUN mkdir -p logs temp config fonts data/downloads /app/.config/QQ/tmp/
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
COPY src ./src

# Dashboard 端口
EXPOSE 3000

# 启动入口
CMD ["node", "src/bot.js"]
