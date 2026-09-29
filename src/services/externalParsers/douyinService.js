'use strict'

const https = require('https')
const { expandExternalShortUrl } = require('./externalShortLinkExpander')

const DETAIL_URL = 'https://www.douyin.com/aweme/v1/web/aweme/detail/'
const PLAY_URL_TEMPLATE = 'https://aweme.snssdk.com/aweme/v1/play/?video_id={uri}&ratio=1080p&line=0'

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Origin': 'https://open.douyin.com',
    'Referer': 'https://open.douyin.com/',
    'Accept': 'application/json, text/plain, */*',
}

// 从展开后的抖音 URL 中提取 aweme_id
// 注意：m.douyin.com/share/video/1234 和 jingxuan.douyin.com/m/video/1234 都是多段路径，
// 必须用 (?:[a-z]+\/)+ 而非 [a-z]+\/，否则这类 URL 展开后依然提取失败
function extractAwemeId(url) {
    const m = url.match(/douyin\.com\/(?:[a-z]+\/)+(\d{15,20})/)
    return m ? m[1] : null
}

function buildPlayUrl(uri) {
    return PLAY_URL_TEMPLATE.replace('{uri}', encodeURIComponent(uri))
}

// 实际 HTTP GET，返回 JSON
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: HEADERS, timeout: 10000 }, (res) => {
            let body = ''
            res.on('data', (chunk) => { body += chunk })
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`douyin detail HTTP ${res.statusCode}`))
                    return
                }
                try {
                    resolve(JSON.parse(body))
                } catch (e) {
                    reject(new Error(`douyin detail JSON parse failed: ${e.message}`))
                }
            })
        })
        req.on('timeout', () => { req.destroy(); reject(new Error('douyin detail timeout')) })
        req.on('error', reject)
    })
}

async function getAwemeDetail(awemeId) {
    const qs = new URLSearchParams({ aweme_id: awemeId, aid: '6383' })
    const url = `${DETAIL_URL}?${qs}`
    const json = await fetchJson(url)

    if (!json || json.status_code !== 0 || !json.aweme_detail) {
        throw new Error(`douyin API returned status_code=${json?.status_code}`)
    }

    return json.aweme_detail
}

// 规范化为统一内部格式
function normalizeAweme(aweme) {
    const author = {
        name: aweme.author?.nickname || 'Unknown',
        face: aweme.author?.avatar_thumb?.url_list?.[0] || '',
        signature: aweme.author?.signature || '',
    }

    const shareText = (() => {
        const info = aweme.share_info || {}
        const desc = info.share_desc || ''
        const descInfo = info.share_desc_info || ''
        return descInfo.replace(`#${desc}#`, '').trim() || desc
    })()

    const shareUrl = (aweme.share_url || '').split('?')[0]

    const base = {
        aweme_id: aweme.aweme_id,
        author,
        title: shareText,
        pubdate: aweme.create_time || 0,
        share_url: shareUrl,
    }

    // 图集 / Live Photo
    if (Array.isArray(aweme.images) && aweme.images.length > 0) {
        const images = []
        const livePhotos = []

        for (const img of aweme.images) {
            if (img.clip_type === 2 || img.clip_type == null) {
                const url = img.url_list?.[img.url_list.length - 1]
                if (url) images.push(url)
            } else if (img.video?.play_addr?.uri) {
                livePhotos.push({
                    cover: img.video.cover?.url_list?.[0] || '',
                    play_addr_uri: img.video.play_addr.uri,
                })
            }
        }

        if (livePhotos.length > 0) {
            return { ...base, type: 'douyin_live_photo', cover: livePhotos[0].cover, images, livePhotos }
        }
        return { ...base, type: 'douyin_note', cover: images[0] || '', images }
    }

    // 普通视频
    if (aweme.video?.play_addr?.uri) {
        const coverList = aweme.video.cover_original_scale?.url_list || aweme.video.cover?.url_list || []
        return {
            ...base,
            type: 'douyin_video',
            cover: coverList[coverList.length - 1] || '',
            duration: Math.floor((aweme.video.duration || 0) / 1000),
            play_addr_uri: aweme.video.play_addr.uri,
        }
    }

    return { ...base, type: 'douyin_video', cover: '' }
}

// 主入口：aweme_id → 标准化结果（可传入短链，内部自动展开）
async function fetchDouyinContent(awemeIdOrShortUrl) {
    let awemeId = awemeIdOrShortUrl

    // 如果传入的是短链，先展开
    if (/^https?:\/\/(v|jx)\.douyin\.com\//.test(awemeIdOrShortUrl)) {
        const expanded = await expandExternalShortUrl(awemeIdOrShortUrl)
        awemeId = extractAwemeId(expanded)
        if (!awemeId) {
            throw new Error(`cannot extract aweme_id from expanded URL: ${expanded}`)
        }
    }

    const aweme = await getAwemeDetail(awemeId)
    return normalizeAweme(aweme)
}

module.exports = { fetchDouyinContent, buildPlayUrl, normalizeAweme, extractAwemeId }
