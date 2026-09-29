'use strict'

const { monitorRegex } = require('../../utils/regexMonitor')
const { createLink } = require('./structuredLinkParser')

const linkTypes = [
    { regex: /(BV[a-zA-Z0-9]{10})|(av[0-9]+)/, type: 'video', extractId: (match) => match[0] },
    { regex: /play\/ss([0-9]+)/, type: 'bangumi', extractId: (match) => match[1] },
    { regex: /(?:t\.bilibili\.com\/|m\.bilibili\.com\/dynamic\/)([0-9]+)/, type: 'dynamic', extractId: (match) => match[1] },
    { regex: /read\/cv([0-9]+)/, type: 'article', extractId: (match) => match[1] },
    { regex: /live.bilibili.com\/([0-9]+)/, type: 'live', extractId: (match) => match[1] },
    { regex: /opus\/([0-9]+)/, type: 'opus', extractId: (match) => match[1] },
    { regex: /bangumi\/play\/ep([0-9]+)/, type: 'ep', extractId: (match) => match[1] },
    { regex: /bangumi\/media\/md([0-9]+)/, type: 'media', extractId: (match) => match[1] },
    { regex: /(?:space\.bilibili\.com\/|(?:https?:\/\/)?[^/]*bilibili\.com\/space\/)([0-9]+)/, type: 'user', extractId: (match) => match[1] },
    { regex: /(?:medialist\/detail\/[mM][lL]|(?:^|\b)[mM][lL])([0-9]+)/, type: 'favorite_list', extractId: (match) => match[1] },
    { regex: /(?:audio\/[aA][uU]|(?:^|\b)[aA][uU])([0-9]+)/, type: 'audio', extractId: (match) => match[1] },
    { regex: /(?:audio\/[aA][mM]|(?:^|\b)[aA][mM])([0-9]+)/, type: 'audio_list', extractId: (match) => match[1] },
    { regex: /(?:read\/readlist\/[rR][lL]|(?:^|\b)[rR][lL])([0-9]+)/, type: 'article_list', extractId: (match) => match[1] },
    // 抖音长链：www.douyin.com/video/1234  www.douyin.com/note/1234
    // m.douyin.com/share/video/1234  ← 两段路径，需要 (?:[a-z]+\/)* 而非 [a-z]+\/
    // jingxuan.douyin.com/m/video/1234 ← 同上
    // video / note 分开匹配：note 链接必须归入 douyin_note 类型，
    // 否则 afterSend 调度不到 douyinNote handler，图集 / Live Photo 永远不会投递
    { regex: /(?:www\.|m\.|jingxuan\.)?douyin\.com\/(?:[a-z]+\/)*note\/(\d{15,20})/,
        type: 'douyin_note', extractId: (match) => match[1] },
    { regex: /(?:www\.|m\.|jingxuan\.)?douyin\.com\/(?:[a-z]+\/)*video\/(\d{15,20})/,
        type: 'douyin_video', extractId: (match) => match[1] },
    { regex: /iesdouyin\.com\/share\/(?:[a-z]+\/)*note\/(\d{15,20})/,
        type: 'douyin_note', extractId: (match) => match[1] },
    { regex: /iesdouyin\.com\/share\/(?:[a-z]+\/)*video\/(\d{15,20})/,
        type: 'douyin_video', extractId: (match) => match[1] },
    // 短链（v.douyin.com 和 xhslink）由 handler.fetch() 在内部展开，这里只做域名捕获
    { regex: /v\.douyin\.com\/([a-zA-Z0-9_\-]{5,20})/,
        type: 'douyin_short', extractId: (match) => match[1] },
    { regex: /jx\.douyin\.com\/([a-zA-Z0-9_\-]{5,20})/,
        type: 'douyin_short', extractId: (match) => match[1] },
    // 小红书长链
    // xsec_token 在 query string 里，依赖取消 ? 截断后才能被 (\?[^\s]*) 捕获
    { regex: /xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]{24})(\?[^\s]*)?/,
        type: 'xhs_note',
        extractId: (match) => match[1],
        extractMeta: (match) => ({ queryString: match[2] || '' }) },
    // 小红书短链 xhslink（短链内部含 query 的完整 path 由 handler 展开后处理）
    { regex: /xhslink\.(com|cn)\/([A-Za-z0-9._?%&+=\/#@\-]{5,100})/,
        type: 'xhs_short', extractId: (match) => match[2] },
]

function parseRegexToken(tokenInfo, groupId) {
    if (!tokenInfo?.normalizedToken) {
        return []
    }

    // 不再截断 query string：B 站现有正则只匹配路径片段，
    // 小红书正则依赖匹配 ?xsec_token=... 部分
    const regexInput = tokenInfo.normalizedToken

    const links = []
    for (const linkType of linkTypes) {
        const globalRegex = new RegExp(linkType.regex, 'g')
        const matches = monitorRegex(
            `${linkType.type}Regex`,
            globalRegex,
            regexInput,
            (regex, input) => Array.from(input.matchAll(regex))
        )

        for (const match of matches) {
            const id = linkType.extractId(match)
            const meta = typeof linkType.extractMeta === 'function'
                ? linkType.extractMeta(match)
                : {}
            links.push(createLink(linkType.type, id, groupId, match[0], meta, tokenInfo.normalizedToken))
        }
    }

    return links
}

module.exports = {
    parseRegexToken,
    linkTypes
}
