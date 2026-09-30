'use strict'

const https = require('https')
const config = require('../../config')
const logger = require('../../utils/logger')
const { expandExternalShortUrl } = require('./externalShortLinkExpander')

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const PC_UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function normalizeQuerySeparators(value) {
    const text = String(value || '').trim()
    const queryStart = text.indexOf('?')
    if (queryStart < 0) return text
    return `${text.slice(0, queryStart)}${text.slice(queryStart).replace(/\\&/g, '&')}`
}

function fetchHtml(url, headers) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers, timeout: 12000 }, (res) => {
            // 跟随 302，但只允许小红书域名跳转，并正确处理相对 Location。
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const loc = new URL(res.headers.location, url)
                const hostname = loc.hostname.toLowerCase()
                if (hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com')) {
                    fetchHtml(loc.toString(), headers).then(resolve).catch(reject)
                } else {
                    reject(new Error(`xhs redirect to unexpected host: ${loc.hostname}`))
                }
                return
            }

            if (res.statusCode >= 400) {
                reject(new Error(`xhs HTTP ${res.statusCode}`))
                return
            }

            let body = ''
            res.on('data', (chunk) => { body += chunk })
            res.on('end', () => resolve(body))
        })
        req.on('timeout', () => { req.destroy(); reject(new Error('xhs fetch timeout')) })
        req.on('error', reject)
    })
}

function buildHeaders(baseHeaders = {}) {
    const cookie = String(config.externalParsers?.xiaohongshu?.cookie || '').trim()
    return cookie ? { ...baseHeaders, Cookie: cookie } : baseHeaders
}

function extractInitialState(html) {
    const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)
    if (!m) throw new Error('xhs: window.__INITIAL_STATE__ not found')
    // 小红书页面把部分非 JSON 值直接序列化进状态脚本（目前常见的是
    // undefined 和空 Map）。这些值不影响 note 数据，先转换为 JSON 等价物。
    const raw = m[1]
        .replace(/;\s*$/, '')
        .replace(/\bundefined\b/g, 'null')
        .replace(/\bNaN\b|\bInfinity\b/g, 'null')
        .replace(/new\s+(?:Map|Set)\(\s*\[\s*\]\s*\)/g, '{}')
        .replace(/new\s+(?:Map|Set)\(\s*\)/g, '{}')
    try {
        return JSON.parse(raw)
    } catch (e) {
        throw new Error(`xhs: __INITIAL_STATE__ JSON parse failed: ${e.message}`)
    }
}

// Explore 路径（PC UA，无额外请求头）
async function parseExplore(noteId, queryString) {
    const url = `https://www.xiaohongshu.com/explore/${noteId}${queryString}`
    const html = await fetchHtml(url, buildHeaders({
        'User-Agent': PC_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }))
    const state = extractInitialState(html)
    const wrapper = state?.note?.noteDetailMap?.[noteId]
    const note = wrapper?.note || (wrapper?.noteId ? wrapper : null)
    if (!note) throw new Error(`xhs explore: note ${noteId} not found in state`)
    return { state, note, path: 'explore' }
}

// Discovery 回退路径（iOS UA + 额外请求头）
async function parseDiscovery(noteId, queryString) {
    const url = `https://www.xiaohongshu.com/discovery/item/${noteId}${queryString}`
    const html = await fetchHtml(url, buildHeaders({
        'User-Agent': IOS_UA,
        'Origin': 'https://www.xiaohongshu.com',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
    }))
    const state = extractInitialState(html)
    // 页面版本之间曾出现过 noteData.data.noteData、noteData.data.note
    // 和 noteData.noteData 三种形态，按完整度从高到低尝试。
    const data = state?.noteData?.data
    const note = data?.noteData
        || data?.note
        || (data?.noteId || data?.id || data?.type ? data : null)
        || state?.noteData?.noteData
    if (!note) throw new Error('xhs discovery: noteData not found in state')
    const preload = state?.noteData?.normalNotePreloadData || null
    return { state, note, preload, path: 'discovery' }
}

