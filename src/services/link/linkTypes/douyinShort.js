'use strict'

const { fetchDouyinContent } = require('../../externalParsers/douyinService')
const { expandExternalShortUrl, isDouyinOrXhsShortLink } = require('../../externalParsers/externalShortLinkExpander')
const douyinVideoHandler = require('./douyinVideo')
const douyinNoteHandler = require('./douyinNote')
const logger = require('../../../utils/logger')
const config = require('../../../config')

function buildShortUrl(descriptor) {
    let candidate = descriptor?.sourceToken || descriptor?.match || ''
    if (candidate && !/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`

    try {
        const parsed = new URL(candidate)
        if (['v.douyin.com', 'jx.douyin.com'].includes(parsed.hostname)
            && parsed.pathname.split('/').filter(Boolean)[0] === descriptor.id) {
            return parsed.href
        }
    } catch (_) {}

    return `https://v.douyin.com/${descriptor.id}/`
}

module.exports = {
    type: 'douyin_short',
    cacheTtlSeconds: 60,   // 抖音 CDN URL 有 TTL，60s 后重新请求

    getCacheIdentity(descriptor) {
        return descriptor.id  // 短链 token
    },

    async fetch(groupId, descriptor) {
        // 平台开关：群级 douyinEnabled 缺席 = 跟随全局；显式布尔值 = 群级强制覆盖，关闭时静默跳过
        if (!config.isExternalParserEnabledForGroup(
            String(groupId),
            'douyinEnabled',
            config.externalParsers?.douyin?.enabled ?? false
        )) {
            return { status: 'disabled', message: 'douyin parser is disabled' }
        }

        try {
            const shortUrl = buildShortUrl(descriptor)
            const expanded = isDouyinOrXhsShortLink(shortUrl)
                ? await expandExternalShortUrl(shortUrl)
                : shortUrl
            const data = await fetchDouyinContent(expanded)
            return { status: 'success', data, type: data.type }
        } catch (error) {
            logger.logEvent('warn', 'LINK', '', 'douyin-short-fetch-failed', {
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
        return buildShortUrl(descriptor)
    },

    buildFetchFailureText(info) {
        if (info?.status === 'disabled') return null
        return null
    },

    resolveCardType(info) {
        // 短链展开后可能是视频 / 图集 / Live Photo，以实际数据类型为准
        return info?.data?.type || 'douyin_video'
    },

    async afterSend(context) {
        // 短链展开后的实际类型可能是视频 / 图集 / Live Photo，
        // 投递逻辑复用 douyinVideo / douyinNote 的 afterSend（各自按 data.type 自行过滤）
        await douyinVideoHandler.afterSend(context)
        await douyinNoteHandler.afterSend(context)
    },

    buildShortUrl,
}
