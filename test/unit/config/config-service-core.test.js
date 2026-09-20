'use strict'

const assert = require('assert')
const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const path = require('path')
const {
    ConfigService,
    createCompatibilityFacade
} = require('../../../src/config/configService')
const { parseYamlDocument } = require('../../../src/config/yamlDocument')
const {
    CONFIG_INVENTORY,
    FLAT_KEY_TO_PATH,
    LEGACY_ENV_TO_PATH,
    createDefaultConfig
} = require('../../../src/config/schemaV1')
const { validateConfig } = require('../../../src/config/validator')
const { ReloadRegistry } = require('../../../src/config/reloadRegistry')
const { writeDeploymentBaseline } = require('../../../src/config/deploymentBaseline')
const {
    ApplicationAdmissionGate,
    applicationAdmissionGate
} = require('../../../src/services/runtime/applicationAdmissionGate')

async function createFixture(options = {}) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bili-config-service-'))
    const configDir = path.join(root, 'config')
    const stateDir = path.join(root, 'data', 'config-state')
    const service = new ConfigService({
        configDir,
        stateDir,
        debounceMs: 20,
        unlinkGraceMs: 30,
        ...options
    })
    await service.initialize({ createIfMissing: true })
    return {
        root,
        configDir,
        configPath: path.join(configDir, 'config.yaml'),
        stateDir,
        service,
        async cleanup() {
            await service.stop()
            await fsp.rm(root, { recursive: true, force: true })
        }
    }
}

function createTransientTransactionFault(service) {
    const assertCurrent = service.transactionBoundary.assertCurrent.bind(service.transactionBoundary)
    let failures = 0
    service.transactionBoundary.assertCurrent = async (...args) => {
        if (failures > 0) {
            failures -= 1
            const error = new Error('injected transaction token change')
            error.code = 'CONFIG_GENERATION_CONFLICT'
            throw error
        }
        return assertCurrent(...args)
    }
    return {
        failNext() {
            failures += 1
        },
        pending() {
            return failures
        }
    }
}

