'use strict'

const assert = require('assert')
const config = require('../../../src/config')

describe('config snapshot compatibility', () => {
    it('includes redacted jwtSecret in getConfigSnapshot()', () => {
        const snapshot = config.getConfigSnapshot()

        assert.ok(
            Object.prototype.hasOwnProperty.call(snapshot, 'jwtSecret'),
            'snapshot should include jwtSecret'
        )
        assert.strictEqual(snapshot.jwtSecret, config.jwtSecret ? '[REDACTED]' : '')
        assert.strictEqual(snapshot.dashboardPassword, config.dashboardPassword ? '[REDACTED]' : '')
    })
})
