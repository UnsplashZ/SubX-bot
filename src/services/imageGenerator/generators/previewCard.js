const browserManager = require('../core/browser');
const { isNightMode, calculateViewport, getTypeConfig, calculateColors, generateCSS } = require('../core/theme');
const { renderVideoContent } = require('../renderers/video');
const { renderBangumiContent } = require('../renderers/bangumi');
const { renderArticleContent } = require('../renderers/article');
const { renderLiveContent } = require('../renderers/live');
const { renderDynamicContent } = require('../renderers/dynamic');
const { renderUserContent } = require('../renderers/user');
const { renderGenericContent } = require('../renderers/generic');
const { renderDouyinVideoContent, renderDouyinNoteContent, renderDouyinLivePhotoContent } = require('../renderers/douyin');
const { renderXhsVideoContent, renderXhsNoteContent } = require('../renderers/xiaohongshu');
const { createRenderEmojiContext } = require('../renderers/components/renderEmojiContext');
const config = require('../../../config');
const logger = require('../../../utils/logger');
const { normalizePreviewLayoutPatch } = require('../../previewLayout/normalizer');
const { getSavedEffectiveLayout } = require('../../previewLayout/merge');
const { buildPreviewLayoutOverrideCss } = require('../../previewLayout/css');
const { collectPreviewLayoutElementMetadata } = require('../../previewLayout/elementMetadata');
const { isEditableType } = require('../../previewLayout/schema');
const { renderTemplateArtifacts, buildStructuralElements, sanitizeArtifactHtml } = require('../../previewTemplate/renderer');
const { getEffectiveTemplate } = require('../../previewTemplate/merge');
const { collectPreviewTemplateMetadata } = require('../../previewTemplate/metadata');

/**
 * 检测是否为充电专属内容
 */
function detectChargingContent(type, data) {
    if (!data) return false          // null/undefined guard
    const isTruthyFlag = (value) => value === true || value === 1 || value === '1'
    if (type === 'dynamic') {
        // B 站充电专属动态：item.basic.is_only_fans = true
        // 注：字段名含 "fans" 但实际对应充电专属（非粉丝团专属），
        // 充电专属内容通常伴随 MAJOR_TYPE_BLOCKED 遮蔽，此字段可用于在 badge 层额外标记
        return data.data?.item?.basic?.is_only_fans === true
    }
    if (type === 'video') {
        // B 站充电专属视频：
        // - is_charging_arc = true（订阅推送时手动注入，来自 /user_videos API 的 vlist 字段）
        // - rights.is_charging_arc = 1（旧版 /x/web-interface/view 字段）
        // - is_upower_exclusive = true（新版 /x/web-interface/view 字段）
        return isTruthyFlag(data.data?.is_charging_arc)
            || isTruthyFlag(data.data?.rights?.is_charging_arc)
            || isTruthyFlag(data.data?.is_upower_exclusive)
    }
    return false
}

/**
 * 渲染类型标签
 * @param {String} type - 内容类型
 * @param {Object} data - 内容数据
 * @param {String} groupId - 群组ID
 * @param {Object} currentType - 当前类型配置
 * @returns {String} HTML 字符串
 */
function renderTypeBadge(type, data, groupId, currentType) {
    const labelConfig = config.getGroupConfig(groupId, 'labelConfig');
    let subtype = type;
    if (type === 'bangumi' && data.data) {
        const st = data.data.season_type;
        if (st === 2) subtype = 'movie';
        else if (st === 3) subtype = 'doc';
        else if (st === 4) subtype = 'guocha';
        else if (st === 5) subtype = 'tv';
        else if (st === 7) subtype = 'variety';
    }

    const isVisible = (labelConfig && labelConfig[subtype] !== undefined)
        ? labelConfig[subtype]
        : (labelConfig && labelConfig[type] !== false);

    if (!isVisible) return '';

    const isCharging = detectChargingContent(type, data)
    const layoutAttr = isEditableType(type) ? ' data-layout-key="typeBadge"' : ''
    return `
        <div class="type-badge"${layoutAttr}>
            <span>${currentType.icon}</span>
            <span>${currentType.label}</span>
            ${isCharging ? '<span class="charging-mark" title="充电专属" aria-label="充电专属">⚡</span>' : ''}
        </div>`;
}

