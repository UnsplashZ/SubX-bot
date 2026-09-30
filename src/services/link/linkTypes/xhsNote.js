'use strict'

const { fetchXhsContent } = require('../../externalParsers/xiaohongshuService')
const externalMediaDelivery = require('../../externalMediaDeliveryService')
const logger = require('../../../utils/logger')
const config = require('../../../config')

module.exports = {
    type: 'xhs_note',

    getCacheIdentity(descriptor) {
        return descriptor.id  // note_id
    },

    async fetch(groupId, descriptor) {
        // 平台开关：系统级 enabled + 群级 xiaohongshuEnabled，关闭时静默跳过
        const sysEnabled = config.externalParsers?.xiaohongshu?.enabled ?? false
        const groupEnabled = config.getGroupConfig(String(groupId), 'xiaohongshuEnabled') ?? false
        if (!sysEnabled && !groupEnabled) {
            return { status: 'disabled', message: 'xiaohongshu parser is disabled' }
        }

        try {
            // 完整 query（含 xsec_token）由 extractMeta 在正则匹配时存入 descriptor.meta，
            // 而不是从 descriptor.sourceToken 再次解析（normalizeUrlToken 可能丢失特殊字符）
            const queryString = descriptor.meta?.queryString || ''
            const data = await fetchXhsContent(descriptor.id, queryString)
            return { status: 'success', data, type: data.type }
        } catch (error) {
            logger.logEvent('warn', 'LINK', '', 'xhs-fetch-failed', {
                id: descriptor.id,
                error: String(error.message || error)
            })
            return { status: 'error', message: error.message }
        }
    },

    buildUrl(descriptor, info) {
        // 平台关闭时返回 null，保证 pipeline 静默跳过
        if (info?.status === 'disabled') return null
        return `https://www.xiaohongshu.com/explore/${descriptor.id}`
    },

    buildFetchFailureText(info) {
        if (info?.status === 'disabled') return null
        return null
    },

    resolveCardType(info) {
        return info?.data?.type || 'xhs_note'
    },

    async afterSend(context) {
        const data = context.info?.data
        if (!data || data.type !== 'xhs_video' || !data.video_url) return

        const xhsCfg = config.externalParsers?.xiaohongshu || {}
        if (!(xhsCfg.downloadEnabled ?? true)) return

        try {
            await externalMediaDelivery.downloadAndSend({
                ws: context.ws,
                groupId: context.groupId,
                url: data.video_url,
                label: data.title || '小红书视频',
                author: data.author?.name,
                platform: 'xiaohongshu',
                durationSeconds: data.video_duration ?? 0,
                maxDurationSeconds: xhsCfg.downloadMaxDurationSeconds ?? 120,
                maxFileSizeBytes: (xhsCfg.downloadMaxFileSizeMB ?? 50) * 1024 * 1024,
                requestHeaders: {
                    Referer: 'https://www.xiaohongshu.com/',
                    ...(xhsCfg.cookie ? { Cookie: String(xhsCfg.cookie) } : {}),
                },
            })
        } catch (err) {
            logger.logEvent('error', 'LINK', '', 'xhs-download-failed', {
                groupId: context.groupId,
                id: data.note_id,
                error: String(err.message || err),
            })
        }
    }
}
