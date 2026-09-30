const config = require('../../../config');
const { generateUnifiedCSS, DESIGN_SYSTEM } = require('../../../utils/designSystem');
const { getCustomFonts } = require('./formatters');
const {
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR2,
    normalizeHexColor,
    hexToRgba,
    buildPreviewGradientLayers,
    buildPreviewGradientMix
} = require('../../../shared/previewGradientModel.cjs');

/**
 * 判断是否为夜间模式
 */
function isNightMode(groupId) {
    const nightMode = config.getGroupConfig(groupId, 'nightMode');
    if (!nightMode) return false;
    const { mode, startTime, endTime } = nightMode;

    if (mode === 'on') return true;
    if (mode === 'off') return false;

    // Timed mode
    const now = new Date();
    const shTime = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).format(now);

    const [h, m] = shTime.split(':').map(Number);
    const curMinutes = h * 60 + m;

    const [startH, startM] = startTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;

    const [endH, endM] = endTime.split(':').map(Number);
    const endMinutes = endH * 60 + endM;

    if (startMinutes < endMinutes) {
        return curMinutes >= startMinutes && curMinutes < endMinutes;
    } else {
        // Cross midnight, e.g. 21:00 to 06:00
        return curMinutes >= startMinutes || curMinutes < endMinutes;
    }
}

/**
 * 计算视口尺寸
 */
function calculateViewport(type, data) {
    let baseWidth = 1100;
    let minWidth = 400;

    if (type === 'dynamic') {
        const modules = data.data?.item?.modules || data.data?.modules || {};
        const module_dynamic = modules.module_dynamic || {};
        const hasImages = module_dynamic.major?.draw?.items?.length > 0 ||
                        module_dynamic.major?.opus?.pics?.length > 0;
        const hasVideo = !!module_dynamic.major?.archive || !!module_dynamic.major?.live_rcmd;
        const hasOrig = !!(data.data?.item?.orig || data.data?.orig);

        baseWidth = 1100;

        // 动态调整宽度以适应长用户名
        const module_author = modules.module_author || {};
        const authorName = module_author.name || '';
        if (authorName.length > 10) {
            // 基础宽度假设只能容纳约10个字符（考虑头像、右侧装饰等占用）
            // 每个额外字符增加约 35px 宽度 (30px 字体 + 间距)
            const extraWidth = (authorName.length - 10) * 35;
            baseWidth += extraWidth;
        }
    } else if (type === 'video' || type === 'live' || type === 'interactive_video') {
        baseWidth = 1100;
    } else if (type === 'bangumi') {
        baseWidth = 1100;
    } else if (type === 'article') {
        baseWidth = 1100;
    } else if (type === 'user') {
        baseWidth = 1100;
        const info = data.data || {};
        const name = info.name || '';
        if (name.length > 10) {
            const extraWidth = (name.length - 10) * 40;
            baseWidth += extraWidth;
        }
    }

    return {
        width: baseWidth,
        height: 1200,
        deviceScaleFactor: 1.2,
        minWidth: minWidth
    };
}

/**
 * 获取类型配置 (标签、颜色、图标)
 */
function getTypeConfig(type, data) {
    const TYPE_CONFIG = {
        video: { label: '视频', color: '#FB7299', icon: '▶️' },
        interactive_video: { label: '互动视频', color: '#FB7299', icon: '🕹️' },
        bangumi: { label: '番剧', color: '#00A1D6', icon: '🎬' },
        article: { label: '专栏', color: '#FAA023', icon: '📰' },
        live: { label: '直播', color: '#FF6699', icon: '📡' },
        dynamic: { label: '动态', color: '#00B5E5', icon: '📱' },
        user: { label: '用户', color: '#FB7299', icon: '👤' },
        favorite_list: { label: '收藏夹', color: '#FF8A00', icon: '⭐' },
        audio: { label: '音频', color: '#8E6BFF', icon: '🎵' },
        audio_list: { label: '歌单', color: '#6E56CF', icon: '🎶' },
        topic: { label: '话题', color: '#00B5E5', icon: '#' },
        channel_series: { label: '合集', color: '#26A69A', icon: '📚' },
        article_list: { label: '文集', color: '#FAA023', icon: '📑' },
        note: { label: '笔记', color: '#4CAF50', icon: '📝' },
        cheese_video: { label: '课程', color: '#FF7043', icon: '🎓' },
        douyin_video: { label: '抖音视频', color: '#333550', icon: '🎵' },
        douyin_note: { label: '抖音图集', color: '#333550', icon: '🖼️' },
        douyin_live_photo: { label: '抖音 Live Photo', color: '#333550', icon: '✨' },
        xhs_video: { label: '小红书视频', color: '#FF2442', icon: '📹' },
        xhs_note: { label: '小红书笔记', color: '#FF2442', icon: '📕' }
    };
    let currentType = TYPE_CONFIG[type] || { label: 'Bilibili', color: '#FB7299', icon: '' };

    if (type === 'bangumi' && data.data) {
         const seasonType = data.data.season_type;
         if (seasonType === 2) {
             currentType = { label: '电影', color: '#FE5050', icon: '🎬' };
         } else if (seasonType === 3) {
             currentType = { label: '纪录片', color: '#00B5E5', icon: '📽️' };
         } else if (seasonType === 4) {
             currentType = { label: '国创', color: '#00B5E5', icon: '🇨🇳' };
         } else if (seasonType === 5) {
             currentType = { label: '电视剧', color: '#FE5050', icon: '📺' };
         } else if (seasonType === 7) {
             currentType = { label: '综艺', color: '#FE5050', icon: '🎤' };
         }
    }
    return currentType;
}

