'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')
const jwt = require('jsonwebtoken')

const originalSetInterval = global.setInterval
global.setInterval = (...args) => {
    const timer = originalSetInterval(...args)
    if (timer && typeof timer.unref === 'function') {
        timer.unref()
    }
    return timer
}
const apiRouter = require('../../../src/dashboard/routes/api')
global.setInterval = originalSetInterval

const config = require('../../../src/config')

const originals = {
    getStatus: config.getStatus,
    jwtSecret: config.jwtSecret,
    bot: global.bot
}

const originalGroupConfigs = JSON.parse(JSON.stringify(config.groupConfigs || {}))

function overwriteGroupConfigs(next) {
    const groupConfigs = config.__getMutableCompatStateForTests().groupConfigs || {}
    for (const key of Object.keys(groupConfigs)) {
        delete groupConfigs[key]
    }
    Object.assign(groupConfigs, next)
}

function buildToken() {
    return jwt.sign(
        { role: 'admin', timestamp: Date.now() },
        config.jwtSecret,
        { expiresIn: '1h' }
    )
}

describe('Dashboard API groups route (official group names)', function () {
    let app
    let token

    before(function () {
        app = express()
        app.use(express.json())
        app.use('/api', apiRouter)
    })

    beforeEach(function () {
        overwriteGroupConfigs({
            'FA3DBDFBE766068B55A4B0C2B0AA82CC': {},
            'DC666FC9C62249AAA0E41FF803D9DAD0': {}
        })
        config.__getMutableCompatStateForTests().jwtSecret = 'dashboard-groups-test-secret'
        config.getStatus = () => ({
            documentGeneration: 1,
            effectiveGeneration: 1,
            fingerprint: 'public-1'
        })
        token = buildToken()
        global.bot = {
            groupList: new Map([
                ['FA3DBDFBE766068B55A4B0C2B0AA82CC', { group_name: 'FA3DBDFBE766068B55A4B0C2B0AA82CC' }],
                ['DC666FC9C62249AAA0E41FF803D9DAD0', { group_name: 'DC666FC9C62249AAA0E41FF803D9DAD0' }]
            ])
        }
    })

    afterEach(function () {
        config.getStatus = originals.getStatus
        config.__getMutableCompatStateForTests().jwtSecret = originals.jwtSecret
        overwriteGroupConfigs(originalGroupConfigs)
        if (originals.bot) {
            global.bot = originals.bot
        } else {
            delete global.bot
        }
    })

    it('official provider: refreshes unknown group names and returns resolved display names', async function () {
        const refreshCalls = []
        const resolvedNames = {}
        global.bot.provider = {
            id: 'official',
            async refreshGroupInfo(groupOpenId) {
                refreshCalls.push(groupOpenId)
                resolvedNames[groupOpenId] = `群-${groupOpenId.slice(0, 4)}`
                return resolvedNames[groupOpenId]
            },
            resolveGroupDisplayName(groupOpenId) {
                return resolvedNames[groupOpenId] || ''
            }
        }

        const res = await request(app)
            .get('/api/groups')
            .set('Authorization', `Bearer ${token}`)

        assert.equal(res.status, 200)
        assert.deepEqual(refreshCalls.sort(), [
            'DC666FC9C62249AAA0E41FF803D9DAD0',
            'FA3DBDFBE766068B55A4B0C2B0AA82CC'
        ])
        const byId = new Map(res.body.map((group) => [group.id, group]))
        assert.equal(byId.get('FA3DBDFBE766068B55A4B0C2B0AA82CC').name, '群-FA3D')
        assert.equal(byId.get('DC666FC9C62249AAA0E41FF803D9DAD0').name, '群-DC66')
    })

    it('official provider: skips refresh for groups whose name is already known', async function () {
        const refreshCalls = []
        global.bot.provider = {
            id: 'official',
            async refreshGroupInfo(groupOpenId) {
                refreshCalls.push(groupOpenId)
                return null
            },
            resolveGroupDisplayName(groupOpenId) {
                return groupOpenId.startsWith('FA3D') ? '已知名称' : ''
            }
        }

        const res = await request(app)
            .get('/api/groups')
            .set('Authorization', `Bearer ${token}`)

        assert.equal(res.status, 200)
        assert.deepEqual(refreshCalls, ['DC666FC9C62249AAA0E41FF803D9DAD0'])
        const byId = new Map(res.body.map((group) => [group.id, group]))
        assert.equal(byId.get('FA3DBDFBE766068B55A4B0C2B0AA82CC').name, '已知名称')
    })

    it('non-official provider: no refresh, names come from groupList', async function () {
        const refreshCalls = []
        global.bot.provider = {
            id: 'napcat',
            async refreshGroupInfo(groupOpenId) {
                refreshCalls.push(groupOpenId)
                return 'x'
            },
            resolveGroupDisplayName() {
                return ''
            }
        }

        const res = await request(app)
            .get('/api/groups')
            .set('Authorization', `Bearer ${token}`)

        assert.equal(res.status, 200)
        assert.deepEqual(refreshCalls, [])
        assert.ok(res.body.every((group) => group.name.startsWith('群组 ') || group.name.length > 0))
    })
})
