#Requires -Version 5.1
<#
.SYNOPSIS
    bili-qq-bot Windows 部署脚本（setup.sh 的 PowerShell 移植版）。

.DESCRIPTION
    产品契约与 setup.sh 保持一致：
    - 全新目录：选择 OneBot 实现，生成 config/config.yaml、docker-compose.yml 与 .env，并启动容器。
    - 已有安装：保留所有部署/配置/数据文件，仅拉取并重建容器。

    与 Linux 版的差异：
    - 移除 chown/chmod/sudo/UID-GID 探测（Docker Desktop on Windows 无需也不支持）。
    - Docker 缺失时通过 winget 引导安装 Docker Desktop，或提示手动安装。
    - LLBot 扫码登录降级为 WebUI 引导（Windows 控制台不支持 bash 的非阻塞轮询输入）。
    - 终端二维码渲染（python3 依赖）不可用，直接引导 LLBot WebUI 扫码。

    测试开关：$env:BILI_SETUP_TEST_MODE = '1'（跳过 Docker 交互等待）。
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [Text.Encoding]::UTF8

$script:BotImageDefault    = 'unsplash/bili-qq-bot:latest'
$script:NapCatImageDefault = 'mlikiowa/napcat-docker:latest'
$script:LLBotImageDefault  = 'linyuchen/llbot:latest'
$script:QQImplementation   = 'llbot'
$script:QQService          = 'llbot'
$script:LLBotWebuiPassword = ''
$script:NapCatWebuiToken   = ''
$script:LLBotAuthToken     = ''
$script:LLBotAuthTokenUrl  = 'https://auth.luckylillia.com/tokens'
$script:OfficialAppId      = ''
$script:OfficialClientSecret = ''
$script:ComposeFile        = ''
$script:ComposeExitCode    = 0
$script:LLBotWebuiAuth     = ''

function Info([string]$Message) { Write-Host $Message -ForegroundColor Green }
function Warn([string]$Message) { Write-Host $Message -ForegroundColor Yellow }
function Die([string]$Message) {
    Write-Host "错误: $Message" -ForegroundColor Red
    exit 1
}

function Get-RandomToken {
    # 与 openssl rand -hex 16 等价：32 位小写十六进制。
    return (New-Guid).ToString('N')
}

function Read-PromptDefault([string]$Prompt, [string]$DefaultValue) {
    $value = Read-Host "$Prompt (默认: $DefaultValue)"
    if ([string]::IsNullOrWhiteSpace($value)) { return $DefaultValue }
    return $value.Trim()
}

function Read-PromptRequired([string]$Prompt) {
    while ($true) {
        $value = Read-Host $Prompt
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
        Warn '该项不能为空。'
    }
}

function Test-QQNumber([string]$Label, [string]$Value) {
    if ($Value -notmatch '^\d+$') { Die "$Label 必须为纯数字。" }
}

function Test-PortNumber([string]$Label, [string]$Value) {
    if ($Value -notmatch '^\d+$') { Die "$Label 必须为 1-65535 的整数。" }
    $port = [int]$Value
    if ($port -lt 1 -or $port -gt 65535) { Die "$Label 必须为 1-65535 的整数。" }
}

function Test-ImageReference([string]$Value) {
    if ($Value -notmatch '^[A-Za-z0-9._/:@-]+$') { Die 'Bot 镜像名称包含不支持的字符。' }
}

function Test-WsToken([string]$Value) {
    if ($Value -notmatch '^[A-Za-z0-9._~-]+$') { Die 'OneBot WebSocket Token 仅支持字母、数字及 . _ ~ -。' }
}

function Test-WsUrl([string]$Value) {
    if ($Value -notmatch '^wss?://\S+$') { Die 'OneBot WebSocket 地址必须以 ws:// 或 wss:// 开头，且不能包含空白字符。' }
}

