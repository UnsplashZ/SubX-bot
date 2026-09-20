#!/bin/bash

set -Eeuo pipefail

# Product contract:
# - Fresh directory: select a OneBot implementation, generate config/config.yaml, and start containers.
# - Existing installation: preserve all deployment/config/data files and only pull/recreate containers.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BOT_IMAGE_DEFAULT='unsplash/bili-qq-bot:latest'
NAPCAT_IMAGE_DEFAULT='mlikiowa/napcat-docker:latest'
LLBOT_IMAGE_DEFAULT='linyuchen/llbot:latest'
QQ_IMPLEMENTATION='llbot'
QQ_SERVICE='llbot'
LLBOT_WEBUI_PASSWORD=''
LLBOT_AUTH_TOKEN=''
LLBOT_AUTH_TOKEN_URL='https://auth.luckylillia.com/tokens'
LLBOT_QR_HELPER_URLS=(
    'https://raw.githubusercontent.com/UnsplashZ/SubX-bot/main/scripts/llbot-qrcode.py'
    'https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/SubX-bot/main/scripts/llbot-qrcode.py'
)
OFFICIAL_APP_ID=''
OFFICIAL_CLIENT_SECRET=''
COMPOSE_FILE=''
SETUP_OPERATOR_UID=''
SETUP_OPERATOR_GID=''
SETUP_CONTAINER_UID=''
SETUP_CONTAINER_GID=''

info() {
    echo -e "${GREEN}$*${NC}"
}

warn() {
    echo -e "${YELLOW}$*${NC}"
}

die() {
    echo -e "${RED}错误: $*${NC}" >&2
    exit 1
}

prompt_default() {
    local prompt="$1"
    local default_value="$2"
    local value
    read -r -p "$prompt (默认: $default_value): " value
    printf '%s' "${value:-$default_value}"
}

prompt_required() {
    local prompt="$1"
    local value
    while true; do
        read -r -p "$prompt: " value
        if [ -n "$value" ]; then
            printf '%s' "$value"
            return 0
        fi
        warn "该项不能为空。"
    done
}

validate_qq_number() {
    local label="$1"
    local value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] || die "$label 必须为纯数字。"
}

validate_port() {
    local label="$1"
    local value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] || die "$label 必须为 1-65535 的整数。"
    [ "$value" -ge 1 ] && [ "$value" -le 65535 ] || die "$label 必须为 1-65535 的整数。"
}

validate_image_reference() {
    local value="$1"
    [[ "$value" =~ ^[A-Za-z0-9._/:@-]+$ ]] || die "Bot 镜像名称包含不支持的字符。"
}

validate_ws_token() {
    local value="$1"
    [[ "$value" =~ ^[A-Za-z0-9._~-]+$ ]] || die "OneBot WebSocket Token 仅支持字母、数字及 . _ ~ -。"
}

validate_ws_url() {
    local value="$1"
    [[ "$value" =~ ^wss?://[^[:space:]]+$ ]] || die "OneBot WebSocket 地址必须以 ws:// 或 wss:// 开头，且不能包含空白字符。"
}

select_qq_implementation() {
    echo 'QQ 接入实现：'
    echo '1) LLBot（默认，Docker 直连模式，需要 LLBot Auth Token）'
    echo '2) NapCat（Docker）'
    echo '3) 已有 OneBot v11 服务（如 SnowLuma；不安装该服务）'
    echo '4) QQ 官方机器人（OpenAPI，不安装 QQ 接入容器）'
    local choice
    read -r -p '请选择 [1/2/3/4，默认 1]: ' choice
    case "${choice:-1}" in
        1)
            QQ_IMPLEMENTATION='llbot'; QQ_SERVICE='llbot'
            warn 'LLBot 不支持单独查询已过滤的入群申请。群管理兼容需要包含 OneBot 兼容层的新版本 Bot 镜像。'
            ;;
        2) QQ_IMPLEMENTATION='napcat'; QQ_SERVICE='napcat' ;;
        3) QQ_IMPLEMENTATION='external'; QQ_SERVICE='' ;;
        4) QQ_IMPLEMENTATION='official'; QQ_SERVICE='' ;;
        *) die '无效的 QQ 接入选项。' ;;
    esac
}

resolve_setup_operator() {
    SETUP_OPERATOR_UID=$(id -u)
    SETUP_OPERATOR_GID=$(id -g)

    if [ "$EUID" -ne 0 ] || [ -z "${SUDO_USER:-}" ]; then
        return 0
    fi
    [[ "${SUDO_UID:-}" =~ ^[0-9]+$ ]] || die "无法识别 sudo 调用用户 UID。"
    [[ "${SUDO_GID:-}" =~ ^[0-9]+$ ]] || die "无法识别 sudo 调用用户 GID。"

    local resolved_uid resolved_gid
    resolved_uid=$(id -u "$SUDO_USER" 2>/dev/null) || die "无法识别 sudo 调用用户 $SUDO_USER。"
    resolved_gid=$(id -g "$SUDO_USER" 2>/dev/null) || die "无法识别 sudo 调用用户 $SUDO_USER。"
    [ "$resolved_uid" = "$SUDO_UID" ] || die "sudo 调用用户 UID 校验失败。"
    [ "$resolved_gid" = "$SUDO_GID" ] || die "sudo 调用用户 GID 校验失败。"

    SETUP_OPERATOR_UID="$resolved_uid"
    SETUP_OPERATOR_GID="$resolved_gid"
}

