#!/usr/bin/env node
'use strict'

const assert = require('assert')

const config = require('../../../src/config')
const messageHandler = require('../../../src/handlers/messageHandler')

function makeGroupMessage(rawMessage, messageId, { userId = 'member-openid', role = 'member' } = {}) {
    return {
        post_type: 'message',
        message_type: 'group',
        self_id: 'bot-appid',
        group_id: 'group-openid',
        user_id: userId,
        message_id: messageId,
        raw_message: rawMessage,
        message: [{ type: 'text', data: { text: rawMessage } }],
        sender: { user_id: userId, nickname: 'Alice', role },
        official: {
            eventId: `event-${messageId}`,
            msgId: messageId,
            msgSeq: 1,
            groupOpenId: 'group-openid',
            memberOpenId: userId
        }
    }
}

describe('messageHandler group admin auto grant', () => {
    const originals = {
        qqProvider: config.qqProvider,
        qqOfficialRootOpenids: config.qqOfficialRootOpenids,
        groupConfigs: config.groupConfigs,
        enabledGroups: config.enabledGroups,
        save: config.save,
        addGroupAdmin: config.addGroupAdmin
    }

    beforeEach(() => {
        messageHandler._processedMessageIds.clear()
        config.__getMutableCompatStateForTests().qqProvider = 'official'
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = []
        config.__getMutableCompatStateForTests().groupConfigs = {
            'group-openid': { admins: [], blacklistedQQs: [] }
        }
        config.__getMutableCompatStateForTests().enabledGroups = ['group-openid']
        config.save = () => {}
        // 测试环境未初始化 ConfigService，addGroupAdmin 的 mutate 不可用；打桩为直接写入
        config.addGroupAdmin = async (groupId, userId) => {
            const state = config.__getMutableCompatStateForTests()
            const entry = state.groupConfigs[groupId] || (state.groupConfigs[groupId] = {})
            const admins = Array.isArray(entry.admins) ? entry.admins : (entry.admins = [])
            if (admins.includes(String(userId))) return false
            admins.push(String(userId))
            return true
        }
    })

    afterEach(() => {
        config.__getMutableCompatStateForTests().qqProvider = originals.qqProvider
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = originals.qqOfficialRootOpenids
        config.__getMutableCompatStateForTests().groupConfigs = originals.groupConfigs
        config.__getMutableCompatStateForTests().enabledGroups = originals.enabledGroups
        config.save = originals.save
        config.addGroupAdmin = originals.addGroupAdmin
        messageHandler._processedMessageIds.clear()
    })

    function makeProvider(sent) {
        return {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message, metadata) {
                sent.push({ groupId, message, metadata })
                return { status: 'ok', retcode: 0 }
            },
            async sendPrivateMessage(userId, message, metadata) {
                sent.push({ userId, message, metadata })
                return { status: 'ok', retcode: 0 }
            }
        }
    }

    it('grants group admin to owner when they send any message', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('/随便说说', 'msg-owner', { userId: 'owner-openid', role: 'owner' }))
        assert.ok(config.groupConfigs['group-openid'].admins.includes('owner-openid'))
        assert.ok(config.isGroupAdmin('group-openid', 'owner-openid'))
    })

    it('grants group admin to admin role member', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('你好', 'msg-admin', { userId: 'admin-openid', role: 'admin' }))
        assert.ok(config.groupConfigs['group-openid'].admins.includes('admin-openid'))
    })

    it('does not grant for regular members', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('你好', 'msg-member', { userId: 'member-openid', role: 'member' }))
        assert.ok(!config.groupConfigs['group-openid'].admins.includes('member-openid'))
    })

    it('grants before group-enabled check so admins can re-enable a disabled group', async () => {
        config.__getMutableCompatStateForTests().enabledGroups = []
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('/设置 功能 开', 'msg-enable', { userId: 'owner-openid', role: 'owner' }))
        assert.ok(config.groupConfigs['group-openid'].admins.includes('owner-openid'))
        assert.ok(config.isGroupEnabled('group-openid'))
    })
})
