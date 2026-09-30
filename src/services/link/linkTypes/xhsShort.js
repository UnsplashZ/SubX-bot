'use strict'

const { fetchXhsContent, extractNoteId, expandExternalShortUrl } = require('../../externalParsers/xiaohongshuService')
const xhsNoteHandler = require('./xhsNote')
const logger = require('../../../utils/logger')
const config = require('../../../config')

module.exports = {
    type: 'xhs_short',

    getCacheIdentity(descriptor) {
        return descriptor.id  // 短链 path token
    },

    async fetch(groupId, descriptor) {
        // 平台开关：群级 xiaohongshuEnabled 缺席 = 跟随全局；显式布尔值 = 群级强制覆盖，关闭时静默跳过
        if (!config.isExternalParserEnabledForGroup(
            String(groupId),
            'xiaohongshuEnabled',
            config.externalParsers?.xiaohongshu?.enabled ?? false
        )) {
            return { status: 'disabled', message: 'xiaohongshu parser is disabled' }
        }

        try {
            const shortUrl = `https://xhslink.com/${descriptor.id}`
            const expanded = await expandExternalShortUrl(shortUrl)
            const extracted = extractNoteId(expanded)
            if (!extracted) {
                throw new Error(`cannot extract note id from expanded URL: ${expanded}`)
            }
            const data = await fetchXhsContent(extracted.noteId, extracted.queryString)
            return { status: 'success', data, type: data.type }
        } catch (error) {
            logger.logEvent('warn', 'LINK', '', 'xhs-short-fetch-failed', {
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
        return `https://xhslink.com/${descriptor.id}`
    },

    buildFetchFailureText(info) {
        if (info?.status === 'disabled') return null
        return null
    },

    resolveCardType(info) {
        return info?.data?.type || 'xhs_note'
    },

    // 短链展开后可能是视频笔记，下载逻辑复用 xhsNote 的 afterSend（按 data.type 自行过滤）
    afterSend: xhsNoteHandler.afterSend
}