prepare_install_directories() {
    local install_dir="$1"
    local relative_path
    local -a managed_directories=(
        config
        data
        fonts/custom
        napcat/config
        napcat/qq
        llbot/data
        onebot/media
        logs
    )

    mkdir -p "${managed_directories[@]/#/$install_dir/}"
    for relative_path in "${managed_directories[@]}"; do
        chown "$SETUP_OPERATOR_UID:$SETUP_OPERATOR_GID" "$install_dir/$relative_path"
    done
    chmod 700 "$install_dir/config"
}

set_setup_operator_ownership() {
    chown "$SETUP_OPERATOR_UID:$SETUP_OPERATOR_GID" "$@"
}

read_numeric_ownership() {
    local target_path="$1"
    if stat -c '%u:%g' "$target_path" >/dev/null 2>&1; then
        stat -c '%u:%g' "$target_path"
    else
        stat -f '%u:%g' "$target_path"
    fi
}

prepare_container_bind_mounts() {
    local install_dir="$1"
    local bot_image="$2"
    local probe_dir probe_file probe_name ownership relative_path
    local -a managed_directories=(
        config
        data
        fonts/custom
        napcat/config
        napcat/qq
        llbot/data
        onebot/media
        logs
    )

    probe_dir=$(mktemp -d "$install_dir/.setup-bind-owner.XXXXXX")
    probe_name="owner-$(random_token)"
    probe_file="$probe_dir/$probe_name"
    set_setup_operator_ownership "$probe_dir"
    chmod 733 "$probe_dir"
    if ! printf '%s' "$probe_name" | docker run --rm -i \
        -v "$probe_dir:/setup-owner-probe" \
        --entrypoint node \
        "$bot_image" -e \
        'const fs = require("fs"); const name = fs.readFileSync(0, "utf8"); if (!/^owner-[a-f0-9]{32}$/.test(name)) process.exit(2); fs.writeFileSync(`/setup-owner-probe/${name}`, "", { mode: 0o600, flag: "wx" })'; then
        rmdir "$probe_dir" 2>/dev/null || true
        die "无法确认 Docker 容器对安装目录的写入身份。"
    fi

    if [ -L "$probe_file" ] || [ ! -f "$probe_file" ]; then
        rm -f "$probe_file"
        rmdir "$probe_dir" 2>/dev/null || true
        die "Docker 容器写入身份探测文件无效。"
    fi
    if ! ownership=$(read_numeric_ownership "$probe_file"); then
        rm -f "$probe_file"
        rmdir "$probe_dir" 2>/dev/null || true
        die "无法读取 Docker 容器写入身份。"
    fi
    SETUP_CONTAINER_UID=${ownership%%:*}
    SETUP_CONTAINER_GID=${ownership##*:}
    rm -f "$probe_file"
    rmdir "$probe_dir"
    [[ "$SETUP_CONTAINER_UID" =~ ^[0-9]+$ ]] || die "Docker 容器写入 UID 无效。"
    [[ "$SETUP_CONTAINER_GID" =~ ^[0-9]+$ ]] || die "Docker 容器写入 GID 无效。"

    for relative_path in "${managed_directories[@]}"; do
        chown "$SETUP_CONTAINER_UID:$SETUP_CONTAINER_GID" "$install_dir/$relative_path"
    done
    chmod 700 "$install_dir/config"
}

set_container_ownership() {
    chown "$SETUP_CONTAINER_UID:$SETUP_CONTAINER_GID" "$@"
}

random_token() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 16
    else
        od -An -N16 -tx1 /dev/urandom | tr -d ' \n'
    fi
}

download_with_fallback() {
    local output_file="$1"
    shift
    local url
    for url in "$@"; do
        if command -v curl >/dev/null 2>&1 && curl -fsSL "$url" -o "$output_file"; then
            return 0
        fi
        if command -v wget >/dev/null 2>&1 && wget -qO "$output_file" "$url"; then
            return 0
        fi
    done
    return 1
}

