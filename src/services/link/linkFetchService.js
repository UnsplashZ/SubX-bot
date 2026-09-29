'use strict'

const cacheManager = require('../../utils/cacheManager')

async function fetch(handler, groupId, descriptor, options = {}) {
    const identity = handler.getCacheIdentity
        ? handler.getCacheIdentity(descriptor)
        : descriptor.id
    const cacheKey = `${handler.type}_${identity}`

    let info = await cacheManager.get(cacheKey)
    if (info) {
        if (typeof options.onCacheHit === 'function') {
            options.onCacheHit(cacheKey)
        }
        return {
            info,
            cacheKey,
            fromCache: true
        }
    }

    info = await handler.fetch(groupId, descriptor)
    if (info && info.status === 'success') {
        // handler 可声明 cacheTtlSeconds 覆盖全局 TTL（undefined = 用全局默认）
        await cacheManager.set(cacheKey, info, handler.cacheTtlSeconds)
    }

    return {
        info,
        cacheKey,
        fromCache: false
    }
}

module.exports = {
    fetch
}