function Select-QQImplementation {
    Write-Host 'QQ 接入实现：'
    Write-Host '1) LLBot（默认，Docker 直连模式，需要 LLBot Auth Token）'
    Write-Host '2) NapCat（Docker）'
    Write-Host '3) 已有 OneBot v11 服务（如 SnowLuma；不安装该服务）'
    Write-Host '4) QQ 官方机器人（OpenAPI，不安装 QQ 接入容器）'
    $choice = Read-Host '请选择 [1/2/3/4，默认 1]'
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '1' }
    switch ($choice) {
        '1' {
            $script:QQImplementation = 'llbot'; $script:QQService = 'llbot'
            Warn 'LLBot 不支持单独查询已过滤的入群申请。群管理兼容需要包含 OneBot 兼容层的新版本 Bot 镜像。'
        }
        '2' { $script:QQImplementation = 'napcat'; $script:QQService = 'napcat' }
        '3' { $script:QQImplementation = 'external'; $script:QQService = '' }
        '4' { $script:QQImplementation = 'official'; $script:QQService = '' }
        default { Die '无效的 QQ 接入选项。' }
    }
}

function Install-Docker {
    Warn '未检测到 Docker。'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $choice = Read-Host '是否通过 winget 安装 Docker Desktop？[y/N]'
        if ($choice -match '^[Yy]$') {
            & winget install -e --id Docker.DockerDesktop
            Warn 'Docker Desktop 安装完成后请启动它，然后重新运行本脚本。'
            exit 0
        }
    }
    Die '请先安装 Docker Desktop（https://www.docker.com/products/docker-desktop/）并确认其已启动。'
}

function Test-DockerComposeV2 {
    & docker compose version 1>$null 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-Compose {
    $composeArgs = @()
    if ($script:ComposeFile) { $composeArgs += @('-f', $script:ComposeFile) }
    $composeArgs += $args
    if (Test-DockerComposeV2) {
        & docker compose @composeArgs
    }
    elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        & docker-compose @composeArgs
    }
    else {
        Die '未找到 Docker Compose。'
    }
    $script:ComposeExitCode = $LASTEXITCODE
}