write_napcat_compose_template() {
    local output_file="$1"
    cat > "$output_file" <<'EOF'
services:
  napcat:
    image: ${BILI_NAPCAT_IMAGE:-mlikiowa/napcat-docker:latest}
    container_name: napcat
    restart: always
    init: true
    stop_grace_period: 30s
    ports:
      - "${BILI_NAPCAT_WEBUI_HOST_PORT:-6099}:6099"
      - "${BILI_NAPCAT_WS_HOST_PORT:-3001}:3001"
    environment:
      TZ: Asia/Shanghai
      WS_ENABLE: "true"
      HTTP_ENABLE: "true"
    volumes:
      - type: bind
        source: ./napcat/config
        target: /app/napcat/config
      - type: bind
        source: ./napcat/qq
        target: /app/.config/QQ
    networks:
      - bot_network

  bili-qq-bot:
    image: ${BILI_BOT_IMAGE:-unsplash/bili-qq-bot:latest}
    pull_policy: if_not_present
    container_name: bili-qq-bot
    restart: always
    init: true
    stop_grace_period: 420s
    depends_on:
      napcat:
        condition: service_started
    environment:
      TZ: Asia/Shanghai
    volumes:
      - type: bind
        source: ./config
        target: /app/config
      - type: bind
        source: ./data
        target: /app/data
      - type: bind
        source: ./logs
        target: /app/logs
      - type: bind
        source: ./fonts/custom
        target: /app/fonts/custom
      - type: bind
        source: ./napcat/qq
        target: /app/.config/QQ
    ports:
      - "${BILI_DASHBOARD_HOST_PORT:-3000}:3000"
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:3000/api/live')
          .then(r=>{if(!r.ok)process.exit(1)})
          .catch(()=>process.exit(1))
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    networks:
      - bot_network

networks:
  bot_network:
    driver: bridge
EOF
}

write_compose_template() {
    local output_file="$1"
    if [ "$QQ_IMPLEMENTATION" = 'napcat' ]; then
        write_napcat_compose_template "$output_file"
        return
    fi
    local base_file
    base_file=$(mktemp "${output_file}.base.XXXXXX")
    write_napcat_compose_template "$base_file"
    {
        echo 'services:'
        if [ "$QQ_IMPLEMENTATION" = 'llbot' ]; then
            cat <<'EOF'
  llbot:
    image: ${BILI_LLBOT_IMAGE:-linyuchen/llbot:latest}
    restart: always
    init: true
    stop_grace_period: 30s
    environment:
      TZ: Asia/Shanghai
      AUTO_LOGIN_QQ: ${BILI_BOT_QQ:-}
    ports:
      - "127.0.0.1:${BILI_LLBOT_WEBUI_HOST_PORT:-3080}:3080"
    volumes:
      - ./llbot/data:/app/llbot/data
      - ./onebot/media:/app/.config/QQ/tmp
    networks:
      - bot_network

EOF
        fi
        awk -v implementation="$QQ_IMPLEMENTATION" '
            /^  bili-qq-bot:/ { emit = 1 }
            !emit { next }
            /^    depends_on:/ {
                if (implementation == "llbot") {
                    print "    depends_on:"
                    print "      llbot:"
                    print "        condition: service_started"
                }
                skip = 1
                next
            }
            skip && /^    [a-z]/ { skip = 0 }
            skip { next }
            /source: .\/napcat\/qq/ { sub("./napcat/qq", "./onebot/media") }
            /target: \/app\/\.config\/QQ$/ { sub("/app/.config/QQ", "/app/.config/QQ/tmp") }
            { print }
        ' "$base_file"
    } > "$output_file"
    rm -f "$base_file"
}

compose() {
    local compose_args=()
    if [ -n "$COMPOSE_FILE" ]; then
        compose_args=(-f "$COMPOSE_FILE")
    fi
    if docker compose version >/dev/null 2>&1; then
        docker compose "${compose_args[@]}" "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "${compose_args[@]}" "$@"
    else
        die "未找到 Docker Compose。"
    fi
}

install_docker() {
    warn "未检测到 Docker。"
    command -v curl >/dev/null 2>&1 || die "自动安装 Docker 需要 curl。请先安装 curl 后重试。"
    echo "1) 国内镜像源"
    echo "2) Docker 官方源"
    local choice
    read -r -p "请选择安装源 [1/2]: " choice
    case "$choice" in
        1) bash <(curl -fsSL https://linuxmirrors.cn/docker.sh) ;;
        2) curl -fsSL https://get.docker.com/ | sh ;;
        *) die "无效选项。" ;;
    esac
    hash -r
    command -v docker >/dev/null 2>&1 || die "Docker 安装后仍不可用，请重新登录后再试。"
}

