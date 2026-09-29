'use strict'

const assert = require('assert')
const externalMediaDeliveryService = require('../../../src/services/externalMediaDeliveryService')

describe('external media delivery cleanup timer', function () {
    it('延迟清理 timer 不阻塞 Node 进程退出', function () {
        const originalSetTimeout = global.setTimeout
        let unrefCalled = false
        let delayMs = null

        global.setTimeout = (_callback, delay) => {
            delayMs = delay
            return { unref() { unrefCalled = true } }
        }

        try {
            externalMediaDeliveryService.scheduleFileCleanup('/tmp/nonexistent-external-media.mp4')
        } finally {
            global.setTimeout = originalSetTimeout
        }

        assert.strictEqual(delayMs, 5 * 60 * 1000)
        assert.strictEqual(unrefCalled, true)
    })
})