// 从 Video.media.stream 提取最优播放 URL（h265 无水印优先）
function extractVideoUrl(video) {
    const candidates = []
    const addUrl = (value) => {
        if (typeof value === 'string' && value.trim()) return value.trim()
        if (value && typeof value === 'object') {
            return addUrl(value.url || value.masterUrl || value.master_url || value.playUrl || value.play_url)
        }
        return null
    }
    const addItem = (item) => {
        if (!item || typeof item !== 'object') return
        const urls = [
            item.masterUrl,
            item.master_url,
            item.url,
            item.playUrl,
            item.play_url,
            ...(Array.isArray(item.urlList) ? item.urlList : []),
            ...(Array.isArray(item.url_list) ? item.url_list : []),
            ...(Array.isArray(item.backupUrls) ? item.backupUrls : []),
            ...(Array.isArray(item.backup_urls) ? item.backup_urls : []),
        ]
        for (const url of urls) {
            const normalizedUrl = addUrl(url)
            if (normalizedUrl) {
                candidates.push({
                    url: normalizedUrl,
                    duration: item.duration ?? item.videoDuration ?? item.durationMs,
                })
            }
        }
    }

    const mediaSources = [video, video?.media, video?.mediaV2, video?.media?.video, video?.mediaV2?.video]
    for (const source of mediaSources) {
        const stream = source?.stream
        for (const codec of ['h265', 'h264', 'av1', 'h266']) {
            const items = stream?.[codec]
            if (Array.isArray(items)) items.forEach(addItem)
        }
    }
    addItem(video?.media)
    addItem(video)

    const selected = candidates[0]
    if (!selected) return { url: null, duration: 0 }
    const duration = Number(selected.duration || video?.duration || video?.videoDuration || video?.media?.duration || 0)
    return {
        url: selected.url,
        duration: Math.floor(duration > 1000 ? duration / 1000 : duration),
    }
}

// 小红书返回的图床地址部分是 http://（sns-webpic-qc.xhscdn.com），
// 投递侧用 https 抓取，这里统一升级为 https（CDN 双协议可用）
function toHttpsUrl(url) {
    if (typeof url !== 'string') return url
    if (url.startsWith('//')) return `https:${url}`
    return url.startsWith('http://')
        ? `https://${url.slice('http://'.length)}`
        : url
}

function normalizeNote(noteData, path) {
    const user = noteData.user || noteData.author || {}
    const author = {
        name: user.nickname || user.nickName || 'Unknown',
        face: toHttpsUrl(user.avatar || user.avatarUrl || ''),
    }
    const title = noteData.title || ''
    const desc  = noteData.desc || ''
    const isVideo = noteData.type === 'video' && noteData.video != null

    const base = {
        note_id: noteData.noteId || noteData.id || '',
        author,
        title,
        desc,
        pubdate: noteData.time ? Math.floor(noteData.time / 1000) : 0,
    }

    if (isVideo) {
        const { url, duration } = extractVideoUrl(noteData.video)
        const coverList = noteData.imageList || []
        const cover = toHttpsUrl(coverList[0]?.urlDefault || coverList[0]?.url || '')
        return { ...base, type: 'xhs_video', video_url: toHttpsUrl(url), video_duration: duration, cover }
    }

    // 图文笔记
    const images = (noteData.imageList || [])
        .map((img) => toHttpsUrl(img.urlDefault || img.url))
        .filter(Boolean)
    return { ...base, type: 'xhs_note', cover: images[0] || '', images }
}

async function fetchXhsContent(noteId, queryString = '') {
    try {
        const { note } = await parseExplore(noteId, queryString)
        return normalizeNote(note, 'explore')
    } catch (exploreErr) {
        logger.logEvent('warn', 'LINK', '', 'xhs-explore-fallback', {
            noteId,
            error: String(exploreErr.message || exploreErr)
        })
        const { note } = await parseDiscovery(noteId, queryString)
        return normalizeNote(note, 'discovery')
    }
}

function extractDirectNoteId(value) {
    if (typeof value !== 'string' || !value.trim()) return null
    try {
        const parsed = new URL(normalizeQuerySeparators(value), 'https://www.xiaohongshu.com')
        const match = parsed.pathname.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{24})\/?$/i)
        if (!match) return null
        return { noteId: match[1], queryString: parsed.search || '' }
    } catch {
        return null
    }
}

// 从分享链接提取 noteId 和 queryString。短链有时先跳到 login，真实地址藏在 redirectPath 中。
function extractNoteId(url, depth = 0) {
    const direct = extractDirectNoteId(url)
    if (direct || depth >= 2 || typeof url !== 'string') return direct

    try {
        const parsed = new URL(url.trim(), 'https://www.xiaohongshu.com')
        const redirectPath = parsed.searchParams.get('redirectPath')
        if (!redirectPath) return null
        const candidates = [redirectPath]
        try {
            const decoded = decodeURIComponent(redirectPath)
            if (decoded !== redirectPath) candidates.push(decoded)
        } catch {
            // URLSearchParams 已完成一次解码，二次解码失败时仍尝试原值。
        }
        for (const candidate of candidates) {
            const result = extractNoteId(candidate, depth + 1)
            if (result) return result
        }
    } catch {
        return null
    }
    return null
}

module.exports = { fetchXhsContent, extractNoteId, extractInitialState, normalizeNote, extractVideoUrl, expandExternalShortUrl }
