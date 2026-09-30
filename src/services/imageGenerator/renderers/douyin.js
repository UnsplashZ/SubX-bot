'use strict'

const { escapeHtml, formatPubTime, formatDuration } = require('../core/formatters')
const { renderExternalRichText } = require('./components/richtext')

// 抖音色系：品牌黑底 + 白字，但预览卡颜色由主题层控制，这里只输出内容 HTML
function renderDouyinVideoContent(data, emojiContext = null) {
    const info = data.data
    const author = info.author || {}
    const face = author.face || ''
    const name = escapeHtml(author.name || 'Unknown')
    const sig  = author.signature ? `<span class="user-signature">${renderExternalRichText(author.signature, emojiContext)}</span>` : ''
    const dur  = info.duration ? ` • 时长: ${formatDuration(info.duration)}` : ''

    return `
        <div class="cover-container external" data-layout-key="cover">
            <img class="cover video" src="${escapeHtml(info.cover || '')}" />
            <div class="cover-badge">抖音</div>
        </div>
        <div class="content" data-layout-key="content">
            <div class="header" data-layout-key="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar no-frame" src="${escapeHtml(face)}" onerror="this.style.display='none'">
                    </div>
                    <div class="user-info">
                        <span class="user-name" data-layout-key="authorName">${name}</span>
                        ${sig}
                        <span class="pub-time" data-layout-key="pubTime">${formatPubTime(info.pubdate)}${dur}</span>
                    </div>
                </div>
            </div>
            <div class="title" data-layout-key="title">${renderExternalRichText(info.title || '', emojiContext)}</div>
        </div>
    `
}

function renderDouyinNoteContent(data, emojiContext = null) {
    const info = data.data
    const author = info.author || {}
    const images = info.images || []
    const displayImages = images.slice(0, 4)  // 预览最多 4 张
    const remaining = images.length - displayImages.length

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
                        <span class="pub-time">${formatPubTime(info.pubdate)} · 抖音图集${images.length > 0 ? ` · ${images.length} 张` : ''}</span>
                    </div>
                </div>
            </div>
            <div class="title">${renderExternalRichText(info.title || '', emojiContext)}</div>
            <div class="note-image-grid">
                ${imageGrid}
                ${remaining > 0 ? `<div class="note-more">+${remaining}</div>` : ''}
            </div>
        </div>
    `
}

function renderDouyinLivePhotoContent(data, emojiContext = null) {
    const info = data.data
    const livePhotos = info.livePhotos || []
    const displayCovers = livePhotos.slice(0, 4).map((lp) => lp.cover)
    const remaining = livePhotos.length - displayCovers.length

    const imageGrid = displayCovers.map((url) =>
        `<img class="note-thumb live-photo" src="${escapeHtml(url)}" />`
    ).join('')

    return `
        <div class="content" data-layout-key="content">
            <div class="header" data-layout-key="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar no-frame" src="${escapeHtml(info.author?.face || '')}" onerror="this.style.display='none'">
                    </div>
                    <div class="user-info">
                        <span class="user-name">${escapeHtml(info.author?.name || '')}</span>
                        <span class="pub-time">${formatPubTime(info.pubdate)} · Live Photo · ${livePhotos.length} 组</span>
                    </div>
                </div>
            </div>
            <div class="title">${renderExternalRichText(info.title || '', emojiContext)}</div>
            <div class="note-image-grid">
                ${imageGrid}
                ${remaining > 0 ? `<div class="note-more">+${remaining}</div>` : ''}
            </div>
        </div>
    `
}

module.exports = {
    renderDouyinVideoContent,
    renderDouyinNoteContent,
    renderDouyinLivePhotoContent,
}
