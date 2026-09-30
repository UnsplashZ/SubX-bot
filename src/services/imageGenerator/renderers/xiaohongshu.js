'use strict'

const { escapeHtml, formatPubTime, formatDuration } = require('../core/formatters')
const { renderExternalRichText } = require('./components/richtext')

// 小红书预览卡渲染器：品牌标记"小红书"，图文笔记含 2×2 缩略图网格
function renderXhsVideoContent(data, emojiContext = null) {
    const info = data.data
    const author = info.author || {}
    const dur = info.video_duration ? ` • 时长: ${formatDuration(info.video_duration)}` : ''

    return `
        <div class="cover-container" data-layout-key="cover">
            <img class="cover video" src="${escapeHtml(info.cover || '')}" />
            <div class="cover-badge">小红书</div>
        </div>
        <div class="content" data-layout-key="content">
            <div class="header" data-layout-key="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar no-frame" src="${escapeHtml(author.face || '')}" onerror="this.style.display='none'">
                    </div>
                    <div class="user-info">
                        <span class="user-name" data-layout-key="authorName">${escapeHtml(author.name || 'Unknown')}</span>
                        <span class="pub-time" data-layout-key="pubTime">${formatPubTime(info.pubdate)}${dur}</span>
                    </div>
                </div>
            </div>
            <div class="title" data-layout-key="title">${renderExternalRichText(info.title || '', emojiContext)}</div>
        </div>
    `
}

function renderXhsNoteContent(data, emojiContext = null) {
    const info = data.data
    const author = info.author || {}
    const images = info.images || []
    const displayImages = images.slice(0, 4)  // 预览最多 4 张
    const remaining = images.length - displayImages.length
    const desc = (info.desc || '').slice(0, 200)

    const imageGrid = displayImages.map((url) =>
        `<img class="note-thumb" src="${escapeHtml(url)}" />`
    ).join('')

    return `
        <div class="content" data-layout-key="content">
            <div class="header" data-layout-key="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar no-frame" src="${escapeHtml(author.face || '')}" onerror="this.style.display='none'">
                    </div>
                    <div class="user-info">
                        <span class="user-name">${escapeHtml(author.name || '')}</span>
                        <span class="pub-time">${formatPubTime(info.pubdate)} · 小红书笔记${images.length > 0 ? ` · ${images.length} 张` : ''}</span>
                    </div>
                </div>
            </div>
            <div class="title">${renderExternalRichText(info.title || '', emojiContext)}</div>
            ${desc ? `<div class="text-content xhs-desc">${renderExternalRichText(desc, emojiContext)}</div>` : ''}
            <div class="note-image-grid">
                ${imageGrid}
                ${remaining > 0 ? `<div class="note-more">+${remaining}</div>` : ''}
            </div>
        </div>
    `
}

module.exports = {
    renderXhsVideoContent,
    renderXhsNoteContent,
}
