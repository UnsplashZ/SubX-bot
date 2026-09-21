// 指令面板自动同步：将 bot 命令清单同步到 QQ 官方「指令面板」（/v2/panels）
// 文档: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/menu-panel/

const PANEL_REMARK = 'bili-qq-bot:auto-sync'
const PANEL_ITEM_LIMIT = 20
const DEFAULT_SCOPES = ['c2c', 'group']

// 与 src/commands 中实际命令保持一致的默认面板指令
// name: 用户点击后填入输入框的内容（<=14字符）；desc: 面板展示描述（<=30字符）
const DEFAULT_PANEL_ITEMS = [
    { type: 'command', name: '/菜单', desc: '查看功能菜单' },
    { type: 'command', name: '/whoami', desc: '查询我的身份信息' },
    { type: 'command', name: '/订阅用户', desc: '订阅B站UP主动态' },
    { type: 'command', name: '/订阅番剧', desc: '订阅B站番剧更新' },
    { type: 'command', name: '/订阅列表', desc: '查看当前订阅' },
    { type: 'command', name: '/设置', desc: '查看群功能设置' },
    { type: 'command', name: '/下载', desc: '下载B站视频(需开启)' }
]

function clampText(value, maxLength) {
    const text = String(value || '').trim()
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength)
}

function normalizePanelItems(items) {
    const source = Array.isArray(items) && items.length > 0 ? items : DEFAULT_PANEL_ITEMS
    const normalized = []
    for (const item of source) {
        if (normalized.length >= PANEL_ITEM_LIMIT) break
        if (!item || typeof item !== 'object') continue
        const type = item.type === 'link' ? 'link' : 'command'
        const entry = {
            type,
            name: clampText(item.name, 14),
            desc: clampText(item.desc, 30)
        }
        if (item.only_admin === true) entry.only_admin = true
        if (type === 'link') {
            const link = String(item.link || '').trim()
            if (!/^https:\/\//.test(link)) continue
            entry.link = link
        }
        if (entry.name) normalized.push(entry)
    }
    return normalized
}

function canonicalItemsSignature(items) {
    return JSON.stringify(normalizePanelItems(items))
}

function extractPanelList(payload) {
    if (Array.isArray(payload)) return { panels: payload, nextCursor: '', isEnd: true }
    const panels = Array.isArray(payload?.records)
        ? payload.records
        : (Array.isArray(payload?.panels)
            ? payload.panels
            : (Array.isArray(payload?.data) ? payload.data : []))
    const nextCursor = String(payload?.next_cursor || payload?.nextCursor || '')
    const isEnd = payload?.is_end === undefined ? !nextCursor : Boolean(payload.is_end)
    return { panels, nextCursor, isEnd }
}

async function listAllPanels(client, scope) {
    const panels = []
    let cursor = ''
    for (let page = 0; page < 20; page += 1) {
        const payload = await client.listPanels(scope, { cursor, limit: 50 })
        const extracted = extractPanelList(payload)
        panels.push(...extracted.panels)
        cursor = extracted.nextCursor
        if (extracted.isEnd || !cursor) break
    }
    return panels
}

function isManagedPanel(panel) {
    return String(panel?.panel?.remark || panel?.remark || '') === PANEL_REMARK
}

async function syncScope({ client, scope, items, logger }) {
    const panels = await listAllPanels(client, scope)
    const managedList = panels.filter(isManagedPanel)
    const managed = managedList[0]
    // 清理历史重复创建的自有面板，只保留一个
    for (const extra of managedList.slice(1)) {
        try {
            await client.deletePanel(extra.panel_id)
            logger?.logEvent?.('info', 'QQ', 'svc:qq:panel-sync', 'duplicate-panel-removed', {
                scope,
                panelId: extra.panel_id
            })
        } catch (error) {
            logger?.logEvent?.('warn', 'QQ', 'svc:qq:panel-sync', 'duplicate-panel-remove-failed', {
                scope,
                panelId: extra.panel_id,
                error: logger.getErrorMessage ? logger.getErrorMessage(error) : String(error)
            })
        }
    }
    const desiredSignature = canonicalItemsSignature(items)

    if (managed) {
        const panelId = managed.panel_id
        const currentSignature = canonicalItemsSignature(managed.panel?.items)
        if (currentSignature === desiredSignature) {
            return { scope, action: 'unchanged', panel_id: panelId }
        }
        const version = Number(managed.version)
        const body = { panel: { items: normalizePanelItems(items), remark: PANEL_REMARK } }
        if (Number.isFinite(version) && version > 0) body.panel.version = version
        await client.updatePanel(panelId, body)
        return { scope, action: 'updated', panel_id: panelId }
    }

    const created = await client.createPanel({
        scope,
        target_type: 'all',
        panel: {
            items: normalizePanelItems(items),
            remark: PANEL_REMARK
        }
    })
    return { scope, action: 'created', panel_id: created?.panel_id || '' }
}

async function syncCommandPanels({ client, items, scopes = DEFAULT_SCOPES, logger = null }) {
    const results = []
    for (const scope of scopes) {
        try {
            results.push(await syncScope({ client, scope, items, logger }))
        } catch (error) {
            logger?.logEvent?.('warn', 'QQ', 'svc:qq:panel-sync', 'scope-sync-failed', {
                scope,
                error: logger.getErrorMessage ? logger.getErrorMessage(error) : String(error)
            })
            results.push({ scope, action: 'failed', error: String(error?.message || error) })
        }
    }
    return results
}

module.exports = {
    syncCommandPanels,
    normalizePanelItems,
    PANEL_REMARK,
    DEFAULT_PANEL_ITEMS,
    DEFAULT_SCOPES
}
