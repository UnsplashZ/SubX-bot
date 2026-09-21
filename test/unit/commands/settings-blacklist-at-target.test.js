#!/usr/bin/env node
'use strict'

const assert = require('assert')

const settingsCommand = require('../../../src/commands/settings')
const config = require('../../../src/config')

const resolveTarget = settingsCommand._resolveBlacklistTarget

describe('settings blacklist at-target resolution', function () {
    it('accepts a plain QQ number argument', () => {
        assert.equal(resolveTarget('12345', {}), '12345')
    })

    it('accepts an openid argument as-is', () => {
        assert.equal(resolveTarget('ABCD1234EFGH5678', {}), 'ABCD1234EFGH5678')
    })

    it('parses NapCat CQ at code argument', () => {
        assert.equal(resolveTarget('[CQ:at,qq=99887766]', {}), '99887766')
    })

    it('parses official <@openid> and <@!openid> placeholders', () => {
        assert.equal(resolveTarget('<@ABCD1234>', {}), 'ABCD1234')
        assert.equal(resolveTarget('<@!ABCD1234>', {}), 'ABCD1234')
    })

    it('falls back to NapCat at segment when no argument', () => {
        const messageData = {
            message: [
                { type: 'at', data: { qq: '11223344' } },
                { type: 'text', data: { text: '/设置 黑名单 添加' } }
            ]
        }
        assert.equal(resolveTarget('', messageData), '11223344')
    })

    it('falls back to official mentions (excluding the bot itself)', () => {
        const messageData = {
            official: {
                raw: {
                    mentions: [
                        { id: 'BOTOPENID', bot: true },
                        { id: 'MEMBEROPENID1234567890ABCDE' }
                    ]
                }
            }
        }
        assert.equal(resolveTarget('', messageData), 'MEMBEROPENID1234567890ABCDE')
    })

    it('skips at-all and empty mentions', () => {
        assert.equal(resolveTarget('', {
            message: [{ type: 'at', data: { qq: 'all' } }]
        }), '')
        assert.equal(resolveTarget('', { official: { raw: { mentions: [] } } }), '')
    })

    it('never resolves the bot itself', () => {
        const messageData = {
            self_id: '12345',
            message: [{ type: 'at', data: { qq: '12345' } }]
        }
        assert.equal(resolveTarget('', messageData), '')
        assert.equal(resolveTarget('12345', messageData), '')
        const officialSelf = {
            self_id: 'BOTOPENID',
            official: { raw: { mentions: [{ id: 'BOTOPENID', bot: true }] } }
        }
        assert.equal(resolveTarget('', officialSelf), '')
    })
})

describe('settings blacklist command with at target', function () {
    const originals = {
        isRootAdmin: config.isRootAdmin,
        isGroupAdmin: config.isGroupAdmin,
        patch: config.patch,
        getStatus: config.getStatus,
        groupConfigs: config.__getMutableCompatStateForTests().groupConfigs
    }
    const sent = []

    beforeEach(function () {
        sent.length = 0
        config.__getMutableCompatStateForTests().groupConfigs = {
            '1000': { blacklistedQQs: [] }
        }
        config.isRootAdmin = () => false
        config.isGroupAdmin = () => true
        config.getStatus = () => ({ documentGeneration: 1 })
        settingsCommand.sendGroupMessage = (_ws, _groupId, messageChain) => {
            sent.push(messageChain?.[0]?.data?.text || '')
        }
    })

    afterEach(function () {
        config.isRootAdmin = originals.isRootAdmin
        config.isGroupAdmin = originals.isGroupAdmin
        config.patch = originals.patch
        config.getStatus = originals.getStatus
        config.__getMutableCompatStateForTests().groupConfigs = originals.groupConfigs
    })

    it('adds at-target to group blacklist without explicit id argument', async function () {
        let patched = null
        config.patch = async (ops) => {
            patched = ops
            return { applied: ['groupConfigs.1000.blacklistedQQs'] }
        }

        const handled = await settingsCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/设置 黑名单 添加',
            messageData: {
                message: [
                    { type: 'at', data: { qq: '55667788' } },
                    { type: 'text', data: { text: '/设置 黑名单 添加' } }
                ]
            }
        })

        assert.equal(handled, true)
        assert.ok(patched, 'config.patch should be called')
        assert.deepEqual(patched[0].path, ['groupConfigs', '1000', 'blacklistedQQs'])
        assert.deepEqual(patched[0].value, ['55667788'])
        assert.ok(sent.some((text) => text.includes('已将 55667788 添加到本群黑名单')))
    })

    it('removes at-target from group blacklist', async function () {
        config.__getMutableCompatStateForTests().groupConfigs = {
            '1000': { blacklistedQQs: ['OPENID11223344556677889900AABB'] }
        }
        let patched = null
        config.patch = async (ops) => {
            patched = ops
            return { applied: ['groupConfigs.1000.blacklistedQQs'] }
        }

        const handled = await settingsCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/设置 黑名单 移除',
            messageData: {
                official: {
                    raw: {
                        mentions: [
                            { id: 'BOTSELFOPENID', bot: true },
                            { id: 'OPENID11223344556677889900AABB' }
                        ]
                    }
                }
            }
        })

        assert.equal(handled, true)
        assert.ok(patched)
        assert.deepEqual(patched[0].value, [])
        assert.ok(sent.some((text) => text.includes('移出本群黑名单')))
    })
})