/**
 * 计算配色方案
 */
function calculateColors(type, data, currentType, isNight) {
    const badgeColor = currentType.color;
    const themeClass = isNight ? 'theme-dark' : 'theme-light';

    // Gradient Mix Logic
    const seen = new Set();
    const colors = [];
    const addColor = (c) => {
        if (isHex(c) && !seen.has(c.toLowerCase())) {
            seen.add(c.toLowerCase());
            colors.push(c);
        }
    };

    if (type === 'video' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
        addColor(f.avatar);
    } else if (type === 'interactive_video' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
        addColor(f.avatar);
    } else if (type === 'bangumi' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
    } else if (type === 'article' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
        addColor(f.avatar);
    } else if (type === 'live' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
        addColor(f.avatar);
    } else if (type === 'user' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.avatar);
    } else if (type === 'dynamic') {
        let modules = {};
        let item = {};
        if (data.data && data.data.item) {
            item = data.data.item;
            modules = item.modules || {};
        } else if (data.data) {
            item = data.data;
            modules = item.modules || {};
        }
        const module_author = modules.module_author || {};
        const authorInfo = item.author || data.data?.author || {};
        const fanColor = authorInfo.fan_color || (module_author.decoration_card && module_author.decoration_card.fan && module_author.decoration_card.fan.color) || null;
        const cardFocus = authorInfo.card_focus_color || null;
        const avatarFocus = authorInfo.avatar_focus_color || null;
        addColor(fanColor);
        addColor(cardFocus);
        addColor(avatarFocus);
    } else if (data.data) {
        const f = data.data.focus || {};
        addColor(f.cover);
        addColor(f.avatar);
    }

    const { color1, color2 } = getPreviewGradientBaseColors();

    const { atmosphereLayer, contentLayer, overlayLayer } = buildGradientLayersFromColors(colors, {
        accentColor1: color1,
        accentColor2: color2,
        isNight
    });
    const gradientOverlay = overlayLayer || '';
    const gradientMix = [gradientOverlay, contentLayer, atmosphereLayer].filter(Boolean).join(', ');

    if (isNight) {
        // 深色模式：徽章底用品牌色渐变 + 白字（与浅色模式一致），整体压暗一档，
        // 避免亮色品牌色（如小红书红）在深色卡片上过于刺眼；暗色品牌色（如抖音深靛）轻微加深即可
        const nightBadgeBase = adjustBrightness(badgeColor, -12)
        return {
            badgeColor,
            themeClass,
            gradientAtmosphere: atmosphereLayer,
            gradientContent: contentLayer,
            gradientOverlay,
            gradientMix,
            badgeBg: `linear-gradient(135deg, ${nightBadgeBase}, ${adjustBrightness(badgeColor, -22)})`,
            badgeTextColor: '#fff',
            badgeShadow: `0 8px 24px ${hexToRgba(currentType.color, 0.40)}, var(--shadow-sm)`,
            badgeBorder: 'none',
            currentType
        };
    } else {
        // 浅色模式
        return {
            badgeColor,
            themeClass,
            gradientAtmosphere: atmosphereLayer,
            gradientContent: contentLayer,
            gradientOverlay,
            gradientMix,
            badgeBg: `linear-gradient(135deg, ${badgeColor}, ${adjustBrightness(badgeColor, -10)})`,
            badgeTextColor: '#fff',
            badgeShadow: `0 8px 24px ${hexToRgba(currentType.color, 0.40)}, var(--shadow-sm)`,
            badgeBorder: 'none',
            currentType
        };
    }
}

/**
 * 判断是否为有效的十六进制颜色值
 * (内部辅助函数)
 */
function isHex(c) {
    return typeof c === 'string' && /^#([0-9a-fA-F]{6})$/.test(c);
}

function buildGradientMixFromColors(inputColors = [], { accentColor1, accentColor2, isNight = false }) {
    return buildPreviewGradientMix({
        accentColor1,
        accentColor2,
        contentColors: inputColors,
        isNight
    });
}

function buildGradientLayersFromColors(inputColors = [], { accentColor1, accentColor2, isNight = false }) {
    return buildPreviewGradientLayers({
        accentColor1,
        accentColor2,
        contentColors: inputColors,
        isNight
    });
}

function getPreviewGradientBaseColors() {
    return {
        color1: normalizeHexColor(config.previewGradientColor1, DEFAULT_PREVIEW_ATMOSPHERE_COLOR1),
        color2: normalizeHexColor(config.previewGradientColor2, DEFAULT_PREVIEW_ATMOSPHERE_COLOR2)
    };
}

function getStaticPreviewGradientMix() {
    const { color1, color2 } = getPreviewGradientBaseColors();
    return buildGradientMixFromColors([], { accentColor1: color1, accentColor2: color2 });
}

/**
 * 调整颜色亮度
 */
function adjustBrightness(hex, percent) {
    // 移除 # 号
    hex = hex.replace('#', '');

    // 转换为 RGB
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // 调整亮度
    r = Math.max(0, Math.min(255, r + (r * percent / 100)));
    g = Math.max(0, Math.min(255, g + (g * percent / 100)));
    b = Math.max(0, Math.min(255, b + (b * percent / 100)));

    // 转换回 hex
    const rr = Math.round(r).toString(16).padStart(2, '0');
    const gg = Math.round(g).toString(16).padStart(2, '0');
    const bb = Math.round(b).toString(16).padStart(2, '0');

    return `#${rr}${gg}${bb}`;
}