function buildColorSummary(colorData = {}) {
    return {
        background: colorData.bgColor || '',
        text: colorData.textColor || '',
        subtext: colorData.subColor || '',
        accent: colorData.accent || '',
        border: colorData.borderColor || '',
        gradientAtmosphere: colorData.gradientAtmosphere || '',
        gradientContent: colorData.gradientContent || '',
        gradientOverlay: colorData.gradientOverlay || '',
        gradientMix: colorData.gradientMix || ''
    }
}

function normalizeRenderOverrides(type, renderOverrides = {}) {
    if (!renderOverrides || Object.keys(renderOverrides).length === 0) {
        return {}
    }
    return normalizePreviewLayoutPatch(type, renderOverrides, {
        requireEditable: false
    })
}

function renderContentHtml(type, data, showId, emojiContext) {
    if (type === 'video') {
        return renderVideoContent(data, emojiContext);
    } else if (type === 'bangumi') {
        return renderBangumiContent(data, emojiContext);
    } else if (type === 'article') {
        return renderArticleContent(data, emojiContext);
    } else if (type === 'live') {
        return renderLiveContent(data, emojiContext);
    } else if (type === 'dynamic') {
        return renderDynamicContent(data, emojiContext);
    } else if (type === 'interactive_video') {
        return renderVideoContent(data, emojiContext);
    } else if (type === 'user') {
        return renderUserContent(data, showId, emojiContext);
    } else if (type === 'douyin_video') {
        return renderDouyinVideoContent(data, emojiContext);
    } else if (type === 'douyin_note') {
        return renderDouyinNoteContent(data, emojiContext);
    } else if (type === 'douyin_live_photo') {
        return renderDouyinLivePhotoContent(data, emojiContext);
    } else if (type === 'xhs_video') {
        return renderXhsVideoContent(data, emojiContext);
    } else if (type === 'xhs_note') {
        return renderXhsNoteContent(data, emojiContext);
    }
    return renderGenericContent(data, emojiContext);
}

function renderLegacyPreviewBody(type, data, groupId, showId, typeConfig, emojiContext) {
    const contentHtml = renderContentHtml(type, data, showId, emojiContext)
    const typeBadgeHtml = renderTypeBadge(type, data, groupId, typeConfig);
    const cardLayoutAttr = isEditableType(type) ? ' data-layout-key="card"' : ''
    return `
                    ${typeBadgeHtml}
                    <div class="card"${cardLayoutAttr}>
                        ${contentHtml}
                    </div>`
}

