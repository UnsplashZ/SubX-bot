'use strict'

// 外部平台域名（抖音 / 小红书），用于 https 前缀补全与结构化解析门控
const EXTERNAL_DOMAINS = [
    'douyin.com', 'iesdouyin.com', 'xhslink.com', 'xhslink.cn', 'xiaohongshu.com'
]

function normalizeUrlToken(token) {
    return String(token || '')
        .trim()
        .replace(/^[("'“‘（【《「『<]+/g, '')
        .replace(/[)"'”’）】》」』>。,，！!？?；;:：]+$/g, '')
}

function buildTokenInfo(token) {
    const rawToken = String(token || '').trim()
    const normalizedToken = normalizeUrlToken(rawToken)
    if (!normalizedToken) {
        return null
    }

    let urlCandidate = normalizedToken
    const needsPrefix = urlCandidate.includes('bilibili.com')
        || urlCandidate.includes('b23.tv')
        || EXTERNAL_DOMAINS.some((d) => urlCandidate.includes(d))
    if (!/^https?:\/\//i.test(urlCandidate) && needsPrefix) {
        urlCandidate = `https://${urlCandidate.replace(/^\/+/, '')}`
    }

    return {
        rawToken,
        normalizedToken,
        urlCandidate
    }
}

function createLink(type, id, groupId, match, meta = {}, sourceToken = '') {
    const normalizedSourceToken = normalizeUrlToken(sourceToken || match)
    const uniqueId = meta.uniqueId || id || normalizedSourceToken || type
    const cacheKey = groupId ? `${type}|${uniqueId}|${groupId}` : `${type}|${uniqueId}`
    return {
        type,
        id,
        cacheKey,
        match,
        meta,
        sourceToken: normalizedSourceToken
    }
}

function createSpaceUserLink(uid, groupId, normalizedToken) {
    return createLink('user', uid, groupId, normalizedToken, {}, normalizedToken)
}

function getSpaceTokenInfo(tokenInfo) {
    if (!tokenInfo?.urlCandidate) {
        return null
    }

    let parsed
    try {
        parsed = new URL(tokenInfo.urlCandidate)
    } catch (_error) {
        return null
    }

    const host = parsed.hostname.toLowerCase()
    const segments = parsed.pathname.split('/').filter(Boolean)

    if (host === 'space.bilibili.com' && /^\d+$/.test(segments[0] || '')) {
        return {
            uid: segments[0],
            resourceSegments: segments.slice(1),
            parsed,
            url: tokenInfo.urlCandidate,
            normalizedToken: tokenInfo.normalizedToken
        }
    }

    if ((host === 'www.bilibili.com' || host.endsWith('.bilibili.com')) && segments[0] === 'space' && /^\d+$/.test(segments[1] || '')) {
        return {
            uid: segments[1],
            resourceSegments: segments.slice(2),
            parsed,
            url: tokenInfo.urlCandidate,
            normalizedToken: tokenInfo.normalizedToken
        }
    }

    return null
}

function parseStructuredToken(tokenInfo, groupId) {
    if (!tokenInfo?.normalizedToken
        || (!tokenInfo.normalizedToken.includes('bilibili.com')
            && !tokenInfo.normalizedToken.includes('b23.tv')
            && !EXTERNAL_DOMAINS.some((d) => tokenInfo.normalizedToken.includes(d)))) {
        return { handled: false, link: null }
    }

    let parsed
    try {
        parsed = new URL(tokenInfo.urlCandidate)
    } catch (_error) {
        return { handled: false, link: null }
    }

    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname
    const segments = path.split('/').filter(Boolean)
    const spaceInfo = getSpaceTokenInfo(tokenInfo)

    if (spaceInfo) {
        const { uid, resourceSegments, url, normalizedToken } = spaceInfo
        if (resourceSegments.length === 0) {
            return {
                handled: true,
                link: createSpaceUserLink(uid, groupId, normalizedToken)
            }
        }

        if (resourceSegments[0] === 'dynamic') {
            return {
                handled: true,
                link: createSpaceUserLink(uid, groupId, normalizedToken)
            }
        }

        if (resourceSegments[0] === 'favlist') {
            const fid = spaceInfo.parsed.searchParams.get('fid')
            const ctype = spaceInfo.parsed.searchParams.get('ctype')
            if (fid && /^\d+$/.test(fid)) {
                if (ctype === '21') {
                    return {
                        handled: true,
                        link: createLink('channel_series', fid, groupId, normalizedToken, {
                            url,
                            uid,
                            seriesId: fid,
                            seriesType: 'season',
                            uniqueId: `season:${uid}:${fid}`
                        }, normalizedToken)
                    }
                }
                return {
                    handled: true,
                    link: createLink('favorite_list', fid, groupId, normalizedToken, {
                        url,
                        mediaId: fid,
                        favoriteType: 'video',
                        uniqueId: `video:${fid}`
                    }, normalizedToken)
                }
            }
            return { handled: true, link: null }
        }

        if (
            resourceSegments[0] === 'channel'
            && spaceInfo.parsed.searchParams.get('sid')
            && (resourceSegments[1] === 'collectiondetail' || resourceSegments[1] === 'seriesdetail')
        ) {
            const seriesId = spaceInfo.parsed.searchParams.get('sid')
            const seriesType = resourceSegments[1] === 'collectiondetail' ? 'season' : 'series'
            return {
                handled: true,
                link: createLink('channel_series', seriesId, groupId, normalizedToken, {
                    url,
                    uid,
                    seriesId,
                    seriesType,
                    uniqueId: `${seriesType}:${uid}:${seriesId}`
                }, normalizedToken)
            }
        }

        return { handled: true, link: null }
    }

    if (host === 'www.bilibili.com' && path === '/h5/note-app/view' && parsed.searchParams.get('cvid')) {
        const cvid = parsed.searchParams.get('cvid')
        return {
            handled: true,
            link: createLink('note', cvid, groupId, tokenInfo.normalizedToken, {
                url: tokenInfo.urlCandidate,
                uniqueId: cvid
            }, tokenInfo.normalizedToken)
        }
    }

    if (
        (
            (host === 'www.bilibili.com' && segments[0] === 'v' && segments[1] === 'topic' && segments[2] === 'detail')
            || (host === 'm.bilibili.com' && segments[0] === 'topic-detail')
        )
        && parsed.searchParams.get('topic_id')
    ) {
        const topicId = parsed.searchParams.get('topic_id')
        return {
            handled: true,
            link: createLink('topic', topicId, groupId, tokenInfo.normalizedToken, {
                url: tokenInfo.urlCandidate,
                uniqueId: topicId
            }, tokenInfo.normalizedToken)
        }
    }

    if (host === 'www.bilibili.com' && segments[0] === 'list' && segments[1] && parsed.searchParams.get('sid')) {
        const uid = segments[1]
        const seriesId = parsed.searchParams.get('sid')
        return {
            handled: true,
            link: createLink('channel_series', seriesId, groupId, tokenInfo.normalizedToken, {
                url: tokenInfo.urlCandidate,
                uid,
                seriesId,
                seriesType: 'series',
                uniqueId: `series:${uid}:${seriesId}`
            }, tokenInfo.normalizedToken)
        }
    }

    if (host === 'www.bilibili.com' && segments[0] === 'medialist' && segments[1] === 'play' && segments[2] && parsed.searchParams.get('business_id')) {
        const uid = segments[2]
        const seriesId = parsed.searchParams.get('business_id')
        return {
            handled: true,
            link: createLink('channel_series', seriesId, groupId, tokenInfo.normalizedToken, {
                url: tokenInfo.urlCandidate,
                uid,
                seriesId,
                seriesType: 'series',
                uniqueId: `series:${uid}:${seriesId}`
            }, tokenInfo.normalizedToken)
        }
    }

    if (host === 'www.bilibili.com' && segments[0] === 'cheese' && segments[1] === 'play' && segments[2]) {
        const target = segments[2]
        if (/^[eE][pP]\d+$/.test(target)) {
            const epId = target.slice(2)
            return {
                handled: true,
                link: createLink('cheese_video', epId, groupId, tokenInfo.normalizedToken, {
                    url: tokenInfo.urlCandidate,
                    epId,
                    uniqueId: `ep:${epId}`
                }, tokenInfo.normalizedToken)
            }
        }
        if (/^[sS][sS]\d+$/.test(target)) {
            const seasonId = target.slice(2)
            return {
                handled: true,
                link: createLink('cheese_video', seasonId, groupId, tokenInfo.normalizedToken, {
                    url: tokenInfo.urlCandidate,
                    seasonId,
                    uniqueId: `season:${seasonId}`
                }, tokenInfo.normalizedToken)
            }
        }
    }

    return { handled: false, link: null }
}

module.exports = {
    normalizeUrlToken,
    buildTokenInfo,
    createLink,
    parseStructuredToken,
    EXTERNAL_DOMAINS
}
