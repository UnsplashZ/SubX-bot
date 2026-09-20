'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')
const { createConfigRouter } = require('../../../src/dashboard/routes/api/modules/config')
const { emptyMutationResult } = require('../../../src/dashboard/routes/api/shared/config-mutation')
const logger = require('../../../src/utils/logger')

function createStub() {
    const calls = []
    let generation = 7
    let secretConfigured = false
    let tokenConfigured = false
    const config = {
        service: {
            lastReloadResult: null,
            toPublicError(error) {
                return { code: error.code || 'CONFIG_ERROR', path: error.path || '', line: null, column: null }
            }
        },
        getStatus() {
            return {
                valid: true,
                schemaVersion: 1,
                documentGeneration: generation,
                effectiveGeneration: generation,
                fingerprint: 'public-fingerprint',
                components: {}
            }
        },
        getDashboardConfigSnapshot() {
            return {
                qqProvider: 'napcat',
                wsUrl: 'ws://localhost:3001',
                wsTokenConfigured: tokenConfigured,
                qqOfficialClientSecretConfigured: secretConfigured,
                generation
            }
        },
        getRootAdminQQ() {
            return '10001'
        },
        async patch(operations, options) {
            calls.push({ operations, options })
            if (options.expectedGeneration !== generation) {
                const error = new Error('conflict')
                error.code = 'CONFIG_GENERATION_CONFLICT'
                error.conflictPaths = ['qq.provider']
                throw error
            }
            if (operations.some((operation) => operation.path.join('.') === 'qq.official.clientSecret' && operation.op === 'set')) {
                secretConfigured = true
            }
            if (operations.some((operation) => operation.path.join('.') === 'qq.official.clientSecret' && operation.op === 'clear-secret')) {
                secretConfigured = false
            }
            if (operations.some((operation) => operation.path.join('.') === 'qq.napcat.wsToken' && operation.op === 'set')) {
                tokenConfigured = true
            }
            if (operations.some((operation) => operation.path.join('.') === 'qq.napcat.wsToken' && operation.op === 'clear-secret')) {
                tokenConfigured = false
            }
            generation += 1
            return {
                generation,
                documentGeneration: generation,
                effectiveGeneration: generation,
                applied: operations.map((operation) => operation.path.join('.')),
                reloaded: ['qqProvider'],
                deploymentApplyRequired: [],
                warnings: [],
                diff: []
            }
        },
        async reload() {
            return {
                generation,
                documentGeneration: generation,
                effectiveGeneration: generation,
                applied: [],
                reloaded: [],
                deploymentApplyRequired: [],
                warnings: []
            }
        },
        async recover(options) {
            calls.push({ recovery: true, options })
            return { recovered: true, handlers: ['qq-provider-runtime'], documentGeneration: generation }
        }
    }
    return { config, calls }
}

function createApp(stub, migration = null) {
    const app = express()
    app.use(express.json())
    app.use('/api', createConfigRouter({
        config: stub.config,
        getMigrationStatus: async () => migration
    }))
    return app
}