async function buildPreviewRenderArtifacts(data, type, groupId, show_id = true, options = {}) {
    const viewport = calculateViewport(type, data);
    const isNight = isNightMode(groupId);
    const typeConfig = getTypeConfig(type, data);
    const colorData = calculateColors(type, data, typeConfig, isNight);
    const emojiContext = await createRenderEmojiContext({ seedData: data });
    const legacyBodyHtml = renderLegacyPreviewBody(type, data, groupId, show_id, typeConfig, emojiContext)
    if (options.draftTemplate) {
        const templateArtifacts = renderTemplateArtifacts(options.draftTemplate, data, type, {
            showId: show_id,
            url: options.url || '',
            groupId,
            typeConfig,
            emojiContext,
            legacyHtml: legacyBodyHtml
        })
        const css = generateCSS(colorData, viewport, {
            previewLayoutOverrideCss: templateArtifacts.css
        });
        const fullHtml = `<html><head>${css}</head><body>
                <div class="container ${colorData.themeClass} gradient-bg ${type === 'article' ? 'article-mode' : ''}" style="--gradient-mix:${colorData.gradientMix};--gradient-atmosphere:${colorData.gradientAtmosphere || colorData.gradientMix};--gradient-content:${colorData.gradientContent || 'none'};--gradient-overlay:${colorData.gradientOverlay || 'none'}">
                    ${templateArtifacts.html}
                </div>
            </body></html>`;
        const containerBodyHtml = `<div class="container ${colorData.themeClass} gradient-bg ${type === 'article' ? 'article-mode' : ''}" style="--gradient-mix:${colorData.gradientMix};--gradient-atmosphere:${colorData.gradientAtmosphere || colorData.gradientMix};--gradient-content:${colorData.gradientContent || 'none'};--gradient-overlay:${colorData.gradientOverlay || 'none'}">${templateArtifacts.html}</div>`
        const htmlArtifact = options.artifactMode === 'image+html' ? {
            html: sanitizeArtifactHtml(fullHtml),
            bodyHtml: sanitizeArtifactHtml(containerBodyHtml),
            fullCss: css,
            css: templateArtifacts.css,
            container: { width: viewport.width, height: 0 },
            elements: buildStructuralElements(templateArtifacts.template),
            renderer: 'preview-template-v2'
        } : null
        return {
            fullHtml,
            htmlArtifact,
            debugMeta: {
                viewport,
                themeClass: colorData.themeClass || '',
                renderer: 'preview-template-v2',
                resolvedTypeConfig: {
                    label: typeConfig.label,
                    icon: typeConfig.icon
                },
                colorSummary: buildColorSummary(colorData)
            }
        };
    }
    const layoutOverrides = normalizeRenderOverrides(type, options.renderOverrides || {});
    const previewLayoutOverrideCss = buildPreviewLayoutOverrideCss(layoutOverrides, {
        type,
        alreadyNormalized: true
    });
    const css = generateCSS(colorData, viewport, { previewLayoutOverrideCss });
    const fullHtml = `<html><head>${css}</head><body>
                <div class="container ${colorData.themeClass} gradient-bg ${type === 'article' ? 'article-mode' : ''}" style="--gradient-mix:${colorData.gradientMix};--gradient-atmosphere:${colorData.gradientAtmosphere || colorData.gradientMix};--gradient-content:${colorData.gradientContent || 'none'};--gradient-overlay:${colorData.gradientOverlay || 'none'}">
                    ${legacyBodyHtml}
                </div>
            </body></html>`;

    return {
        fullHtml,
        debugMeta: {
            viewport,
            themeClass: colorData.themeClass || '',
            resolvedTypeConfig: {
                label: typeConfig.label,
                icon: typeConfig.icon
            },
            colorSummary: buildColorSummary(colorData)
        }
    };
}

