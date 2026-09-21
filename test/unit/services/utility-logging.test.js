#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const { monitorRegex } = require('../../../src/utils/regexMonitor')
const subscriptionService = require('../../../src/services/subscriptionService')
const biliApi = require('../../../src/services/biliApi')
const serviceManager = require('../../../src/services/ServiceManager')

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    const originalReplace = subscriptionService.cookieFollowings
    const originalProcess = serviceManager.process
    const originalStart = serviceManager.start
    const originalSendCommand = serviceManager.sendCommand

    try {
        assert.throws(() => monitorRegex('boom-pattern', /x/, 'xxx', () => {
            throw new Error('regex boom')
        }), /regex boom/)

        subscriptionService.cookieFollowings = []

        serviceManager.process = {}
        serviceManager.start = async () => {}
        serviceManager.sendCommand = async () => {
            throw new Error('download boom')
        }
        const result = await biliApi.downloadVideo('BV1ZHiyBkExG', 0, '720p', '1000')
        assert.strictEqual(result.status, 'error')

        assert.ok(logs.some(line => line.includes('ERR STORE') && line.includes('[svc:regex]') && line.includes('regex-execution-failed') && line.includes('patternName=boom-pattern')))
        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('[svc:subscription]') && line.includes('cookie-followings-setter-ignored')))
        assert.ok(logs.some(line => line.includes('ERR RPC') && line.includes('[svc:bili-api]') && line.includes('video-download-failed') && line.includes('bvid=BV1ZHiyBkExG')))
        assert.ok(!logs.some(line => line.includes('[RegexMonitor]')))
        assert.ok(!logs.some(line => line.includes('[SubscriptionService]')))
        assert.ok(!logs.some(line => line.includes('[BiliApi]')))
        console.log('✓ utility/service 小模块会输出统一摘要日志')
    } finally {
        off()
        subscriptionService.cookieFollowings = originalReplace
        serviceManager.process = originalProcess
        serviceManager.start = originalStart
        serviceManager.sendCommand = originalSendCommand
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
