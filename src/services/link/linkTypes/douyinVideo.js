'use strict'

const { fetchDouyinContent, buildPlayUrl } = require('../../externalParsers/douyinService')
const externalMediaDelivery = require('../../externalMediaDeliveryService')
const logger = require('../../../utils/logger')
const config = require('../../../config')

function isDouyinEnabled(groupId) {
    // 群级 douyinEnabled 缺席 = 跟随全局；显式布尔值 = 群级强制覆盖
    return config.isExternalParserEnabledForGroup(
        String(groupId),
        'douyinEnabled',
        config.externalParsers?.douyin?.enabled ?? false
    )
}

module.exports = {
    type: 'douyin_video',
    cacheTtlSeconds: 60,   // 抖音 CDN URL 有 TTL，60s 后重新请求

    getCacheIdentity(descriptor) {
        return descriptor.id  // aweme_id
    },

    async fetch(groupId, descriptor) {
        // 平台开关：系统级 enabled + 群级 douyinEnabled，关闭时静默跳过
        if (!isDouyinEnabled(groupId)) {
            return { status: 'disabled', message: 'douyin parser is disabled' }
        }

        try {
            // descriptor.id 为 aweme_id；note 类型链接由 douyinNote handler 处理（图集 / Live Photo 投递）
            const data = await fetchDouyinContent(descriptor.id)
            return { status: 'success', data, type: data.type }
        } catch (error) {
            logger.logEvent('warn', 'LINK', '', 'douyin-fetch-failed', {
                id: descriptor.id,
                error: String(error.message || error)
            })
            return { status: 'error', message: error.message }
        }
    },

    buildUrl(descriptor, info) {
        // 平台关闭时返回 null，与 buildFetchFailureText 配合实现 pipeline 静默跳过
        if (info?.status === 'disabled') return null
        if (info?.data?.share_url) return info.data.share_url
        return `https://www.douyin.com/video/${descriptor.id}`
    },

    buildFetchFailureText(info) {
        // 始终返回 null：平台关闭或抓取失败时由 buildUrl 决定是否降级，
        // 平台关闭（buildUrl 返回 null）时 pipeline 完全静默
        if (info?.status === 'disabled') return null
        return null
    },

    resolveCardType(info) {
        return info?.data?.type || 'douyin_video'
    },

    async afterSend(context) {
        const data = context.info?.data
        if (!data || data.type !== 'douyin_video' || !data.play_addr_uri) return

        // 检查群组是否开启了抖音视频下载：群级 douyinDownloadEnabled 缺席 = 跟随全局
        const downloadEnabled = config.isExternalParserEnabledForGroup(
            String(context.groupId),
            'douyinDownloadEnabled',
            config.externalParsers?.douyin?.downloadEnabled ?? false
        )
        if (!downloadEnabled) return

        const douyinCfg = config.externalParsers?.douyin || {}
        try {
            await externalMediaDelivery.downloadAndSend({
                ws: context.ws,
                groupId: context.groupId,
                url: buildPlayUrl(data.play_addr_uri),
                label: data.title || '抖音视频',
                author: data.author.name,
                platform: 'douyin',
                // data.duration 单位为秒（normalizeAweme 中已做 /1000），必须显式传入，
                // 否则时长预检不生效
                durationSeconds: data.duration ?? 0,
                maxDurationSeconds: config.getExternalParserLimitForGroup(
                    context.groupId,
                    'douyinDownloadMaxDurationSeconds',
                    douyinCfg.downloadMaxDurationSeconds ?? 120
                ),
                maxFileSizeBytes: config.getExternalParserLimitForGroup(
                    context.groupId,
                    'douyinDownloadMaxFileSizeMB',
                    douyinCfg.downloadMaxFileSizeMB ?? 50
                ) * 1024 * 1024,
            })
        } catch (err) {
            logger.logEvent('error', 'LINK', '', 'douyin-download-failed', {
                groupId: context.groupId,
                id: data.aweme_id,
                error: String(err.message || err)
            })
        }
    }
}