async function generatePreviewCardArtifacts(data, type, groupId, show_id = true, options = {}) {
    return browserManager.withRetry(async () => {
        await browserManager.init();
        const page = await browserManager.createPage({ width: 1200, height: 1200 });

        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            const { fullHtml, htmlArtifact, debugMeta } = await buildPreviewRenderArtifacts(data, type, groupId, show_id, options);
            await page.setViewport(debugMeta.viewport);
            await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('.container', { timeout: 5000 });

            // 额外等待图片加载（如果需要）
            if (type === 'article') {
                await page.evaluate(async () => {
                    const lazyAttrs = ['data-src', 'data-original', 'data-url', 'data-lazy-src', 'data-actualsrc']
                    const placeholders = [/^data:image\/gif/i, /^about:blank$/i]
                    const toSafeUrl = (url) => {
                        if (!url) return ''
                        if (url.startsWith('//')) return `https:${url}`
                        return url
                    }
                    const isPlaceholder = (src) => placeholders.some(re => re.test(src || ''))
                    const pickLazySrc = (img) => {
                        for (const attr of lazyAttrs) {
                            const value = img.getAttribute(attr)
                            if (value) return value
                        }
                        return ''
                    }
                    const waitImageReady = (img, timeoutMs = 10000) => new Promise((resolve) => {
                        if (img.complete && img.naturalWidth > 0) return resolve()
                        const timer = setTimeout(() => resolve(), timeoutMs)
                        const done = () => {
                            clearTimeout(timer)
                            resolve()
                        }
                        img.addEventListener('load', done, { once: true })
                        img.addEventListener('error', done, { once: true })
                    })

                    const images = Array.from(document.querySelectorAll('img'))
                    for (const img of images) {
                        const srcAttr = img.getAttribute('src') || ''
                        const currentSrc = srcAttr.trim()
                        const lazySrc = pickLazySrc(img).trim()
                        const shouldReplace = !currentSrc || isPlaceholder(currentSrc)
                        const candidate = toSafeUrl(shouldReplace ? lazySrc : currentSrc)
                        if (candidate && candidate !== currentSrc) {
                            img.setAttribute('src', candidate)
                        } else if (currentSrc.startsWith('//')) {
                            img.setAttribute('src', toSafeUrl(currentSrc))
                        }
                    }

                    await Promise.all(images.map(img => waitImageReady(img)))
                    await new Promise(resolve => setTimeout(resolve, 150))
                })
            } else {
                await page.evaluate(async () => {
                    const selectors = Array.from(document.querySelectorAll('img'))
                    await Promise.all(selectors.map(img => {
                        if (img.complete) return
                        return new Promise((resolve) => {
                            img.addEventListener('load', resolve)
                            img.addEventListener('error', resolve)
                        })
                    }))
                })
            }

            await page.evaluate(() => {
                const elements = document.querySelectorAll('.text-content, .orig-text, .article-body');
                elements.forEach(el => {
                    if (el.scrollHeight > el.clientHeight) {
                        el.classList.add('truncated');
                    }
                });
            });

            const element = await page.$('.container');
            if (!element) throw new Error('Container element not found');

            const elementMetadata = options.collectElementMetadata
                ? (options.draftTemplate
                    ? await collectPreviewTemplateMetadata(page)
                    : await collectPreviewLayoutElementMetadata(page, type))
                : null

            const imageBuffer = await element.screenshot({
                type: 'png',
                omitBackground: true
            });

            let resolvedHtmlArtifact = htmlArtifact
            if (resolvedHtmlArtifact && elementMetadata?.container) {
                resolvedHtmlArtifact = { ...resolvedHtmlArtifact, container: elementMetadata.container }
            }

            return {
                base64: imageBuffer.toString('base64'),
                html: fullHtml,
                debugMeta,
                elementMetadata,
                htmlArtifact: resolvedHtmlArtifact
            };
        } finally {
            await browserManager.closePage(page);
        }
    });
}

/**
 * 生成预览卡片图片
 * @param {Object} data - 内容数据
 * @param {String} type - 内容类型
 * @param {String} groupId - 群组ID
 * @param {Boolean} show_id - 是否显示UID (仅用于user类型)
 * @returns {Promise<String>} Base64编码的图片
 */
async function generatePreviewCard(data, type, groupId, show_id = true) {
    let renderOverrides = {}
    let draftTemplate = null
    try {
        if (isEditableType(type)) {
            draftTemplate = getEffectiveTemplate(type, groupId)
        } else {
            renderOverrides = getSavedEffectiveLayout(type, groupId, { tolerateInvalid: true })
        }
    } catch (error) {
        logger.logEvent('warn', 'PREVIEW_LAYOUT', 'svc:image-generator', 'saved-layout-load-failed', {
            type,
            groupId: groupId ? String(groupId) : '',
            error: logger.getErrorMessage(error)
        })
        if (isEditableType(type)) {
            throw error
        }
    }
    const artifacts = await generatePreviewCardArtifacts(data, type, groupId, show_id, { renderOverrides, draftTemplate })
    return artifacts.base64
}

module.exports = {
    generatePreviewCard,
    generatePreviewCardArtifacts,
    detectChargingContent,
    renderTypeBadge,
    renderLegacyPreviewBody
};
