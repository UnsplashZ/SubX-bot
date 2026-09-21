#!/usr/bin/env node
'use strict'

const assert = require('assert')

const whoami = require('../../../src/commands/whoami')
const buildIdentityLines = whoami._buildIdentityLines

describe('whoami identity lines', () => {
    it('shows sender nickname when present', () => {
        const lines = buildIdentityLines({
            groupId: 'g1',
            userId: 'u1',
            messageData: {
                sender: { nickname: '小明', role: 'member' }
            }
        })
        assert.ok(lines.includes('昵称: 小明'))
    })

    it('omits nickname line when absent', () => {
        const lines = buildIdentityLines({
            groupId: 'g1',
            userId: 'u1',
            messageData: {
                sender: { role: 'member' }
            }
        })
        assert.ok(!lines.some((line) => line.startsWith('昵称:')))
    })
})
