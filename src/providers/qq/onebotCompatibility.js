'use strict'

const implementations = new WeakMap()
const pending = new WeakMap()

function transport(handle) {
    return handle?.ws || handle
}

function getImplementation(handle) {
    const ws = transport(handle)
    return ws && implementations.get(ws) || 'unknown'
}

async function detectImplementation(handle, call) {
    const ws = transport(handle)
    if (!ws || typeof ws !== 'object') return 'unknown'
    if (implementations.has(ws)) return implementations.get(ws)
    if (pending.has(ws)) return pending.get(ws)
    const probe = (async () => {
        try {
            const reply = await call('get_version_info', {})
            if (reply?.status !== 'ok' || Number(reply.retcode ?? 0) !== 0) return 'unknown'
            const name = String(reply.data?.app_name || '').toLowerCase()
            const implementation = /llonebot|llbot|luckylillia/.test(name) ? 'llbot'
                : name.includes('snowluma') ? 'snowluma'
                    : name.includes('napcat') ? 'napcat' : 'unknown'
            implementations.set(ws, implementation)
            return implementation
        } catch { return 'unknown' }
    })()
    pending.set(ws, probe)
    try { return await probe } finally { pending.delete(ws) }
}

function adaptAction(implementation, action) {
    if (implementation !== 'llbot') return action
    if (action === 'get_group_ignored_notifies') {
        const error = new Error('LLBot 不支持单独查询已过滤的入群申请；可查询全部群系统消息。')
        error.code = 'ONEBOT_ACTION_UNSUPPORTED'
        throw error
    }
    return action === '_del_group_notice' ? '_delete_group_notice' : action
}

module.exports = { getImplementation, detectImplementation, adaptAction }