prepare_compose_file() {
    local script_dir="$1"
    local compose_file="$2"
    local overwrite='y'

    if [ -f "$compose_file" ]; then
        read -r -p "检测到 docker-compose.yml，是否使用最新版覆盖？[y/N]: " overwrite
    fi
    if [ -f "$compose_file" ] && [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
        warn "保留现有 docker-compose.yml。"
        return 0
    fi

    local temp_file
    temp_file=$(mktemp "${compose_file}.tmp.XXXXXX")
    write_compose_template "$temp_file"
    mv -f "$temp_file" "$compose_file"
}

find_compose_file() {
    local install_dir="$1"
    local name
    for name in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
        if [ -f "$install_dir/$name" ]; then
            printf '%s' "$install_dir/$name"
            return 0
        fi
    done
    return 1
}

has_existing_config() {
    local install_dir="$1"
    [ -f "$install_dir/config/config.yaml" ] ||
    [ -f "$install_dir/config/config.json" ] ||
    [ -f "$install_dir/config/.env" ]
}

wait_for_bot_state() {
    local require_ready="$1"
    local timeout_seconds="${2:-180}"
    local poll_seconds="${BILI_SETUP_POLL_INTERVAL:-3}"
    local started container_id state
    started=$(date +%s)
    container_id=$(compose ps -q bili-qq-bot 2>/dev/null || true)
    [ -n "$container_id" ] || return 1

    while [ $(( $(date +%s) - started )) -lt "$timeout_seconds" ]; do
        state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
        case "$state" in
            healthy|running)
                if [ "$require_ready" != '1' ]; then
                    if docker exec "$container_id" node -e \
                        "fetch('http://127.0.0.1:3000/api/live', { signal: AbortSignal.timeout(3000) }).then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))" >/dev/null 2>&1; then
                        return 0
                    fi
                elif docker exec "$container_id" node -e \
                    "fetch('http://127.0.0.1:3000/api/ready', { signal: AbortSignal.timeout(3000) }).then(r => { if (!r.ok) process.exit(1); return r.json() }).then(body => { if (body.ready !== true) process.exit(1) }).catch(() => process.exit(1))" \
                    >/dev/null 2>&1; then
                    return 0
                fi
                ;;
            unhealthy|exited|dead|removing) return 1 ;;
        esac
        sleep "$poll_seconds"
    done
    return 1
}

verify_management_and_report_qq() {
    if ! wait_for_bot_state 0 "${BILI_SETUP_LIVE_TIMEOUT:-180}"; then
        compose ps || true
        die 'Bot 管理面板未在规定时间内进入健康状态，请检查 docker logs bili-qq-bot。'
    fi
    if ! wait_for_bot_state 1 "${BILI_SETUP_READY_TIMEOUT:-15}"; then
        wait_for_bot_state 0 5 || die 'Bot 管理面板不可用，请检查 docker logs bili-qq-bot。'
        warn '管理面板已启动，但 QQ 接入尚未就绪。可登录 WebUI 修改连接配置或切换官方入口；Bot 会在后台重试，不会因 QQ 离线而重启。'
    fi
}

update_existing_containers() {
    info "检测到已有安装，仅更新现有容器。"
    info "校验现有 Compose 配置"
    compose config -q

    echo "拉取部署镜像..."
    compose pull bili-qq-bot

    local services
    services=$(compose config --services)
    QQ_SERVICE=''
    if printf '%s\n' "$services" | grep -qx 'llbot'; then QQ_SERVICE='llbot';
    elif printf '%s\n' "$services" | grep -qx 'napcat'; then QQ_SERVICE='napcat'; fi
    [ -z "$QQ_SERVICE" ] || compose pull "$QQ_SERVICE" || warn 'QQ 接入镜像拉取失败，仍启动管理面板。'
    start_qq_service
    [ -f config/config.yaml ] || warn '检测到旧版配置：由 Bot 启动时迁移。'

    info "重建并启动 Bot 管理面板"
    compose up -d --no-deps bili-qq-bot
    verify_management_and_report_qq
    compose ps

    echo
    info "容器更新完成。现有配置和数据均已保留。"
}

write_compose_env() {
    local env_file="$1"
    local bot_image="$2"
    local dashboard_port="$3"
    cat > "$env_file" <<EOF
BILI_BOT_IMAGE=$bot_image
BILI_NAPCAT_IMAGE=$NAPCAT_IMAGE_DEFAULT
BILI_DASHBOARD_HOST_PORT=$dashboard_port
BILI_NAPCAT_WEBUI_HOST_PORT=6099
BILI_NAPCAT_WS_HOST_PORT=3001
BILI_LLBOT_IMAGE=$LLBOT_IMAGE_DEFAULT
BILI_LLBOT_WEBUI_HOST_PORT=3080
BILI_QQ_IMPLEMENTATION=$QQ_IMPLEMENTATION
EOF
    set_setup_operator_ownership "$env_file"
    chmod 600 "$env_file"
}

write_llbot_config() {
    local install_dir="$1" bot_qq="$2" ws_token="$3"
    LLBOT_WEBUI_PASSWORD=$(random_token)
    cat > "$install_dir/llbot/data/config_$bot_qq.json" <<EOF
{
  "webui": { "enable": true, "host": "0.0.0.0", "port": 3080 },
  "ob11": {
    "enable": true,
    "connect": [{
      "type": "ws", "enable": true, "host": "0.0.0.0", "port": 3001,
      "token": "$ws_token", "heartInterval": 30000,
      "messageFormat": "array", "reportSelfMessage": false,
      "reportOfflineMessage": false, "debug": false
    }]
  },
  "milky": { "enable": false }, "satori": { "enable": false },
  "ffmpeg": "/usr/bin/ffmpeg"
}
EOF
    printf '%s\n' "$LLBOT_WEBUI_PASSWORD" > "$install_dir/llbot/data/webui_token.txt"
    printf 'BILI_BOT_QQ=%s\n' "$bot_qq" >> "$install_dir/.env"
    if [ -n "$LLBOT_AUTH_TOKEN" ]; then
        # LLBot direct 模式标准机制：watcher 监听 data/auth_token.txt 变化，
        # 读取 -> 校验 -> 校验通过即触发登录（等价 WebUI 录入）。
        printf '%s\n' "$LLBOT_AUTH_TOKEN" > "$install_dir/llbot/data/auth_token.txt"
        chmod 600 "$install_dir/llbot/data/auth_token.txt"
        info 'LLBot Auth Token 已写入 llbot/data/auth_token.txt。'
    fi
    set_container_ownership "$install_dir/llbot/data/config_$bot_qq.json" "$install_dir/llbot/data/webui_token.txt"
    [ ! -f "$install_dir/llbot/data/auth_token.txt" ] || set_container_ownership "$install_dir/llbot/data/auth_token.txt"
    chmod 700 "$install_dir/llbot/data"
    chmod 600 "$install_dir/llbot/data/config_$bot_qq.json" "$install_dir/llbot/data/webui_token.txt"
}

