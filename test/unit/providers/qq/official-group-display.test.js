#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')

const OfficialQqProvider = require('../../../../src/providers/qq/officialProvider')
const OfficialIdStore = require('../../../../src/providers/qq/official/idStore')
const { META } = require('../../../../src/config/schema')

function makeProvider({ idStore, openapi, configOverrides = {} } = {}) {
    const store = idStore || new OfficialIdStore({ storagePath: '' })
    const api = openapi || { calls: [], async getGroupInfo() { this.calls.push(arguments); return { group_name: '' } } }
    const config = {
        qqOfficialAppId: 'app',
        qqOfficialClientSecret: 'secret',
        qqOfficialApiBase: 'https://api.example.test',
        qqOfficialAccountQpm: 10,
        qqOfficialGroupQpm: 10,
        qqOfficialQueueMaxSize: 10,
        qqOfficialGroupAliases: {},
        ...configOverrides
    }
    const provider = new OfficialQqProvider({
        publishGlobal: false,
        runtimeActive: false,
        config,
        tokenManager: { async getAccessToken() { return 'token' }, getStatus() { return {} } },
        openapi: api,
        gateway: Object.assign(new EventEmitter(), { getStatus() { return {} } }),
        rateLimiter: { async stop() {}, getStatus() { return {} } },
        mediaUploader: {},
        sender: {},
        idStore: store,
        messageIdStore: { getStatus() { return {} } },
        logger: { logEvent() {}, getErrorMessage: error => error?.message || String(error) }
    })
    return { provider, store, api }
}

