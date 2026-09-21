#!/usr/bin/env node
'use strict'

const assert = require('assert')

const config = require('../../../src/config')
const messageHandler = require('../../../src/handlers/messageHandler')

function makeGroupMessage(rawMessage, messageId, { userId = 'member-openid' } = {}) {
    return {
        post_type: 'message',
        message_type: 'group',
        self_id: 'bot-appid',
        group_id: 'group-openid',
        user_id: userId,
        message_id: messageId,
        raw_message: rawMessage,
        message: [{ type: 'text', data: { text: rawMessage } }],
        sender: { user_id: userId, nickname: 'Alice', role: 'member' },
        official: {
            eventId: `event-${messageId}`,
            msgId: messageId,
            msgSeq: 1,
            groupOpenId: 'group-openid',
            memberOpenId: userId,
            userOpenId: `u-${userId}`
        }
    }
}

function extractText(sent) {
    return sent
        .map((entry) => entry.message || [])
        .flat()
        .filter((segment) => segment.type === 'text')
        .map((segment) => segment.data?.text || '')
        .join('\n')
}

describe('/whoami command', () => {
    const originals = {
        qqProvider: config.qqProvider,
        qqOfficialRootOpenids: config.qqOfficialRootOpenids,
        groupConfigs: config.groupConfigs,
        enabledGroups: config.enabledGroups,
        save: config.save
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
    })

    afterEach(() => {
        config.__getMutableCompatStateForTests().qqProvider = originals.qqProvider
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = originals.qqOfficialRootOpenids
        config.__getMutableCompatStateForTests().groupConfigs = originals.groupConfigs
        config.__getMutableCompatStateForTests().enabledGroups = originals.enabledGroups
        config.save = originals.save
        messageHandler._processedMessageIds.clear()
    })

    function makeProvider(sent) {
        return {
            id: 'official',
            readyState: 1,
            async sendGroupMessage(groupId, message, metadata) {
                sent.push({ groupId, message, metadata })
                return { status: 'ok', retcode: 0 }
            }
        }
    }

    it('replies with openid identity info for group messages', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('/whoami', 'msg-1'))
        const text = extractText(sent)
        assert.ok(text.includes('member-openid'))
        assert.ok(text.includes('u-member-openid'))
        assert.ok(text.includes('group-openid'))
        assert.ok(text.includes('QQ_OFFICIAL_ROOT_OPENIDS'))
    })

    it('shows root admin permission when openid configured', async () => {
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = ['member-openid']
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('/whoami', 'msg-2'))
        const text = extractText(sent)
        assert.ok(text.includes('全局管理员'))
    })

    it('shows group admin permission when in group admins', async () => {
        config.__getMutableCompatStateForTests().groupConfigs['group-openid'].admins = ['member-openid']
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('/whoami', 'msg-3'))
        const text = extractText(sent)
        assert.ok(text.includes('群管理员'))
    })

    it('supports /我的id alias and ignores unrelated messages', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('/我的id', 'msg-4'))
        assert.ok(extractText(sent).includes('member-openid'))

        const before = sent.length
        await messageHandler.handleMessage(makeProvider(sent), makeGroupMessage('/whoami2 not-a-command', 'msg-5'))
        assert.equal(sent.length, before)
    })
})
