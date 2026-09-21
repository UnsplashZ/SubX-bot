#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')

const sysConfig = require('../../../src/config')
const groupsRouter = require('../../../src/dashboard/routes/api/modules/groups')
const groupVideoDownloadRouter = require('../../../src/dashboard/routes/api/modules/group-video-download')
const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')

function createApp(...routers) {
    const app = express()
    app.use(express.json())
    for (const router of routers) {
        app.use('/api', router)
    }
    return app
}

describe('dashboard official group_openid support', () => {
    const originals = {}
    const testState = sysConfig.__getMutableCompatStateForTests()
    let generation
    let patchCalls

    beforeEach(() => {
        originals.save = sysConfig.save
        originals.patch = sysConfig.patch
        originals.getSnapshot = sysConfig.getSnapshot
        originals.getStatus = sysConfig.getStatus
        originals.qqProvider = sysConfig.qqProvider
        originals.groupConfigs = JSON.parse(JSON.stringify(sysConfig.groupConfigs || {}))
        originals.enabledGroups = Array.isArray(sysConfig.enabledGroups) ? [...sysConfig.enabledGroups] : []
        originals.providerScopedEnabledGroups = JSON.parse(JSON.stringify(sysConfig.providerScopedEnabledGroups || {}))
        originals.bot = global.bot
        originals.removeGroupFromAllSubscriptions = subscriptionManager.removeGroupFromAllSubscriptions

        sysConfig.save = () => {}
        testState.qqProvider = 'official'
        testState.groupConfigs = {
            'group-openid': { isInGroup: true }
        }
        testState.enabledGroups = []
        testState.providerScopedEnabledGroups = {}
        generation = 1
        patchCalls = []
        sysConfig.getSnapshot = () => ({
            groupConfigs: JSON.parse(JSON.stringify(sysConfig.groupConfigs || {})),
            enabledGroups: [...(sysConfig.enabledGroups || [])],
            providerScopedEnabledGroups: JSON.parse(JSON.stringify(sysConfig.providerScopedEnabledGroups || {}))
        })
        sysConfig.getStatus = () => ({
            documentGeneration: generation,
            effectiveGeneration: generation,
            fingerprint: `public-${generation}`
        })
        sysConfig.patch = async (operations, options) => {
            patchCalls.push({ operations: JSON.parse(JSON.stringify(operations)), options: { ...options } })
            for (const operation of operations) {
                const [root, key, nested] = operation.path
                if (root === 'groupConfigs') {
                    if (operation.op === 'remove') delete testState.groupConfigs[key]
                    else testState.groupConfigs[key] = JSON.parse(JSON.stringify(operation.value))
                } else if (root === 'providerScopedEnabledGroups') {
                    testState.providerScopedEnabledGroups[nested || key] = [...operation.value]
                } else if (root === 'enabledGroups') {
                    testState.enabledGroups = [...operation.value]
                }
            }
            generation += 1
            return {
                documentGeneration: generation,
                effectiveGeneration: generation,
                generation,
                applied: operations.map((operation) => operation.path.join('.')),
                reloaded: ['groups'],
                deploymentApplyRequired: [],
                warnings: []
            }
        }
        global.bot = {
            provider: { id: 'official' },
            groupList: new Map([
                ['group-openid', { group_id: 'group-openid', group_name: 'Official Group' }]
            ])
        }
    })

    afterEach(() => {
        testState.qqProvider = originals.qqProvider
        testState.groupConfigs = originals.groupConfigs
        testState.enabledGroups = originals.enabledGroups
        testState.providerScopedEnabledGroups = originals.providerScopedEnabledGroups
        sysConfig.save = originals.save
        sysConfig.patch = originals.patch
        sysConfig.getSnapshot = originals.getSnapshot
        sysConfig.getStatus = originals.getStatus
        global.bot = originals.bot
        subscriptionManager.removeGroupFromAllSubscriptions = originals.removeGroupFromAllSubscriptions
    })

    it('lists and updates official opaque group ids in dashboard APIs', async () => {
        const app = createApp(groupsRouter, groupVideoDownloadRouter)

        const listRes = await request(app).get('/api/groups')
        assert.equal(listRes.status, 200)
        assert.equal(listRes.headers['x-config-generation'], '1')
        assert.deepEqual(listRes.body.map(group => group.id), ['group-openid'])
        assert.equal(listRes.body[0].name, 'Official Group')

        const configRes = await request(app)
            .post('/api/groups/group-openid/config')
            .send({ showId: false, expectedGeneration: 1 })
        assert.equal(configRes.status, 200)
        assert.equal(configRes.body.config.showId, false)

        const videoRes = await request(app)
            .put('/api/groups/group-openid/video-download-config')
            .send({ videoDownloadEnabled: true, videoDownloadResolution: '720p', expectedGeneration: 2 })
        assert.equal(videoRes.status, 200)
        assert.equal(videoRes.body.config.videoDownloadEnabled, true)
    })

    it('keeps opaque group ids rejected in onebot compatibility mode', async () => {
        testState.qqProvider = 'napcat'
        global.bot = {
            provider: { id: 'napcat' },
            groupList: new Map()
        }
        const app = createApp(groupsRouter)

        const res = await request(app)
            .post('/api/groups/group-openid/config')
            .send({ showId: false, expectedGeneration: 1 })

        assert.equal(res.status, 400)
    })

    it('stores Official group toggles in provider-scoped whitelist without mutating NapCat whitelist', async () => {
        testState.enabledGroups = []
        testState.providerScopedEnabledGroups = {}
        const app = createApp(groupsRouter)

        const res = await request(app)
            .post('/api/groups/group-openid/toggle')
            .send({ expectedGeneration: 1 })

        assert.equal(res.status, 200)
        assert.deepEqual(sysConfig.enabledGroups, [])
        assert.deepEqual(sysConfig.providerScopedEnabledGroups.official, [])

        testState.qqProvider = 'napcat'
        global.bot = {
            provider: { id: 'napcat' },
            groupList: new Map([[1000, { group_id: 1000, group_name: 'NapCat Group' }]])
        }
        const listRes = await request(app).get('/api/groups')
        assert.equal(listRes.status, 200)
        assert.equal(listRes.body[0].id, '1000')
        assert.equal(listRes.body[0].isEnabled, true)
    })

    it('rolls configuration back when left-group subscription cleanup fails', async () => {
        testState.groupConfigs = { 'group-openid': { isInGroup: false, showId: false } }
        testState.providerScopedEnabledGroups = { official: ['group-openid'] }
        global.bot = { provider: { id: 'official' }, groupList: new Map() }
        subscriptionManager.removeGroupFromAllSubscriptions = async () => {
            throw new Error('fixture cleanup failure')
        }
        const app = createApp(groupsRouter)

        const res = await request(app)
            .delete('/api/groups/group-openid')
            .send({ expectedGeneration: 1 })

        assert.equal(res.status, 500)
        assert.equal(res.body.code, 'GROUP_SUBSCRIPTION_CLEANUP_FAILED')
        assert.deepEqual(sysConfig.groupConfigs['group-openid'], { isInGroup: false, showId: false })
        assert.deepEqual(sysConfig.providerScopedEnabledGroups.official, ['group-openid'])
        assert.equal(patchCalls.length, 2)
        assert.equal(patchCalls[1].options.actor, 'dashboard-rollback')
        assert.equal(patchCalls[1].options.expectedGeneration, 2)
    })
})