function Write-FileUtf8NoBom([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function Write-NapCatComposeTemplate([string]$OutputFile) {
    $template = @'
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
      WEBUI_TOKEN: ${BILI_NAPCAT_WEBUI_TOKEN:-}
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
'@
    Write-FileUtf8NoBom $OutputFile $template
}

function Get-BotServiceBlock([string]$DependsOnService, [string]$MediaVolumeSource, [string]$MediaVolumeTarget) {
    $dependsOn = ''
    if ($DependsOnService) {
        $dependsOn = @"
    depends_on:
      ${DependsOnService}:
        condition: service_started
"@
    }
    return @"
  bili-qq-bot:
    image: `${BILI_BOT_IMAGE:-unsplash/bili-qq-bot:latest}
    pull_policy: if_not_present
    container_name: bili-qq-bot
    restart: always
    init: true
    stop_grace_period: 420s
$dependsOn
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
        source: $MediaVolumeSource
        target: $MediaVolumeTarget
    ports:
      - "`${BILI_DASHBOARD_HOST_PORT:-3000}:3000"
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
"@
}

function Get-LLBotServiceBlock {
    return @'
  llbot:
    image: ${BILI_LLBOT_IMAGE:-linyuchen/llbot:latest}
    restart: always
    init: true
    stop_grace_period: 30s
    environment:
      TZ: Asia/Shanghai
      AUTO_LOGIN_QQ: ${BILI_BOT_QQ:-}
    ports:
      - "${BILI_LLBOT_WEBUI_HOST_PORT:-3080}:3080"
    volumes:
      - ./llbot/data:/app/llbot/data
      - ./onebot/media:/app/.config/QQ/tmp
    networks:
      - bot_network
'@
}

function Write-ComposeTemplate([string]$OutputFile) {
    $content = ''
    switch ($script:QQImplementation) {
        'napcat' {
            Write-NapCatComposeTemplate $OutputFile
            return
        }
        'llbot' {
            $content = "services:`n" + (Get-LLBotServiceBlock) + "`n`n" + `
                (Get-BotServiceBlock 'llbot' './onebot/media' '/app/.config/QQ/tmp') + "`n`nnetworks:`n  bot_network:`n    driver: bridge`n"
        }
        default {
            # external / official：仅 Bot 容器，依赖外部 OneBot 服务或官方 OpenAPI。
            $content = "services:`n" + `
                (Get-BotServiceBlock '' './onebot/media' '/app/.config/QQ/tmp') + "`n`nnetworks:`n  bot_network:`n    driver: bridge`n"
        }
    }
    Write-FileUtf8NoBom $OutputFile $content
}

function Find-ComposeFile([string]$InstallDir) {
    foreach ($name in @('compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml')) {
        $candidate = Join-Path $InstallDir $name
        if (Test-Path $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

function Test-ExistingConfig([string]$InstallDir) {
    return (Test-Path (Join-Path $InstallDir 'config/config.yaml')) -or
           (Test-Path (Join-Path $InstallDir 'config/config.json')) -or
           (Test-Path (Join-Path $InstallDir 'config/.env'))
}

function Prepare-InstallDirectories([string]$InstallDir) {
    $managedDirectories = @(
        'config', 'data', 'fonts/custom', 'napcat/config', 'napcat/qq',
        'llbot/data', 'onebot/media', 'logs'
    )
    foreach ($relativePath in $managedDirectories) {
        New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir $relativePath) | Out-Null
    }
}

function Prepare-ComposeFile([string]$ComposeFilePath) {
    if (Test-Path $ComposeFilePath -PathType Leaf) {
        $overwrite = Read-Host '检测到 docker-compose.yml，是否使用最新版覆盖？[y/N]'
        if ($overwrite -notmatch '^[Yy]$') {
            Warn '保留现有 docker-compose.yml。'
            return
        }
    }
    $tempFile = "$ComposeFilePath.tmp"
    try {
        Write-ComposeTemplate $tempFile
        Move-Item -Force $tempFile $ComposeFilePath
    }
    finally {
        if (Test-Path $tempFile) { Remove-Item -Force $tempFile }
    }
}

function Write-ComposeEnv([string]$EnvFile, [string]$BotImage, [string]$DashboardPort) {
    if ($script:QQImplementation -eq 'napcat' -and -not $script:NapCatWebuiToken) {
        $script:NapCatWebuiToken = Get-RandomToken
    }
    $lines = @(
        "BILI_BOT_IMAGE=$BotImage",
        "BILI_NAPCAT_IMAGE=$script:NapCatImageDefault",
        "BILI_DASHBOARD_HOST_PORT=$DashboardPort",
        'BILI_NAPCAT_WEBUI_HOST_PORT=6099',
        'BILI_NAPCAT_WS_HOST_PORT=3001',
        "BILI_LLBOT_IMAGE=$script:LLBotImageDefault",
        'BILI_LLBOT_WEBUI_HOST_PORT=3080',
        "BILI_QQ_IMPLEMENTATION=$script:QQImplementation"
    )
    if ($script:NapCatWebuiToken) {
        $lines += "BILI_NAPCAT_WEBUI_TOKEN=$script:NapCatWebuiToken"
    }
    Write-FileUtf8NoBom $EnvFile ($lines -join "`n")
    Add-Content -Path $EnvFile -Value ''
}

function Write-NapCatConfig([string]$InstallDir, [string]$BotQQ, [string]$WsToken) {
    $content = @"
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
        "token": "$WsToken",
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
"@
    Write-FileUtf8NoBom (Join-Path $InstallDir "napcat/config/onebot11_$BotQQ.json") $content
}

function Write-LLBotConfig([string]$InstallDir, [string]$BotQQ, [string]$WsToken) {
    $script:LLBotWebuiPassword = Get-RandomToken
    $configContent = @"
{
  "webui": { "enable": true, "host": "0.0.0.0", "port": 3080 },
  "ob11": {
    "enable": true,
    "connect": [{
      "type": "ws", "enable": true, "host": "0.0.0.0", "port": 3001,
      "token": "$WsToken", "heartInterval": 30000,
      "messageFormat": "array", "reportSelfMessage": false,
      "reportOfflineMessage": false, "debug": false
    }]
  },
  "milky": { "enable": false }, "satori": { "enable": false },
  "ffmpeg": "/usr/bin/ffmpeg"
}
"@
    Write-FileUtf8NoBom (Join-Path $InstallDir "llbot/data/config_$BotQQ.json") $configContent
    Write-FileUtf8NoBom (Join-Path $InstallDir 'llbot/data/webui_token.txt') "$script:LLBotWebuiPassword`n"
    Add-Content -Path (Join-Path $InstallDir '.env') -Value "BILI_BOT_QQ=$BotQQ"
    if ($script:LLBotAuthToken) {
        # LLBot direct 模式标准机制：watcher 监听 data/auth_token.txt 变化，
        # 读取 -> 校验 -> 校验通过即触发登录（等价 WebUI 录入）。
        Write-FileUtf8NoBom (Join-Path $InstallDir 'llbot/data/auth_token.txt') "$script:LLBotAuthToken`n"
        Info 'LLBot Auth Token 已写入 llbot/data/auth_token.txt。'
    }
}

function Resolve-NapCatWebuiToken {
    # NapCat 面板密码优先取 .env 中部署时生成的值；旧安装回退到持久化的 webui.json。
    $token = ''
    if (Test-Path ./.env) {
        $line = Get-Content ./.env | Where-Object { $_ -match '^BILI_NAPCAT_WEBUI_TOKEN=' } | Select-Object -Last 1
        if ($line) { $token = $line.Substring('BILI_NAPCAT_WEBUI_TOKEN='.Length).Trim() }
    }
    if (-not $token -and (Test-Path ./napcat/config/webui.json)) {
        try {
            $json = Get-Content ./napcat/config/webui.json -Raw | ConvertFrom-Json
            if ($json -and $json.PSObject.Properties['token']) { $token = [string]$json.token }
        }
        catch { }
    }
    return $token
}

function Get-SHA256Hex([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLower()
    }
    finally { $sha.Dispose() }
}

function Get-LLBotWebuiBase {
    $port = '3080'
    if (Test-Path ./.env) {
        $line = Get-Content ./.env | Where-Object { $_ -match '^BILI_LLBOT_WEBUI_HOST_PORT=' } | Select-Object -Last 1
        if ($line) {
            $candidate = $line.Substring('BILI_LLBOT_WEBUI_HOST_PORT='.Length).Trim()
            if ($candidate) { $port = $candidate }
        }
    }
    return "http://127.0.0.1:$port"
}

function Invoke-LLBotApiGet([string]$Path) {
    return (& curl.exe -fsS -m 10 -H "X-Webui-Token: $script:LLBotWebuiAuth" "$(Get-LLBotWebuiBase)$Path" 2>$null)
}

function Invoke-LLBotApiPost([string]$Path, [string]$Body) {
    return (& curl.exe -fsS -m 10 -H "X-Webui-Token: $script:LLBotWebuiAuth" -H 'content-type: application/json' -d $Body "$(Get-LLBotWebuiBase)$Path" 2>$null)
}

function Read-LLBotAuthToken([string]$InstallDir) {
    $existing = ''
    $authFile = Join-Path $InstallDir 'llbot/data/auth_token.txt'
    if (Test-Path $authFile) {
        $existing = ((Get-Content $authFile -Raw) -replace '\s', '')
    }
    if ($existing) {
        $script:LLBotAuthToken = $existing
        Info '检测到已有 LLBot Auth Token，将复用。'
        return
    }
    Write-Host ''
    Info 'LLBot 登录 QQ 需要 Auth Token（sign 鉴权用，官方校验通过后会自动发起登录）。'
    Info "申请地址: $script:LLBotAuthTokenUrl"
    while ($true) {
        $value = Read-Host '请输入 LLBot Auth Token'
        $value = ($value -replace '\s', '')
        if ($value) { $script:LLBotAuthToken = $value; return }
        Warn 'Auth Token 不能为空。'
    }
}

function Test-LLBotOnline {
    $body = Invoke-LLBotApiGet '/api/login-info'
    if (-not $body) { return $false }
    return ($body -match '"online"\s*:\s*true')
}

function Update-LLBotAuthToken {
    # token 校验失败时引导重新输入并改写文件（watcher 监听文件变化重新校验）。
    $body = Invoke-LLBotApiGet '/api/auth-token/status'
    if (-not $body) { return }
    if ($body -notmatch '"validation"\s*:\s*"invalid"') { return }
    $message = ''
    if ($body -match '"message"\s*:\s*"([^"]*)"') { $message = $Matches[1] }
    if ($message) { Warn "LLBot Auth Token 校验失败：$message" } else { Warn 'LLBot Auth Token 校验失败。' }
    $script:LLBotAuthToken = ''
    Read-LLBotAuthToken (Get-Location).Path
    if (-not $script:LLBotAuthToken) { return }
    Write-FileUtf8NoBom './llbot/data/auth_token.txt' "$script:LLBotAuthToken`n"
    Info '已更新 LLBot Auth Token，等待重新校验...'
    Start-Sleep -Seconds 5
}

function Start-LLBotQuickLogin {
    # 有历史会话时提供免扫码快速登录；返回 $true 表示已触发或无需处理。
    $body = Invoke-LLBotApiGet '/api/quick-login-list'
    if (-not $body) { return $true }
    $uins = @([regex]::Matches($body, '"uin"\s*:\s*(\d+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    if ($uins.Count -eq 0) { return $true }
    Write-Host ''
    Info '检测到以下可快速登录的 QQ 账号（复用本地会话，无需扫码）：'
    for ($i = 0; $i -lt $uins.Count; $i++) {
        Write-Host ("  {0}) {1}" -f ($i + 1), $uins[$i])
    }
    $choice = Read-Host '选择序号直接登录，直接回车改为扫码登录'
    if ([string]::IsNullOrWhiteSpace($choice)) { return $false }
    $index = 0
    if (-not [int]::TryParse($choice.Trim(), [ref]$index) -or $index -lt 1 -or $index -gt $uins.Count) {
        Warn '无效的选择，改用扫码登录。'
        return $false
    }
    $uin = $uins[$index - 1]
    Invoke-LLBotApiPost '/api/quick-login' ("{`"uin`":`"$uin`"}") | Out-Null
    $deadline = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) + 30
    while (([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -lt $deadline) {
        if (Test-LLBotOnline) {
            Info "QQ $uin 快速登录成功。"
            return $true
        }
        Start-Sleep -Seconds 3
    }
    Warn '快速登录未及时生效，改用扫码登录。'
    return $false
}

function Start-LLBotCliLogin {
    # 交互式命令行登录；任何失败都静默降级（返回 $false），由调用方打印 WebUI 指引。
    # Windows 版不支持终端二维码渲染与非阻塞输入轮询，扫码环节统一引导 WebUI。
    if ($env:BILI_SETUP_TEST_MODE -eq '1') { return $false }
    if ($script:QQImplementation -ne 'llbot') { return $false }
    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { return $false }
    if (-not (Test-Path './llbot/data/webui_token.txt')) { return $false }
    $script:LLBotWebuiAuth = Get-SHA256Hex ((Get-Content './llbot/data/webui_token.txt' -Raw).Trim())
    if (-not $script:LLBotWebuiAuth) { return $false }

    Write-Host ''
    Info '正在等待 LLBot WebUI 就绪...'
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        if (Invoke-LLBotApiGet '/api/login-info') { $ready = $true; break }
        Start-Sleep -Seconds 3
    }
    if (-not $ready) { Warn 'LLBot WebUI 未在预期时间内就绪。'; return $false }

    Update-LLBotAuthToken

    if (Test-LLBotOnline) {
        Info 'LLBot 已在线，无需重新登录。'
        return $true
    }

    return (Start-LLBotQuickLogin)
}

function Start-QQService {
    switch ($script:QQService) {
        'napcat' {
            Invoke-Compose up -d napcat
            if ($script:ComposeExitCode -ne 0) { Warn 'NapCat 启动失败，可在 Bot 管理面板修改接入配置。' }
            $napCatToken = Resolve-NapCatWebuiToken
            Write-Host 'NapCat 面板: http://<服务器IP>:6099/webui'
            if ($napCatToken) { Write-Host "NapCat 面板密码: $napCatToken" }
            Warn '请完成 QQ 扫码；二维码可通过 docker logs -f napcat 查看。'
        }
        'llbot' {
            Invoke-Compose up -d llbot
            if ($script:ComposeExitCode -ne 0) { Warn 'LLBot 启动失败，可在 Bot 管理面板修改接入配置。' }
            if (Start-LLBotCliLogin) {
                Info 'LLBot QQ 登录完成。'
            }
            else {
                Warn '命令行登录未完成，请打开 LLBot 面板 http://<服务器IP>:3080 录入 Auth Token 并扫码登录。'
                if ($script:LLBotWebuiPassword) { Write-Host "LLBot 面板密码: $script:LLBotWebuiPassword" }
                Warn '已有安装的面板密码保存在 llbot/data/webui_token.txt。'
            }
        }
        default {
            if ($script:QQImplementation -eq 'official') {
                Info '官方入口已配置；可在 Bot 管理面板补充或修改凭据。'
            }
            else {
                Warn '请确认已有 OneBot 服务已登录，且 Bot 容器能访问配置的 WebSocket 地址。'
            }
        }
    }
}

function Wait-BotState([bool]$RequireReady, [int]$TimeoutSeconds = 180) {
    $pollSeconds = 3
    if ($env:BILI_SETUP_POLL_INTERVAL) { $pollSeconds = [int]$env:BILI_SETUP_POLL_INTERVAL }
    $started = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $containerId = (Invoke-Compose ps -q bili-qq-bot 2>$null | Select-Object -First 1)
    if (-not $containerId) { return $false }

    while ((([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) - $started) -lt $TimeoutSeconds) {
        $state = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $containerId 2>$null | Select-Object -First 1)
        if ($state -match '^(healthy|running)$') {
            if (-not $RequireReady) {
                & docker exec $containerId node -e "fetch('http://127.0.0.1:3000/api/live', { signal: AbortSignal.timeout(3000) }).then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))" 1>$null 2>$null
                if ($LASTEXITCODE -eq 0) { return $true }
            }
            else {
                & docker exec $containerId node -e "fetch('http://127.0.0.1:3000/api/ready', { signal: AbortSignal.timeout(3000) }).then(r => { if (!r.ok) process.exit(1); return r.json() }).then(body => { if (body.ready !== true) process.exit(1) }).catch(() => process.exit(1))" 1>$null 2>$null
                if ($LASTEXITCODE -eq 0) { return $true }
            }
        }
        elseif ($state -match '^(unhealthy|exited|dead|removing)$') {
            return $false
        }
        Start-Sleep -Seconds $pollSeconds
    }
    return $false
}

function Confirm-ManagementAndReportQQ {
    $liveTimeout = 180
    if ($env:BILI_SETUP_LIVE_TIMEOUT) { $liveTimeout = [int]$env:BILI_SETUP_LIVE_TIMEOUT }
    if (-not (Wait-BotState $false $liveTimeout)) {
        Invoke-Compose ps | Out-Host
        Die 'Bot 管理面板未在规定时间内进入健康状态，请检查 docker logs bili-qq-bot。'
    }
    $readyTimeout = 15
    if ($env:BILI_SETUP_READY_TIMEOUT) { $readyTimeout = [int]$env:BILI_SETUP_READY_TIMEOUT }
    if (-not (Wait-BotState $true $readyTimeout)) {
        if (-not (Wait-BotState $false 5)) { Die 'Bot 管理面板不可用，请检查 docker logs bili-qq-bot。' }
        Warn '管理面板已启动，但 QQ 接入尚未就绪。可登录 WebUI 修改连接配置或切换官方入口；Bot 会在后台重试，不会因 QQ 离线而重启。'
    }
}

function Report-QQPanelAccess {
    switch ($script:QQService) {
        'llbot' {
            if (Test-Path './llbot/data/webui_token.txt') {
                Write-Host 'LLBot 面板: http://<服务器IP>:3080'
                Write-Host "LLBot 面板密码: $((Get-Content './llbot/data/webui_token.txt' -Raw).Trim())"
            }
        }
        'napcat' {
            $token = Resolve-NapCatWebuiToken
            Write-Host 'NapCat 面板: http://<服务器IP>:6099/webui'
            if ($token) {
                Write-Host "NapCat 面板密码: $token"
            }
            else {
                Warn '未找到 NapCat 面板密码，请执行 docker logs napcat 查看。'
            }
        }
    }
}

function Update-ExistingContainers {
    Info '检测到已有安装，仅更新现有容器。'
    Info '校验现有 Compose 配置'
    Invoke-Compose config -q
    if ($script:ComposeExitCode -ne 0) { Die '现有 Compose 配置校验失败。' }

    Write-Host '拉取部署镜像...'
    Invoke-Compose pull bili-qq-bot
    if ($script:ComposeExitCode -ne 0) { Die 'Bot 镜像拉取失败。' }

    $services = @(Invoke-Compose config --services)
    $script:QQService = ''
    if ($services | Where-Object { $_ -eq 'llbot' }) { $script:QQService = 'llbot' }
    elseif ($services | Where-Object { $_ -eq 'napcat' }) { $script:QQService = 'napcat' }
    if ($script:QQService) {
        Invoke-Compose pull $script:QQService
        if ($script:ComposeExitCode -ne 0) { Warn 'QQ 接入镜像拉取失败，仍启动管理面板。' }
    }
    Start-QQService
    if (-not (Test-Path 'config/config.yaml')) { Warn '检测到旧版配置：由 Bot 启动时迁移。' }

    Info '重建并启动 Bot 管理面板'
    Invoke-Compose up -d --no-deps bili-qq-bot
    if ($script:ComposeExitCode -ne 0) { Die 'Bot 管理面板启动失败。' }
    Confirm-ManagementAndReportQQ
    Invoke-Compose ps | Out-Host

    Write-Host ''
    Report-QQPanelAccess
    Write-Host ''
    Info '容器更新完成。现有配置和数据均已保留。'
}

function Generate-ConfigYaml([string]$InstallDir, [string]$BotImage, [string]$WsUrl,
    [string]$WsToken, [string]$AdminQQ, [string]$DashboardPort,
    [string]$DashboardPassword, [string]$AllowedOrigins) {

    $provider = 'napcat'
    if ($script:QQImplementation -eq 'official') { $provider = 'official' }
    $nodeScript = @'
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
'@
    & docker run --rm `
        -e "SETUP_PROVIDER=$provider" `
        -e "SETUP_OFFICIAL_APP_ID=$script:OfficialAppId" `
        -e "SETUP_OFFICIAL_CLIENT_SECRET=$script:OfficialClientSecret" `
        -e "SETUP_WS_URL=$WsUrl" `
        -e "SETUP_WS_TOKEN=$WsToken" `
        -e "SETUP_ADMIN_QQ=$AdminQQ" `
        -e "SETUP_DASHBOARD_PORT=$DashboardPort" `
        -e "SETUP_DASHBOARD_PASSWORD=$DashboardPassword" `
        -e "SETUP_ALLOWED_ORIGINS=$AllowedOrigins" `
        -v "${InstallDir}:/install" `
        --entrypoint node `
        $BotImage -e $nodeScript
    if ($LASTEXITCODE -ne 0) { Die '生成 config/config.yaml 失败。' }
}

function Main {
    Info '[1/8] 检测运行环境'
    # Windows 不需要 root/sudo 检查；Docker Desktop 权限由安装程序处理。

    Info '[2/8] 检测 Docker'
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Install-Docker }
    & docker info 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) { Die 'Docker 服务不可用。请确认 Docker Desktop 已启动。' }

    Info '[3/8] 设置安装目录'
    $installInput = Read-Host '请输入安装目录 (留空使用当前目录)'
    if ([string]::IsNullOrWhiteSpace($installInput)) {
        $installDir = (Get-Location).Path
    }
    else {
        $installDir = $installInput.Trim()
        New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    }
    $installDir = (Resolve-Path $installDir).Path
    Set-Location $installDir

    $existingCompose = $null
    if (Test-ExistingConfig $installDir) {
        $existingCompose = Find-ComposeFile $installDir
    }
    if ($existingCompose) {
        $script:ComposeFile = $existingCompose
        Update-ExistingContainers
        return
    }

    Select-QQImplementation

    Info '[4/8] 创建目录'
    Prepare-InstallDirectories $installDir

    Info '[5/8] 准备部署配置'
    $botImage = Read-PromptDefault 'Bot 镜像' $script:BotImageDefault
    $dashboardPort = Read-PromptDefault 'WebUI 宿主机端口' '3000'
    $configFile = Join-Path $installDir 'config/config.yaml'
    $script:ComposeFile = Join-Path $installDir 'docker-compose.yml'

    Test-ImageReference $botImage
    Test-PortNumber 'WebUI 宿主机端口' $dashboardPort

    Prepare-ComposeFile $script:ComposeFile
    Write-ComposeEnv (Join-Path $installDir '.env') $botImage $dashboardPort

    Write-Host '拉取部署镜像...'
    Invoke-Compose pull bili-qq-bot
    if ($script:ComposeExitCode -ne 0) { Die 'Bot 镜像拉取失败。' }
    if ($script:QQService) {
        Invoke-Compose pull $script:QQService
        if ($script:ComposeExitCode -ne 0) { Warn 'QQ 接入镜像拉取失败，仍启动管理面板。' }
    }

    $overwriteConfig = 'y'
    if (Test-Path $configFile -PathType Leaf) {
        $answer = Read-Host '检测到 config/config.yaml，是否重新生成？[y/N]'
        if (-not [string]::IsNullOrWhiteSpace($answer)) { $overwriteConfig = $answer.Trim() }
        else { $overwriteConfig = 'n' }
    }

    $dashboardPassword = ''
    if (-not (Test-Path $configFile -PathType Leaf) -or $overwriteConfig -match '^[Yy]$') {
        $botQQ = ''
        $wsToken = ''
        $wsUrl = 'ws://napcat:3001'
        if ($script:QQImplementation -eq 'official') {
            $appIdInput = Read-Host 'QQ 官方 AppID（可留空，稍后在面板配置）'
            $script:OfficialAppId = $appIdInput.Trim()
            $secretSecure = Read-Host 'QQ 官方 ClientSecret（可留空，稍后在面板配置）' -AsSecureString
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretSecure)
            try {
                $script:OfficialClientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
                if ($null -eq $script:OfficialClientSecret) { $script:OfficialClientSecret = '' }
            }
            finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
            }
        }
        else {
            if ($script:QQImplementation -ne 'external') {
                $botQQ = Read-PromptRequired '请输入 Bot QQ 号'
                Test-QQNumber 'Bot QQ 号' $botQQ
            }
            $wsTokenInput = Read-Host '请输入 OneBot WebSocket Token (新服务留空自动生成；已有服务请填实际值)'
            $wsToken = $wsTokenInput.Trim()
            if ($script:QQImplementation -ne 'external' -and -not $wsToken) {
                $wsToken = Get-RandomToken
            }
            if ($wsToken) { Test-WsToken $wsToken }
            if ($script:QQImplementation -eq 'external') {
                $wsUrl = Read-PromptRequired '已有服务的 WebSocket 地址（必须能从 Bot 容器访问）'
                Warn '媒体文件需共享：请将安装目录 onebot/media 同时挂载到接入服务的 /app/.config/QQ/tmp。'
                Warn '若服务在其他主机，须自行提供共享文件系统；否则图片和视频发送无法工作。'
            }
            else {
                $wsUrl = Read-PromptDefault 'OneBot WebSocket 地址' "ws://$script:QQService`:3001"
            }
            Test-WsUrl $wsUrl
        }
        $adminQQ = Read-PromptRequired '请输入管理员 QQ 号'
        Test-QQNumber '管理员 QQ 号' $adminQQ
        $dashboardPassword = Read-PromptDefault 'WebUI 面板密码' 'admin'
        $allowedOrigins = Read-Host '允许访问 WebUI 的公网 Origin (可留空)'
        $allowedOrigins = $allowedOrigins.Trim()

        if ($script:QQImplementation -eq 'llbot') {
            Read-LLBotAuthToken $installDir
        }

        switch ($script:QQImplementation) {
            'napcat' { Write-NapCatConfig $installDir $botQQ $wsToken }
            'llbot' { Write-LLBotConfig $installDir $botQQ $wsToken }
        }
        Generate-ConfigYaml $installDir $botImage $wsUrl $wsToken $adminQQ $dashboardPort $dashboardPassword $allowedOrigins
        Info '已生成新版 config/config.yaml。'
    }
    else {
        Warn '保留现有 config/config.yaml。'
    }

    Info '[6/8] 校验 Compose'
    Invoke-Compose config -q
    if ($script:ComposeExitCode -ne 0) { Die 'Compose 配置校验失败。' }

    Info '[7/8] 启动 QQ 接入服务'
    Start-QQService

    Info '[8/8] 启动 Bot 管理面板'
    Invoke-Compose up -d --no-deps bili-qq-bot
    if ($script:ComposeExitCode -ne 0) { Die 'Bot 管理面板启动失败。' }
    Confirm-ManagementAndReportQQ
    Invoke-Compose ps | Out-Host

    Write-Host ''
    Info '部署完成。'
    Write-Host "WebUI: http://<服务器IP>:$dashboardPort"
    if ($dashboardPassword) { Write-Host "面板密码: $dashboardPassword" }
    Report-QQPanelAccess
    Write-Host 'Bot 日志: docker logs -f bili-qq-bot'
}

Main
