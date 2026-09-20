'use strict'

const assert = require('assert')
const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const path = require('path')
const {
    resolveLegacyConfig,
    createDefaultV1Config
} = require('../../../src/migrations/config/legacyLoader')
const {
    parseConfigYaml,
    stringifyConfigYaml
} = require('../../../src/migrations/config/configDocument')
const { migrateLegacy, backupLegacyFiles } = require('../../../src/migrations/config')

const FIXTURES = path.join(__dirname, '../../fixtures/config-migration')

function copyFixture(name) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-migration-'))
    const configDir = path.join(root, 'config')
    fs.cpSync(path.join(FIXTURES, name), configDir, { recursive: true })
    fs.chmodSync(root, 0o700)
    fs.chmodSync(configDir, 0o700)
    const configYaml = path.join(configDir, 'config.yaml')
    if (fs.existsSync(configYaml)) fs.chmodSync(configYaml, 0o600)
    const runtimeEnvFile = path.join(configDir, 'runtime-env.json')
    if (fs.existsSync(runtimeEnvFile)) fs.chmodSync(runtimeEnvFile, 0o600)
    return { root, configDir, runtimeEnvFile }
}

describe('legacy config resolver', () => {
    it('replays field-level priority and drops removed Agent settings with a warning', () => {
        const fixture = copyFixture('conflict-priority')
        try {
            const result = resolveLegacyConfig({
                configDir: fixture.configDir,
                runtimeEnvFile: fixture.runtimeEnvFile
            })
            assert.strictEqual(result.source, 'legacy')
            assert.strictEqual(result.config.qq.napcat.wsUrl, 'ws://config-json.example:3001')
            assert.strictEqual(result.config.qq.provider, 'napcat')
            assert.strictEqual(result.config.qq.official.clientSecret, 'runtime-official-secret')
            assert.strictEqual(result.config.dashboard.jwtSecret, 'config-json-jwt-secret')
            assert.deepStrictEqual(result.config.qq.official.rootOpenids, [
                'config-root-1',
                'config-root-2',
                'runtime-root-1',
                'runtime-root-2'
            ])
            assert.strictEqual(result.config.admin.rootQQ, '20002')
            assert.strictEqual(result.config.paths.python, '/config-json/python')
            assert.strictEqual(result.config.pythonService.port, 12001)
            // Agent 已移除：遗留 agent 配置与 AGENT_* 环境变量被丢弃并告警
            assert.ok(!Object.prototype.hasOwnProperty.call(result.config, 'agent'))
            assert.ok(result.warnings.some((warning) => warning.code === 'LEGACY_AGENT_CONFIG_DROPPED'))
            assert.deepStrictEqual(result.config.groupConfigs['12345'].admins, ['90001'])
            assert.strictEqual(
                result.config.compat.unmappedLegacy.groupConfigs['12345'].futureLegacyFlag,
                'preserve-me'
            )
            assert.ok(result.warnings.some((warning) => warning.code === 'LEGACY_UNMAPPED_GROUP_CONFIG'))
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true })
        }
    })

    it('does not let dotenv overwrite the captured runtime environment', () => {
        const fixture = copyFixture('conflict-priority')
        try {
            const result = resolveLegacyConfig({
                configDir: fixture.configDir,
                runtimeEnvFile: fixture.runtimeEnvFile
            })
            assert.strictEqual(result.config.pythonService.port, 12001)
            assert.strictEqual(result.config.qq.official.clientSecret, 'runtime-official-secret')
            assert.strictEqual(result.config.admin.rootQQ, '20002')
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true })
        }
    })

    it('preserves legacy Official root ordering/duplicates and logger effective semantics', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-legacy-roots-logger-'))
        const configDir = path.join(root, 'config')
        const runtimeEnvFile = path.join(root, 'runtime-env.json')
        fs.mkdirSync(configDir, { mode: 0o700 })
        fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
            qqOfficialRootOpenids: ['root-a', 'root-a']
        }), { mode: 0o600 })
        fs.writeFileSync(path.join(configDir, '.jwtSecret'), 'j'.repeat(64), { mode: 0o600 })
        fs.writeFileSync(runtimeEnvFile, JSON.stringify({
            QQ_OFFICIAL_ROOT_OPENIDS: 'root-a,root-b',
            LOG_LEVEL: 'not-a-level',
            LOG_STACKS: 'all'
        }), { mode: 0o600 })
        try {
            const result = resolveLegacyConfig({ configDir, runtimeEnvFile })
            assert.deepStrictEqual(result.config.qq.official.rootOpenids, ['root-a', 'root-a', 'root-a', 'root-b'])
            assert.strictEqual(result.config.logging.level, 'info')
            assert.strictEqual(result.config.logging.stacks, 'always')
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('preserves the exact legacy bool parser and fails closed for raw unrepresentable overrides', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-legacy-types-'))
        const configDir = path.join(root, 'config')
        fs.mkdirSync(configDir, { mode: 0o700 })
        const runtimeEnvFile = path.join(root, 'runtime-env.json')
        fs.writeFileSync(runtimeEnvFile, '{"QQ_OFFICIAL_USE_SHARDED_GATEWAY":"off"}\n', { mode: 0o600 })
        fs.writeFileSync(path.join(configDir, '.jwtSecret'), 'a'.repeat(64), { mode: 0o600 })
        try {
            fs.writeFileSync(path.join(configDir, 'config.json'), '{}\n', { mode: 0o600 })
            const envResult = resolveLegacyConfig({ configDir, runtimeEnvFile })
            assert.strictEqual(envResult.config.qq.official.useShardedGateway, true)

            fs.writeFileSync(path.join(configDir, 'config.json'), '{"videoDownloadEnabled":"false"}\n', { mode: 0o600 })
            assert.throws(
                () => resolveLegacyConfig({ configDir, runtimeEnvFile }),
                (error) => error.code === 'LEGACY_EFFECTIVE_CONFIG_UNREPRESENTABLE'
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('accepts the protected KEY=VALUE runtime snapshot emitted by setup', () => {
        const fixture = copyFixture('conflict-priority')
        try {
            fs.writeFileSync(fixture.runtimeEnvFile, 'BILI_SERVER_PORT=13001\nADMIN_QQ=30003\n', { mode: 0o600 })
            const result = resolveLegacyConfig({
                configDir: fixture.configDir,
                runtimeEnvFile: fixture.runtimeEnvFile
            })
            assert.strictEqual(result.config.pythonService.port, 13001)
            assert.strictEqual(result.config.admin.rootQQ, '30003')
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true })
        }
    })

    it('treats an existing valid YAML as authoritative without requiring runtime env', () => {
        const fixture = copyFixture('existing-yaml')
        try {
            const result = resolveLegacyConfig({ configDir: fixture.configDir })
            assert.strictEqual(result.source, 'existing-yaml')
            assert.strictEqual(result.config.qq.provider, 'official')
            assert.strictEqual(result.config.dashboard.listenPort, 3555)
            assert.deepStrictEqual(result.sourceHashes, {
                config_yaml: result.sourceHashes.config_yaml
            })
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true })
        }
    })

    it('requires authoritative YAML to be a private single-link regular file', () => {
        for (const unsafeKind of ['mode', 'symlink', 'hardlink']) {
            const fixture = copyFixture('existing-yaml')
            const yamlPath = path.join(fixture.configDir, 'config.yaml')
            try {
                if (unsafeKind === 'mode') {
                    fs.chmodSync(yamlPath, 0o644)
                } else if (unsafeKind === 'symlink') {
                    const target = path.join(fixture.root, 'managed.yaml')
                    fs.renameSync(yamlPath, target)
                    fs.symlinkSync(target, yamlPath)
                } else {
                    fs.linkSync(yamlPath, path.join(fixture.root, 'managed-hardlink.yaml'))
                }
                assert.throws(
                    () => resolveLegacyConfig({ configDir: fixture.configDir }),
                    (error) => ['CONFIG_FILE_UNSAFE', 'CONFIG_FILE_PERMISSION_UNSAFE'].includes(error.code),
                    unsafeKind
                )
            } finally {
                fs.rmSync(fixture.root, { recursive: true, force: true })
            }
        }
    })

    it('copies authoritative YAML to a distinct output with resumable hash fencing', () => {
        const fixture = copyFixture('existing-yaml')
        const output = path.join(fixture.root, 'staged-config/config.yaml')
        const migrationDir = path.join(fixture.root, 'migration')
        const cutover = {
            sourceRuntimeClass: 'managed-v1+',
            cutoverKind: 'managed-upgrade',
            cutoverAttemptId: 'existing-yaml-copy',
            deliveryGuarantee: 'exactly-once',
            exceptionScope: 'none',
            affectedState: 'none',
            retryPolicy: 'none',
            warningCodes: []
        }
        try {
            assert.throws(() => migrateLegacy({
                configDir: fixture.configDir,
                configPath: output,
                migrationDir,
                cutover,
                faultInjector(phase) {
                    if (phase === 'target_prepared') throw new Error('simulated interruption')
                }
            }), /simulated interruption/)
            assert.strictEqual(fs.existsSync(output), false)
            const resumed = migrateLegacy({
                configDir: fixture.configDir,
                configPath: output,
                migrationDir,
                cutover
            })
            assert.strictEqual(resumed.status, 'candidate-written')
            assert.deepStrictEqual(fs.readFileSync(output), fs.readFileSync(path.join(fixture.configDir, 'config.yaml')))
            fs.writeFileSync(output, 'version: 1\n', { mode: 0o600 })
            assert.throws(
                () => migrateLegacy({ configDir: fixture.configDir, configPath: output, migrationDir, cutover }),
                (error) => error.code === 'MIGRATION_EXISTING_YAML_TARGET_CONFLICT'
            )
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true })
        }
    })

    it('rejects duplicate keys, aliases, future versions and node limit overflow', () => {
        assert.throws(
            () => parseConfigYaml('version: 1\nversion: 1\n'),
            (error) => error.code === 'CONFIG_YAML_PARSE_FAILED'
        )
        assert.throws(
            () => parseConfigYaml('version: 1\nqq: &qq\n  provider: napcat\ncopy: *qq\n'),
            (error) => error.code === 'CONFIG_YAML_ALIAS_FORBIDDEN'
        )
        const future = createDefaultV1Config({ jwtSecret: 'fixture-jwt' })
        future.version = 2
        assert.throws(
            () => stringifyConfigYaml(future),
            (error) => error.code === 'CONFIG_FUTURE_VERSION'
        )
        assert.throws(
            () => parseConfigYaml('version: 1\nqq:\n  provider: napcat\n', { maxNodes: 1 }),
            (error) => error.code === 'CONFIG_MAX_NODES_EXCEEDED'
        )
    })

    it('writes private candidate and migration artifacts while dry-run remains write-free', () => {
        const dryFixture = copyFixture('conflict-priority')
        try {
            const dryDataDir = path.join(dryFixture.root, 'data')
            const result = migrateLegacy({
                configDir: dryFixture.configDir,
                dataDir: dryDataDir,
                runtimeEnvFile: dryFixture.runtimeEnvFile,
                dryRun: true,
                cutover: {
                    sourceRuntimeClass: 'legacy-v0',
                    cutoverKind: 'first-managed-adoption',
                    cutoverAttemptId: 'fixture-attempt',
                    deliveryGuarantee: 'best-effort',
                    exceptionScope: 'legacy-v0-first-cutover-inflight-outbound',
                    affectedState: 'operations-without-durable-part-record',
                    retryPolicy: 'retry-determinable-uncommitted-parent-or-target',
                    ambiguousDeliveryWindow: true,
                    warningCodes: ['LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS']
                }
            })
            assert.strictEqual(result.status, 'planned')
            assert.strictEqual(fs.existsSync(path.join(dryFixture.configDir, 'config.yaml')), false)
            assert.strictEqual(fs.existsSync(dryDataDir), false)
        } finally {
            fs.rmSync(dryFixture.root, { recursive: true, force: true })
        }

        const fixture = copyFixture('conflict-priority')
        try {
            const dataDir = path.join(fixture.root, 'data')
            const result = migrateLegacy({
                configDir: fixture.configDir,
                dataDir,
                runtimeEnvFile: fixture.runtimeEnvFile,
                cutover: {
                    sourceRuntimeClass: 'legacy-v0',
                    cutoverKind: 'first-managed-adoption',
                    cutoverAttemptId: 'fixture-attempt',
                    deliveryGuarantee: 'best-effort',
                    exceptionScope: 'legacy-v0-first-cutover-inflight-outbound',
                    affectedState: 'operations-without-durable-part-record',
                    retryPolicy: 'retry-determinable-uncommitted-parent-or-target',
                    ambiguousDeliveryWindow: true,
                    warningCodes: ['LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS']
                }
            })
            assert.strictEqual(result.manifest.status, 'candidate_written')
            assert.ok(result.manifest.cutover.warningCodes.includes('LEGACY_UNMAPPED_GROUP_CONFIG'))
            assert.ok(result.publicStatus.warningCodes.includes('LEGACY_UNMAPPED_GROUP_CONFIG'))
            assert.strictEqual(fs.statSync(fixture.configDir).mode & 0o777, 0o700)
            assert.strictEqual(fs.statSync(path.join(fixture.configDir, 'config.yaml')).mode & 0o777, 0o600)
            assert.strictEqual(fs.statSync(path.dirname(result.manifestPath)).mode & 0o777, 0o700)
            assert.strictEqual(fs.statSync(result.manifestPath).mode & 0o777, 0o600)
            for (const artifact of result.manifest.archiveArtifacts) {
                assert.strictEqual(fs.statSync(path.join(path.dirname(result.manifestPath), artifact)).mode & 0o777, 0o600)
            }
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true })
        }
    })

    it('never overwrites an existing legacy backup on retry', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-config-backup-'))
        const configDir = path.join(root, 'config')
        const migrationDir = path.join(root, 'migration')
        fs.mkdirSync(configDir, { mode: 0o700 })
        fs.mkdirSync(migrationDir, { mode: 0o700 })
        const sourcePath = path.join(configDir, '.env')
        fs.writeFileSync(sourcePath, 'VALUE=before\n', { mode: 0o600 })
        try {
            backupLegacyFiles(configDir, migrationDir)
            const backupPath = path.join(migrationDir, 'dotenv.backup')
            const originalBackup = fs.readFileSync(backupPath)
            assert.deepStrictEqual(backupLegacyFiles(configDir, migrationDir), ['dotenv.backup'])
            assert.deepStrictEqual(fs.readFileSync(backupPath), originalBackup)
            fs.writeFileSync(sourcePath, 'VALUE=after\n', { mode: 0o600 })
            assert.throws(
                () => backupLegacyFiles(configDir, migrationDir),
                (error) => error.code === 'MIGRATION_BACKUP_CONFLICT'
            )
            assert.deepStrictEqual(fs.readFileSync(backupPath), originalBackup)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('uses one captured legacy byte snapshot for parsing, hashing, and backup', () => {
        const fixture = copyFixture('conflict-priority')
        const dataDir = path.join(fixture.root, 'data')
        const original = fs.readFileSync(path.join(fixture.configDir, 'config.json'))
        try {
            const resolved = resolveLegacyConfig({
                configDir: fixture.configDir,
                runtimeEnvFile: fixture.runtimeEnvFile,
                generatedJwtSecret: 'a'.repeat(64)
            })
            fs.writeFileSync(path.join(fixture.configDir, 'config.json'), '{"wsUrl":"ws://changed.invalid"}\n')
            const migrationDir = path.join(fixture.root, 'migration')
            fs.mkdirSync(migrationDir, { mode: 0o700 })
            backupLegacyFiles(fixture.configDir, migrationDir, {
                capturedSources: resolved.capturedSources,
                sourceHashes: resolved.sourceHashes
            })
            assert.deepStrictEqual(fs.readFileSync(path.join(migrationDir, 'json.backup')), original)
            assert.equal(resolved.sourceHashes.json, crypto.createHash('sha256').update(original).digest('hex'))
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true })
        }
    })

    it('replays the legacy JWT owner precedence and 64-character secret-file rule', () => {
        const cases = [
            { name: 'override', config: { jwtSecret: 'override-secret' }, env: { JWT_SECRET: 'env-secret' }, file: 'f'.repeat(64), expected: 'override-secret' },
            { name: 'env', config: {}, env: { JWT_SECRET: 'env-secret' }, file: 'f'.repeat(64), expected: 'env-secret' },
            { name: 'file-64', config: {}, env: {}, file: `  ${'s'.repeat(64)}\n`, expected: 's'.repeat(64) },
            { name: 'file-63-generates', config: {}, env: {}, file: 's'.repeat(63), generated: 'a'.repeat(64), expected: 'a'.repeat(64) },
            { name: 'file-65-generates', config: {}, env: {}, file: 's'.repeat(65), generated: 'b'.repeat(64), expected: 'b'.repeat(64) },
            { name: 'missing-generates', config: {}, env: {}, generated: 'c'.repeat(64), expected: 'c'.repeat(64) }
        ]
        for (const item of cases) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), `bili-jwt-${item.name}-`))
            const configDir = path.join(root, 'config')
            fs.mkdirSync(configDir, { mode: 0o700 })
            fs.writeFileSync(path.join(configDir, 'config.json'), `${JSON.stringify(item.config)}\n`)
            const runtimeEnvFile = path.join(configDir, 'runtime-env.json')
            fs.writeFileSync(runtimeEnvFile, `${JSON.stringify(item.env)}\n`, { mode: 0o600 })
            if (item.file !== undefined) fs.writeFileSync(path.join(configDir, '.jwtSecret'), item.file, { mode: 0o600 })
            try {
                const result = resolveLegacyConfig({ configDir, runtimeEnvFile, generatedJwtSecret: item.generated })
                assert.strictEqual(result.config.dashboard.jwtSecret, item.expected, item.name)
            } finally {
                fs.rmSync(root, { recursive: true, force: true })
            }
        }
    })

    it('fails closed for unrepresentable or unprovable legacy JWT effective values', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-jwt-fail-'))
        const configDir = path.join(root, 'config')
        fs.mkdirSync(configDir, { mode: 0o700 })
        const runtimeEnvFile = path.join(configDir, 'runtime-env.json')
        fs.writeFileSync(runtimeEnvFile, '{}\n', { mode: 0o600 })
        try {
            fs.writeFileSync(path.join(configDir, 'config.json'), '{"jwtSecret":""}\n')
            assert.throws(
                () => resolveLegacyConfig({ configDir, runtimeEnvFile, allowGenerateJwtSecret: true }),
                (error) => error.code === 'LEGACY_JWT_SECRET_UNREPRESENTABLE'
            )
            fs.writeFileSync(path.join(configDir, 'config.json'), '{}\n')
            fs.writeFileSync(path.join(configDir, '.jwtSecret'), 'x'.repeat(63), { mode: 0o600 })
            assert.throws(
                () => resolveLegacyConfig({ configDir, runtimeEnvFile }),
                (error) => error.code === 'LEGACY_JWT_SECRET_EFFECTIVE_UNPROVABLE'
            )
            fs.rmSync(path.join(configDir, '.jwtSecret'))
            fs.mkdirSync(path.join(configDir, '.jwtSecret'))
            assert.throws(
                () => resolveLegacyConfig({ configDir, runtimeEnvFile, allowGenerateJwtSecret: true }),
                (error) => error.code === 'LEGACY_SOURCE_UNSAFE'
            )
            fs.rmSync(path.join(configDir, '.jwtSecret'), { recursive: true })
            fs.writeFileSync(path.join(configDir, '.jwtSecret'), 'x'.repeat(64), { mode: 0o000 })
            assert.throws(
                () => resolveLegacyConfig({ configDir, runtimeEnvFile, allowGenerateJwtSecret: true }),
                (error) => error.code === 'LEGACY_SOURCE_READ_FAILED'
            )
            fs.chmodSync(path.join(configDir, '.jwtSecret'), 0o600)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