# ---- LLBot 命令行登录（Auth Token 录入 + 终端二维码扫码） ----
# 依赖 LLBot WebUI 后端接口（X-Webui-Token: sha256(webui密码) 鉴权）：
#   GET  /api/auth-token/status   token 校验状态
#   GET  /api/login-info          { online, uin, ... }
#   GET  /api/quick-login-list    历史会话快速登录
#   GET  /api/login-qrcode        { qrcodeUrl, expireTime, ... }
# 任一环节不可用都降级为原有提示（打开 WebUI 完成登录），不影响部署流程。

sha256_hex() {
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$1" | sha256sum | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
    else
        return 1
    fi
}

llbot_webui_base() {
    local port
    port=$(grep -E '^BILI_LLBOT_WEBUI_HOST_PORT=' ./.env 2>/dev/null | tail -n1 | cut -d= -f2)
    printf 'http://127.0.0.1:%s' "${port:-3080}"
}

llbot_api_get() {
    curl -fsS -m 10 -H "X-Webui-Token: $LLBOT_WEBUI_AUTH" "$(llbot_webui_base)$1" 2>/dev/null
}

llbot_api_post() {
    curl -fsS -m 10 -H "X-Webui-Token: $LLBOT_WEBUI_AUTH" -H 'content-type: application/json' -d "$2" "$(llbot_webui_base)$1" 2>/dev/null
}

prompt_llbot_auth_token() {
    local install_dir="$1" existing=''
    if [ -f "$install_dir/llbot/data/auth_token.txt" ]; then
        existing=$(tr -d '[:space:]' < "$install_dir/llbot/data/auth_token.txt" 2>/dev/null)
    fi
    if [ -n "$existing" ]; then
        LLBOT_AUTH_TOKEN="$existing"
        info '检测到已有 LLBot Auth Token，将复用。'
        return 0
    fi
    echo
    info 'LLBot 登录 QQ 需要 Auth Token（sign 鉴权用，官方校验通过后会自动发起登录）。'
    info "申请地址: $LLBOT_AUTH_TOKEN_URL"
    local value=''
    while [ -z "$value" ]; do
        read -r -p '请输入 LLBot Auth Token: ' value
        value=$(printf '%s' "$value" | tr -d '[:space:]')
        [ -n "$value" ] || warn 'Auth Token 不能为空。'
    done
    LLBOT_AUTH_TOKEN="$value"
}

resolve_llbot_qr_helper() {
    # 优先使用随仓库分发的本地副本（git clone 安装），否则从 GitHub 下载到临时文件。
    local candidate
    for candidate in './scripts/llbot-qrcode.py'; do
        if [ -f "$candidate" ]; then
            printf '%s' "$candidate"
            return 0
        fi
    done
    command -v python3 >/dev/null 2>&1 || return 1
    local url tmp
    tmp=$(mktemp /tmp/llbot-qrcode.XXXXXX.py) || return 1
    for url in "${LLBOT_QR_HELPER_URLS[@]}"; do
        if curl -fsSL -m 15 "$url" -o "$tmp" 2>/dev/null && grep -q 'class QrCode' "$tmp"; then
            printf '%s' "$tmp"
            return 0
        fi
    done
    rm -f "$tmp"
    return 1
}

render_llbot_qr() {
    local helper
    helper=$(resolve_llbot_qr_helper) || return 1
    python3 "$helper" "$1" 2>/dev/null || return 1
}

llbot_poll_online() {
    # 返回 0 表示已在线
    local body
    body=$(llbot_api_get /api/login-info) || return 1
    printf '%s' "$body" | grep -q '"online":true'
}

