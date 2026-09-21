const serviceManager = require('../../../src/services/ServiceManager')

const previewCache = new Map()

function buildPreviewCacheKey(endpoint, payload = {}) {
    return JSON.stringify({
        endpoint,
        payload
    })
}

async function buildRequest(cacheMode, endpoint, payload) {
    const cacheKey = buildPreviewCacheKey(endpoint, payload)

    if (cacheMode === 'cached' && previewCache.has(cacheKey)) {
        return previewCache.get(cacheKey)
    }

    const result = await serviceManager.sendCommand(endpoint, payload)

    if (cacheMode === 'cached' && result?.status === 'success') {
        previewCache.set(cacheKey, result)
    }

    return result
}

async function resolvePreviewTarget(link, options = {}) {
    const { groupId = null, cacheMode = 'cached' } = options
    const { type, id, meta = {}, match = '' } = link || {}

    if (!type || !id) {
        throw new Error('缺少预览目标类型或 ID')
    }

    let info = null
    let cardType = type
    let url = match || ''

    switch (type) {
        case 'video':
            info = await buildRequest(cacheMode, 'video', { bvid: id, group_id: groupId })
            cardType = info.type || 'video'
            url = `https://www.bilibili.com/video/${id}`
            break
        case 'bangumi':
            info = await buildRequest(cacheMode, 'bangumi', { season_id: id, group_id: groupId })
            cardType = 'bangumi'
            url = `https://www.bilibili.com/bangumi/play/ss${id}`
            break
        case 'dynamic':
            info = await buildRequest(cacheMode, 'dynamic_detail', { dynamic_id: id, group_id: groupId })
            cardType = info.type || 'dynamic'
            url = `https://t.bilibili.com/${id}`
            break
        case 'article':
            info = await buildRequest(cacheMode, 'article', { cvid: id, group_id: groupId })
            cardType = 'article'
            url = info?.data?.canonical_url || `https://www.bilibili.com/read/cv${id}`
            break
        case 'live':
            info = await buildRequest(cacheMode, 'live_room', { room_id: id, group_id: groupId })
            cardType = 'live'
            url = `https://live.bilibili.com/${id}`
            break
        case 'opus':
            info = await buildRequest(cacheMode, 'opus', { opus_id: id, group_id: groupId })
            cardType = info.type || 'dynamic'
            url = `https://www.bilibili.com/opus/${id}`
            break
        case 'ep':
            info = await buildRequest(cacheMode, 'ep', { ep_id: id, group_id: groupId })
            cardType = 'bangumi'
            url = `https://www.bilibili.com/bangumi/play/ep${id}`
            break
        case 'media':
            info = await buildRequest(cacheMode, 'media', { media_id: id, group_id: groupId })
            cardType = 'bangumi'
            url = `https://www.bilibili.com/bangumi/media/md${id}`
            break
        case 'user':
            info = await buildRequest(cacheMode, 'user_info', { uid: id, group_id: groupId })
            cardType = 'user'
            url = `https://space.bilibili.com/${id}`
            break
        case 'favorite_list': {
            const favoriteType = meta.favoriteType || 'video'
            const mediaId = favoriteType === 'video' ? (meta.mediaId ?? id) : null
            info = await buildRequest(cacheMode, 'favorite_list', { media_id: mediaId, favorite_type: favoriteType, group_id: groupId })
            cardType = 'favorite_list'
            url = meta.url || (mediaId ? `https://www.bilibili.com/medialist/detail/ml${mediaId}` : match)
            break
        }
        case 'audio':
            info = await buildRequest(cacheMode, 'audio', { auid: id, group_id: groupId })
            cardType = 'audio'
            url = meta.url || `https://www.bilibili.com/audio/au${id}`
            break
        case 'audio_list':
            info = await buildRequest(cacheMode, 'audio_list', { amid: id, group_id: groupId })
            cardType = 'audio_list'
            url = meta.url || `https://www.bilibili.com/audio/am${id}`
            break
        case 'topic':
            info = await buildRequest(cacheMode, 'topic', { topic_id: id, group_id: groupId })
            cardType = 'topic'
            url = meta.url || `https://www.bilibili.com/v/topic/detail/?topic_id=${id}`
            break
        case 'channel_series':
            info = await buildRequest(cacheMode, 'channel_series', {
                uid: meta.uid,
                series_id: meta.seriesId || id,
                series_type: meta.seriesType || 'series',
                group_id: groupId
            })
            cardType = 'channel_series'
            url = meta.url || match
            break
        case 'article_list':
            info = await buildRequest(cacheMode, 'article_list', { rlid: id, group_id: groupId })
            cardType = 'article_list'
            url = meta.url || `https://www.bilibili.com/read/readlist/rl${id}`
            break
        case 'note':
            info = await buildRequest(cacheMode, 'note', { cvid: id, group_id: groupId })
            cardType = 'note'
            url = meta.url || `https://www.bilibili.com/h5/note-app/view?cvid=${id}`
            break
        case 'cheese_video':
            info = await buildRequest(cacheMode, 'cheese_video', {
                ep_id: meta.epId || null,
                season_id: meta.seasonId || null,
                group_id: groupId
            })
            cardType = 'cheese_video'
            url = meta.url || (
                meta.epId
                    ? `https://www.bilibili.com/cheese/play/ep${meta.epId}`
                    : `https://www.bilibili.com/cheese/play/ss${meta.seasonId || id}`
            )
            break
        default:
            throw new Error(`未支持的预览类型: ${type}`)
    }

    return {
        status: info?.status || 'error',
        info,
        cardType,
        canonicalUrl: url,
        url
    }
}

module.exports = {
    resolvePreviewTarget
}
