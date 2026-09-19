'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const YAML = require('yaml')

const repoRoot = path.join(__dirname, '../../..')
const setupScript = path.join(repoRoot, 'setup.sh')

function writeFakeDocker(fakeBin) {
    fs.mkdirSync(fakeBin, { recursive: true })
    fs.writeFileSync(path.join(fakeBin, 'docker'), `#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [ "$1" = "info" ]; then exit 0; fi
if [ "$1" = "inspect" ]; then printf '%s\n' "\${BILI_TEST_HEALTH_STATE:-healthy}"; exit 0; fi
if [ "$1" = "exec" ] && [ "$2" = "napcat" ]; then
    if [ -n "\${BILI_TEST_NAPCAT_STATE_FILE:-}" ] && [ ! -f "$BILI_TEST_NAPCAT_STATE_FILE" ]; then
        : > "$BILI_TEST_NAPCAT_STATE_FILE"
        exit 1
    fi
    exit 0
fi
if [ "$1" = "exec" ] && echo "$*" | grep -q 'api/live'; then exit 0; fi
if [ "$1" = "exec" ]; then [ "\${BILI_TEST_READY_STATE:-ready}" = "ready" ]; exit $?; fi
if [ "$1" = "logs" ]; then
    if [ -n "\${BILI_TEST_NAPCAT_QR_FIXTURE:-}" ]; then
        printf '%s\n' '请扫描下面的二维码，然后在手Q上授权登录：'
        printf '%s\n' 'QR-FIXTURE-LINE'
        printf '%s\n' '二维码解码URL: https://example.invalid/fixture'
        printf '%s\n' '二维码已保存到 /app/napcat/cache/qrcode.png'
    else
        echo "Login Success"
    fi
    exit 0
fi
if [ "$1" = "run" ]; then
    previous=''
    owner_probe_path=''
    for argument in "$@"; do
        if [ "$previous" = "-v" ]; then
            case "$argument" in
                *:/setup-owner-probe)
                    owner_probe_path="\${argument%:/setup-owner-probe}"
                    ;;
                *:/install)
                    host_path="\${argument%:/install}"
                    mkdir -p "$host_path/config"
                    printf 'version: 1\n' > "$host_path/config/config.yaml"
                    ;;
            esac
        fi
        previous="$argument"
    done
    if [ -n "$owner_probe_path" ]; then
        probe_name=$(cat)
        : > "$owner_probe_path/$probe_name"
    fi
    exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then exit 0; fi
if [ "$1" = "compose" ]; then
    shift
    if [ "$1" = "-f" ]; then shift 2; fi
    if [ "$1 $2" = "config --services" ]; then printf '%s\n' "\${BILI_TEST_QQ_SERVICE:-napcat}" bili-qq-bot; exit 0; fi
    if [ "$1 $2 $3" = "up -d llbot" ] && [ "\${BILI_TEST_QQ_START:-ok}" = "failed" ]; then exit 1; fi
    if [ "$1" = "run" ]; then [ "\${BILI_TEST_ONEBOT_LOGIN:-ok}" = "ok" ]; exit $?; fi
    if [ "$1 $2 $3" = "ps -q bili-qq-bot" ]; then echo "bot-container"; exit 0; fi
fi
exit 0
`, { mode: 0o755 })
}

function runSetup({ installDir, fakeBin, dockerLog, inputs = [], env = {} }) {
    return childProcess.spawnSync('bash', [setupScript], {
        cwd: repoRoot,
        input: [installDir, ...inputs].join('\n') + '\n',
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            BILI_SETUP_TEST_MODE: '1',
            DOCKER_LOG: dockerLog,
            ...env
        }
    })
}