llbot_refresh_auth_token() {
    # token 校验失败时引导重新输入并改写文件（watcher 监听文件变化重新校验）。
    local body validation message
    body=$(llbot_api_get /api/auth-token/status) || return 0
    validation=$(printf '%s' "$body" | sed -n 's/.*"validation":"\([^"]*\)".*/\1/p')
    [ "$validation" = 'invalid' ] || return 0
    message=$(printf '%s' "$body" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p')
    warn "LLBot Auth Token 校验失败${message:+：$message}"
    LLBOT_AUTH_TOKEN=''
    prompt_llbot_auth_token "$(pwd)"
    [ -n "$LLBOT_AUTH_TOKEN" ] || return 0
    printf '%s\n' "$LLBOT_AUTH_TOKEN" > ./llbot/data/auth_token.txt
    chmod 600 ./llbot/data/auth_token.txt
    info '已更新 LLBot Auth Token，等待重新校验...'
    sleep 5
}

llbot_try_quick_login() {
    # 有历史会话时提供免扫码快速登录；返回 0 表示已触发或无需处理。
    local body uins i uin
    body=$(llbot_api_get /api/quick-login-list) || return 0
    uins=$(printf '%s' "$body" | grep -o '"uin":[0-9]*' | cut -d: -f2 | sort -u)
    [ -n "$uins" ] || return 0
    echo
    info '检测到以下可快速登录的 QQ 账号（复用本地会话，无需扫码）：'
    i=0
    for uin in $uins; do
        i=$((i + 1))
        echo "  $i) $uin"
    done
    local choice=''
    read -r -p '选择序号直接登录，直接回车改为扫码登录: ' choice
    [ -n "$choice" ] || return 1
    [[ "$choice" =~ ^[0-9]+$ ]] || { warn '无效的选择，改用扫码登录。'; return 1; }
    uin=$(printf '%s\n' "$uins" | sed -n "${choice}p")
    [ -n "$uin" ] || { warn '无效的选择，改用扫码登录。'; return 1; }
    llbot_api_post /api/quick-login "{\"uin\":\"$uin\"}" >/dev/null || warn '快速登录触发失败，改用扫码登录。'
    local deadline=$(( $(date +%s) + 30 ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if llbot_poll_online; then
            info "QQ $uin 快速登录成功。"
            return 0
        fi
        sleep 3
    done
    warn '快速登录未及时生效，改用扫码登录。'
    return 1
}

llbot_qr_login() {
    local deadline=$(( $(date +%s) + 300 ))
    local qr_json url expire qr_deadline answered
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if llbot_poll_online; then
            info 'QQ 登录成功。'
            return 0
        fi
        qr_json=$(llbot_api_get /api/login-qrcode) || { sleep 3; continue; }
        url=$(printf '%s' "$qr_json" | sed -n 's/.*"qrcodeUrl":"\([^"]*\)".*/\1/p')
        expire=$(printf '%s' "$qr_json" | sed -n 's/.*"expireTime":\([0-9]*\).*/\1/p')
        [ -n "$url" ] || { sleep 3; continue; }
        echo
        echo '--------------------------------------------------------------'
        info '请使用手机 QQ 扫描下方二维码登录'
        if ! render_llbot_qr "$url"; then
            warn '终端二维码渲染失败（需要 python3）。'
            return 1
        fi
        echo '二维码过期会自动刷新；输入 s 回车跳过，稍后可在 LLBot WebUI 扫码。'
        qr_deadline=$(( $(date +%s) + ${expire:-60} - 5 ))
        while [ "$(date +%s)" -lt "$qr_deadline" ]; do
            if llbot_poll_online; then
                echo
                info 'QQ 登录成功。'
                return 0
            fi
            answered=''
            read -r -t 3 answered || true
            if [ "$answered" = 's' ] || [ "$answered" = 'S' ]; then
                warn '已跳过命令行扫码。'
                return 1
            fi
        done
        info '二维码已过期，正在获取新二维码...'
    done
    warn '扫码登录等待超时。'
    return 1
}

llbot_cli_login() {
    # 交互式命令行登录；任何失败都静默降级（返回 1），由调用方打印 WebUI 指引。
    # 自动化测试模式无真实 WebUI，直接跳过轮询等待。
    [ "${BILI_SETUP_TEST_MODE:-0}" != '1' ] || return 1
    [ "$QQ_IMPLEMENTATION" = 'llbot' ] || return 1
    command -v curl >/dev/null 2>&1 || return 1
    [ -f ./llbot/data/webui_token.txt ] || return 1
    LLBOT_WEBUI_AUTH=$(sha256_hex "$(cat ./llbot/data/webui_token.txt)") || return 1

    echo
    info '正在等待 LLBot WebUI 就绪...'
    local ready='' i
    for i in $(seq 1 30); do
        if llbot_api_get /api/login-info >/dev/null 2>&1; then ready=1; break; fi
        sleep 3
    done
    [ -n "$ready" ] || { warn 'LLBot WebUI 未在预期时间内就绪。'; return 1; }

    llbot_refresh_auth_token || true

    if llbot_poll_online; then
        info 'LLBot 已在线，无需重新登录。'
        return 0
    fi

    if llbot_try_quick_login; then
        return 0
    fi

    llbot_qr_login || return 1
}

start_qq_service() {
    case "$QQ_SERVICE" in
        napcat)
            compose up -d napcat || warn 'NapCat 启动失败，可在 Bot 管理面板修改接入配置。'
            warn '请完成 QQ 扫码；二维码可通过 docker logs -f napcat 查看。'

            ;;
        llbot)
            compose up -d llbot || warn 'LLBot 启动失败，可在 Bot 管理面板修改接入配置。'
            if llbot_cli_login; then
                info 'LLBot QQ 登录完成。'
            else
                warn '命令行登录未完成，请打开 LLBot 面板 http://127.0.0.1:3080 录入 Auth Token 并扫码登录。'
                warn '远程部署请先建立 SSH 隧道：ssh -L 3080:127.0.0.1:3080 <服务器>'
                [ -z "$LLBOT_WEBUI_PASSWORD" ] || printf 'LLBot 面板密码: %s\n' "$LLBOT_WEBUI_PASSWORD"
                warn '已有安装的面板密码保存在 llbot/data/webui_token.txt。'
            fi
            ;;
        '')
            if [ "$QQ_IMPLEMENTATION" = 'official' ]; then
                info '官方入口已配置；可在 Bot 管理面板补充或修改凭据。'
            else
                warn '请确认已有 OneBot 服务已登录，且 Bot 容器能访问配置的 WebSocket 地址。'
            fi
            ;;
    esac
}

