#!/usr/bin/env node
'use strict'

const assert = require('assert')

const {
    syncCommandPanels,
    normalizePanelItems,
    PANEL_REMARK,
    DEFAULT_PANEL_ITEMS
} = require('../../../../src/providers/qq/official/panelSync')

function makeFakeClient({ existing = [], failScopes = [] } = {}) {
    const calls = { list: [], create: [], update: [], get: [], delete: [] }
    const state = { panels: [...existing], nextPanelId: 1 }
    return {
        calls,
        state,
        async listPanels(scope) {
            calls.list.push(scope)
            if (failScopes.includes(scope)) {
                const error = new Error(`list_failed_${scope}`)
                throw error
            }
            return {
                records: state.panels.filter((panel) => panel.scope === scope),
                next_cursor: '',
                is_end: true
            }
        },
        async createPanel(body) {
            calls.create.push(body)
            const panelId = `panel_${state.nextPanelId++}`
            state.panels.push({
                panel_id: panelId,
                scope: body.scope,
                target_type: body.target_type,
                panel: body.panel,
                version: 1
            })
            return { panel_id: panelId }
        },
        async getPanel(panelId) {
            calls.get.push(panelId)
            return state.panels.find((panel) => panel.panel_id === panelId)
        },
        async updatePanel(panelId, body) {
            calls.update.push({ panelId, body })
            const panel = state.panels.find((item) => item.panel_id === panelId)
            if (panel) {
                panel.panel = body.panel
                panel.version = (panel.version || 0) + 1
            }
            return { version: panel?.version || 1 }
        },
        async deletePanel(panelId) {
            calls.delete.push(panelId)
            state.panels = state.panels.filter((panel) => panel.panel_id !== panelId)
            return {}
        }
    }
}

describe('official panelSync', () => {
    it('normalizes items: clamps text length, enforces https links, caps at 20', () => {
        const items = normalizePanelItems([
            { type: 'command', name: '/a'.padEnd(30, 'x'), desc: 'd'.padEnd(60, 'y') },
            { type: 'link', name: 'ok-link', link: 'http://insecure.example.com' },
            { type: 'link', name: 'ok-link', link: 'https://example.com' },
            ...Array.from({ length: 25 }, (_, i) => ({ type: 'command', name: `/cmd${i}`, desc: `desc${i}` }))
        ])
        assert.equal(items.length, 20)
        assert.ok(items.every((item) => item.name.length <= 14))
        assert.ok(items.every((item) => item.desc.length <= 30))
        assert.ok(items.filter((item) => item.type === 'link').every((item) => item.link.startsWith('https://')))
        assert.equal(items.filter((item) => item.type === 'link').length, 1)
    })

    it('falls back to DEFAULT_PANEL_ITEMS when items empty', () => {
        const items = normalizePanelItems([])
        assert.deepEqual(items, normalizePanelItems(DEFAULT_PANEL_ITEMS))
        assert.ok(items.length > 0)
    })

    it('creates c2c and group panels when no managed panel exists', async () => {
        const client = makeFakeClient()
        const results = await syncCommandPanels({ client, items: [] })
        assert.deepEqual(results.map((r) => `${r.scope}:${r.action}`), ['c2c:created', 'group:created'])
        assert.equal(client.calls.create.length, 2)
        for (const body of client.calls.create) {
            assert.equal(body.target_type, 'all')
            assert.equal(body.panel.remark, PANEL_REMARK)
            assert.ok(Array.isArray(body.panel.items) && body.panel.items.length > 0)
        }
    })

    it('updates managed panel when desired items differ', async () => {
        const client = makeFakeClient({
            existing: [{
                panel_id: 'panel_1',
                scope: 'c2c',
                target_type: 'all',
                panel: { items: [{ type: 'command', name: '/旧命令', desc: '旧' }], remark: PANEL_REMARK },
                version: 3
            }]
        })
        const results = await syncCommandPanels({ client, items: [] })
        assert.equal(results[0].action, 'updated')
        assert.equal(results[0].panel_id, 'panel_1')
        assert.equal(client.calls.update.length, 1)
        assert.equal(client.calls.update[0].body.panel.version, 3)
        assert.equal(client.calls.create.length, 1) // group scope created
    })

    it('leaves managed panel unchanged when items match', async () => {
        const desired = normalizePanelItems([])
        const client = makeFakeClient({
            existing: ['c2c', 'group'].map((scope, index) => ({
                panel_id: `panel_${index + 1}`,
                scope,
                target_type: 'all',
                panel: { items: desired, remark: PANEL_REMARK },
                version: 1
            }))
        })
        const results = await syncCommandPanels({ client, items: [] })
        assert.deepEqual(results.map((r) => r.action), ['unchanged', 'unchanged'])
        assert.equal(client.calls.update.length, 0)
        assert.equal(client.calls.create.length, 0)
    })

    it('does not touch panels managed by others (different remark)', async () => {
        const client = makeFakeClient({
            existing: [{
                panel_id: 'other_1',
                scope: 'c2c',
                target_type: 'all',
                panel: { items: [{ type: 'command', name: '/other', desc: 'x' }], remark: 'someone-else' },
                version: 1
            }]
        })
        const results = await syncCommandPanels({ client, items: [] })
        assert.equal(results[0].action, 'created')
        assert.equal(client.calls.update.length, 0)
    })

    it('removes duplicate managed panels keeping only the first', async () => {
        const desired = normalizePanelItems([])
        const client = makeFakeClient({
            existing: ['c2c', 'c2c', 'group'].map((scope, index) => ({
                panel_id: `dup_${index + 1}`,
                scope,
                target_type: 'all',
                panel: { items: desired, remark: PANEL_REMARK },
                version: 1
            }))
        })
        const results = await syncCommandPanels({ client, items: [] })
        assert.deepEqual(results.map((r) => r.action), ['unchanged', 'unchanged'])
        assert.deepEqual(client.calls.delete, ['dup_2'])
    })

    it('tolerates per-scope failures and reports them', async () => {
        const client = makeFakeClient({ failScopes: ['group'] })
        const results = await syncCommandPanels({ client, items: [] })
        assert.equal(results[0].action, 'created')
        assert.equal(results[1].action, 'failed')
    })
})