describe('official provider group display', () => {
    it('idStore.listGroupMembers only returns members of the given group', () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertMember('g1', 'm1', { nickname: 'Alice', role: 'owner' })
        store.upsertMember('g1', 'm2', { nickname: 'Bob', role: 'admin' })
        store.upsertMember('g2', 'm3', { nickname: 'Carol', role: 'member' })

        const members = store.listGroupMembers('g1')
        assert.equal(members.length, 2)
        assert.ok(members.every((m) => m.groupOpenId === 'g1'))
        assert.equal(store.listGroupMembers('g2').length, 1)
        assert.equal(store.listGroupMembers('').length, 0)
        assert.equal(store.listGroupMembers('unknown').length, 0)
    })

    it('resolveGroupDisplayName prefers API/stored groupName over alias', () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertGroup('g1', { groupName: '官方名称' })
        const { provider } = makeProvider({
            idStore: store,
            configOverrides: { qqOfficialGroupAliases: { g1: '我的别名' } }
        })
        assert.equal(provider.resolveGroupDisplayName('g1'), '官方名称')
        assert.equal(provider.resolveGroupDisplayName('missing'), '')
    })

    it('resolveGroupDisplayName falls back to alias then empty', () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertGroup('g1', {})
        const { provider } = makeProvider({
            idStore: store,
            configOverrides: { qqOfficialGroupAliases: { g1: '我的别名', g2: '另一个别名' } }
        })
        assert.equal(provider.resolveGroupDisplayName('g1'), '我的别名')
        assert.equal(provider.resolveGroupDisplayName('g2'), '另一个别名')
        assert.equal(provider.resolveGroupDisplayName('g3'), '')
        assert.equal(provider.resolveGroupDisplayName(''), '')
    })

    it('refreshGroupInfo returns cached name without calling the API', async () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertGroup('g1', { groupName: '已缓存' })
        let apiCalls = 0
        const { provider } = makeProvider({
            idStore: store,
            openapi: { async getGroupInfo() { apiCalls += 1; return { group_name: '新名称' } } }
        })
        const name = await provider.refreshGroupInfo('g1')
        assert.equal(name, '已缓存')
        assert.equal(apiCalls, 0)
    })

    it('refreshGroupInfo writes API group_name into idStore', async () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertGroup('g1', {})
        const { provider } = makeProvider({
            idStore: store,
            openapi: { async getGroupInfo() { return { group_name: '  新群名  ' } } }
        })
        const name = await provider.refreshGroupInfo('g1')
        assert.equal(name, '新群名')
        assert.equal(store.getGroup('g1').groupName, '新群名')
    })

    it('refreshGroupInfo tolerates whitelist errors (11253/403) without throwing', async () => {
        const store = new OfficialIdStore({ storagePath: '' })
        for (const error of [
            Object.assign(new Error('no permission'), { qqCode: 11253 }),
            Object.assign(new Error('forbidden'), { httpStatus: 403 })
        ]) {
            const { provider } = makeProvider({
                idStore: store,
                openapi: { async getGroupInfo() { throw error } }
            })
            const name = await provider.refreshGroupInfo('g1')
            assert.equal(name, null)
        }
    })

    it('refreshGroupInfo skips empty ids and empty API names', async () => {
        let apiCalls = 0
        const { provider } = makeProvider({
            openapi: { async getGroupInfo() { apiCalls += 1; return { group_name: '' } } }
        })
        assert.equal(await provider.refreshGroupInfo(''), null)
        assert.equal(await provider.refreshGroupInfo('g1'), null)
        assert.equal(apiCalls, 1)
    })

    it('getGroupRoster summarizes owner, admins and observed member count', () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertMember('g1', 'm1', { nickname: 'Alice', role: 'owner' })
        store.upsertMember('g1', 'm2', { nickname: 'Bob', role: 'admin' })
        store.upsertMember('g1', 'm3', { nickname: 'Dave', role: 'admin' })
        store.upsertMember('g1', 'm4', { nickname: '', role: 'member' })
        const { provider } = makeProvider({ idStore: store })

        const roster = provider.getGroupRoster('g1')
        assert.equal(roster.memberCount, 4)
        assert.equal(roster.ownerNickname, 'Alice')
        assert.deepEqual(roster.adminNicknames, ['Bob', 'Dave'])
        assert.deepEqual(provider.getGroupRoster('unknown'), {
            memberCount: 0,
            ownerNickname: '',
            adminNicknames: []
        })
    })

    it('callAction get_group_info returns resolved display name and known flag', async () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertGroup('g1', { groupName: '官方名称' })
        const { provider } = makeProvider({ idStore: store })

        const known = await provider.callAction('get_group_info', { group_id: 'g1' })
        assert.equal(known.status, 'ok')
        assert.equal(known.data.group_name, '官方名称')
        assert.equal(known.data.known, true)

        const unknown = await provider.callAction('get_group_info', { group_id: 'gX' })
        assert.equal(unknown.data.group_name, '')
        assert.equal(unknown.data.known, false)
    })

    it('buildGroupListMap prefers API name and uses alias as fallback', () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertGroup('g1', { groupName: '官方名称' })
        store.upsertGroup('g2', {})
        const { provider } = makeProvider({
            idStore: store,
            configOverrides: { qqOfficialGroupAliases: { g1: '别名群', g2: '别名群' } }
        })
        const map = provider.buildGroupListMap()
        assert.equal(map.get('g1').group_name, '官方名称')
        assert.equal(map.get('g2').group_name, '别名群')
    })

    it('callAction get_group_list applies aliases', async () => {
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertGroup('g1', {})
        const { provider } = makeProvider({
            idStore: store,
            configOverrides: { qqOfficialGroupAliases: { g1: '别名群' } }
        })
        const resp = await provider.callAction('get_group_list')
        assert.equal(resp.data.find((g) => g.group_id === 'g1').group_name, '别名群')
    })

    it('refreshGroupInfo negative-caches failed ids to avoid repeated API calls', async () => {
        let apiCalls = 0
        const error = Object.assign(new Error('no permission'), { qqCode: 11253 })
        const { provider } = makeProvider({
            idStore: new OfficialIdStore({ storagePath: '' }),
            openapi: { async getGroupInfo() { apiCalls += 1; throw error } }
        })
        assert.equal(await provider.refreshGroupInfo('g1'), null)
        assert.equal(await provider.refreshGroupInfo('g1'), null)
        assert.equal(apiCalls, 1)
    })

    it('maybeRefreshGroupInfo skips when alias/display name already known', async () => {
        let apiCalls = 0
        const store = new OfficialIdStore({ storagePath: '' })
        store.upsertGroup('g1', { groupName: '已有名称' })
        const { provider } = makeProvider({
            idStore: store,
            openapi: { async getGroupInfo() { apiCalls += 1; return { group_name: '新名称' } } }
        })
        provider.maybeRefreshGroupInfo('g1')
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(apiCalls, 0)
    })

    it('maybeRefreshGroupInfo lazily fetches unknown group names', async () => {
        let apiCalls = 0
        const store = new OfficialIdStore({ storagePath: '' })
        const { provider } = makeProvider({
            idStore: store,
            openapi: { async getGroupInfo() { apiCalls += 1; return { group_name: '拉到的群名' } } }
        })
        provider.maybeRefreshGroupInfo('g1')
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(apiCalls, 1)
        assert.equal(store.getGroup('g1').groupName, '拉到的群名')
    })
})

describe('config qqOfficialGroupAliases', () => {
    it('parses JSON object from value and tolerates invalid input', () => {
        const schemaEntry = META.qqOfficialGroupAliases
        assert.deepEqual(schemaEntry.get.call(schemaEntry, { qqOfficialGroupAliases: '{"g1":"测试群"}' }), { g1: '测试群' })
        assert.deepEqual(schemaEntry.get.call(schemaEntry, { qqOfficialGroupAliases: '{bad json' }), {})
        assert.deepEqual(schemaEntry.get.call(schemaEntry, { qqOfficialGroupAliases: '' }), {})
        assert.deepEqual(schemaEntry.get.call(schemaEntry, { qqOfficialGroupAliases: { g2: '对象直传' } }), { g2: '对象直传' })
        assert.deepEqual(schemaEntry.get.call(schemaEntry, { qqOfficialGroupAliases: '[1,2]' }), {})
    })
})