describe('ConfigService core', () => {
    it('rejects non-canonical or duplicate Dashboard allowed origins', () => {
        for (const origins of [
            ['https://bot.example.com/'],
            ['http://bot.example.com:80'],
            ['https://bot.example.com/path'],
            ['https://user@example.com'],
            ['https://bot.example.com', 'https://bot.example.com']
        ]) {
            const candidate = createDefaultConfig()
            candidate.dashboard.jwtSecret = 'test-dashboard-jwt-secret'
            candidate.dashboard.allowedOrigins = origins
            assert.throws(() => validateConfig(candidate), (error) => error.code === 'CONFIG_VALIDATION_ERROR')
        }
        const valid = createDefaultConfig()
        valid.dashboard.jwtSecret = 'test-dashboard-jwt-secret'
        valid.dashboard.allowedOrigins = ['https://bot.example.com', 'http://localhost:3000']
        assert.deepStrictEqual(validateConfig(valid).dashboard.allowedOrigins, valid.dashboard.allowedOrigins)
    })

    it('accepts numeric and Official opaque entity IDs while rejecting unsafe identifiers', () => {
        const valid = createDefaultConfig()
        valid.dashboard.jwtSecret = 'test-jwt-secret'
        valid.enabledGroups = ['123456', 'group_openid:abc_DEF-123']
        valid.providerScopedEnabledGroups = {
            napcat: ['123456'],
            official: ['group_openid:abc_DEF-123']
        }
        valid.groupConfigs = {
            123456: { admins: ['90001'] },
            'group_openid:abc_DEF-123': {
                admins: ['member_openid:xyz_987'],
                blacklistedQQs: ['user_openid:blocked-1']
            }
        }
        // `agent` is a legacy tombstone: leftover sections from older
        // documents stay valid but are ignored at runtime.
        valid.agent = {
            groups: { 'group_openid:abc_DEF-123': { enabled: true } },
            llm: { apiKey: 'leftover-secret' }
        }
        valid.qq.official.rootOpenids = ['user_openid:root_1']
        assert.doesNotThrow(() => validateConfig(valid))

        for (const invalidId of ['has space', 'has/slash', 'line\nbreak', 'x'.repeat(201)]) {
            const invalid = createDefaultConfig()
            invalid.dashboard.jwtSecret = 'test-jwt-secret'
            invalid.groupConfigs = { [invalidId]: {} }
            assert.throws(() => validateConfig(invalid), /Invalid map key/)
        }

        for (const dangerousKey of ['__proto__', 'prototype', 'constructor']) {
            const invalid = createDefaultConfig()
            invalid.dashboard.jwtSecret = 'test-jwt-secret'
            invalid.groupConfigs = JSON.parse(`{"${dangerousKey}":{}}`)
            assert.throws(() => validateConfig(invalid), /Dangerous map key/)
        }
    })

    it('accepts the runtime night-mode vocabulary and rejects the obsolete schedule alias', () => {
        const valid = createDefaultConfig()
        valid.dashboard.jwtSecret = 'test-jwt-secret'
        valid.rendering.nightMode.mode = 'timed'
        valid.groupConfigs = {
            123456: { nightMode: { mode: 'timed', startTime: '21:00', endTime: '06:00' } }
        }
        assert.doesNotThrow(() => validateConfig(valid))

        valid.rendering.nightMode.mode = 'schedule'
        assert.throws(() => validateConfig(valid), /Unsupported value/)
    })

    it('preserves zero as the unlimited video duration sentinel', () => {
        const valid = createDefaultConfig()
        valid.dashboard.jwtSecret = 'test-jwt-secret'
        valid.videoDownload.maxDurationSeconds = 0
        valid.groupConfigs = { 123456: { videoDownloadMaxDuration: 0 } }
        assert.doesNotThrow(() => validateConfig(valid))
    })

    it('exposes exhaustive schema metadata for compatibility keys and production legacy envs', () => {
        const inventoryByPath = new Map(CONFIG_INVENTORY.map((entry) => [entry.yamlPath, entry]))
        for (const [flatKey, yamlPath] of Object.entries(FLAT_KEY_TO_PATH)) {
            const label = yamlPath.join('.')
            assert.ok(inventoryByPath.has(label), `missing inventory path for ${flatKey}`)
            assert.strictEqual(inventoryByPath.get(label).flatKey, flatKey)
        }
        ;[
            'CHROMIUM_PATH',
            'PUPPETEER_EXECUTABLE_PATH',
            'MESSAGE_DEDUP_TTL_MS',
            'AI_MESSAGE_DEDUP_MAX_ENTRIES',
            'LOG_LEVEL',
            'LOG_BUFFER_SIZE'
        ].forEach((key) => assert.ok(LEGACY_ENV_TO_PATH[key], `missing legacy env mapping for ${key}`))
        assert.ok(!('AGENT_LLM_BASE_URL' in LEGACY_ENV_TO_PATH), 'removed agent envs must not be mapped')
        const agentTombstone = inventoryByPath.get('agent')
        assert.strictEqual(agentTombstone.secret, true)
        assert.strictEqual(agentTombstone.publicShape, 'configured-marker')
    })

    it('creates one private config.yaml and a private last-good outside config/', async () => {
        const fixture = await createFixture()
        try {
            const configFiles = await fsp.readdir(fixture.configDir)
            assert.deepStrictEqual(configFiles, ['config.yaml'])
            assert.strictEqual((await fsp.stat(fixture.configDir)).mode & 0o777, 0o700)
            assert.strictEqual((await fsp.stat(fixture.configPath)).mode & 0o777, 0o600)
            assert.strictEqual((await fsp.stat(fixture.stateDir)).mode & 0o777, 0o700)
            assert.strictEqual((await fsp.stat(path.join(fixture.stateDir, 'last-good.yaml'))).mode & 0o777, 0o600)
            assert.strictEqual(fixture.service.getStatus().documentGeneration, 1)
            assert.strictEqual(fixture.service.getStatus().effectiveGeneration, 1)
        } finally {
            await fixture.cleanup()
        }
    })

    it('rejects permissive config.yaml on cold start instead of chmod-repairing it', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bili-config-unsafe-mode-'))
        const configDir = path.join(root, 'config')
        const stateDir = path.join(root, 'data/config-state')
        await fsp.mkdir(configDir, { recursive: true, mode: 0o700 })
        const unsafeConfig = createDefaultConfig()
        unsafeConfig.dashboard.jwtSecret = 'test-jwt-secret'
        const source = require('../../../src/config/yamlDocument').stringifyYamlDocument(
            require('../../../src/config/yamlDocument').createYamlDocument(unsafeConfig)
        )
        const configPath = path.join(configDir, 'config.yaml')
        await fsp.writeFile(configPath, source, { mode: 0o644 })
        const service = new ConfigService({ configDir, stateDir })
        try {
            await assert.rejects(service.initialize(), (error) => error.code === 'CONFIG_PARSE_ERROR')
            assert.strictEqual((await fsp.stat(configPath)).mode & 0o777, 0o644)
        } finally {
            await service.stop().catch(() => {})
            await fsp.rm(root, { recursive: true, force: true })
        }
    })

    it('computes deployment pending state from the last successful applied baseline across reloads and restarts', async () => {
        const fixture = await createFixture()
        const baselinePath = path.join(fixture.stateDir, 'deployment-applied.json')
        try {
            assert.ok(!fixture.service.getStatus().pendingDeploymentApply.includes('dashboard.listenPort'))
            writeDeploymentBaseline(baselinePath, fixture.service.getSnapshot(), { releaseEpoch: 'release-1' })
            assert.deepStrictEqual(fixture.service.getStatus().pendingDeploymentApply, [])
            assert.strictEqual(fixture.service.getStatus().deployment.appliedGeneration, 1)

            await fixture.service.patch(
                [{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 91 }],
                { expectedGeneration: 1 }
            )
            assert.deepStrictEqual(fixture.service.getStatus().pendingDeploymentApply, [])
            const noOp = await fixture.service.reload({ source: 'test-no-op' })
            assert.deepStrictEqual(noOp.deploymentApplyRequired, [])

            const changed = await fixture.service.patch(
                [{ op: 'set', path: ['deployment', 'ports', 'dashboardHost'], value: 4321 }],
                { expectedGeneration: 2 }
            )
            assert.deepStrictEqual(changed.deploymentApplyRequired, ['deployment.ports.dashboardHost'])

            await fixture.service.stop()
            const restarted = new ConfigService({
                configDir: fixture.configDir,
                stateDir: fixture.stateDir
            })
            fixture.service = restarted
            await restarted.initialize()
            assert.deepStrictEqual(restarted.getStatus().pendingDeploymentApply, ['deployment.ports.dashboardHost'])

            writeDeploymentBaseline(baselinePath, restarted.getSnapshot(), {
                previousPath: baselinePath,
                releaseEpoch: 'release-2'
            })
            const applied = restarted.getStatus()
            assert.deepStrictEqual(applied.pendingDeploymentApply, [])
            assert.strictEqual(applied.deployment.appliedGeneration, 2)
            assert.strictEqual(applied.deployment.releaseEpoch, 'release-2')
        } finally {
            await fixture.cleanup()
        }
    })

    it('strictly rejects duplicate keys, custom tags, cycles and unknown config keys', async () => {
        assert.throws(() => parseYamlDocument('a: 1\na: 2\n'), /DUPLICATE_KEY|Invalid YAML/)
        assert.throws(() => parseYamlDocument('a: !unsafe value\n'), /Custom YAML tags/)
        assert.throws(() => parseYamlDocument('a: &a\n  child: *a\n'), /Cyclic YAML/)

        const fixture = await createFixture()
        try {
            const before = fixture.service.getSnapshot()
            const source = await fsp.readFile(fixture.configPath, 'utf8')
            await fsp.writeFile(fixture.configPath, `${source}unknownRoot: true\n`, { mode: 0o600 })
            await assert.rejects(
                fixture.service.reload({ source: 'test-invalid' }),
                (error) => error.code === 'CONFIG_VALIDATION_ERROR' && error.path === '/unknownRoot'
            )
            assert.strictEqual(fixture.service.getSnapshot(), before)
            assert.strictEqual(fixture.service.getStatus().documentGeneration, 1)
            assert.ok(fixture.service.getStatus().rejected)
        } finally {
            await fixture.cleanup()
        }
    })

    it('redacts all schema secrets without exposing values in errors or public fingerprints', async () => {
        const fixture = await createFixture()
        try {
            await fixture.service.patch([
                { op: 'set', path: ['qq', 'napcat', 'wsToken'], value: 'napcat-secret' },
                { op: 'set', path: ['qq', 'official', 'clientSecret'], value: 'official-secret' },
                // `agent` is a legacy tombstone: any leftover section stays
                // secret and is never projected publicly.
                { op: 'set', path: ['agent'], value: { llm: { apiKey: 'agent-secret' } } }
            ], { expectedGeneration: 1 })

            const publicConfig = fixture.service.getPublicSnapshot()
            assert.deepStrictEqual(publicConfig.qq.napcat.wsToken, { configured: true })
            assert.deepStrictEqual(publicConfig.qq.official.clientSecret, { configured: true })
            assert.deepStrictEqual(publicConfig.agent, { configured: true })
            const serialized = JSON.stringify({ publicConfig, status: fixture.service.getStatus() })
            assert.ok(!serialized.includes('napcat-secret'))
            assert.ok(!serialized.includes('official-secret'))
            assert.ok(!serialized.includes('agent-secret'))

            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['qq', 'official', 'clientSecret'], value: { leaked: 'official-secret' } }]),
                (error) => {
                    const output = JSON.stringify(fixture.service.toPublicError(error))
                    return error.code === 'CONFIG_VALIDATION_ERROR' && !output.includes('official-secret')
                }
            )
        } finally {
            await fixture.cleanup()
        }
    })

    it('preserves YAML comments and separates document/effective generations', async () => {
        const fixture = await createFixture()
        try {
            const original = await fsp.readFile(fixture.configPath, 'utf8')
            const commented = original.replace('subscription:', '# keep-subscription-comment\nsubscription:')
            await fsp.writeFile(fixture.configPath, commented, { mode: 0o600 })
            await fixture.service.reload({ source: 'comment-only' })
            assert.strictEqual(fixture.service.getStatus().documentGeneration, 2)
            assert.strictEqual(fixture.service.getStatus().effectiveGeneration, 1)

            await fixture.service.patch(
                [{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 75 }],
                { expectedGeneration: 2 }
            )
            const after = await fsp.readFile(fixture.configPath, 'utf8')
            assert.ok(after.includes('# keep-subscription-comment'))
            assert.strictEqual(fixture.service.getStatus().documentGeneration, 3)
            assert.strictEqual(fixture.service.getStatus().effectiveGeneration, 2)
            assert.strictEqual(fixture.service.get('subscriptionCheckInterval'), 75)
        } finally {
            await fixture.cleanup()
        }
    })

    it('enforces expected generation and exposes a read-only flat compatibility facade', async () => {
        const fixture = await createFixture()
        try {
            const facade = createCompatibilityFacade(fixture.service)
            assert.strictEqual(facade.qqProvider, 'napcat')
            assert.strictEqual(facade.subscriptionCheckInterval, 60)
            assert.throws(() => {
                facade.subscriptionCheckInterval = 5
            }, /Direct configuration assignment/)

            await fixture.service.patch(
                [{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 80 }],
                { expectedGeneration: 1 }
            )
            await assert.rejects(
                fixture.service.patch(
                    [{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 90 }],
                    { expectedGeneration: 1 }
                ),
                (error) => error.code === 'CONFIG_GENERATION_CONFLICT' && error.statusCode === 409
            )
        } finally {
            await fixture.cleanup()
        }
    })

    it('requires an explicit clear-secret operation and protects non-clearable secrets', async () => {
        const fixture = await createFixture()
        try {
            await fixture.service.patch([{ op: 'set', path: ['qq', 'napcat', 'wsToken'], value: 'token' }])
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['qq', 'napcat', 'wsToken'], value: '' }]),
                (error) => error.code === 'CONFIG_VALIDATION_ERROR'
            )
            await fixture.service.patch([{ op: 'clear-secret', path: ['qq', 'napcat', 'wsToken'] }])
            assert.strictEqual(fixture.service.get('wsToken'), '')
            await assert.rejects(
                fixture.service.patch([{ op: 'clear-secret', path: ['dashboard', 'jwtSecret'] }]),
                (error) => error.code === 'CONFIG_VALIDATION_ERROR'
            )
        } finally {
            await fixture.cleanup()
        }
    })

    it('loads without creating a cross-process configuration owner lock', async () => {
        const fixture = await createFixture()
        const second = new ConfigService({
            configDir: fixture.configDir,
            stateDir: fixture.stateDir
        })
        try {
            await second.load({ startup: true })
            assert.strictEqual(fixture.service.getStatus().valid, true)
            assert.strictEqual(second.getStatus().valid, true)
            assert.strictEqual(fs.existsSync(path.join(fixture.root, 'data/runtime/config-owner.lock')), false)
        } finally {
            await second.stop().catch(() => {})
            await fixture.cleanup()
        }
    })

    it('runs reload handlers in order and restores the previous YAML on commit failure', async () => {
        const fixture = await createFixture()
        const phases = []
        try {
            fixture.service.registerReloadHandler({
                id: 'cache-runtime',
                effects: ['cache'],
                preflight: async () => phases.push('preflight'),
                prepareParallel: async () => phases.push('prepareParallel'),
                pauseIngress: async () => phases.push('pauseIngress'),
                preCommitDrain: async () => phases.push('preCommitDrain'),
                prepareExclusive: async () => phases.push('prepareExclusive'),
                commitHandles: async () => phases.push('commitHandles'),
                validateAdmission: async () => {
                    assert.strictEqual(fixture.service.getStatus().documentGeneration, 1)
                    phases.push('validateAdmission')
                },
                enableIngress: async () => {
                    assert.strictEqual(applicationAdmissionGate.snapshot().closed, true)
                    assert.strictEqual(fixture.service.getStatus().documentGeneration, 2)
                    phases.push('enableIngress')
                },
                finalizeAdmission: () => phases.push('finalizeAdmission'),
                commitAdmission: async () => phases.push('commitAdmission'),
                afterAdmissionOpen: async () => phases.push('afterAdmissionOpen'),
                postCommitDrain: async () => phases.push('postCommitDrain'),
                disposeOld: async () => phases.push('disposeOld')
            })
            await fixture.service.patch([{ op: 'set', path: ['cache', 'dataTtlSeconds'], value: 10 }], { expectedGeneration: 1 })
            assert.deepStrictEqual(phases, [
                'preflight',
                'prepareParallel',
                'pauseIngress',
                'preCommitDrain',
                'prepareExclusive',
                'commitHandles',
                'validateAdmission',
                'enableIngress',
                'finalizeAdmission',
                'commitAdmission',
                'finalizeAdmission',
                'afterAdmissionOpen',
                'postCommitDrain',
                'disposeOld'
            ])
            assert.strictEqual(applicationAdmissionGate.snapshot().closed, false)
            assert.strictEqual(fixture.service.getStatus().components['cache-runtime'].resourceGeneration, 1)

            fixture.service.registerReloadHandler({
                id: 'subscription-failure',
                effects: ['subscription'],
                commitHandles: async () => {
                    throw new Error('candidate commit failed')
                }
            })
            const beforeSource = await fsp.readFile(fixture.configPath, 'utf8')
            const beforeGeneration = fixture.service.getStatus().documentGeneration
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 120 }]),
                (error) => error.code === 'CONFIG_RELOAD_ERROR' && error.phase === 'commitHandles'
            )
            assert.strictEqual(await fsp.readFile(fixture.configPath, 'utf8'), beforeSource)
            assert.strictEqual(fixture.service.getStatus().documentGeneration, beforeGeneration)
            assert.strictEqual(fixture.service.get('subscriptionCheckInterval'), 60)
        } finally {
            await fixture.cleanup()
        }
    })

    it('publishes the candidate snapshot before opening ingress and fully restores on enable failure', async () => {
        const fixture = await createFixture()
        let observedDuringEnable = null
        try {
            fixture.service.registerReloadHandler({
                id: 'subscription-enable-barrier',
                effects: ['subscription'],
                enableIngress(candidate) {
                    assert.strictEqual(applicationAdmissionGate.snapshot().closed, true)
                    observedDuringEnable = fixture.service.get('subscription.checkIntervalSeconds')
                    assert.strictEqual(observedDuringEnable, candidate.subscription.checkIntervalSeconds)
                    throw new Error('enable failed')
                }
            })
            const beforeSource = await fsp.readFile(fixture.configPath, 'utf8')
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 91 }]),
                (error) => error.code === 'CONFIG_RELOAD_ERROR' && error.phase === 'enableIngress'
            )
            assert.strictEqual(observedDuringEnable, 91)
            assert.strictEqual(fixture.service.get('subscription.checkIntervalSeconds'), 60)
            assert.strictEqual(fixture.service.getStatus().documentGeneration, 1)
            assert.strictEqual(fixture.service.getStatus().effectiveGeneration, 1)
            assert.strictEqual(await fsp.readFile(fixture.configPath, 'utf8'), beforeSource)
            assert.strictEqual(applicationAdmissionGate.snapshot().closed, false)
        } finally {
            await fixture.cleanup()
        }
    })

    it('runs all fallible admission validation before publishing the candidate snapshot', async function () {
        this.timeout(5000)
        const fixture = await createFixture()
        let snapshotPublications = 0
        fixture.service.on('snapshotPublished', () => { snapshotPublications += 1 })
        try {
            fixture.service.registerReloadHandler({
                id: 'admission-validation-failure',
                effects: ['subscription'],
                validateAdmission(candidate) {
                    assert.strictEqual(candidate.subscription.checkIntervalSeconds, 92)
                    assert.strictEqual(fixture.service.get('subscription.checkIntervalSeconds'), 60)
                    throw new Error('candidate lost readiness before publication')
                }
            })
            const beforeSource = await fsp.readFile(fixture.configPath, 'utf8')
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 92 }]),
                (error) => error.code === 'CONFIG_RELOAD_ERROR' && error.phase === 'validateAdmission'
            )
            assert.strictEqual(snapshotPublications, 1, 'only the previous snapshot rollback publication is allowed')
            assert.strictEqual(fixture.service.get('subscription.checkIntervalSeconds'), 60)
            assert.strictEqual(applicationAdmissionGate.snapshot().closed, false)
            assert.strictEqual(await fsp.readFile(fixture.configPath, 'utf8'), beforeSource)
        } finally {
            await fixture.cleanup()
        }
    })

    it('rechecks liveness synchronously immediately before opening admission and reverses admission commits', async () => {
        const fixture = await createFixture()
        let healthy = true
        let finalizeCalls = 0
        let admissionRolledBack = false
        try {
            fixture.service.registerReloadHandler({
                id: 'last-turn-liveness',
                effects: ['subscription'],
                finalizeAdmission() {
                    finalizeCalls += 1
                    if (!healthy) throw new Error('candidate failed in final admission turn')
                },
                commitAdmission: async () => { healthy = false },
                rollbackAdmission: async () => {
                    healthy = true
                    admissionRolledBack = true
                }
            })
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 93 }]),
                (error) => error.code === 'CONFIG_RELOAD_ERROR' && error.phase === 'finalizeAdmission'
            )
            assert.strictEqual(finalizeCalls, 2)
            assert.strictEqual(admissionRolledBack, true)
            assert.strictEqual(fixture.service.get('subscription.checkIntervalSeconds'), 60)
            assert.strictEqual(applicationAdmissionGate.snapshot().closed, false)
        } finally {
            await fixture.cleanup()
        }
    })

    it('rolls back the candidate snapshot and runtime when the transaction boundary changes inside commitAdmission', async () => {
        const gate = new ApplicationAdmissionGate()
        const reloadRegistry = new ReloadRegistry({ admissionGate: gate })
        const fixture = await createFixture({ reloadRegistry })
        const transactionFault = createTransientTransactionFault(fixture.service)
        let candidateRuntimeActive = false
        try {
            fixture.service.registerReloadHandler({
                id: 'transaction-change-during-admission-commit',
                effects: ['subscription'],
                async commitAdmission(candidate, previous, context) {
                    candidateRuntimeActive = true
                    transactionFault.failNext()
                    await context.assertTransactionCurrent()
                },
                async rollbackAdmission() {
                    candidateRuntimeActive = false
                }
            })
            const beforeSource = await fsp.readFile(fixture.configPath, 'utf8')
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 96 }]),
                (error) => error.code === 'CONFIG_RELOAD_ERROR' && error.phase === 'commitAdmission'
            )
            assert.strictEqual(candidateRuntimeActive, false)
            assert.strictEqual(fixture.service.get('subscription.checkIntervalSeconds'), 60)
            assert.strictEqual(fixture.service.getStatus().documentGeneration, 1)
            assert.strictEqual(await fsp.readFile(fixture.configPath, 'utf8'), beforeSource)
            assert.strictEqual(gate.snapshot().closed, false)
        } finally {
            await fixture.cleanup()
        }
    })

    it('keeps the final transaction fence compensatable before admission opens', async () => {
        const gate = new ApplicationAdmissionGate()
        const reloadRegistry = new ReloadRegistry({ admissionGate: gate })
        const fixture = await createFixture({ reloadRegistry })
        const transactionFault = createTransientTransactionFault(fixture.service)
        let candidateRuntimeActive = false
        let admissionRolledBack = false
        try {
            fixture.service.registerReloadHandler({
                id: 'transaction-change-at-final-admission-fence',
                effects: ['subscription'],
                async commitAdmission() {
                    candidateRuntimeActive = true
                    transactionFault.failNext()
                },
                async rollbackAdmission() {
                    candidateRuntimeActive = false
                    admissionRolledBack = true
                }
            })
            const beforeSource = await fsp.readFile(fixture.configPath, 'utf8')
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 97 }]),
                (error) => error.code === 'CONFIG_RELOAD_ERROR' &&
                    error.phase === 'finalAdmissionFence' && error.handlerId === 'config-transaction'
            )
            assert.strictEqual(admissionRolledBack, true)
            assert.strictEqual(candidateRuntimeActive, false)
            assert.strictEqual(fixture.service.get('subscription.checkIntervalSeconds'), 60)
            assert.strictEqual(fixture.service.getStatus().documentGeneration, 1)
            assert.strictEqual(await fsp.readFile(fixture.configPath, 'utf8'), beforeSource)
            assert.strictEqual(gate.snapshot().closed, false)
        } finally {
            await fixture.cleanup()
        }
    })

    it('performs no fallible transaction check after the final synchronous fence opens admission', async () => {
        const gate = new ApplicationAdmissionGate()
        const reloadRegistry = new ReloadRegistry({ admissionGate: gate })
        const fixture = await createFixture({ reloadRegistry })
        const transactionFault = createTransientTransactionFault(fixture.service)
        let finalizeCalls = 0
        let candidateRuntimeActive = false
        try {
            fixture.service.registerReloadHandler({
                id: 'transaction-change-adjacent-to-admission-open',
                effects: ['subscription'],
                async commitAdmission() {
                    candidateRuntimeActive = true
                },
                finalizeAdmission() {
                    finalizeCalls += 1
                    if (finalizeCalls === 2) transactionFault.failNext()
                },
                async rollbackAdmission() {
                    candidateRuntimeActive = false
                }
            })
            await fixture.service.patch([
                { op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 98 }
            ])
            assert.strictEqual(finalizeCalls, 2)
            assert.strictEqual(transactionFault.pending(), 1, 'no transaction assertion may run after the final synchronous fence')
            assert.strictEqual(candidateRuntimeActive, true)
            assert.strictEqual(fixture.service.get('subscription.checkIntervalSeconds'), 98)
            assert.strictEqual(fixture.service.getStatus().documentGeneration, 2)
            assert.strictEqual(gate.snapshot().closed, false)
        } finally {
            await fixture.cleanup()
        }
    })

    it('keeps global admission closed and enters recovery-required for unresolved prepare cleanup', async () => {
        const gate = new ApplicationAdmissionGate()
        const reloadRegistry = new ReloadRegistry({ admissionGate: gate })
        const fixture = await createFixture({ reloadRegistry })
        try {
            fixture.service.registerReloadHandler({
                id: 'prepare-residual',
                effects: ['subscription'],
                prepareParallel: async () => {
                    const error = new Error('candidate failed and could not terminate')
                    const cleanupError = new Error('residual child')
                    cleanupError.code = 'PYTHON_RESIDUAL_PROCESS'
                    error.cleanupErrors = [cleanupError]
                    throw error
                }
            })
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 94 }]),
                (error) => Array.isArray(error.rollbackErrors) && error.rollbackErrors.length === 1
            )
            assert.strictEqual(gate.snapshot().closed, true)
            assert.strictEqual(fixture.service.getStatus().recoveryRequired.required, true)
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 95 }]),
                (error) => error.code === 'CONFIG_RELOAD_ERROR' && error.phase === 'recovery-required'
            )
        } finally {
            await fixture.cleanup()
        }
    })

    it('keeps the transferred admission token closed when runtime recovery fails', async () => {
        const gate = new ApplicationAdmissionGate()
        const reloadRegistry = new ReloadRegistry({ admissionGate: gate })
        const fixture = await createFixture({ reloadRegistry })
        let recoveryAttempts = 0
        let pauseAttempts = 0
        try {
            fixture.service.registerReloadHandler({
                id: 'recoverable-runtime',
                effects: ['subscription'],
                async rollbackExclusive() {
                    const error = new Error('candidate cleanup left recovery work')
                    error.code = 'RUNTIME_RECOVERY_REQUIRED'
                    throw error
                },
                async resumePendingRecovery() {
                    recoveryAttempts += 1
                    const error = new Error('old runtime restore failed')
                    error.code = 'RUNTIME_RESTORE_FAILED'
                    throw error
                },
                async pausePendingRecovery() {
                    pauseAttempts += 1
                }
            })
            fixture.service.registerReloadHandler({
                id: 'later-runtime-fault',
                effects: ['subscription'],
                async prepareExclusive() {
                    throw new Error('later runtime prepare failed')
                }
            })

            await assert.rejects(
                fixture.service.patch([{
                    op: 'set',
                    path: ['subscription', 'checkIntervalSeconds'],
                    value: 93
                }]),
                error => error.rollbackErrors?.some(entry => entry.code === 'RUNTIME_RECOVERY_REQUIRED')
            )
            const recoveryToken = gate.activeToken
            await assert.rejects(
                () => fixture.service.recover({ source: 'test' }),
                error => error.code === 'RUNTIME_RESTORE_FAILED'
            )
            assert.equal(recoveryAttempts, 1)
            assert.equal(pauseAttempts, 1)
            assert.strictEqual(gate.activeToken, recoveryToken)
            assert.equal(gate.snapshot().closed, true)
            assert.equal(fixture.service.getStatus().recoveryRequired.required, true)
            assert.deepStrictEqual(
                fixture.service.getStatus().pendingRuntimeRecovery.handlers,
                ['recoverable-runtime']
            )
        } finally {
            if (gate.snapshot().closed && gate.activeToken) gate.open(gate.activeToken)
            await fixture.cleanup()
        }
    })

    it('closes admission when the first rollback error occurs before prepare acquires a gate token', async () => {
        const gate = new ApplicationAdmissionGate()
        const registry = new ReloadRegistry({ admissionGate: gate })
        registry.register({
            id: 'early-rollback-failure',
            effects: ['subscription'],
            async prepareParallel() {
                throw new Error('candidate construction failed')
            },
            async rollbackPrepared() {
                const error = new Error('candidate cleanup failed')
                error.code = 'EARLY_CLEANUP_FAILED'
                throw error
            }
        })

        await assert.rejects(
            () => registry.prepare({
                candidate: {},
                previous: {},
                diff: [{ path: ['subscription'], effects: ['subscription'] }]
            }),
            error => error.rollbackErrors?.some(entry => entry.code === 'EARLY_CLEANUP_FAILED')
        )
        assert.strictEqual(gate.snapshot().closed, true)
        gate.open(gate.activeToken)
    })

    it('keeps admission closed when restoring previous ingress is the first rollback failure', async () => {
        const gate = new ApplicationAdmissionGate()
        const registry = new ReloadRegistry({ admissionGate: gate })
        registry.register({
            id: 'restore-ingress-failure',
            effects: ['subscription'],
            async commitHandles() {
                throw new Error('commit failed')
            },
            async restorePrevious() {
                const error = new Error('previous ingress could not be restored')
                error.code = 'RESTORE_INGRESS_FAILED'
                throw error
            }
        })
        const transaction = await registry.prepare({
            candidate: {},
            previous: {},
            diff: [{ path: ['subscription'], effects: ['subscription'] }]
        })

        await assert.rejects(
            () => transaction.commit(),
            error => error.rollbackErrors?.some(entry => entry.code === 'RESTORE_INGRESS_FAILED')
        )
        assert.strictEqual(gate.snapshot().closed, true)
        gate.open(gate.activeToken)
    })

    it('rejects new reload transactions after stop begins', async () => {
        const fixture = await createFixture()
        try {
            await fixture.service.stop()
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 90 }]),
                (error) => error.code === 'CONFIG_SERVICE_STOPPED' && error.statusCode === 503
            )
        } finally {
            await fsp.rm(fixture.root, { recursive: true, force: true })
        }
    })

    it('marks handlers registered after initial load as effect-ready without a synthetic reload', async () => {
        const fixture = await createFixture()
        try {
            fixture.service.registerReloadHandler({
                id: 'late-dashboard-runtime',
                effects: ['dashboard']
            })
            const status = fixture.service.getStatus().components['late-dashboard-runtime']
            assert.strictEqual(status.observedDocumentGeneration, 1)
            assert.ok(status.appliedEffectHash)
            assert.strictEqual(status.appliedEffectHash, status.desiredEffectHash)
            assert.strictEqual(status.resourceGeneration, 0)
        } finally {
            await fixture.cleanup()
        }
    })

    it('rolls back a handler that throws after producing a partial phase side effect', async () => {
        for (const scenario of [
            ['prepareParallel', 'rollbackPrepared'],
            ['pauseIngress', 'restorePrevious'],
            ['prepareExclusive', 'rollbackExclusive']
        ]) {
            const [phase, rollbackPhase] = scenario
            const registry = new ReloadRegistry()
            let sideEffect = false
            registry.register({
                id: `partial-${phase}`,
                effects: ['subscription'],
                async [phase]() {
                    sideEffect = true
                    throw new Error(`failed after ${phase}`)
                },
                async [rollbackPhase]() {
                    sideEffect = false
                }
            })
            await assert.rejects(registry.prepare({
                candidate: {},
                previous: {},
                diff: [{ path: ['subscription'], effects: ['subscription'] }],
                nextDocumentGeneration: 2,
                nextEffectiveGeneration: 2,
                desiredEffectHash: 'test'
            }))
            assert.strictEqual(sideEffect, false, `${phase} side effect was not restored`)
        }
    })

    it('detects a disk edit at the final commit barrier without overwriting the external revision', async () => {
        const fixture = await createFixture()
        let injected = false
        try {
            fixture.service.registerReloadHandler({
                id: 'subscription-final-cas',
                effects: ['subscription'],
                async commitHandles() {
                    if (injected) return
                    injected = true
                    const candidateSource = await fsp.readFile(fixture.configPath, 'utf8')
                    await fsp.writeFile(
                        fixture.configPath,
                        candidateSource.replace('dataTtlSeconds: 3600', 'dataTtlSeconds: 88'),
                        { mode: 0o600 }
                    )
                }
            })
            await assert.rejects(
                fixture.service.patch([{ op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 91 }]),
                (error) => error.code === 'CONFIG_GENERATION_CONFLICT'
            )
            assert.strictEqual(fixture.service.get('cache.dataTtlSeconds'), 88)
            assert.strictEqual(fixture.service.get('subscription.checkIntervalSeconds'), 91)
            assert.match(await fsp.readFile(fixture.configPath, 'utf8'), /dataTtlSeconds: 88/)
        } finally {
            await fixture.cleanup()
        }
    })

    it('enters recovery-required state when restoring the previous YAML fails', async () => {
        const fixture = await createFixture()
        try {
            const previousSource = await fsp.readFile(fixture.configPath, 'utf8')
            const originalWriteConfig = fixture.service.writer.writeConfig.bind(fixture.service.writer)
            fixture.service.writer.writeConfig = async (source, options) => {
                if (source === previousSource) {
                    const error = new Error('injected restore failure')
                    error.code = 'INJECTED_RESTORE_FAILURE'
                    throw error
                }
                return originalWriteConfig(source, options)
            }
            fixture.service.registerReloadHandler({
                id: 'subscription-restore-failure',
                effects: ['subscription'],
                commitHandles() {
                    throw new Error('candidate commit failed')
                }
            })
            await assert.rejects(fixture.service.patch([
                { op: 'set', path: ['subscription', 'checkIntervalSeconds'], value: 99 }
            ]))
            const status = fixture.service.getStatus()
            assert.strictEqual(status.degraded, true)
            assert.strictEqual(status.recoveryRequired.required, true)
            assert.strictEqual(status.recoveryRequired.diskRestoreFailed, true)
            await assert.rejects(
                fixture.service.reload({ source: 'test-after-restore-failure' }),
                (error) => error.code === 'CONFIG_RELOAD_ERROR' && error.phase === 'recovery-required'
            )
        } finally {
            await fixture.cleanup()
        }
    })

    it('rejects a symlink in the managed config/state directory chain', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bili-config-symlink-'))
        const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'bili-config-outside-'))
        const service = new ConfigService({
            configDir: path.join(root, 'config'),
            stateDir: path.join(root, 'data', 'config-state')
        })
        try {
            await fsp.symlink(outside, path.join(root, 'data'))
            await assert.rejects(
                service.initialize({ createIfMissing: true }),
                (error) => error.code === 'CONFIG_WRITE_ERROR'
            )
        } finally {
            await service.stop().catch(() => {})
            await fsp.rm(root, { recursive: true, force: true })
            await fsp.rm(outside, { recursive: true, force: true })
        }
    })
})
