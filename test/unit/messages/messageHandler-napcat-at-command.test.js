#!/usr/bin/env node
'use strict'

const assert = require('assert')

const config = require('../../../src/config')
const messageHandler = require('../../../src/handlers/messageHandler')

function makeNapcatMessage(rawMessage, messageId, { userId = '111111', selfId = '222222', atFirst = true } = {}) {
    const message = []
    if (atFirst) {
        message.push({ type: 'at', data: { qq: selfId, name: 'subx-bot' } })
    }
    message.push({ type: 'text', data: { text: rawMessage } })
    return {
        post_type: 'message',
        message_type: 'group',
        self_id: selfId,
        group_id: '1065812436',
        user_id: userId,
        message_id: messageId,
        raw_message: `[CQ:at,qq=${selfId},name=subx-bot]${rawMessage}`,
        message,
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

describe('messageHandler napcat @bot command support', () => {
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
        messageHandler._atFallbackLastSentAt.clear()
        config.__getMutableCompatStateForTests().qqProvider = 'napcat'
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = []
        config.__getMutableCompatStateForTests().groupConfigs = {
            '1065812436': { admins: [], blacklistedQQs: [] }
        }
        config.__getMutableCompatStateForTests().enabledGroups = ['1065812436']
        config.save = () => {}
        config.addGroupAdmin = async () => false
    })

    afterEach(() => {
        config.__getMutableCompatStateForTests().qqProvider = originals.qqProvider
        config.__getMutableCompatStateForTests().qqOfficialRootOpenids = originals.qqOfficialRootOpenids
        config.__getMutableCompatStateForTests().groupConfigs = originals.groupConfigs
        config.__getMutableCompatStateForTests().enabledGroups = originals.enabledGroups
        config.save = originals.save
        config.addGroupAdmin = originals.addGroupAdmin
        messageHandler._processedMessageIds.clear()
        messageHandler._atFallbackLastSentAt.clear()
    })

    function makeProvider(sent) {
        return {
            id: 'napcat',
            readyState: 1,
            send: (payload) => {
                const body = JSON.parse(payload)
                sent.push({ action: body.action, params: body.params })
                return true
            }
        }
    }

    it('dispatches commands prefixed with a leading @bot CQ at segment', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeNapcatMessage('/whoami', 'nc-1'))
        const text = extractText(sent.map((entry) => ({ message: entry.params?.message })))
        assert.ok(text.includes('111111'))
    })

    it('dispatches @bot link messages to link processing (raw text kept after strip)', async () => {
        const sent = []
        const message = makeNapcatMessage(' 看这个 https://www.bilibili.com/video/BV1234567890', 'nc-2')
        await messageHandler.handleMessage(makeProvider(sent), message)
        // 链接处理路径会发送表情表态或预览，不应静默丢弃
        assert.ok(sent.length > 0)
    })

    it('falls back to usage hint for mention-only napcat messages', async () => {
        const sent = []
        await messageHandler.handleMessage(makeProvider(sent), makeNapcatMessage('', 'nc-3'))
        const text = extractText(sent.map((entry) => ({ message: entry.params?.message })))
        assert.ok(text.includes('/菜单'))
    })

    it('does not strip at segments targeting other members', async () => {
        const sent = []
        const message = makeNapcatMessage('/whoami', 'nc-4')
        message.message[0].data.qq = '333333'
        message.raw_message = '[CQ:at,qq=333333]/whoami'
        await messageHandler.handleMessage(makeProvider(sent), message)
        const text = extractText(sent.map((entry) => ({ message: entry.params?.message })))
        assert.ok(!text.includes('【身份信息】'))
    })
})