describe('setup.sh lightweight deployment contract', () => {
    let source

    before(() => {
        source = fs.readFileSync(setupScript, 'utf8')
    })

    it('keeps one interactive deployment flow without lifecycle modes', () => {
        for (const removedMode of ['--install', '--upgrade', '--apply', '--dry-run']) {
            assert.ok(!source.includes(removedMode), `unexpected deployment mode: ${removedMode}`)
        }
        assert.match(source, /请输入安装目录/)
        assert.match(source, /compose pull/)
        assert.match(source, /compose up -d/)
    })

    it('generates the canonical YAML config through the application Config CLI', () => {
        assert.match(source, /src\/cli\/config/)
        assert.match(source, /config\/config\.yaml/)
        assert.match(source, /"init"/)
        assert.match(source, /"--provider", process\.env\.SETUP_PROVIDER/)
        assert.match(source, /SETUP_WS_TOKEN/)
        assert.match(source, /SETUP_ADMIN_QQ/)
        assert.match(source, /SETUP_DASHBOARD_PASSWORD/)
    })

    it('does not own migration, publication or recovery transactions', () => {
        for (const removedConcern of [
            'mount-writers.tsv',
            'upgrade-manifest.json',
            'publication-journal',
            'checkpointManifest',
            'discover_mount_writers',
            'rollback_publication'
        ]) {
            assert.ok(!source.includes(removedConcern), `unexpected setup responsibility: ${removedConcern}`)
        }
    })

    it('retains the v3.24.6 deployment essentials', () => {
        assert.match(source, /onebot11_\$bot_qq\.json/)
        assert.match(source, /docker-compose\.yml/)
        assert.match(source, /docker logs -f napcat/)
        assert.match(source, /fonts\/custom/)
        assert.match(source, /docker logs -f bili-qq-bot/)
    })

    it('validates setup inputs and atomically publishes downloaded Compose files', () => {
        assert.match(source, /validate_qq_number/)
        assert.match(source, /validate_port/)
        assert.match(source, /validate_image_reference/)
        assert.match(source, /validate_ws_token/)
        assert.match(source, /validate_ws_url/)
        assert.match(source, /mktemp/)
        assert.match(source, /mv -f "\$temp_file" "\$compose_file"/)
    })

    it('generates the release-matched default Compose template', () => {
        assert.doesNotMatch(source, /refs\/heads\/main\/docker-compose\.yml/)
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-compose-template-'))
        try {
            const output = path.join(root, 'compose.yml')
            const definitions = source.replace(/\nmain "\$@"\s*$/, '\n')
            const result = childProcess.spawnSync('bash', [], {
                input: definitions + '\nwrite_compose_template "' + output + '"\n', encoding: 'utf8'
            })
            assert.equal(result.status, 0, result.stderr)
            const generated = YAML.parse(fs.readFileSync(output, 'utf8'))
            const repository = YAML.parse(fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8'))
            assert.deepStrictEqual(generated, repository)
            assert.equal(generated.services['bili-qq-bot'].stop_grace_period, '420s')
            assert.ok(generated.services.llbot)
            assert.ok(!generated.services.napcat)
        } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })

    it('updates only containers when an existing installation is detected', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-existing-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        const composeSource = 'services:\n  bili-qq-bot:\n    image: existing/image:tag\n'
        const configSource = 'version: 1\nqq:\n  provider: napcat\n'
        const envSource = 'BILI_BOT_IMAGE=existing/image:tag\n'

        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), composeSource)
        fs.writeFileSync(path.join(installDir, 'config/config.yaml'), configSource)
        fs.writeFileSync(path.join(installDir, '.env'), envSource)
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({ installDir, fakeBin, dockerLog })

            assert.equal(result.status, 0, result.stderr || result.stdout)
            assert.match(result.stdout, /检测到已有安装，仅更新现有容器/)
            assert.match(result.stdout, /现有配置和数据均已保留/)
            assert.equal(fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf8'), composeSource)
            assert.equal(fs.readFileSync(path.join(installDir, 'config/config.yaml'), 'utf8'), configSource)
            assert.equal(fs.readFileSync(path.join(installDir, '.env'), 'utf8'), envSource)
            assert.equal(fs.existsSync(path.join(installDir, 'data')), false)

            const dockerCalls = fs.readFileSync(dockerLog, 'utf8')
            assert.match(dockerCalls, /^info$/m)
            assert.match(dockerCalls, /compose -f .*docker-compose\.yml config -q/)
            assert.match(dockerCalls, /compose -f .*docker-compose\.yml pull/)
            assert.match(dockerCalls, /compose -f .*docker-compose\.yml up -d napcat/)
            assert.doesNotMatch(dockerCalls, /exec napcat bash -lc/)
            assert.match(dockerCalls, /compose -f .*docker-compose\.yml up -d --no-deps bili-qq-bot$/m)
            assert.match(dockerCalls, /inspect --format/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })

    it('recognizes all standard Compose filenames for existing installations', () => {
        for (const composeName of ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']) {
            const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-compose-name-'))
            const installDir = path.join(tempRoot, 'install')
            const fakeBin = path.join(tempRoot, 'bin')
            const dockerLog = path.join(tempRoot, 'docker.log')
            fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
            fs.writeFileSync(path.join(installDir, composeName), 'services: {}\n')
            fs.writeFileSync(path.join(installDir, 'config/config.yaml'), 'version: 1\n')
            writeFakeDocker(fakeBin)

            try {
                const result = runSetup({ installDir, fakeBin, dockerLog })
                assert.equal(result.status, 0, `${composeName}: ${result.stderr || result.stdout}`)
                assert.match(result.stdout, /仅更新现有容器/)
                assert.match(fs.readFileSync(dockerLog, 'utf8'), new RegExp(`compose -f .*${composeName.replace('.', '\\.')}`))
            } finally {
                fs.rmSync(tempRoot, { recursive: true, force: true })
            }
        }
    })

    it('fails an update when the Bot container is unhealthy', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-unhealthy-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), 'services: {}\n')
        fs.writeFileSync(path.join(installDir, 'config/config.yaml'), 'version: 1\n')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                env: { BILI_TEST_HEALTH_STATE: 'unhealthy' }
            })
            assert.notEqual(result.status, 0)
            assert.match(result.stderr, /管理面板未在规定时间内进入健康状态/)
            assert.doesNotMatch(result.stdout, /容器更新完成/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })

    it('keeps management available when QQ never becomes ready', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-not-ready-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), 'services: {}\n')
        fs.writeFileSync(path.join(installDir, 'config/config.yaml'), 'version: 1\n')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                env: {
                    BILI_TEST_HEALTH_STATE: 'healthy',
                    BILI_TEST_READY_STATE: 'not-ready',
                    BILI_SETUP_READY_TIMEOUT: '1',
                    BILI_SETUP_POLL_INTERVAL: '0.05'
                }
            })
            assert.equal(result.status, 0)
            assert.match(result.stdout, /管理面板已启动.*QQ 接入尚未就绪/)
            assert.match(result.stdout, /容器更新完成/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    }).timeout(5000)

    it('finishes a fresh install with management available while QQ is offline', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-fresh-not-ready-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                inputs: ['2', '', '', '123456', '', '', '654321', '', '', 'n'],
                env: {
                    BILI_TEST_HEALTH_STATE: 'healthy',
                    BILI_TEST_READY_STATE: 'not-ready',
                    BILI_SETUP_READY_TIMEOUT: '1',
                    BILI_SETUP_POLL_INTERVAL: '0.05'
                }
            })
            assert.equal(result.status, 0)
            assert.match(result.stdout, /管理面板已启动.*QQ 接入尚未就绪/)
            assert.match(result.stdout, /部署完成/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    }).timeout(5000)

    it('reports a fresh install complete after health and readiness both pass', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-fresh-ready-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                inputs: ['2', '', '', '123456', '', '', '654321', '', '', 'n']
            })
            assert.equal(result.status, 0, result.stderr || result.stdout)
            assert.match(result.stdout, /部署完成/)
            const dockerCalls = fs.readFileSync(dockerLog, 'utf8')
            const napcatStart = dockerCalls.indexOf('up -d napcat')
            const napcatLoginCheck = dockerCalls.indexOf('exec napcat bash -lc')
            const botStart = dockerCalls.indexOf('up -d --no-deps bili-qq-bot')
            assert.ok(napcatStart >= 0, dockerCalls)
            assert.equal(napcatLoginCheck, -1)
            assert.ok(botStart > napcatStart, dockerCalls)
            assert.match(dockerCalls, /exec bot-container node -e .*api\/ready/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })

    it('starts the Bot without waiting for a NapCat QR scan', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-napcat-qr-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        const napcatStateFile = path.join(tempRoot, 'napcat-ready')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                inputs: ['2', '', '', '123456', '', '', '654321', '', '', 'n'],
                env: {
                    BILI_TEST_NAPCAT_STATE_FILE: napcatStateFile,
                    BILI_TEST_NAPCAT_QR_FIXTURE: '1',
                    BILI_SETUP_NAPCAT_POLL_INTERVAL: '0.01'
                }
            })

            assert.equal(result.status, 0, result.stderr || result.stdout)
            assert.match(result.stdout, /请完成 QQ 扫码/)
            assert.match(fs.readFileSync(dockerLog, 'utf8'), /up -d --no-deps bili-qq-bot/)
            assert.doesNotMatch(fs.readFileSync(dockerLog, 'utf8'), /exec napcat bash -lc/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })

    it('repairs fresh-install bind mount ownership for the detected container identity', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-sudo-owner-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        const currentUid = process.getuid()
        const currentGid = process.getgid()
        const currentUser = os.userInfo().username
        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.chmodSync(path.join(installDir, 'config'), 0o755)
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                inputs: ['2', '', '', '123456', '', '', '654321', '', '', 'n'],
                env: {
                    SUDO_USER: currentUser,
                    SUDO_UID: String(currentUid),
                    SUDO_GID: String(currentGid)
                }
            })

            assert.equal(result.status, 0, result.stderr || result.stdout)
            const configStat = fs.statSync(path.join(installDir, 'config'))
            const napcatConfigStat = fs.statSync(path.join(installDir, 'napcat/config/onebot11_123456.json'))
            assert.equal(configStat.uid, currentUid)
            assert.equal(configStat.gid, currentGid)
            assert.equal(configStat.mode & 0o777, 0o700)
            assert.equal(napcatConfigStat.uid, currentUid)
            assert.equal(napcatConfigStat.gid, currentGid)
            assert.equal(napcatConfigStat.mode & 0o777, 0o600)
            assert.match(fs.readFileSync(dockerLog, 'utf8'), /:\/setup-owner-probe/)
            assert.match(source, /set_setup_operator_ownership "\$probe_dir"\s+chmod 733 "\$probe_dir"/)
            assert.deepStrictEqual(
                fs.readdirSync(installDir).filter((name) => name.startsWith('.setup-bind-owner.')),
                []
            )
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })

    it('defaults new installations to LLBot with persistent sessions and shared media', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-llbot-'))
        const installDir = path.join(root, 'install')
        const fakeBin = path.join(root, 'bin')
        const dockerLog = path.join(root, 'docker.log')
        writeFakeDocker(fakeBin)
        try {
            const result = runSetup({ installDir, fakeBin, dockerLog,
                inputs: ['', '', '', '123456', '', '', '654321', '', '', 'n'] })
            assert.equal(result.status, 0, result.stderr || result.stdout)
            const compose = YAML.parse(fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf8'))
            assert.ok(compose.services.llbot)
            assert.equal(compose.services.llbot.image, '${BILI_LLBOT_IMAGE:-linyuchen/llbot:latest}')
            assert.ok(!compose.services.napcat)
            assert.ok(compose.services.llbot.volumes.includes('./llbot/data:/app/llbot/data'))
            assert.ok(compose.services.llbot.volumes.includes('./onebot/media:/app/.config/QQ/tmp'))
            const configPath = path.join(installDir, 'llbot/data/config_123456.json')
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
            assert.equal(config.ob11.connect[0].messageFormat, 'array')
            assert.equal(config.ob11.connect[0].enable, true)
            assert.match(config.ob11.connect[0].token, /^[a-f0-9]{32}$/)
            assert.equal(fs.statSync(configPath).mode & 0o777, 0o600)
            assert.equal(fs.statSync(path.dirname(configPath)).mode & 0o777, 0o700)
            assert.match(fs.readFileSync(path.join(installDir, '.env'), 'utf8'), /BILI_BOT_QQ=123456/)
            const calls = fs.readFileSync(dockerLog, 'utf8')
            assert.doesNotMatch(calls, /up -d napcat/)
            assert.ok(calls.indexOf('up -d llbot') < calls.indexOf('up -d --no-deps bili-qq-bot'))
            assert.doesNotMatch(calls, /run --rm --no-deps/)
        } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })

    it('starts management even when the LLBot container cannot start', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-auth-failure-'))
        const installDir = path.join(root, 'install')
        const fakeBin = path.join(root, 'bin')
        const dockerLog = path.join(root, 'docker.log')
        writeFakeDocker(fakeBin)
        try {
            const result = runSetup({ installDir, fakeBin, dockerLog,
                inputs: ['', '', '', '123456', '', '', '654321', '', '', 'n'],
                env: { BILI_TEST_QQ_START: 'failed' } })
            assert.equal(result.status, 0)
            assert.match(result.stdout, /LLBot 启动失败/)
            assert.match(fs.readFileSync(dockerLog, 'utf8'), /up -d --no-deps bili-qq-bot/)
            assert.doesNotMatch(fs.readFileSync(dockerLog, 'utf8'), /run --rm --no-deps/)
            assert.match(result.stdout, /部署完成/)
        } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })

    it('deploys Official directly without a QQ gateway or OneBot login gate', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-official-'))
        const installDir = path.join(root, 'install')
        const fakeBin = path.join(root, 'bin')
        const dockerLog = path.join(root, 'docker.log')
        writeFakeDocker(fakeBin)
        try {
            const result = runSetup({ installDir, fakeBin, dockerLog,
                inputs: ['4', '', '', 'fixture-app', 'fixture-secret', '654321', '', '', 'n'] })
            assert.equal(result.status, 0, result.stderr || result.stdout)
            const compose = YAML.parse(fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf8'))
            assert.deepStrictEqual(Object.keys(compose.services), ['bili-qq-bot'])
            const calls = fs.readFileSync(dockerLog, 'utf8')
            assert.match(calls, /SETUP_PROVIDER=official/)
            assert.match(calls, /SETUP_OFFICIAL_APP_ID=fixture-app/)
            assert.doesNotMatch(calls, /up -d (napcat|llbot)/)
            assert.match(calls, /up -d --no-deps bili-qq-bot/)
            assert.doesNotMatch(result.stdout, /fixture-secret/)
        } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })

    it('connects external implementations without installing a QQ gateway', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-external-'))
        const installDir = path.join(root, 'install')
        const fakeBin = path.join(root, 'bin')
        const dockerLog = path.join(root, 'docker.log')
        writeFakeDocker(fakeBin)
        try {
            const result = runSetup({ installDir, fakeBin, dockerLog,
                inputs: ['3', '', '', 'fixture-token', 'ws://gateway:3001', '654321', '', '', 'n'] })
            assert.equal(result.status, 0, result.stderr || result.stdout)
            const compose = YAML.parse(fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf8'))
            assert.deepStrictEqual(Object.keys(compose.services), ['bili-qq-bot'])
            assert.ok(!compose.services['bili-qq-bot'].depends_on)
            const calls = fs.readFileSync(dockerLog, 'utf8')
            assert.doesNotMatch(calls, /up -d (napcat|llbot)/)
            assert.doesNotMatch(calls, /run --rm --no-deps/)
            assert.match(result.stdout, /共享/)
        } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })

    it('preserves an existing LLBot installation and starts its selected gateway', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-update-llbot-'))
        const installDir = path.join(root, 'install')
        const fakeBin = path.join(root, 'bin')
        const dockerLog = path.join(root, 'docker.log')
        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.writeFileSync(path.join(installDir, 'config/config.yaml'), 'version: 1\n')
        const composeText = 'services:\n  llbot:\n    image: custom/llbot:fixed\n'
        fs.writeFileSync(path.join(installDir, 'compose.yml'), composeText)
        writeFakeDocker(fakeBin)
        try {
            const result = runSetup({ installDir, fakeBin, dockerLog, env: { BILI_TEST_QQ_SERVICE: 'llbot' } })
            assert.equal(result.status, 0, result.stderr || result.stdout)
            assert.equal(fs.readFileSync(path.join(installDir, 'compose.yml'), 'utf8'), composeText)
            const calls = fs.readFileSync(dockerLog, 'utf8')
            assert.match(calls, /up -d llbot/)
            assert.doesNotMatch(calls, /up -d napcat/)
        } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })

    it('lets the application migrate legacy config before the final readiness check', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-legacy-'))
        const installDir = path.join(root, 'install')
        const fakeBin = path.join(root, 'bin')
        const dockerLog = path.join(root, 'docker.log')
        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.writeFileSync(path.join(installDir, 'config/config.json'), '{}\n')
        fs.writeFileSync(path.join(installDir, 'compose.yml'), 'services: {}\n')
        writeFakeDocker(fakeBin)
        try {
            const result = runSetup({ installDir, fakeBin, dockerLog })
            assert.equal(result.status, 0, result.stderr || result.stdout)
            assert.match(result.stdout, /旧版配置/)
            const calls = fs.readFileSync(dockerLog, 'utf8')
            assert.doesNotMatch(calls, /run --rm --no-deps/)
            assert.match(calls, /api\/ready/)
        } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })

    it('rejects unsafe first-install inputs before writing NapCat JSON', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-invalid-token-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                inputs: ['2', '', '', '123456', 'bad"token']
            })
            assert.notEqual(result.status, 0)
            assert.match(result.stderr, /Token 仅支持/)
            assert.equal(fs.existsSync(path.join(installDir, 'napcat/config/onebot11_123456.json')), false)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })
})