write_napcat_config() {
    local install_dir="$1"
    local bot_qq="$2"
    local ws_token="$3"
    cat > "$install_dir/napcat/config/onebot11_$bot_qq.json" <<EOF
{
  "network": {
    "httpServers": [],
    "httpSseServers": [],
    "httpClients": [],
    "websocketServers": [
      {
        "enable": true,
        "name": "bot",
        "host": "0.0.0.0",
        "port": 3001,
        "reportSelfMessage": false,
        "enableForcePushEvent": true,
        "messagePostFormat": "array",
        "token": "$ws_token",
        "debug": false,
        "heartInterval": 30000
      }
    ],
    "websocketClients": [],
    "plugins": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false
}
EOF
    set_container_ownership "$install_dir/napcat/config/onebot11_$bot_qq.json"
    chmod 600 "$install_dir/napcat/config/onebot11_$bot_qq.json"
}

generate_config_yaml() {
    local install_dir="$1"
    local bot_image="$2"
    local ws_url="$3"
    local ws_token="$4"
    local admin_qq="$5"
    local dashboard_port="$6"
    local dashboard_password="$7"
    local allowed_origins="$8"

    local provider='napcat'
    [ "$QQ_IMPLEMENTATION" != 'official' ] || provider='official'
    docker run --rm \
        -e SETUP_PROVIDER="$provider" \
        -e SETUP_OFFICIAL_APP_ID="$OFFICIAL_APP_ID" \
        -e SETUP_OFFICIAL_CLIENT_SECRET="$OFFICIAL_CLIENT_SECRET" \
        -e SETUP_WS_URL="$ws_url" \
        -e SETUP_WS_TOKEN="$ws_token" \
        -e SETUP_ADMIN_QQ="$admin_qq" \
        -e SETUP_DASHBOARD_PORT="$dashboard_port" \
        -e SETUP_DASHBOARD_PASSWORD="$dashboard_password" \
        -e SETUP_ALLOWED_ORIGINS="$allowed_origins" \
        -v "$install_dir:/install" \
        --entrypoint node \
        "$bot_image" -e '
const fs = require("fs")
const { run } = require("/app/src/cli/config")
const input = {
    provider: process.env.SETUP_PROVIDER,
    officialAppId: process.env.SETUP_OFFICIAL_APP_ID,
    officialClientSecret: process.env.SETUP_OFFICIAL_CLIENT_SECRET,
    rootAdminQQ: process.env.SETUP_ADMIN_QQ,
    wsUrl: process.env.SETUP_WS_URL,
    wsToken: process.env.SETUP_WS_TOKEN,
    dashboardPassword: process.env.SETUP_DASHBOARD_PASSWORD,
    env: {
        DASHBOARD_PORT: process.env.SETUP_DASHBOARD_PORT,
        DASHBOARD_ALLOWED_ORIGINS: process.env.SETUP_ALLOWED_ORIGINS
    }
}
fs.writeFileSync("/tmp/setup-config-input.json", `${JSON.stringify(input)}\n`, { mode: 0o600 })
Promise.resolve(run([
    "init", "--output", "/install/config/config.yaml",
    "--provider", process.env.SETUP_PROVIDER, "--input", "/tmp/setup-config-input.json", "--force"
])).catch((error) => {
    console.error(error && (error.code || error.message) || error)
    process.exit(1)
})
'
    chmod 600 "$install_dir/config/config.yaml"
}

main() {
    info "[1/8] 检测运行环境"
    if [ "${BILI_SETUP_TEST_MODE:-0}" != '1' ] && [ "$EUID" -ne 0 ]; then
        die "请使用 root 用户或 sudo 运行此脚本。"
    fi
    info "[2/8] 检测 Docker"
    command -v docker >/dev/null 2>&1 || install_docker
    docker info >/dev/null 2>&1 || die "Docker 服务不可用。"

    info "[3/8] 设置安装目录"
    local install_input install_dir script_dir
    read -r -p "请输入安装目录 (留空使用当前目录): " install_input
    install_dir="${install_input:-$(pwd)}"
    mkdir -p "$install_dir"
    install_dir=$(cd "$install_dir" && pwd)
    script_dir=$(cd "$(dirname "$0")" && pwd)
    cd "$install_dir"
    resolve_setup_operator

    local existing_compose=''
    if has_existing_config "$install_dir"; then
        existing_compose=$(find_compose_file "$install_dir" || true)
    fi
    if [ -n "$existing_compose" ]; then
        COMPOSE_FILE="$existing_compose"
        update_existing_containers
        return 0
    fi

    select_qq_implementation

    info "[4/8] 创建目录"
    prepare_install_directories "$install_dir"

    info "[5/8] 准备部署配置"
    local bot_image dashboard_port config_file overwrite_config
    bot_image=$(prompt_default "Bot 镜像" "$BOT_IMAGE_DEFAULT")
    dashboard_port=$(prompt_default "WebUI 宿主机端口" "3000")
    config_file="$install_dir/config/config.yaml"
    COMPOSE_FILE="$install_dir/docker-compose.yml"

    validate_image_reference "$bot_image"
    validate_port "WebUI 宿主机端口" "$dashboard_port"

    prepare_compose_file "$script_dir" "$install_dir/docker-compose.yml"
    write_compose_env "$install_dir/.env" "$bot_image" "$dashboard_port"

    echo "拉取部署镜像..."
    BILI_BOT_IMAGE="$bot_image" compose pull bili-qq-bot
    [ -z "$QQ_SERVICE" ] || compose pull "$QQ_SERVICE" || warn 'QQ 接入镜像拉取失败，仍启动管理面板。'
    prepare_container_bind_mounts "$install_dir" "$bot_image"

    overwrite_config='y'
    if [ -f "$config_file" ]; then
        read -r -p "检测到 config/config.yaml，是否重新生成？[y/N]: " overwrite_config
    fi

    local dashboard_password=''
    if [ ! -f "$config_file" ] || [[ "$overwrite_config" =~ ^[Yy]$ ]]; then
        local bot_qq ws_token ws_url admin_qq allowed_origins
        bot_qq=''
        ws_url='ws://napcat:3001'
        ws_token=''
        if [ "$QQ_IMPLEMENTATION" = 'official' ]; then
            read -r -p 'QQ 官方 AppID（可留空，稍后在面板配置）: ' OFFICIAL_APP_ID
            read -r -s -p 'QQ 官方 ClientSecret（可留空，稍后在面板配置）: ' OFFICIAL_CLIENT_SECRET
            echo
        else
            if [ "$QQ_IMPLEMENTATION" != 'external' ]; then
                bot_qq=$(prompt_required "请输入 Bot QQ 号")
                validate_qq_number "Bot QQ 号" "$bot_qq"
            fi
            read -r -p "请输入 OneBot WebSocket Token (新服务留空自动生成；已有服务请填实际值): " ws_token
            if [ "$QQ_IMPLEMENTATION" != 'external' ]; then
                ws_token="${ws_token:-$(random_token)}"
            fi
            [ -z "$ws_token" ] || validate_ws_token "$ws_token"
            if [ "$QQ_IMPLEMENTATION" = 'external' ]; then
                ws_url=$(prompt_required '已有服务的 WebSocket 地址（必须能从 Bot 容器访问）')
                warn '媒体文件需共享：请将安装目录 onebot/media 同时挂载到接入服务的 /app/.config/QQ/tmp。'
                warn '若服务在其他主机，须自行提供共享文件系统；否则图片和视频发送无法工作。'
            else
                ws_url=$(prompt_default "OneBot WebSocket 地址" "ws://$QQ_SERVICE:3001")
            fi
            validate_ws_url "$ws_url"
        fi
        admin_qq=$(prompt_required "请输入管理员 QQ 号")
        validate_qq_number "管理员 QQ 号" "$admin_qq"
        dashboard_password=$(prompt_default "WebUI 面板密码" "admin")
        read -r -p "允许访问 WebUI 的公网 Origin (可留空): " allowed_origins

        if [ "$QQ_IMPLEMENTATION" = 'llbot' ]; then
            prompt_llbot_auth_token "$install_dir"
        fi

        case "$QQ_IMPLEMENTATION" in
            napcat) write_napcat_config "$install_dir" "$bot_qq" "$ws_token" ;;
            llbot) write_llbot_config "$install_dir" "$bot_qq" "$ws_token" ;;
        esac
        generate_config_yaml \
            "$install_dir" "$bot_image" "$ws_url" "$ws_token" "$admin_qq" \
            "$dashboard_port" "$dashboard_password" "$allowed_origins"
        info "已生成新版 config/config.yaml。"
    else
        warn "保留现有 config/config.yaml。"
    fi

    info "[6/8] 校验 Compose"
    compose config -q

    info "[7/8] 启动 QQ 接入服务"
    start_qq_service

    info "[8/8] 启动 Bot 管理面板"
    compose up -d --no-deps bili-qq-bot
    verify_management_and_report_qq
    compose ps

    echo
    info "部署完成。"
    echo "WebUI: http://<服务器IP>:$dashboard_port"
    [ -z "$dashboard_password" ] || echo "面板密码: $dashboard_password"
    echo "Bot 日志: docker logs -f bili-qq-bot"
}

main "$@"
