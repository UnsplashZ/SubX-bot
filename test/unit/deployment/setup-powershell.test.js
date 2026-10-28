'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')

const repoRoot = path.join(__dirname, '../../..')
const setupPath = path.join(repoRoot, 'setup.ps1')
let supportsNativeArgumentModes = false
const powershell = [process.env.PWSH, 'pwsh', 'powershell.exe'].filter(Boolean).find(command => {
    const result = childProcess.spawnSync(command, [
        '-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'
    ], { encoding: 'utf8', timeout: 15000 })
    if (result.error || result.status !== 0) return false
    const [major, minor] = result.stdout.trim().split('.').map(Number)
    supportsNativeArgumentModes = major > 7 || (major === 7 && minor >= 3)
    return true
})
const argumentModes = supportsNativeArgumentModes
    ? (process.platform === 'win32' ? ['Legacy', 'Standard', 'Windows'] : ['Legacy', 'Standard'])
    : ['Legacy']

const driver = `
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object Text.UTF8Encoding($false)
$PSNativeCommandArgumentPassing = $env:BILI_TEST_ARGUMENT_MODE
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($env:BILI_TEST_SETUP, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'setup.ps1 syntax errors' }
foreach ($name in @('Die', 'Get-LLBotWebuiBase', 'Invoke-LLBotApiPost', 'Generate-ConfigYaml')) {
    $definition = $ast.Find({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if (-not $definition) { throw "Missing function: $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
$case = ConvertFrom-Json ([IO.File]::ReadAllText($env:BILI_TEST_CASE))
$script:QQImplementation = $case.implementation
$script:OfficialAppId = $case.officialAppId
$script:OfficialClientSecret = $case.officialClientSecret
$script:LLBotWebuiAuth = 'test-auth'
if ($case.action -eq 'post') {
    Invoke-LLBotApiPost '/api/quick-login' $case.body
} else {
    Generate-ConfigYaml $case.installDir 'example.invalid/bot:test' $case.wsUrl $case.wsToken $case.adminQQ $case.dashboardPort $case.dashboardPassword $case.allowedOrigins
}
`

// A native executable receives the arguments and stdin after PowerShell has
// serialized them. A PowerShell function mock would miss the quoting regression.
const nativeCapture = `
const fs = require('fs')
const path = require('path')
fs.writeFileSync(process.env.BILI_TEST_CAPTURE, JSON.stringify({
    argv: [path.basename(process.argv[1]), ...process.argv.slice(2)],
    stdin: fs.readFileSync(0, 'utf8')
}))
process.stdout.write('{"ok":true}\\n')
process.exit(Number(process.env.BILI_TEST_NATIVE_EXIT || 0))
`

const httpCapture = `
const fs = require('fs')
const http = require('http')
const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
        fs.writeFileSync(process.env.BILI_TEST_CAPTURE, JSON.stringify({
            method: request.method, url: request.url, headers: request.headers,
            stdin: Buffer.concat(chunks).toString('utf8')
        }))
        response.end('{"ok":true}')
    })
})
server.listen(0, '127.0.0.1', () => console.log(server.address().port))
`

function executeConfigSource(source) {
    const writes = []
    const calls = []
    vm.runInNewContext(source, {
        Buffer,
        require(name) {
            if (name === 'fs') return { writeFileSync: (...args) => writes.push(args) }
            if (name === '/app/src/cli/config') return { run: args => { calls.push(Array.from(args)) } }
            throw new Error(`Unexpected module: ${name}`)
        },
        console: { error: () => { throw new Error('Unexpected config generation error') } },
        process: { exit: () => { throw new Error('Unexpected config generation exit') } }
    }, { timeout: 1000 })
    assert.strictEqual(writes.length, 1)
    assert.strictEqual(writes[0][0], '/tmp/setup-config-input.json')
    assert.strictEqual(writes[0][2].mode, 0o600)
    assert.strictEqual(calls.length, 1)
    const input = JSON.parse(writes[0][1])
    assert.deepStrictEqual(calls[0], [
        'init', '--output', '/install/config/config.yaml',
        '--provider', input.provider, '--input', '/tmp/setup-config-input.json', '--force'
    ])
    return input
}

