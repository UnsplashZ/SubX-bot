#!/usr/bin/env node
'use strict'

const assert = require('assert')

const config = require('../../../src/config')
const messageHandler = require('../../../src/handlers/messageHandler')
const { mapOfficialEvent } = require('../../../src/providers/qq/official/eventMapper')

function makeOfficialAtMessage(content, messageId, { userId = 'member-openid', mentions = [] } = {}) {
    return mapOfficialEvent({
        id: `event-${messageId}`,
        t: 'GROUP_MESSAGE_CREATE',
        d: {
            id: messageId,
            group_openid: 'group-openid',
            content,
            mentions,
            author: {
                member_openid: userId,
                member_name: 'Alice'
            }
        },
        selfId: 'bot-appid'
    }, { selfId: 'bot-appid' })
}

function makeNapcatAtMessage(rawMessage, messageId, { userId = '111111' } = {}) {
    return {
        post_type: 'message',
        message_type: 'group',
        self_id: '222222',
        group_id: 'group-openid',
        user_id: userId,
        message_id: messageId,
        raw_message: rawMessage,
        message: [
            { type: 'at', data: { qq: '222222' } },
            { type: 'text', data: { text: rawMessage } }
        ],
        sender: { user_id: userId, nickname: 'Bob', role: 'member' }
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

describe('messageHandler @bot fallback hint', () => {
    const originals = {
        qqProvider: config.qqProvider,
        qqOfficialRootOpenids: config.qqOfficialRootOpenids,
        groupConfigs: config.groupConfigs,
        enabledGroups: config.enabledGroups,
        save: config.save
    }

    beforeEach(() => {
        messageHandler._processedMessageIds.clear()
        messageHandler._atFallbackLastSentAt.clear()
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
        messageHandler._atFallbackLastSentAt.clear()
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

    it('replies with usage hint when full-mode message @s the bot with plain text', async () => {
        const sent = []
        const payload = makeOfficialAtMessage('<@!bot-appid> 在吗', 'msg-at-1')
        assert.equal(payload.raw_message, '在吗')
        await messageHandler.handleMessage(makeProvider(sent), payload)
        const text = extractText(sent)
        assert.ok(text.includes('/菜单'))
        assert.ok(text.includes('B站链接'))
    })

    it('throttles hint to one per group within the cooldown window', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeOfficialAtMessage('<@!bot-appid> 在吗', 'msg-at-2'))
        await messageHandler.handleMessage(makeProvider(sent), makeOfficialAtMessage('<@!bot-appid> 在不在', 'msg-at-3'))
        assert.equal(sent.length, 1)
    })

    it('does not reply to plain messages without mentioning the bot', async () => {
        const sent = []
        const payload = makeOfficialAtMessage('大家早上好', 'msg-noat')
        await messageHandler.handleMessage(makeProvider(sent), payload)
        assert.equal(sent.length, 0)
    })

    it('does not reply when another member is mentioned instead of the bot', async () => {
        const sent = []
        const payload = makeOfficialAtMessage('<@!someone-else> 你好', 'msg-other-at')
        await messageHandler.handleMessage(makeProvider(sent), payload)
        assert.equal(sent.length, 0)
    })

    it('supports napcat-style at segments', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeNapcatAtMessage(' 在吗', 'msg-nc-1'))
        assert.equal(sent.length, 1)
        assert.ok(extractText(sent).includes('/菜单'))
    })

    it('replies to mention-only messages and nickname-style mentions confirmed by mentions array', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeOfficialAtMessage(
            '@我超可爱-测试中',
            'msg-only-at',
            { mentions: [{ id: 'bot-appid', bot: true }] }
        ))
        assert.equal(sent.length, 1)

        messageHandler._atFallbackLastSentAt.clear()

        await messageHandler.handleMessage(makeProvider(sent), makeOfficialAtMessage(
            '@我超可爱-测试中 /whoami',
            'msg-nick-at',
            { mentions: [{ id: 'bot-appid', bot: true }] }
        ))
        assert.equal(sent.length, 2)
        assert.ok(extractText(sent).includes('member-openid'))
    })
})