/**
 * 生成完整的 CSS 样式
 * 包含统一设计系统 + 自定义样式
 */
function generateCSS(colorData, viewport, options = {}) {
    // Load Custom Fonts
    const { css: customFontsCss, families: customFontFamilies } = getCustomFonts();

    // Generate Unified CSS from Design System
    const baseCss = generateUnifiedCSS(colorData, viewport, { customFontsCss, customFontFamilies });

    // Append custom styles specific to imageGenerator
    return baseCss + `
        <style>

            .cover-container { position: relative; width: 100%; }
            .cover { width: 100%; display: block; object-fit: cover; border-radius: var(--radius-lg); }
            .cover.video { aspect-ratio: 16/9; }
            /* 外部平台（抖音/小红书）视频封面按原始比例展示并铺满卡片宽度，
               竖屏封面不再受高度上限约束，也不会在两侧留下空白。 */
            .cover-container.external .cover.video { aspect-ratio: auto; height: auto; max-height: none; object-fit: contain; background: var(--color-soft-bg); }
            .cover.bangumi { aspect-ratio: 3/4; object-fit: cover; }
            .cover.live { aspect-ratio: 16/9; }
            .cover.article { aspect-ratio: auto; height: auto; }

            .content {
                padding: 24px;
                position: relative;
            }

            .header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 20px;
            }

            .header-left { display: flex; align-items: center; }

            .avatar-wrapper {
                position: relative;
                width: 128px;
                height: 128px;
                margin-right: 18px;
                --verify-size: 32px;
                --verify-right: 14px;
                --verify-bottom: 14px;
                transition: all 0.3s ease-in-out;
            }

            .avatar-wrapper--dynamic.avatar-wrapper--with-frame {
                width: 134px;
                height: 134px;
                --verify-size: 32px;
                --verify-right: 7px;
                --verify-bottom: 7px;
            }

            .avatar-wrapper--dynamic.avatar-wrapper--no-frame {
                --verify-size: 32px;
                --verify-right: 14px;
                --verify-bottom: 14px;
            }

            .avatar-wrapper--user.avatar-wrapper--no-frame {
                --verify-size: 34px;
                --verify-right: 6px;
                --verify-bottom: 6px;
            }

            .avatar-wrapper--user.avatar-wrapper--with-frame {
                --verify-size: 34px;
                --verify-right: 6px;
                --verify-bottom: 24px;
                padding-top: 85px;
            }

            .avatar-wrapper--user {
                width: 150px;
                height: 150px;
                margin-bottom: 20px;
                box-sizing: content-box;
            }

            .avatar {
                position: absolute;
                top: 50%;
                left: 50%;
                width: 72px;
                height: 72px;
                transform: translate(-50%, -50%);
                border-radius: 50%;
                border: 3px solid var(--color-card-bg);
                box-shadow: var(--shadow-sm);
                z-index: 1;
                transition: all 0.3s ease-in-out;
            }

            .avatar.no-frame {
                width: 96px;
                height: 96px;
            }

            .avatar-wrapper--dynamic.avatar-wrapper--with-frame .avatar {
                width: 84px;
                height: 84px;
            }

            .avatar--user {
                width: 150px;
                height: 150px;
                border-width: 4px;
            }

            .avatar--user.no-frame {
                width: 150px;
                height: 150px;
            }

            .avatar.no-border { border: none; }

            .avatar-frame {
                position: absolute;
                top: 50%;
                left: 50%;
                width: 128px;
                height: 128px;
                transform: translate(-50%, -50%);
                object-fit: contain;
                pointer-events: none;
                z-index: 2;
                filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
                transition: all 0.3s ease-in-out;
            }

            .avatar-wrapper--dynamic.avatar-wrapper--with-frame .avatar-frame {
                width: 160px;
                height: 160px;
            }

            .avatar-frame--user {
                width: 160%;
                height: 160%;
            }

            .author-verify-badge {
                position: absolute;
                right: var(--verify-right, 10px);
                bottom: var(--verify-bottom, 10px);
                width: var(--verify-size, 34px);
                height: var(--verify-size, 34px);
                border-radius: 999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
                z-index: 4;
                pointer-events: none;
            }

            .author-verify-icon {
                width: 100%;
                height: 100%;
                display: block;
            }

            .user-info {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .user-info--profile {
                width: 100%;
            }

            .user-name {
                font-size: 36px;
                font-weight: 700;
                color: var(--color-text);
                display: flex;
                align-items: center;
                gap: 10px;
                letter-spacing: 0.3px;
                white-space: nowrap;
            }

            .user-name--profile {
                justify-content: center;
                gap: 12px;
            }

            .user-level {
                color: #fff;
                font-size: 16px;
                padding: 2px 8px;
                border-radius: var(--radius-md);
                font-weight: 700;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                background-color: #bfbfbf;
            }
            .user-level.lv0, .user-level.lv1 { background-color: #bfbfbf; }
            .user-level.lv2 { background-color: #95ddb2; }
            .user-level.lv3 { background-color: #92d1e5; }
            .user-level.lv4 { background-color: #ffb37c; }
            .user-level.lv5 { background-color: #ff6c00; }
            .user-level.lv6 { background-color: #ff0000; }
            .user-level.lv7, .user-level.lv8, .user-level.lv9 {
                background: linear-gradient(135deg, #ff0000, #ffb300, #ffff00, #00ff00, #00ffff, #0000ff, #8b00ff);
            }

            .user-header {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                text-align: center;
                margin-bottom: 10px;
            }

            .user-vip-label {
                font-size: 16px;
                background: var(--color-primary);
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                vertical-align: middle;
            }

            .user-id-text {
                text-align: center;
                font-size: 16px;
                color: var(--color-subtext);
                margin-top: 4px;
                font-family: monospace;
            }

            .user-medal {
                margin-top: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .user-medal-badge {
                display: inline-flex;
                border: 1px solid var(--color-subtext);
                border-radius: 4px;
                overflow: hidden;
            }

            .user-medal-name {
                background: var(--color-subtext);
                color: var(--color-card-bg);
                padding: 2px 6px;
                font-size: 16px;
                font-weight: bold;
            }

            .user-medal-level {
                background: var(--color-card-bg);
                color: var(--color-subtext);
                padding: 2px 6px;
                font-size: 16px;
            }

            .user-dynamic-section {
                margin-top: 35px;
                border-top: 1px solid var(--color-border);
                padding-top: 25px;
                text-align: left;
            }

            .user-dynamic-title {
                font-size: 20px;
                color: var(--color-subtext);
                margin-bottom: 12px;
                font-weight: bold;
            }

            .user-dynamic-text {
                font-size: 24px;
                color: var(--color-text);
                line-height: 1.6;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 4;
                -webkit-box-orient: vertical;
            }

            .user-dynamic-images {
                display: flex;
                gap: 12px;
                margin-top: 20px;
                overflow: hidden;
                height: 180px;
            }

            .user-dynamic-image {
                height: 180px;
                width: 180px;
                object-fit: cover;
                object-position: top;
                border-radius: 8px;
            }

            .user-dynamic-video {
                margin-top: 20px;
                display: flex;
                gap: 16px;
                background: var(--color-soft-bg);
                border-radius: 12px;
                padding: 12px;
                align-items: center;
            }

            .user-dynamic-video-cover {
                height: 90px;
                width: 144px;
                object-fit: cover;
                border-radius: 8px;
            }

            .user-dynamic-video-title {
                flex: 1;
                font-size: 20px;
                color: var(--color-text);
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                line-height: 1.4;
            }

            .pub-time {
                font-size: 20px;
                color: var(--color-subtext);
                font-weight: 400;
            }

            .decoration-card-wrapper {
                position: relative;
                display: inline-block;
            }

            .decoration-card {
                height: 96px;
                width: auto;
                object-fit: contain;
                margin: 0;
                filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
            }

            .serial-badge {
                position: absolute;
                top: 50%;
                left: 80px;
                transform: translateY(-50%);
                font-weight: 700;
                font-size: 26px;
            }


            .decorate-bg {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 160px;
                border-radius: var(--radius-lg) var(--radius-lg) 0 0;
                overflow: hidden;
            }

            .decorate-bg img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                filter: blur(3px);
                transform: scale(1.1);
            }

            .decorate-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 160px;
                border-radius: var(--radius-lg) var(--radius-lg) 0 0;
                background: linear-gradient(to bottom, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0));
            }

            .title {
                font-size: 42px;
                font-weight: 700;
                margin-bottom: 16px;
                color: var(--color-text);
                max-height: 1800px;
                line-height: 1.5;
                letter-spacing: 0.5px;
            }
            .status-line {
                margin-top: 8px;
                margin-bottom: 12px;
                font-size: 22px;
                color: var(--color-subtext);
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .status-prefix { white-space: nowrap; }
            .status-meta { white-space: nowrap; }

            .text-content {
                font-size: 30px;
                color: var(--color-text);
                line-height: 1.75;
                margin-top: 20px;
                margin-bottom: 18px;
                white-space: pre-wrap;
                word-wrap: break-word;
                text-align: left;
                max-height: 800px;
                overflow: hidden;
                position: relative;
            }

            .text-content.user-sign {
                text-align: center;
                margin-top: 16px;
                margin-bottom: 18px;
                color: var(--color-subtext);
                font-size: 18px;
                line-height: 1.5;
                padding: 0 20px;
            }
            .text-content img {
                max-width: 100%;
                height: auto;
                border-radius: var(--radius-sm);
            }
            .text-content.truncated::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 120px;
                background: linear-gradient(to bottom, transparent, var(--color-card-bg));
                pointer-events: none;
            }

            /* Article Mode Specifics */
            .container.article-mode .card {
                max-width: none;
                margin: 0;
            }

            .article-cover-container {
                margin: 0 0 20px 0;
                overflow: hidden;
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-sm);
            }

            .article-excerpt {
                margin-top: 16px;
                margin-bottom: 24px;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
                line-height: 1.75;
                max-height: calc(1.75em * 3);
                position: relative;
            }

            .article-excerpt.truncated::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 72px;
                background: linear-gradient(to bottom, transparent, var(--color-card-bg));
                pointer-events: none;
            }

            .article-body {
                font-size: 30px;
                color: var(--color-text);
                line-height: 1.8;
                margin-top: 24px;
                margin-bottom: 24px;
                word-wrap: break-word;
                text-align: left;
                max-height: 3000px;
                overflow: hidden;
                position: relative;
            }
            .article-body.truncated::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 160px;
                background: linear-gradient(to bottom, transparent, var(--color-card-bg));
                pointer-events: none;
            }
            .article-body img {
                max-width: 100%;
                height: auto;
                border-radius: var(--radius-md);
                margin: 20px 0;
                display: block;
                box-shadow: var(--shadow-sm);
            }
            .article-body figure {
                margin: 20px 0;
                width: 100%;
            }
            .article-body figure.img-box {
                margin: 20px 0;
                width: 100%;
            }
            .article-body figure.img-box img {
                width: 100%;
                max-width: 100%;
                height: auto;
                margin: 0;
                display: block;
            }
            .article-body p {
                margin-bottom: 24px;
            }
            .article-body h1 {
                font-size: 1.6em;
                font-weight: 700;
                margin: 40px 0 24px;
                line-height: 1.3;
                border-bottom: 2px solid var(--color-border);
                padding-bottom: 16px;
            }
            .article-body h2 {
                font-size: 1.4em;
                font-weight: 700;
                margin: 36px 0 20px;
                line-height: 1.3;
                border-left: 6px solid var(--color-primary);
                padding-left: 16px;
            }
            .article-body h3 {
                font-size: 1.25em;
                font-weight: 700;
                margin: 28px 0 16px;
            }
            .article-body blockquote {
                background: var(--color-soft-bg);
                border-left: 6px solid var(--color-subtext);
                margin: 24px 0;
                padding: 20px 24px;
                color: var(--color-subtext);
                border-radius: var(--radius-sm);
            }
            .article-body pre {
                background: var(--color-soft-bg-2);
                padding: 20px;
                border-radius: var(--radius-md);
                overflow-x: auto;
                font-family: monospace;
                margin: 24px 0;
                font-size: 0.9em;
            }
            .article-body ul, .article-body ol {
                padding-left: 40px;
                margin-bottom: 24px;
            }
            .article-body li {
                margin-bottom: 12px;
            }
            .article-body a {
                color: var(--color-secondary);
                text-decoration: none;
                border-bottom: 1px dashed var(--color-secondary);
            }
            /* Bilibili specific cleanups */
            .article-body .cut-off-5 { display: none; }
            .article-body .img-caption {
                font-size: 24px;
                color: var(--color-subtext);
                text-align: center;
                margin-top: -10px;
                margin-bottom: 24px;
            }

            .article-stats {
                margin-top: 20px;
                padding-top: 20px;
                border-top: 1px solid var(--color-border);
            }

            .orig-card {
                margin-top: 16px;
                border: 2px solid var(--color-border);
                background: var(--color-card-bg);
                border-radius: var(--radius-lg);
                overflow: hidden;
                box-shadow: var(--shadow-sm);
            }

            .orig-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px;
                border-bottom: 2px solid var(--color-border);
                background: var(--color-soft-bg);
            }

            .avatar-wrapper--orig {
                width: 56px;
                height: 56px;
                margin-right: 0;
                flex-shrink: 0;
                --verify-size: 20px;
                --verify-right: -2px;
                --verify-bottom: -2px;
            }

            .orig-author-avatar {
                width: 100%;
                height: 100%;
                border-radius: 50%;
                box-shadow: var(--shadow-sm);
                display: block;
            }

            .orig-author-meta {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 0;
            }

            .orig-author-name {
                font-weight: 700;
                font-size: 20px;
                color: var(--color-text);
                line-height: 1.35;
            }

            .orig-pub-time {
                font-size: 16px;
                color: var(--color-subtext);
                font-weight: 400;
            }

            .orig-content { padding: 16px; }
            .orig-content > :first-child.embedded-resource-card {
                margin-top: 0;
            }

            .orig-title {
                font-size: 22px;
                font-weight: 700;
                color: var(--color-text);
                margin-bottom: 10px;
                line-height: 1.4;
            }

            .orig-text {
                font-size: 20px;
                color: var(--color-subtext);
                line-height: 1.7;
                white-space: pre-wrap;
                max-height: 800px;
                overflow: hidden;
                position: relative;
            }
            .orig-text.truncated::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 120px;
                background: linear-gradient(to bottom, transparent, var(--color-card-bg));
                pointer-events: none;
            }

            .stats {
                display: flex;
                gap: 24px;
                font-size: 26px;
                color: var(--color-subtext);
                align-items: center;
                margin: 16px 0 12px 0;
                width: 100%;
            }

            .user-stats {
                display: flex;
                justify-content: center;
                gap: 40px;
                margin: 30px auto 0 auto;
                padding: 20px 40px;
                background: rgba(240, 242, 245, 0.78);
                border-radius: 12px;
                width: fit-content;
            }

            .theme-dark .user-stats {
                background: rgba(18, 22, 27, 0.72);
            }

            .user-stat-item {
                text-align: center;
            }

            .user-stat-value {
                font-size: 24px;
                font-weight: bold;
                color: var(--color-text);
                margin-bottom: 4px;
            }

            .user-stat-label {
                font-size: 16px;
                color: var(--color-subtext);
            }

            .video-stats {
                background: transparent;
            }

            .theme-dark .video-stats {
                background: transparent;
            }

            .action-bar {
                display: flex;
                align-items: center;
                gap: 48px;
                margin-top: 20px;
                padding-top: 20px;
                border-top: 1px solid var(--color-border);
                width: 100%;
            }

            .action-item {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 26px;
                color: var(--color-subtext);
                font-weight: 500;
            }

            .action-item svg {
                width: 32px;
                height: 32px;
                fill: var(--color-subtext);
                opacity: 0.85;
            }

            .stat-item {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 600;
                color: var(--color-subtext);
                white-space: nowrap;
            }

            .stat-item svg {
                fill: var(--color-subtext);
                width: 30px;
                height: 30px;
            }

            .globe-icon {
                width: 24px;
                height: 24px;
                vertical-align: middle;
            }

            .images-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                margin-top: 20px;
            }
            .images-grid.cols-2 {
                grid-template-columns: repeat(2, 1fr);
            }

            .images-grid.is-orig {
                margin-top: 10px;
            }

            .image-item {
                position: relative;
                width: 100%;
                overflow: hidden;
                border-radius: var(--radius-md);
            }

            .images-grid .image-item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                object-position: top;
                aspect-ratio: 1/1;
                cursor: pointer;
                transition: transform 0.2s;
                box-shadow: var(--shadow-sm);
            }

            .image-type-badge {
                position: absolute;
                right: 8px;
                bottom: 8px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 50px;
                height: 31px;
                padding: 0 13px;
                border-radius: var(--radius-sm);
                background: rgba(0, 0, 0, 0.52);
                color: rgba(255, 255, 255, 0.98);
                font-size: 21px;
                font-weight: 600;
                line-height: 1;
                letter-spacing: 0.02em;
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
            }

            .single-image {
                margin-top: 20px;
                width: 100%;
                max-height: 1500px;
                object-fit: cover;
                object-position: top;
                border-radius: var(--radius-lg);
                display: block;
                box-shadow: var(--shadow-md);
            }

            .single-image.is-orig {
                margin-top: 10px;
            }

            .dynamic-image {
                margin-top: 20px;
                width: 100%;
                max-height: 1500px;
                object-fit: cover;
                object-position: top;
                border-radius: var(--radius-lg);
                display: block;
                box-shadow: var(--shadow-md);
            }

            .live-badge-status {
                display: inline-block;
                padding: 4px 12px;
                border-radius: var(--radius-md);
                font-size: 14px;
                font-weight: 700;
                margin-left: 10px;
                vertical-align: middle;
                transform: translateY(-1px);
            }

            .live-badge-status.live-badge-lg {
                font-size: 20px;
                padding: 6px 12px;
                margin-left: 10px;
            }

            .live-on {
                background: linear-gradient(135deg, var(--color-emphasis), ${adjustBrightness('#FF6699', -10)});
                color: white;
                box-shadow: var(--shadow-sm);
            }

            .live-off {
                background: var(--color-soft-bg-2);
                color: var(--color-subtext);
            }

            .video-tag {
                background: var(--color-soft-bg);
                color: var(--color-subtext);
                padding: 4px 10px;
                border-radius: var(--radius-sm);
                font-size: 14px;
                margin-right: 8px;
                vertical-align: middle;
                font-weight: 500;
            }

            .duration-badge {
                position: absolute;
                bottom: 8px;
                right: 8px;
                background: rgba(0, 0, 0, 0.65);
                color: white;
                padding: 4px 10px;
                border-radius: 6px;
                font-size: 20px;
                font-weight: 500;
                backdrop-filter: blur(4px);
            }

            /* Rich Text & Special Content */
            .emoji {
                width: 1.15em;
                height: 1.15em;
                vertical-align: -0.18em;
                margin: 0 0.08em;
                display: inline-block;
            }

            .at-user {
                color: var(--color-secondary);
                font-weight: 700;
                margin: 0 2px;
                cursor: pointer;
            }

            .topic-tag {
                color: var(--color-secondary);
                margin: 0 2px;
                font-weight: 700;
            }

            .rich-link {
                color: var(--color-secondary);
                text-decoration: none;
                cursor: pointer;
            }

            .external-link {
                overflow-wrap: anywhere;
            }

            .rt-link-inline {
                display: inline;
                color: var(--color-secondary);
                font-weight: 600;
                max-width: 100%;
            }

            .rt-link-icon {
                width: 1em;
                height: 1em;
                display: inline-block;
                margin-right: 0.12em;
                vertical-align: -0.12em;
            }

            .rt-link-icon-svg {
                width: 100%;
                height: 100%;
                display: block;
                fill: currentColor;
            }

            .rt-link-text {
                color: var(--color-secondary);
                word-break: break-all;
                vertical-align: baseline;
            }

            .vote-card {
                background: var(--color-soft-bg);
                border-radius: var(--radius-lg);
                padding: 20px;
                margin-top: 24px;
                border: 1px solid var(--color-border);
                box-shadow: var(--shadow-sm);
                width: 100%;
                box-sizing: border-box;
            }

            .vote-header {
                font-size: 24px;
                font-weight: 700;
                color: var(--color-text);
                margin-bottom: 16px;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .vote-icon {
                width: 28px;
                height: 28px;
                fill: var(--color-secondary);
            }

            .vote-footer {
                margin-top: 16px;
                display: flex;
                gap: 12px;
                font-size: 16px;
                color: var(--color-subtext);
                align-items: center;
            }

            .vote-type-text {
                font-weight: 500;
                color: var(--color-subtext);
            }

            .vote-options {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .vote-options.with-images {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
            }

            .vote-item {
                background: var(--color-card-bg);
                padding: 16px 20px;
                border-radius: var(--radius-md);
                font-size: 22px;
                color: var(--color-text);
                border: 1px solid var(--color-border);
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: background-color 0.2s;
            }

            .vote-item.has-image {
                flex-direction: column;
                padding: 12px;
                align-items: stretch;
                text-align: center;
            }

            .vote-stat-bar {
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                background: rgba(0, 161, 214, 0.1);
                z-index: 0;
                transition: width 0.5s ease;
            }

            .vote-item-content {
                position: relative;
                z-index: 1;
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
            }

            .vote-stat-text {
                font-size: 16px;
                color: var(--color-subtext);
                margin-left: 10px;
                font-weight: 500;
            }

            .vote-item-image {
                width: 100%;
                aspect-ratio: 1;
                border-radius: var(--radius-sm);
                overflow: hidden;
                margin-bottom: 10px;
            }

            .vote-item-image img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .vote-footer {
                margin-top: 16px;
                color: var(--color-subtext);
                font-size: 18px;
                display: flex;
                align-items: center;
                gap: 12px;
            }

             .vote-btn {
                 background: var(--color-emphasis);
                 color: white;
                 padding: 8px 24px;
                 border-radius: var(--radius-md);
                 font-weight: 700;
                 font-size: 18px;
             }

            .vote-inline {
                color: var(--color-secondary);
                font-weight: 700;
                margin: 0 2px;
            }

            .embedded-resource-card {
                margin-top: 20px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                overflow: hidden;
                background: var(--color-card-bg);
                box-shadow: var(--shadow-sm);
            }
            .embedded-resource-card.no-cover .embedded-resource-body {
                background: var(--color-soft-bg);
            }
            .embedded-resource-card--compact {
                display: flex;
                align-items: stretch;
                gap: 14px;
                border-radius: var(--radius-md);
                height: 140px;
                min-height: 120px;
                max-height: 160px;
                overflow: hidden;
                background: var(--color-soft-bg);
            }
            .embedded-resource-card--compact .embedded-resource-body {
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 0;
                flex: 1;
                min-width: 0;
                padding: 12px 16px 12px 0;
                background: transparent;
            }
            .embedded-resource-cover {
                position: relative;
                width: 100%;
                background: var(--color-soft-bg);
            }
            .embedded-resource-cover-img {
                width: 100%;
                aspect-ratio: 16 / 9;
                object-fit: cover;
                display: block;
                max-height: 820px;
            }
            .embedded-resource-badge {
                position: absolute;
                left: 12px;
                top: 12px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-height: 30px;
                padding: 0 12px;
                border-radius: 999px;
                background: var(--embedded-resource-badge, var(--color-emphasis));
                color: #fff;
                font-size: 18px;
                font-weight: 700;
                line-height: 1;
                box-shadow: var(--shadow-sm);
            }
            .embedded-resource-badge--inline {
                position: static;
            }
            .embedded-resource-card--compact .embedded-resource-cover {
                display: flex;
                flex: 0 0 auto;
                width: auto;
                align-self: stretch;
                min-height: 120px;
                max-height: 160px;
                background: transparent;
            }
            .embedded-resource-card--compact .embedded-resource-cover-img {
                display: block;
                width: auto;
                height: 100%;
                aspect-ratio: auto;
                border-radius: 12px;
                background: transparent;
            }
            .embedded-resource-card--compact .embedded-resource-badge:not(.embedded-resource-badge--inline) {
                display: none;
            }
            .embedded-resource-card--compact .embedded-resource-meta-row {
                margin-bottom: 4px;
            }
            .embedded-resource-card--compact .embedded-resource-badge--inline {
                display: inline-block;
                align-self: flex-start;
                min-height: 0;
                padding: 0;
                border: 0;
                border-radius: 0;
                background: transparent;
                color: color-mix(in srgb, var(--color-text) 35%, var(--color-subtext) 65%);
                font-size: 16px;
                font-weight: 500;
                letter-spacing: 0;
                line-height: 1.2;
                box-shadow: none;
            }
            .embedded-resource-card--compact.no-cover .embedded-resource-body {
                padding-left: 16px;
            }
            .embedded-resource-body {
                padding: 14px 16px 16px;
                background: var(--color-soft-bg);
            }
            .embedded-resource-meta-row {
                display: flex;
                align-items: center;
                margin-bottom: 10px;
            }
            .embedded-resource-main {
                min-width: 0;
                width: 100%;
            }
            .embedded-resource-card--compact .embedded-resource-main {
                display: flex;
                flex-direction: column;
                justify-content: center;
            }
            .embedded-resource-subtitle {
                font-size: 18px;
                color: var(--color-subtext);
                margin-bottom: 8px;
                line-height: 1.4;
            }
            .embedded-resource-title {
                font-size: 24px;
                font-weight: 700;
                color: var(--color-text);
                line-height: 1.45;
                word-break: break-word;
            }
            .embedded-resource-stats {
                display: flex;
                flex-wrap: wrap;
                gap: 16px;
                margin-top: 10px;
                color: var(--color-subtext);
            }
            .embedded-resource-stat {
                font-size: 18px;
                font-weight: 600;
                white-space: nowrap;
            }
            .embedded-resource-desc {
                margin-top: 10px;
                font-size: 18px;
                color: var(--color-subtext);
                line-height: 1.6;
                white-space: pre-wrap;
            }
            .embedded-resource-card--compact .embedded-resource-subtitle {
                font-size: 16px;
                margin-bottom: 0;
                color: var(--color-subtext);
                line-height: 1.25;
                display: -webkit-box;
                -webkit-line-clamp: 1;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .embedded-resource-card--compact .embedded-resource-title {
                font-size: 24px;
                margin-bottom: 3px;
                line-height: 1.3;
                display: -webkit-box;
                -webkit-line-clamp: 1;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .embedded-resource-card--compact .embedded-resource-stats {
                margin-top: 4px;
                gap: 8px;
            }
            .embedded-resource-card--compact .embedded-resource-stat {
                font-size: 16px;
                line-height: 1.25;
            }
            .embedded-resource-card--compact .embedded-resource-desc {
                margin-top: 3px;
                font-size: 16px;
                line-height: 1.25;
                display: -webkit-box;
                -webkit-line-clamp: 1;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }

            .opus-link-card {
                margin-top: 20px;
                display: flex;
                align-items: stretch;
                gap: 14px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                height: 140px;
                overflow: hidden;
                background: var(--color-soft-bg);
                box-shadow: var(--shadow-sm);
                min-height: 120px;
                max-height: 160px;
            }
            .opus-link-card--no-cover .opus-link-card-body {
                padding-left: 16px;
            }
            .opus-link-card-cover {
                display: flex;
                flex: 0 0 auto;
                align-self: stretch;
                background: transparent;
            }
            .opus-link-card-cover-img {
                display: block;
                width: auto;
                height: 100%;
                aspect-ratio: auto;
                border-radius: 12px;
                background: transparent;
            }
            .opus-link-card-body {
                display: flex;
                flex: 1;
                min-width: 0;
                flex-direction: column;
                justify-content: center;
                gap: 0;
                padding: 12px 14px 12px 0;
                background: transparent;
            }
            .opus-link-card-title {
                font-size: 19px;
                font-weight: 700;
                color: var(--color-text);
                line-height: 1.3;
                word-break: break-word;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .opus-link-card-meta {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-top: 8px;
                color: var(--color-subtext);
                font-size: 14px;
            }
            .opus-link-card-stats {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                margin-top: 8px;
                color: var(--color-subtext);
            }
            .opus-link-card-stat {
                font-size: 14px;
                font-weight: 600;
                color: inherit;
                white-space: nowrap;
            }
            .opus-link-card-desc {
                margin-top: 6px;
                font-size: 14px;
                color: var(--color-subtext);
                line-height: 1.35;
                white-space: pre-wrap;
                display: -webkit-box;
                -webkit-line-clamp: 1;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }

            .video-card-inline {
                margin-top: 20px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                overflow: hidden;
                background: var(--color-card-bg);
            }
            .video-card-cover {
                width: 100%;
                aspect-ratio: 16/9;
                object-fit: cover;
                max-height: 800px;
            }
            .video-card-content {
                padding: 12px;
                background: var(--color-soft-bg);
            }
            .video-card-title {
                font-weight: bold;
                font-size: 26px;
                margin-bottom: 8px;
                color: var(--color-text);
                line-height: 1.4;
            }
            .stat-inline-container {
                color: var(--color-subtext);
                font-size: 22px;
                display: flex;
                gap: 20px;
                align-items: center;
                margin-top: 8px;
            }
            .stat-inline {
                display: flex;
                align-items: center;
                gap: 6px;
                white-space: nowrap;
            }
            .stat-inline svg {
                width: 24px;
                height: 24px;
                fill: var(--color-subtext);
            }

            .live-rcmd-card {
                margin-top: 20px;
                border: 1px solid var(--color-border);
                border-radius: 8px;
                overflow: hidden;
                background: var(--color-card-bg);
            }

            .live-rcmd-cover {
                width: 100%;
                aspect-ratio: 16/9;
                object-fit: cover;
                max-height: 800px;
            }

            .live-rcmd-badge-wrap {
                position: absolute;
                top: 10px;
                right: 10px;
            }

            .live-rcmd-content {
                padding: 15px;
                background: var(--color-soft-bg);
            }

            .live-rcmd-title {
                font-weight: 700;
                font-size: 26px;
                margin-bottom: 8px;
                line-height: 1.4;
                color: var(--color-text);
            }

            .live-rcmd-meta {
                color: var(--color-subtext);
                font-size: 22px;
                display: flex;
                gap: 20px;
            }

            .live-header-name-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .header-right {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .serial-badge {
                color: var(--serial-color, var(--color-subtext));
            }

            /* 外部平台（抖音 / 小红书）预览卡专属样式 */
            .cover-badge {
                position: absolute;
                top: 16px;
                right: 16px;
                padding: 6px 16px;
                font-size: 20px;
                font-weight: 700;
                color: #fff;
                background: rgba(0, 0, 0, 0.55);
                border-radius: var(--radius-md);
                z-index: 2;
            }

            .user-signature {
                font-size: 20px;
                color: var(--color-subtext);
                line-height: 1.35;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }

            /* 图集 2×2 网格（抖音图集 / Live Photo / 小红书笔记共用） */
            .note-image-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
                margin-top: 20px;
                position: relative;
            }

            .note-thumb {
                width: 100%;
                aspect-ratio: 1;
                object-fit: cover;
                border-radius: var(--radius-md);
                display: block;
            }

            .note-thumb.live-photo {
                border: 2px solid var(--color-border);
            }

            .note-more {
                position: absolute;
                right: 12px;
                bottom: 12px;
                padding: 4px 14px;
                font-size: 22px;
                font-weight: 700;
                color: #fff;
                background: rgba(0, 0, 0, 0.6);
                border-radius: var(--radius-md);
            }

            .xhs-desc {
                font-size: 24px;
                color: var(--color-subtext);
                max-height: 200px;
            }
         </style>
     ` + (options.previewLayoutOverrideCss || '');
}

module.exports = {
    isNightMode,
    calculateViewport,
    getTypeConfig,
    calculateColors,
    getPreviewGradientBaseColors,
    getStaticPreviewGradientMix,
    buildGradientMixFromColors,
    generateCSS,
    adjustBrightness,
    hexToRgba
};
