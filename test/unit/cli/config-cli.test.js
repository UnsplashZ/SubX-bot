'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const YAML = require('yaml')
const { run } = require('../../../src/cli/config')
const { createDefaultV1Config } = require('../../../src/migrations/config/legacyLoader')
const { stringifyConfigYaml } = require('../../../src/migrations/config/configDocument')
const { uniqueRelocations } = require('../../../src/migrations/config/compose')
const { matchesKnownSetupTemplate } = require('../../../src/cli/compose')

const FIXTURES = path.join(__dirname, '../../fixtures/config-migration')

function validator(value) {
    return { valid: true, value }
}

function assertComposeValid(filePath) {
    const probe = spawnSync('docker', ['compose', '-f', filePath, 'config', '-q'], { encoding: 'utf8' })
    if (probe.error?.code === 'ENOENT') return
    assert.strictEqual(probe.status, 0, probe.stderr || probe.stdout)
}

describe('config CLI', function () {
    this.timeout(10000)
    it('requires explicit non-argv commands for schema secret paths', async () => {
        let called = false
        const requestConfigControl = async () => { called = true }
        await assert.rejects(
            run(['set', 'qq.official.clientSecret', 'argv-secret', '--expected-generation', '1'], { requestConfigControl }),
            (error) => error.message === 'CONFIG_SECRET_REQUIRES_EXPLICIT_COMMAND'
        )
        assert.strictEqual(called, false)
    })

    it('sets secrets only from a private single-link file and never returns the value', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-secret-cli-'))
        const input = path.join(root, 'secret.input')
        const secret = 'not-for-output'
        fs.writeFileSync(input, `${secret}\n`, { mode: 0o600 })
        let request
        try {
            const result = await run([
                'set-secret', 'qq.official.clientSecret', '--input', input, '--expected-generation', '7'
            ], { requestConfigControl: async (_socket, payload) => { request = payload; return { result: { generation: 8 } } } })
            assert.strictEqual(request.operations[0].value, secret)
            assert.strictEqual(request.expectedGeneration, 7)
            assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))

            fs.chmodSync(input, 0o644)
            await assert.rejects(
                run(['set-secret', 'qq.official.clientSecret', '--input', input, '--expected-generation', '8']),
                (error) => error.message === 'CONFIG_SECRET_INPUT_UNSAFE'
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('supports explicit stdin secret set and clear-secret operations', async () => {
        const requests = []
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-secret-fd-cli-'))
        const input = path.join(root, 'stdin')
        fs.writeFileSync(input, 'fd-secret\n', { mode: 0o600 })
        const fd = fs.openSync(input, 'r')
        try {
            await run(['set-secret', 'qq.official.clientSecret', '--fd', String(fd), '--expected-generation', '2'], {
                requestConfigControl: async (_socket, payload) => { requests.push(payload); return { result: {} } }
            })
            await run(['clear-secret', 'qq.official.clientSecret', '--expected-generation', '3'], {
                requestConfigControl: async (_socket, payload) => { requests.push(payload); return { result: {} } }
            })
            assert.deepStrictEqual(requests.map((request) => request.operations[0].op), ['set', 'clear-secret'])
            assert.strictEqual(requests[0].operations[0].value, 'fd-secret')
            assert.strictEqual(Object.hasOwn(requests[1].operations[0], 'value'), false)
        } finally {
            fs.closeSync(fd)
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('initializes and validates a private config file', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-cli-'))
        fs.chmodSync(root, 0o700)
        const configPath = path.join(root, 'config.yaml')
        try {
            const initialized = run(['init', '--config', configPath, '--provider', 'official'])
            assert.strictEqual(initialized.ok, true)
            assert.strictEqual(initialized.config.provider, 'official')
            assert.strictEqual(fs.statSync(configPath).mode & 0o777, 0o600)
            const validated = run(['validate', '--config', configPath])
            assert.strictEqual(validated.config.version, 1)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('records a private deployment applied baseline with monotonic generations', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-deployment-baseline-cli-'))
        fs.chmodSync(root, 0o700)
        const configPath = path.join(root, 'config.yaml')
        const baselinePath = path.join(root, 'deployment-applied.json')
        try {
            fs.writeFileSync(configPath, stringifyConfigYaml(createDefaultV1Config({ jwtSecret: 'fixture-jwt' })), { mode: 0o600 })
            const first = run([
                'record-deployment-applied', '--config', configPath, '--output', baselinePath,
                '--release-epoch', 'release-1'
            ], { validator })
            assert.strictEqual(first.deployment.generation, 1)
            assert.strictEqual(fs.statSync(baselinePath).mode & 0o777, 0o600)

            const second = run([
                'record-deployment-applied', '--config', configPath, '--baseline', baselinePath,
                '--output', baselinePath, '--release-epoch', 'release-2'
            ], { validator })
            assert.strictEqual(second.deployment.generation, 2)
            const stored = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
            assert.strictEqual(stored.releaseEpoch, 'release-2')
            assert.strictEqual(stored.generation, 2)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('accepts setup aliases and renders a protected Compose candidate with ownership', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-compose-cli-'))
        fs.chmodSync(root, 0o700)
        const configPath = path.join(root, 'config.yaml')
        const existingCompose = path.join(root, 'docker-compose.yml')
        const output = path.join(root, 'candidate.yml')
        const ownership = path.join(root, 'ownership.json')
        try {
            fs.writeFileSync(configPath, stringifyConfigYaml(createDefaultV1Config({ jwtSecret: 'fixture-jwt' })), { mode: 0o600 })
            fs.copyFileSync(path.join(__dirname, '../../fixtures/deployment/legacy-compose.yml'), existingCompose)
            const existing = YAML.parse(fs.readFileSync(existingCompose, 'utf8'))
            existing.services['bili-qq-bot'].labels = { 'user.owner': 'preserve' }
            existing.services['bili-qq-bot'].deploy = { resources: { limits: { memory: '768M' } } }
            existing.services['reverse-proxy'] = { image: 'example/proxy:1', networks: ['user-edge'] }
            existing.networks = { 'user-edge': { external: true } }
            fs.writeFileSync(existingCompose, YAML.stringify(existing), { mode: 0o600 })
            const result = run([
                'render-compose',
                '--config', configPath,
                '--existing-compose', existingCompose,
                '--output', output,
                '--ownership-output', ownership,
                '--bot-image', 'example/bot@sha256:deadbeef'
            ], { validator })
            assert.strictEqual(result.action, 'render-compose')
            assert.strictEqual(fs.statSync(output).mode & 0o777, 0o600)
            assert.strictEqual(fs.statSync(ownership).mode & 0o777, 0o600)
            const rendered = fs.readFileSync(output, 'utf8')
            assert.ok(rendered.includes('example/bot@sha256:deadbeef'))
            assert.ok(rendered.includes('pull_policy: never'))
            assert.ok(rendered.includes('./logs:/app/logs'))
            const renderedModel = YAML.parse(rendered)
            assert.deepStrictEqual(renderedModel.services['bili-qq-bot'].labels, { 'user.owner': 'preserve' })
            assert.deepStrictEqual(renderedModel.services['bili-qq-bot'].deploy, existing.services['bili-qq-bot'].deploy)
            assert.deepStrictEqual(renderedModel.services['reverse-proxy'], existing.services['reverse-proxy'])
            assert.deepStrictEqual(renderedModel.networks['user-edge'], { external: true })
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('reports mount relocation and refuses render without a validated relocation artifact', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-compose-plan-'))
        fs.chmodSync(root, 0o700)
        const configPath = path.join(root, 'config.yaml')
        const existingCompose = path.join(root, 'docker-compose.yml')
        const planPath = path.join(root, 'plan.json')
        try {
            const config = createDefaultV1Config({ jwtSecret: 'fixture-jwt' })
            config.deployment.mounts.data = './relocated-data'
            fs.writeFileSync(configPath, stringifyConfigYaml(config), { mode: 0o600 })
            fs.copyFileSync(path.join(__dirname, '../../fixtures/deployment/legacy-compose.yml'), existingCompose)
            const planned = run([
                'deployment-plan', '--config', configPath, '--existing-compose', existingCompose, '--output', planPath
            ], { validator })
            assert.strictEqual(planned.plan.requiresRelocation, true)
            assert.strictEqual(planned.plan.configFingerprint, undefined)
            assert.ok(!JSON.stringify(planned).includes('./relocated-data'))
            const privatePlan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
            assert.ok(/^[a-f0-9]{64}$/.test(privatePlan.configFingerprint))
            assert.ok(/^[a-f0-9]{64}$/.test(privatePlan.existingComposeFingerprint))
            assert.ok(/^[a-f0-9]{64}$/.test(privatePlan.planFingerprint))
            const dataMount = privatePlan.mounts.find((mount) => mount.key === 'data')
            assert.deepStrictEqual(dataMount, {
                service: 'bili-qq-bot',
                key: 'data',
                containerTarget: '/app/data',
                oldSource: './data',
                newSource: './relocated-data',
                preserveRequired: true,
                sharedIdentity: null
            })
            assert.throws(
                () => run([
                    'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                    '--output', path.join(root, 'candidate.yml'), '--ownership-output', path.join(root, 'ownership.json'),
                    '--adopt-existing'
                ], { validator }),
                (error) => error.code === 'COMPOSE_MOUNT_RELOCATION_REQUIRED'
            )

            const artifactPath = path.join(root, 'relocation-artifact.json')
            const inventoryFingerprint = 'a'.repeat(64)
            const relocatedMounts = uniqueRelocations(privatePlan.mounts)
            fs.writeFileSync(artifactPath, `${JSON.stringify({
                version: 1,
                planFingerprint: privatePlan.planFingerprint,
                configFingerprint: privatePlan.configFingerprint,
                existingComposeFingerprint: privatePlan.existingComposeFingerprint,
                operations: relocatedMounts.map((mount) => ({
                    key: mount.key,
                    sharedIdentity: mount.sharedIdentity,
                    containerTarget: mount.containerTarget,
                    oldSource: mount.oldSource,
                    newSource: mount.newSource,
                    operation: 'copy-and-switch',
                    bindings: mount.bindings,
                    inventory: {
                        beforeFingerprint: inventoryFingerprint,
                        afterFingerprint: inventoryFingerprint,
                        matched: true
                    }
                })),
                validatedAt: new Date().toISOString()
            }, null, 2)}\n`, { mode: 0o600 })
            const rendered = run([
                'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                '--output', path.join(root, 'candidate.yml'), '--ownership-output', path.join(root, 'ownership.json'),
                '--adopt-existing', '--validated-relocation-artifact', artifactPath
            ], { validator })
            assert.strictEqual(rendered.action, 'render-compose')

            const tampered = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
            tampered.configFingerprint = 'b'.repeat(64)
            fs.writeFileSync(artifactPath, `${JSON.stringify(tampered)}\n`, { mode: 0o600 })
            assert.throws(
                () => run([
                    'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                    '--output', path.join(root, 'candidate-2.yml'), '--ownership-output', path.join(root, 'ownership-2.json'),
                    '--adopt-existing', '--validated-relocation-artifact', artifactPath
                ], { validator }),
                (error) => error.code === 'DEPLOYMENT_RELOCATION_ARTIFACT_PLAN_MISMATCH'
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('reconciles the managed NapCat dependency without deleting user dependencies', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-compose-depends-'))
        fs.chmodSync(root, 0o700)
        const configPath = path.join(root, 'config.yaml')
        const existingCompose = path.join(root, 'docker-compose.yml')
        const output = path.join(root, 'candidate.yml')
        const ownership = path.join(root, 'ownership.json')
        try {
            const config = createDefaultV1Config({ jwtSecret: 'fixture-jwt' })
            config.qq.provider = 'official'
            fs.writeFileSync(configPath, stringifyConfigYaml(config), { mode: 0o600 })
            fs.writeFileSync(existingCompose, YAML.stringify({
                services: {
                    napcat: { image: 'mlikiowa/napcat-docker:latest' },
                    postgres: { image: 'postgres:16-alpine' },
                    'bili-qq-bot': {
                        image: 'unsplash/bili-qq-bot:latest',
                        depends_on: {
                            napcat: { condition: 'service_started' },
                            postgres: { condition: 'service_healthy', required: false }
                        },
                        ports: ['3000:3000'],
                        volumes: [
                            './config:/app/config',
                            './data:/app/data',
                            './logs:/app/logs',
                            './fonts/custom:/app/fonts/custom'
                        ]
                    }
                }
            }), { mode: 0o600 })

            run([
                'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                '--output', output, '--ownership-output', ownership, '--adopt-existing'
            ], { validator })

            const official = YAML.parse(fs.readFileSync(output, 'utf8'))
            assert.strictEqual(official.services.napcat, undefined)
            assert.deepStrictEqual(official.services['bili-qq-bot'].depends_on, {
                postgres: { condition: 'service_healthy', required: false }
            })
            assertComposeValid(output)

            config.qq.provider = 'napcat'
            fs.writeFileSync(configPath, stringifyConfigYaml(config), { mode: 0o600 })
            const napcatExisting = YAML.parse(fs.readFileSync(output, 'utf8'))
            napcatExisting.services.napcat = {
                image: 'mlikiowa/napcat-docker:latest',
                ports: ['6099:6099', '3001:3001'],
                volumes: ['./napcat/config:/app/napcat/config', './napcat/qq:/app/.config/QQ']
            }
            napcatExisting.services['bili-qq-bot'].volumes.push('./napcat/qq:/app/.config/QQ')
            fs.writeFileSync(existingCompose, YAML.stringify(napcatExisting), { mode: 0o600 })

            run([
                'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                '--output', output, '--ownership-output', ownership
            ], { validator })
            const napcat = YAML.parse(fs.readFileSync(output, 'utf8'))
            assert.deepStrictEqual(napcat.services['bili-qq-bot'].depends_on, {
                postgres: { condition: 'service_healthy', required: false },
                napcat: { condition: 'service_started' }
            })
            assertComposeValid(output)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('auto-adopts only the known fresh-install template for Official while preserving user fields', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-compose-known-template-'))
        fs.chmodSync(root, 0o700)
        const configPath = path.join(root, 'config.yaml')
        const existingCompose = path.join(root, 'docker-compose.yml')
        const output = path.join(root, 'candidate.yml')
        const ownership = path.join(root, 'ownership.json')
        try {
            const config = createDefaultV1Config({ jwtSecret: 'fixture-jwt', provider: 'official', officialClientSecret: 'secret' })
            config.qq.official.appId = 'app-id'
            fs.writeFileSync(configPath, stringifyConfigYaml(config), { mode: 0o600 })
            const existing = YAML.parse(fs.readFileSync(path.join(__dirname, '../../../docker-compose.yml'), 'utf8'))
            existing.services['bili-qq-bot'].labels = { 'user.owner': 'preserve' }
            existing.services['bili-qq-bot'].deploy = { resources: { limits: { memory: '768M' } } }
            existing.services['reverse-proxy'] = { image: 'example/proxy:1', networks: ['user-edge'] }
            existing.networks['user-edge'] = { external: true }
            fs.writeFileSync(existingCompose, YAML.stringify(existing), { mode: 0o600 })

            const result = run([
                'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                '--output', output, '--ownership-output', ownership, '--adopt-known-template',
                '--bot-image', 'example/bot@sha256:deadbeef'
            ], { validator })
            assert.strictEqual(result.provider, 'official')
            const rendered = YAML.parse(fs.readFileSync(output, 'utf8'))
            assert.strictEqual(rendered.services.napcat, undefined)
            assert.strictEqual(rendered.services.llbot, undefined)
            assert.strictEqual(rendered.services['bili-qq-bot'].depends_on, undefined)
            assert.deepStrictEqual(rendered.services['bili-qq-bot'].labels, { 'user.owner': 'preserve' })
            assert.deepStrictEqual(rendered.services['bili-qq-bot'].deploy, existing.services['bili-qq-bot'].deploy)
            assert.deepStrictEqual(rendered.services['reverse-proxy'], existing.services['reverse-proxy'])
            assert.deepStrictEqual(rendered.networks['user-edge'], { external: true })

            const mutations = [
                value => { value.services.llbot.environment.PLUGIN_ENABLED = 'true' },
                value => { value.services.llbot.volumes.push({ type: 'bind', source: './plugin', target: '/app/plugin' }) },
                value => { value.services.llbot.volumes.push({ type: 'bind', source: './other-qq', target: '/app/.config/QQ' }) },
                value => { value.services.llbot.networks.push('plugin-network') },
                value => { value.services.llbot.labels = { plugin: 'true' } }
            ]
            for (const mutate of mutations) {
                const unknown = JSON.parse(JSON.stringify(existing))
                mutate(unknown)
                assert.strictEqual(matchesKnownSetupTemplate(unknown), false)
                fs.writeFileSync(existingCompose, YAML.stringify(unknown), { mode: 0o600 })
                assert.throws(() => run([
                    'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                    '--output', output, '--ownership-output', ownership, '--adopt-known-template'
                ], { validator }), error => error.code === 'COMPOSE_UNKNOWN_TEMPLATE_ADOPTION_REQUIRED')
            }

            const explicit = JSON.parse(JSON.stringify(existing))
            explicit.services.llbot.ports = ['9999:3080']
            fs.writeFileSync(existingCompose, YAML.stringify(explicit), { mode: 0o600 })
            assert.doesNotThrow(() => run([
                'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                '--output', output, '--ownership-output', ownership,
                '--adopt-known-template', '--adopt-existing'
            ], { validator }))
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('uses last-rendered field CAS, rotates networks, and keeps a stable container ingress and health port', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-compose-cas-'))
        fs.chmodSync(root, 0o700)
        const configPath = path.join(root, 'config.yaml')
        const existingCompose = path.join(root, 'docker-compose.yml')
        const output = path.join(root, 'candidate.yml')
        const ownership = path.join(root, 'ownership.json')
        try {
            const config = createDefaultV1Config({ jwtSecret: 'fixture-jwt' })
            config.deployment.network.name = 'old-managed'
            fs.writeFileSync(configPath, stringifyConfigYaml(config), { mode: 0o600 })
            fs.copyFileSync(path.join(__dirname, '../../fixtures/deployment/legacy-compose.yml'), existingCompose)
            run([
                'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                '--output', output, '--ownership-output', ownership, '--adopt-existing'
            ], { validator })

            const owned = JSON.parse(fs.readFileSync(ownership, 'utf8'))
            assert.strictEqual(owned.version, 2)
            assert.ok(owned.fields['/services/bili-qq-bot/ports'].hash)

            config.dashboard.listenPort = 4000
            config.deployment.ports.dashboardHost = 4000
            config.deployment.network.name = 'new-managed'
            fs.writeFileSync(configPath, stringifyConfigYaml(config), { mode: 0o600 })
            fs.copyFileSync(output, existingCompose)
            run([
                'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                '--ownership', ownership, '--output', output, '--ownership-output', ownership
            ], { validator })
            const rendered = YAML.parse(fs.readFileSync(output, 'utf8'))
            assert.deepStrictEqual(rendered.services['bili-qq-bot'].ports, ['4000:3000'])
            assert.ok(JSON.stringify(rendered.services['bili-qq-bot'].healthcheck).includes('127.0.0.1:3000/api/live'))
            assert.ok(rendered.networks['new-managed'])
            assert.strictEqual(rendered.networks['old-managed'], undefined)
            assert.ok(rendered.services['bili-qq-bot'].networks.includes('new-managed'))
            assert.ok(!rendered.services['bili-qq-bot'].networks.includes('old-managed'))

            const drifted = YAML.parse(fs.readFileSync(output, 'utf8'))
            drifted.services['bili-qq-bot'].ports = ['4999:3000']
            fs.writeFileSync(existingCompose, YAML.stringify(drifted), { mode: 0o600 })
            config.deployment.ports.dashboardHost = 4100
            fs.writeFileSync(configPath, stringifyConfigYaml(config), { mode: 0o600 })
            assert.throws(
                () => run([
                    'render-compose', '--config', configPath, '--existing-compose', existingCompose,
                    '--ownership', ownership, '--output', output, '--ownership-output', ownership
                ], { validator }),
                (error) => error.code === 'COMPOSE_OWNED_FIELD_DRIFT' && error.path === '/services/bili-qq-bot/ports'
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('migrate-legacy dry-run performs no writes and existing YAML wins without runtime snapshot', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-cli-migrate-'))
        const configDir = path.join(root, 'config')
        const dataDir = path.join(root, 'data')
        fs.cpSync(path.join(FIXTURES, 'conflict-priority'), configDir, { recursive: true })
        fs.chmodSync(root, 0o700)
        fs.chmodSync(configDir, 0o700)
        fs.chmodSync(path.join(configDir, 'runtime-env.json'), 0o600)
        try {
            const dryRun = await run([
                'migrate-legacy',
                '--config-dir', configDir,
                '--data-dir', dataDir,
                '--runtime-env-file', path.join(configDir, 'runtime-env.json'),
                '--dry-run'
            ], { validator })
            assert.strictEqual(dryRun.result, 'planned')
            assert.strictEqual(fs.existsSync(path.join(configDir, 'config.yaml')), false)
            assert.strictEqual(fs.existsSync(dataDir), false)

            fs.rmSync(configDir, { recursive: true, force: true })
            fs.cpSync(path.join(FIXTURES, 'existing-yaml'), configDir, { recursive: true })
            fs.chmodSync(path.join(configDir, 'config.yaml'), 0o600)
            const existing = await run([
                'migrate-legacy',
                '--config-dir', configDir,
                '--data-dir', dataDir
            ], { validator })
            assert.strictEqual(existing.result, 'skipped-existing-yaml')
            assert.strictEqual(existing.config.provider, 'official')
            assert.strictEqual(fs.existsSync(path.join(dataDir, 'migrations/data-schema-state.json')), true)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('fails closed for unsafe authoritative YAML instead of reporting a skipped migration', async () => {
        for (const unsafeKind of ['mode', 'symlink', 'hardlink']) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-cli-unsafe-yaml-'))
            const configDir = path.join(root, 'config')
            fs.cpSync(path.join(FIXTURES, 'existing-yaml'), configDir, { recursive: true })
            fs.chmodSync(root, 0o700)
            fs.chmodSync(configDir, 0o700)
            const configPath = path.join(configDir, 'config.yaml')
            fs.chmodSync(configPath, 0o600)
            try {
                if (unsafeKind === 'mode') fs.chmodSync(configPath, 0o644)
                if (unsafeKind === 'symlink') {
                    const target = path.join(root, 'managed.yaml')
                    fs.renameSync(configPath, target)
                    fs.symlinkSync(target, configPath)
                }
                if (unsafeKind === 'hardlink') fs.linkSync(configPath, path.join(root, 'managed-hardlink.yaml'))
                await assert.rejects(
                    run(['migrate-legacy', '--config-dir', configDir], { validator }),
                    (error) => error.code === 'CONFIG_BOOTSTRAP_INVALID_INPUT',
                    unsafeKind
                )
            } finally {
                fs.rmSync(root, { recursive: true, force: true })
            }
        }
    })

    it('ignores legacy owner-lock artifacts when validating authoritative YAML', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-cli-legacy-owner-artifact-'))
        const configDir = path.join(root, 'config')
        const ownerLock = path.join(root, 'data', 'runtime', 'config-owner.lock')
        fs.cpSync(path.join(FIXTURES, 'existing-yaml'), configDir, { recursive: true })
        fs.chmodSync(path.join(configDir, 'config.yaml'), 0o600)
        fs.mkdirSync(ownerLock, { recursive: true, mode: 0o700 })
        fs.writeFileSync(path.join(ownerLock, 'owner.json'), `${JSON.stringify({
            pid: process.pid,
            nonce: 'a'.repeat(32),
            processStartIdentity: 'legacy-release-process',
            acquiredAt: new Date().toISOString()
        })}\n`, { mode: 0o600 })
        try {
            const result = await run(['migrate-legacy', '--config-dir', configDir], { validator })
            assert.strictEqual(result.result, 'skipped-existing-yaml')
            assert.strictEqual(fs.existsSync(path.join(ownerLock, 'owner.json')), true)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    for (const jwtFixture of [null, 'x'.repeat(63), 'x'.repeat(65)]) {
        it(`fails closed when legacy JWT is ${jwtFixture === null ? 'missing' : `${jwtFixture.length} characters`}`, async () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-cli-jwt-'))
            const configDir = path.join(root, 'config')
            fs.mkdirSync(configDir, { mode: 0o700 })
            fs.writeFileSync(path.join(configDir, 'config.json'), '{}\n', { mode: 0o600 })
            const runtimeEnv = path.join(configDir, 'runtime-env.json')
            fs.writeFileSync(runtimeEnv, '{}\n', { mode: 0o600 })
            if (jwtFixture !== null) fs.writeFileSync(path.join(configDir, '.jwtSecret'), jwtFixture, { mode: 0o600 })
            try {
                await assert.rejects(
                    Promise.resolve().then(() => run([
                        'migrate-legacy', '--legacy-root', configDir,
                        '--runtime-env-file', runtimeEnv, '--dry-run', '--json'
                    ], { validator })),
                    (error) => error.code === 'CONFIG_BOOTSTRAP_INVALID_INPUT'
                )
            } finally {
                fs.rmSync(root, { recursive: true, force: true })
            }
        })
    }
})