describe('dashboard config v1 API', () => {
    it('exposes the token-fenced ConfigService recovery action', async () => {
        const stub = createStub()
        const response = await request(createApp(stub))
            .post('/api/config/recover')
            .send({})
        assert.strictEqual(response.status, 200)
        assert.strictEqual(response.body.recovered, true)
        assert.deepStrictEqual(response.body.handlers, ['qq-provider-runtime'])
        assert.deepStrictEqual(stub.calls[0], {
            recovery: true,
            options: { source: 'dashboard' }
        })
    })

    it('uses expectedGeneration ConfigService.patch and never echoes a Secret', async () => {
        const stub = createStub()
        const response = await request(createApp(stub))
            .post('/api/config')
            .send({
                expectedGeneration: 7,
                qqProvider: 'official',
                qqOfficialClientSecret: 'fixture-secret',
                qqOfficialRootOpenids: 'root-a,root-b'
            })

        assert.strictEqual(response.status, 200)
        assert.strictEqual(response.body.generation, 8)
        assert.deepStrictEqual(response.body.reloaded, ['qqProvider'])
        assert.strictEqual(response.body.config.qqOfficialClientSecretConfigured, true)
        assert.ok(!JSON.stringify(response.body).includes('fixture-secret'))
        assert.strictEqual(stub.calls[0].options.actor, 'dashboard')
        assert.strictEqual(stub.calls[0].options.expectedGeneration, 7)
        assert.ok(stub.calls[0].operations.some((operation) => operation.path.join('.') === 'qq.official.clientSecret'))
    })

    it('treats omitted/empty Secret as unchanged and requires explicit clear-secret', async () => {
        const stub = createStub()
        await request(createApp(stub))
            .post('/api/config')
            .send({ expectedGeneration: 7, qqOfficialClientSecret: 'fixture-secret' })

        const unchanged = await request(createApp(stub))
            .post('/api/config')
            .send({ expectedGeneration: 8, qqProvider: 'official', qqOfficialClientSecret: '' })
        assert.strictEqual(unchanged.status, 200)
        assert.ok(!stub.calls[1].operations.some((operation) => operation.path.join('.') === 'qq.official.clientSecret'))

        const cleared = await request(createApp(stub))
            .post('/api/config')
            .send({
                expectedGeneration: 9,
                secretActions: { qqOfficialClientSecret: 'clear' }
            })
        assert.strictEqual(cleared.status, 200)
        assert.strictEqual(cleared.body.config.qqOfficialClientSecretConfigured, false)
        assert.ok(stub.calls[2].operations.some((operation) => operation.op === 'clear-secret'))
    })

    it('accepts OneBot wsUrl/wsToken updates, keeps empty token unchanged and requires explicit clear', async () => {
        const stub = createStub()
        const response = await request(createApp(stub))
            .post('/api/config')
            .send({ expectedGeneration: 7, wsUrl: 'ws://napcat:3001', wsToken: 'fixture-token' })

        assert.strictEqual(response.status, 200)
        assert.strictEqual(response.body.config.wsTokenConfigured, true)
        assert.ok(!JSON.stringify(response.body).includes('fixture-token'))
        assert.ok(stub.calls[0].operations.some((operation) => operation.path.join('.') === 'qq.napcat.wsUrl'))
        assert.ok(stub.calls[0].operations.some((operation) => operation.path.join('.') === 'qq.napcat.wsToken'))

        const unchanged = await request(createApp(stub))
            .post('/api/config')
            .send({ expectedGeneration: 8, wsUrl: 'ws://napcat:3002', wsToken: '' })
        assert.strictEqual(unchanged.status, 200)
        assert.ok(stub.calls[1].operations.some((operation) => operation.path.join('.') === 'qq.napcat.wsUrl'))
        assert.ok(!stub.calls[1].operations.some((operation) => operation.path.join('.') === 'qq.napcat.wsToken'))

        const cleared = await request(createApp(stub))
            .post('/api/config')
            .send({ expectedGeneration: 9, secretActions: { wsToken: 'clear' } })
        assert.strictEqual(cleared.status, 200)
        assert.strictEqual(cleared.body.config.wsTokenConfigured, false)
        assert.ok(stub.calls[2].operations.some((operation) => operation.op === 'clear-secret' && operation.path.join('.') === 'qq.napcat.wsToken'))
    })

    it('returns a redacted 409 conflict and rejects missing generation', async () => {
        const stub = createStub()
        const missing = await request(createApp(stub))
            .post('/api/config')
            .send({ qqProvider: 'official' })
        assert.strictEqual(missing.status, 400)
        assert.strictEqual(missing.body.code, 'CONFIG_EXPECTED_GENERATION_REQUIRED')

        const conflict = await request(createApp(stub))
            .post('/api/config')
            .send({ expectedGeneration: 6, qqProvider: 'official' })
        assert.strictEqual(conflict.status, 409)
        assert.strictEqual(conflict.body.generation, 7)
        assert.deepStrictEqual(conflict.body.conflictPaths, ['qq.provider'])
        assert.strictEqual(conflict.body.message, undefined)
    })

    it('logs redacted reload failure details without exposing them in the response', async () => {
        const stub = createStub()
        const cause = Object.assign(new Error('gateway denied clientSecret=fixture-secret'), {
            code: 'QQ_OPENAPI_ERROR',
            httpStatus: 403,
            qqCode: 11241,
            path: '/gateway/bot'
        })
        stub.config.patch = async () => {
            throw Object.assign(new Error('Reload handler failed during prepareParallel'), {
                code: 'CONFIG_RELOAD_ERROR',
                phase: 'prepareParallel',
                handlerId: 'qq-provider-runtime',
                cause
            })
        }

        const events = []
        const unsubscribe = logger.onLog((event) => events.push(event))
        try {
            const response = await request(createApp(stub))
                .post('/api/config')
                .send({ expectedGeneration: 7, qqProvider: 'official' })

            assert.strictEqual(response.status, 400)
            assert.strictEqual(response.body.code, 'CONFIG_RELOAD_ERROR')
            assert.strictEqual(response.body.phase, undefined)
            assert.strictEqual(response.body.causeMessage, undefined)

            const event = events.find((entry) => entry.action === 'config-update-failed')
            assert.ok(event)
            assert.strictEqual(event.fields.phase, 'prepareParallel')
            assert.strictEqual(event.fields.handlerId, 'qq-provider-runtime')
            assert.strictEqual(event.fields.causeCode, 'QQ_OPENAPI_ERROR')
            assert.strictEqual(event.fields.httpStatus, 403)
            assert.strictEqual(event.fields.qqCode, 11241)
            assert.strictEqual(event.fields.causePath, '/gateway/bot')
            assert.strictEqual(event.fields.causeMessage, 'gateway denied clientSecret=[REDACTED]')
            assert.ok(!JSON.stringify(event).includes('fixture-secret'))
        } finally {
            unsubscribe()
        }
    })

    it('uses the same typed migration projection for the migrations endpoint', async () => {
        const stub = createStub()
        const migration = {
            migrationId: 'config-v0-to-v1',
            checkpoint: 'probe_ready',
            phase: 'probe',
            deliveryGuarantee: 'best-effort',
            warningCodes: ['LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS']
        }
        const response = await request(createApp(stub, migration)).get('/api/config/migrations')
        assert.strictEqual(response.status, 200)
        assert.deepStrictEqual(response.body.migration, migration)
    })

    it('accepts segment arrays and strict RFC 6901 pointers but rejects dotted or malformed paths', async () => {
        const stub = createStub()
        const arrayPath = await request(createApp(stub)).post('/api/config').send({
            expectedGeneration: 7,
            patch: [{ op: 'set', path: ['qq', 'provider'], value: 'official' }]
        })
        assert.strictEqual(arrayPath.status, 200)

        const pointer = await request(createApp(stub)).post('/api/config').send({
            expectedGeneration: 8,
            patch: [{ op: 'set', path: '/qq/provider', value: 'napcat' }]
        })
        assert.strictEqual(pointer.status, 200)

        for (const path of ['qq.provider', '/qq/~2provider', '/qq//provider']) {
            const response = await request(createApp(stub)).post('/api/config').send({
                expectedGeneration: 9,
                patch: [{ op: 'set', path, value: 'official' }]
            })
            assert.strictEqual(response.status, 400)
            assert.strictEqual(response.body.code, 'CONFIG_PATH_INVALID')
        }
    })

    it('keeps persisted deployment pending paths in no-op mutation responses', () => {
        const result = emptyMutationResult({
            getStatus: () => ({
                documentGeneration: 11,
                effectiveGeneration: 11,
                pendingDeploymentApply: ['deployment.ports.dashboardHost']
            })
        })
        assert.deepStrictEqual(result.deploymentApplyRequired, ['deployment.ports.dashboardHost'])
    })
})
