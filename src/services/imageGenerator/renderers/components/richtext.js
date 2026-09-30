/**
 * 富文本解析器
 * 解析 Bilibili 富文本节点 (表情、@用户、话题、投票、URL等)
 */
const { loadRichTextIcon } = require('./richtextIcons')
const { isEmojiToken, splitEmojiTokens } = require('./biliEmojiRegistry')

const ICON_LINK_TYPES = new Set([
    'RICH_TEXT_NODE_TYPE_WEB',
    'RICH_TEXT_NODE_TYPE_VOTE',
    'RICH_TEXT_NODE_TYPE_LOTTERY',
    'RICH_TEXT_NODE_TYPE_BV'
])

const TEXT_LINK_TYPES = new Set([
    'RICH_TEXT_NODE_TYPE_AT',
    'RICH_TEXT_NODE_TYPE_GOODS',
    'RICH_TEXT_NODE_TYPE_URL'
])

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>')
}

function escapeAttr(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function normalizeJumpUrl(url) {
    const raw = String(url || '').trim()
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    return raw
}

function resolveLinkText(node) {
    const rawText = String(node?.text || '').trim()
    if (rawText) return rawText

    const jumpUrl = normalizeJumpUrl(node?.jump_url)
    if (jumpUrl) return jumpUrl

    const origText = String(node?.orig_text || '').trim()
    if (origText) return origText

    return rawText || '链接'
}

function isTopicDetailJumpUrl(url) {
    const jumpUrl = normalizeJumpUrl(url)
    if (!jumpUrl) return false
    return /\/v\/topic\/detail\/\?topic_id=\d+/.test(jumpUrl)
}

function renderTextLink(node, extraClassName = '') {
    const text = resolveLinkText(node)
    const title = normalizeJumpUrl(node?.jump_url) || ''
    const className = extraClassName
        ? `${extraClassName} rich-link rt-link-text`
        : 'rich-link rt-link-text'
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
    return `<span class="${className}"${titleAttr}>${escapeHtml(text)}</span>`
}

function renderIconLink(node, extraClassName = '') {
    const iconSvg = loadRichTextIcon(node?.type)
    const iconHtml = iconSvg
        ? `<span class="rt-link-icon">${iconSvg}</span>`
        : ''
    return `<span class="rt-link-inline">${iconHtml}${renderTextLink(node, extraClassName)}</span>`
}

function renderEmojiImage(iconUrl, altText) {
    if (!iconUrl) return escapeHtml(altText)
    const safeAlt = escapeAttr(altText)
    return `<img class="emoji" src="${iconUrl}" alt="${safeAlt}" />`
}

function renderTextWithEmojiFallback(text, emojiContext = null) {
    const rawText = String(text || '')
    if (!rawText) return ''

    const parts = splitEmojiTokens(rawText)
    return parts.map(part => {
        if (!part) return ''
        if (isEmojiToken(part)) {
            const matched = emojiContext?.lookupEmojiByText?.(part)
            if (matched?.iconUrl) {
                return renderEmojiImage(matched.iconUrl, part)
            }
        }
        return escapeHtml(part)
    }).join('')
}

/**
 * 渲染抖音 / 小红书的纯文本描述，补齐平台常见的 #话题#、@用户和 URL。
 * 不解析为可执行 HTML，所有普通文本和属性值都经过现有安全转义流程。
 */
// 话题字符的终止符：空白、# 、HTML 特殊字符与常见中英文标点（话题内容不含这些字符）
const TOPIC_STOP_CHARS = new Set(['#', '<', '>', '"', "'", '&', '@',
    ' ', '\t', '\r', '\n', '\u00a0',
    '，', '。', '！', '？', '、', '；', '：', '（', '）', '【', '】', '《', '》',
    ',', '.', '!', '?', ';', ':', '(', ')', '[', ']', '{', '}', '/', '\\', '|'])

/**
 * 从 text[start]（必须为 '#'）扫描一个话题串：
 * - 抖音链式："#抽象#搞笑#精神状态#耀祖" → 多个话题
 * - 闭合单话题："#旅行#"（# 后紧跟终止符，即两个 # 之间无内容）
 * - 开式单话题："#穿搭"（后随空白或终止符）
 * 返回 { segments, closed, end }；end 为已消费的结束下标。
 */
function matchTopicRun(text, start) {
    const segments = []
    let i = start
    let closed = false

    while (i < text.length && text[i] === '#') {
        let j = i + 1
        while (j < text.length && !TOPIC_STOP_CHARS.has(text[j])) j++
        if (j === i + 1) {
            // 空片段：连续 ## 或 # 后紧跟终止符。已在话题串中间则结束扫描
            if (segments.length === 0) return null
            break
        }
        segments.push(text.slice(i + 1, j))
        i = j
        if (i < text.length && text[i] === '#') {
            // lookahead：# 之后还有话题内容 → 作为链式分隔符继续；否则视为闭合 # 
            if (i + 1 < text.length && !TOPIC_STOP_CHARS.has(text[i + 1])) continue
            closed = true
            i += 1
        }
        break
    }

    if (segments.length === 0) return null
    return { segments, closed, end: i }
}

function renderTopicRun(span, run, emojiContext) {
    // 链式话题：每个话题独立标签，空格分隔（原串无空格的写法渲染出来更易读）
    if (run.segments.length > 1) {
        return run.segments
            .map(seg => `<span class="topic-tag">#${renderTextWithEmojiFallback(seg, emojiContext)}</span>`)
            .join(' ')
    }
    // 闭合单话题：保留原样（含两个 #）
    if (run.closed) {
        return `<span class="topic-tag">${renderTextWithEmojiFallback(span.slice(run.start, run.end), emojiContext)}</span>`
    }
    // 开式单话题："#穿搭"
    return `<span class="topic-tag">#${renderTextWithEmojiFallback(run.segments[0], emojiContext)}</span>`
}

// 渲染两个 URL/@ 令牌之间的普通文本片段，其中可能包含 # 话题串
function renderPlainSpan(span, emojiContext) {
    let html = ''
    let cursor = 0
    let idx = span.indexOf('#')

    while (idx !== -1) {
        const run = matchTopicRun(span, idx)
        if (!run) {
            idx = span.indexOf('#', idx + 1)
            continue
        }
        run.start = idx
        html += renderTextWithEmojiFallback(span.slice(cursor, idx), emojiContext)
        html += renderTopicRun(span, run, emojiContext)
        cursor = run.end
        idx = span.indexOf('#', run.end)
    }

    return html + renderTextWithEmojiFallback(span.slice(cursor), emojiContext)
}

function renderExternalRichText(text, emojiContext = null) {
    const rawText = String(text || '')
    if (!rawText) return ''

    // URL 与 @ 令牌仍走正则；# 话题由 renderPlainSpan 单独扫描（需要链式切分逻辑）
    const tokenPattern = /https?:\/\/[^\s<>"']+|@[^\s#@，。！？、；：:（）()[\]{}<>]+/gu
    let cursor = 0
    let html = ''
    let match

    while ((match = tokenPattern.exec(rawText))) {
        const original = match[0]
        let token = original
        let trailing = ''
        if (/^https?:\/\//i.test(token)) {
            const trailingMatch = token.match(/[。，、！？；：:，,.!?;]+$/u)
            if (trailingMatch) {
                trailing = trailingMatch[0]
                token = token.slice(0, -trailing.length)
            }
        }

        html += renderPlainSpan(rawText.slice(cursor, match.index), emojiContext)
        if (/^https?:\/\//i.test(token)) {
            html += `<span class="rich-link external-link" title="${escapeAttr(token)}">${renderTextWithEmojiFallback(token, emojiContext)}</span>`
        } else {
            html += `<span class="at-user">${renderTextWithEmojiFallback(token, emojiContext)}</span>`
        }
        if (trailing) html += renderTextWithEmojiFallback(trailing, emojiContext)
        cursor = match.index + original.length
    }

    return html + renderPlainSpan(rawText.slice(cursor), emojiContext)
}

function renderUnknownNodeText(text, emojiContext = null) {
    const html = renderTextWithEmojiFallback(text, emojiContext)
    if (!html) return ''
    return `<span class="rt-link-text">${html}</span>`
}

/**
 * 解析富文本节点数组，返回 HTML 字符串
 * @param {Array} nodes - 富文本节点数组
 * @param {String} rawText - 原始文本 (fallback)
 * @param {Object|null} emojiContext - 当前卡片表情渲染上下文
 * @returns {String} HTML 字符串
 */
function parseRichText(nodes, rawText, emojiContext = null) {
    if (nodes && nodes.length > 0) {
        return nodes.map(node => {
            const type = node?.type
            const text = node?.text

            if (type === 'RICH_TEXT_NODE_TYPE_TEXT' || !type) {
                return renderTextWithEmojiFallback(text, emojiContext)
            }

            if (type === 'RICH_TEXT_NODE_TYPE_EMOJI') {
                const registered = emojiContext?.registerEmojiNode?.(node) || null
                const icon = node?.emoji?.icon_url
                    || registered?.iconUrl
                    || emojiContext?.lookupEmojiByText?.(text)?.iconUrl
                    || ''
                return renderEmojiImage(icon, text)
            }

            if (type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
                if (isTopicDetailJumpUrl(node?.jump_url)) {
                    return renderIconLink(node, 'topic-tag')
                }
                return renderTextLink(node, 'topic-tag')
            }

            if (ICON_LINK_TYPES.has(type)) {
                const extraClassName = type === 'RICH_TEXT_NODE_TYPE_VOTE'
                    ? 'vote-inline'
                    : ''
                return renderIconLink(node, extraClassName)
            }

            if (TEXT_LINK_TYPES.has(type)) {
                if (type === 'RICH_TEXT_NODE_TYPE_AT') return renderTextLink(node, 'at-user')
                if (type === 'RICH_TEXT_NODE_TYPE_TOPIC') return renderTextLink(node, 'topic-tag')
                return renderTextLink(node)
            }

            return renderUnknownNodeText(text, emojiContext)
        }).join('')
    }

    return renderTextWithEmojiFallback(rawText, emojiContext)
}

module.exports = {
    parseRichText,
    renderExternalRichText
}
