# 阶段1：安装后端 Node 生产依赖（仅保留运行所需包）
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# 跳过 Puppeteer 自带 Chromium 下载，统一使用独立下载的 headless shell
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true

# 仅拷贝依赖清单以利用 Docker 缓存
COPY package.json package-lock.json ./
# 安装生产依赖并清理 npm 缓存
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force


# 阶段2：构建 dashboard 前端静态资源
FROM node:22-bookworm-slim AS dashboard-builder

WORKDIR /app/dashboard

# 先安装 dashboard 依赖（加速二次构建）
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --no-audit --no-fund \
    && npm cache clean --force

COPY src/shared /app/src/shared
# 拷贝 dashboard 源码并执行生产构建（输出 dist）
COPY dashboard/ ./
RUN npm run build


# 阶段3：下载并裁剪 chrome-headless-shell（替代完整 Chromium，体积更小）
# npmmirror 的 chrome-for-testing 无 arm64 包，playwright 构建同时提供 x64/arm64
FROM node:22-bookworm-slim AS browser

ARG TARGETARCH
ENV PW_BUILD=1200

RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) zip="chromium-headless-shell-linux.zip" ;; \
        arm64) zip="chromium-headless-shell-linux-arm64.zip" ;; \
        *) echo "unsupported arch: ${TARGETARCH}"; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl unzip binutils ca-certificates \
      libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
      libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxi6 \
      libxrandr2 libxrender1 libxkbcommon0 libasound2 libdbus-1-3 libgbm1 libdrm2; \
    curl -fsSL -o /tmp/chs.zip "https://registry.npmmirror.com/-/binary/playwright/builds/chromium/${PW_BUILD}/${zip}"; \
    unzip -q /tmp/chs.zip -d /tmp; \
    mv /tmp/chrome-linux /chs; \
    strip --strip-unneeded /chs/headless_shell; \
    rm -f /tmp/chs.zip; \
    chmod +x /chs/headless_shell; \
    /chs/headless_shell --version


# 阶段4：运行时镜像（只包含运行必需内容）
FROM node:22-bookworm-slim

WORKDIR /app

# 切换 apt 源为国内镜像
RUN set -eux; \
    rm -f /etc/apt/sources.list; \
    rm -f /etc/apt/sources.list.d/debian.sources; \
    printf '%s\n' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-backports main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware' \
      > /etc/apt/sources.list

## 安装系统依赖 + Python 依赖（单一 RUN，同层清理 pip 与缓存）
##  headless shell 运行库替代完整 Chromium 的 gtk/llvm/mesa 依赖链
COPY requirements.txt ./
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      fonts-noto-cjk \
      fonts-noto-core \
      fonts-noto-color-emoji \
      fonts-symbola \
      ffmpeg \
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
      libdrm2 \
    && pip3 install --no-cache-dir -r requirements.txt --break-system-packages -i https://mirrors.aliyun.com/pypi/simple/ \
    && apt-get purge -y python3-pip \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/* \
    && rm -f /usr/share/fonts/opentype/noto/NotoSerifCJK-*.ttc \
    && rm -f requirements.txt \
    && fc-cache -fv

# 运行时环境变量：生产模式 + Puppeteer 浏览器路径
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/chs/headless_shell

## 仅拷贝运行需要的文件：生产 node_modules、后端源码、配置模板、前端 dist、浏览器
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
COPY --from=browser /chs /chs

# 创建运行期目录（日志/临时文件/下载目录/QQ 临时目录）
RUN mkdir -p logs temp config fonts data/downloads /app/.config/QQ/tmp/

# Dashboard 端口
EXPOSE 3000

# 启动入口
CMD ["node", "src/bot.js"]
