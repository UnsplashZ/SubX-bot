'use strict'

const logger = require('../../utils/logger')
const runtimeMetricsService = require('../runtimeMetricsService')
const { buildTokenInfo, parseStructuredToken } = require('./structuredLinkParser')
const { parseRegexToken } = require('./regexLinkParser')

const MAX_MESSAGE_LENGTH = 10000

function normalizeMarkdownLinks(message) {
    // Markdown 标签可能包含空格，先替换成真实目标 URL，再交给 token 解析器。
    return message.replace(/\[[^\]]*\]\(\s*(<[^>]+>|https?:\/\/[^\s)]+)\s*\)/gi, (_match, target) =>
        target.replace(/^<|>$/g, '')
    )
}

function getScope(traceContext = null) {
    return traceContext?.scope || ''
}

function appendUniqueLink(links, link) {
    if (!link) {
        return
    }

    const duplicateLink = links.some((existingLink) =>
        existingLink.type === link.type
        && existingLink.cacheKey === link.cacheKey
        && existingLink.sourceToken === link.sourceToken
    )

    if (!duplicateLink) {
        links.push(link)
    }
}

function extractLinksFromMessage(rawMessage, groupId, traceContext = null) {
    const startedAt = Date.now()
    const scope = getScope(traceContext)
    if (!rawMessage || typeof rawMessage !== 'string') {
        logger.logEvent('debug', 'LINK', scope, 'extract-skipped', {
            groupId,
            reason: 'invalid_message_type',
            valueType: typeof rawMessage
        })
        runtimeMetricsService.record('linkParsing', {
            ok: true,
            durationMs: Date.now() - startedAt,
            latest: '跳过'
        })
        return []
    }

    const checkLength = Math.min(rawMessage.length, MAX_MESSAGE_LENGTH)
    const checkStr = rawMessage.substring(0, checkLength)
    const hasBilibiliDomain = checkStr.includes('bilibili.com')
        || checkStr.includes('b23.tv')
        || checkStr.includes('bilibili')
        || /\b(?:[mM][lL]|[aA][uU]|[aA][mM]|[rR][lL])\d+\b/.test(checkStr)

    // 外部平台（抖音 / 小红书）域名门控，独立变量避免污染 hasBilibiliDomain 的语义
    const hasExternalPlatformDomain = checkStr.includes('douyin.com')
        || checkStr.includes('iesdouyin.com')
        || checkStr.includes('xhslink.com')
        || checkStr.includes('xhslink.cn')
        || checkStr.includes('xiaohongshu.com')

    if (!hasBilibiliDomain && !hasExternalPlatformDomain) {
        logger.logEvent('debug', 'LINK', scope, 'extract-skipped', {
            groupId,
            reason: 'domain_not_found'
        })
        runtimeMetricsService.record('linkParsing', {
            ok: true,
            durationMs: Date.now() - startedAt,
            latest: '无链接'
        })
        return []
    }

    if (rawMessage.length > MAX_MESSAGE_LENGTH) {
        logger.logEvent('warn', 'LINK', scope, 'message-truncated', {
            groupId,
            originalLength: rawMessage.length,
            truncatedLength: MAX_MESSAGE_LENGTH
        })
        rawMessage = rawMessage.substring(0, MAX_MESSAGE_LENGTH)
    }

    const links = []
    const tokenInfos = normalizeMarkdownLinks(rawMessage)
        .split(/\s+/)
        .map((token) => buildTokenInfo(token))
        .filter(Boolean)

    for (const tokenInfo of tokenInfos) {
        const structuredResult = parseStructuredToken(tokenInfo, groupId)
        if (structuredResult.handled) {
            appendUniqueLink(links, structuredResult.link)
            continue
        }

        const regexLinks = parseRegexToken(tokenInfo, groupId)
        for (const link of regexLinks) {
            appendUniqueLink(links, link)
        }
    }

    logger.logEvent('info', 'LINK', scope, 'extract', {
        groupId,
        count: links.length
    })
    runtimeMetricsService.record('linkParsing', {
        ok: true,
        durationMs: Date.now() - startedAt,
        latest: links.length > 0 ? `解析 ${links.length} 个` : '无链接'
    })
    return links
}

module.exports = {
    extractLinksFromMessage,
    appendUniqueLink,
    buildTokenInfo
}
