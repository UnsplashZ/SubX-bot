'use strict'

const { fetchDouyinContent } = require('../../externalParsers/douyinService')
const externalMediaDelivery = require('../../externalMediaDeliveryService')
const logger = require('../../../utils/logger')
const config = require('../../../config')

// 抖音图集 / Live Photo handler
// fetch 复用 douyinService（normalizeAweme 会按 images / livePhotos 区分类型）
module.exports = {
    type: 'douyin_note',
    cacheTtlSeconds: 60,   // 抖音 CDN URL 有 TTL，60s 后重新请求

    getCacheIdentity(descriptor) {
        return descriptor.id  // aweme_id
    },

    async fetch(groupId, descriptor) {
        // 平台开关：系统级 enabled + 群级 douyinEnabled，关闭时静默跳过
        const sysEnabled = config.externalParsers?.douyin?.enabled ?? false
        const groupEnabled = config.getGroupConfig(String(groupId), 'douyinEnabled') ?? false
        if (!sysEnabled && !groupEnabled) {
            return { status: 'disabled', message: 'douyin parser is disabled' }
        }

        try {
            const data = await fetchDouyinContent(descriptor.id)
            return { status: 'success', data, type: data.type }
        } catch (error) {
            logger.logEvent('warn', 'LINK', '', 'douyin-note-fetch-failed', {
                id: descriptor.id,
                error: String(error.message || error)
            })
            return { status: 'error', message: error.message }
        }
    },

    buildUrl(descriptor, info) {
        // 平台关闭时返回 null，保证 pipeline 静默跳过
        if (info?.status === 'disabled') return null
        if (info?.data?.share_url) return info.data.share_url
        return `https://www.douyin.com/note/${descriptor.id}`
    },

    buildFetchFailureText(info) {
        if (info?.status === 'disabled') return null
        return null
    },

    resolveCardType(info) {
        return info?.data?.type || 'douyin_note'
    },

    async afterSend(context) {
        const data = context.info?.data
        if (!data) return

        // 图集 / Live Photo 投递开关与视频下载共用 downloadEnabled 配置
        const sysDownloadEnabled = config.externalParsers?.douyin?.downloadEnabled ?? false
        const groupDownloadEnabled = config.getGroupConfig(String(context.groupId), 'douyinDownloadEnabled') ?? false
        if (!sysDownloadEnabled && !groupDownloadEnabled) return

        try {
            if (data.type === 'douyin_live_photo' && Array.isArray(data.livePhotos) && data.livePhotos.length > 0) {
                await externalMediaDelivery.deliverLivePhotoGroup(
                    context.ws,
                    context.groupId,
                    data.livePhotos,
                    'douyin'
                )
            } else if (data.type === 'douyin_note' && Array.isArray(data.images) && data.images.length > 0) {
                await externalMediaDelivery.deliverImages(
                    context.ws,
                    context.groupId,
                    data.images,
                    data.title || '抖音图集'
                )
            }
        } catch (err) {
            logger.logEvent('error', 'LINK', '', 'douyin-note-delivery-failed', {
                groupId: context.groupId,
                id: data.aweme_id,
                error: String(err.message || err)
            })
        }
    }
}