describe('setup.ps1 native input transport', function () {
    this.timeout(30000)
    let root
    let fakeBin

    before(function () {
        if (!powershell) this.skip()
    })

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-ps-'))
        fakeBin = path.join(root, 'native tools')
        fs.mkdirSync(fakeBin)
        for (const name of [process.platform === 'win32' ? 'docker.exe' : 'docker']) {
            const target = path.join(fakeBin, name)
            try {
                fs.linkSync(process.execPath, target)
            } catch {
                fs.copyFileSync(process.execPath, target)
                fs.chmodSync(target, 0o755)
            }
        }
        if (process.platform !== 'win32') {
            const curl = childProcess.spawnSync('which', ['curl'], { encoding: 'utf8' })
            assert.strictEqual(curl.status, 0, 'curl is required for the HTTP transport test')
            fs.symlinkSync(curl.stdout.trim(), path.join(fakeBin, 'curl.exe'))
        }
        fs.writeFileSync(path.join(root, 'capture.cjs'), nativeCapture)
        fs.writeFileSync(path.join(root, 'driver.ps1'), driver)
    })

    afterEach(() => {
        if (root) fs.rmSync(root, { recursive: true, force: true })
    })

    function runCase(mode, overrides = {}, nativeExit = 0) {
        const values = {
            implementation: 'napcat',
            officialAppId: '123456',
            officialClientSecret: 'secret "quoted" \\ $ & \u4e2d\u6587',
            installDir: path.join(root, 'install with spaces \u4e2d\u6587'),
            wsUrl: 'ws://napcat:3001',
            wsToken: 'test-token',
            adminQQ: '123456789',
            dashboardPort: '3000',
            dashboardPassword: 'pass "double" \'single\' \\ $ & ` \u4e2d\u6587\nsecond line',
            allowedOrigins: 'https://example.invalid,https://other.invalid',
            ...overrides
        }
        fs.writeFileSync(path.join(root, 'case.json'), JSON.stringify(values), { mode: 0o600 })
        const result = childProcess.spawnSync(powershell, [
            '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', path.join(root, 'driver.ps1')
        ], {
            cwd: root,
            encoding: 'utf8',
            timeout: 20000,
            env: {
                ...process.env,
                PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
                NODE_OPTIONS: `--require=${JSON.stringify(path.join(root, 'capture.cjs'))}`,
                BILI_TEST_ARGUMENT_MODE: mode,
                BILI_TEST_SETUP: setupPath,
                BILI_TEST_CASE: path.join(root, 'case.json'),
                BILI_TEST_CAPTURE: path.join(root, 'capture.json'),
                BILI_TEST_NATIVE_EXIT: String(nativeExit)
            }
        })
        assert.ifError(result.error)
        const capture = JSON.parse(fs.readFileSync(path.join(root, 'capture.json'), 'utf8'))
        return { result, capture, values }
    }

    for (const mode of argumentModes) {
        for (const implementation of ['napcat', 'llbot', 'external', 'official']) {
            it(`preserves config source and special characters for ${implementation} in ${mode} mode`, () => {
                const { result, capture, values } = runCase(mode, { implementation })
                assert.strictEqual(result.status, 0, result.stdout + result.stderr)
                assert.deepStrictEqual(capture.argv, [
                    'run', '--rm', '-i', '-v', `${values.installDir}:/install`,
                    '--entrypoint', 'node', 'example.invalid/bot:test', '-'
                ])
                const input = executeConfigSource(capture.stdin)
                assert.deepStrictEqual(input, {
                    provider: implementation === 'official' ? 'official' : 'napcat',
                    officialAppId: values.officialAppId,
                    officialClientSecret: values.officialClientSecret,
                    rootAdminQQ: values.adminQQ,
                    wsUrl: values.wsUrl,
                    wsToken: values.wsToken,
                    dashboardPassword: values.dashboardPassword,
                    env: {
                        DASHBOARD_PORT: values.dashboardPort,
                        DASHBOARD_ALLOWED_ORIGINS: values.allowedOrigins
                    }
                })
                assert(/^[\x00-\x7f]*$/.test(capture.stdin), 'stdin source must survive legacy output encoding')
            })
        }

        it(`preserves empty optional config values in ${mode} mode`, () => {
            const { result, capture } = runCase(mode, {
                officialAppId: '', officialClientSecret: '', wsToken: '',
                dashboardPassword: '', allowedOrigins: ''
            })
            assert.strictEqual(result.status, 0, result.stdout + result.stderr)
            const input = executeConfigSource(capture.stdin)
            assert.strictEqual(input.officialClientSecret, '')
            assert.strictEqual(input.wsToken, '')
            assert.strictEqual(input.dashboardPassword, '')
            assert.strictEqual(input.env.DASHBOARD_ALLOWED_ORIGINS, '')
        })

        it(`fails config generation when Docker exits unsuccessfully in ${mode} mode`, () => {
            const { result } = runCase(mode, {}, 17)
            assert.strictEqual(result.status, 1, result.stdout + result.stderr)
            assert(result.stdout.includes('config/config.yaml'))
        })

        it(`preserves the JSON POST body through native curl in ${mode} mode`, async () => {
            const body = JSON.stringify({ uin: '123456789', note: '"quoted" \\ \u4e2d\u6587 & $' })
            const server = childProcess.spawn(process.execPath, ['-e', httpCapture], {
                env: { ...process.env, BILI_TEST_CAPTURE: path.join(root, 'capture.json') },
                stdio: ['ignore', 'pipe', 'pipe']
            })
            try {
                const port = await new Promise((resolve, reject) => {
                    server.once('error', reject)
                    server.once('exit', code => reject(new Error(`HTTP fixture exited: ${code}`)))
                    server.stdout.once('data', chunk => resolve(Number(chunk.toString().trim())))
                })
                fs.writeFileSync(path.join(root, '.env'), `BILI_LLBOT_WEBUI_HOST_PORT=${port}\n`)
                const { result, capture } = runCase(mode, { action: 'post', body })
                assert.strictEqual(result.status, 0, result.stdout + result.stderr)
                assert.deepStrictEqual(JSON.parse(capture.stdin), JSON.parse(body))
                assert.strictEqual(capture.method, 'POST')
                assert.strictEqual(capture.url, '/api/quick-login')
                assert.strictEqual(capture.headers['content-type'], 'application/json')
                assert.strictEqual(capture.headers['x-webui-token'], 'test-auth')
            } finally {
                if (server.exitCode === null && server.signalCode === null) {
                    await new Promise(resolve => {
                        server.once('exit', resolve)
                        server.kill()
                    })
                }
            }
        })
    }
})
