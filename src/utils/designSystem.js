// 统一的设计系统配置
const DESIGN_SYSTEM = {
    // 统一字体配置
    typography: {
        title: '42px',           // 主标题
        subtitle: '28px',        // 副标题
        sectionTitle: '26px',    // 章节标题
        body: '24px',            // 正文
        caption: '20px',         // 说明文字
        small: '16px'            // 小字
    },
    
    // 统一圆角
    radius: {
        sm: '6px',
        md: '10px',
        lg: '18px',
        container: '20px'        // 容器统一使用20px
    },
    
    // 统一间距
    spacing: {
        container: '24px',       // 容器padding
        card: '28px',           // 卡片padding
        section: '28px',        // 章节间距
        item: '16px'            // 项目间距
    },
    
    // Type Badge配置
    typeBadge: {
        fontSize: '28px',
        padding: '16px 28px',
        gap: '12px',
        marginBottom: '20px',
        fontWeight: '700'
    },

    // 充电专属内容颜色
    charging: {
        gold:        '#FFB300',
        goldBg:      'rgba(255, 179, 0, 0.15)',
        goldBorder:  'rgba(255, 179, 0, 0.4)',
    }
};

const PREVIEW_FONT_FALLBACK_CHAIN = '"Noto Sans CJK SC", "Noto Sans Sinhala", "Noto Color Emoji", sans-serif'

function buildPreviewFontFamily(customFontFamilies = []) {
    const customFamilies = Array.isArray(customFontFamilies) ? customFontFamilies : []
    if (customFamilies.length === 0) return PREVIEW_FONT_FALLBACK_CHAIN
    return `${customFamilies.join(', ')}, ${PREVIEW_FONT_FALLBACK_CHAIN}`
}

// 统一的CSS生成函数
function generateUnifiedCSS(colorData, viewport, options = {}) {
    const {
        currentType,
        badgeColor,
        badgeBg,
        badgeTextColor,
        badgeShadow,
        badgeBorder,
        gradientMix,
        gradientAtmosphere = gradientMix,
        gradientContent = '',
        gradientOverlay = ''
    } = colorData;
    const { minWidth = 400, width = 1200 } = viewport;
    const { customFontsCss = '', customFontFamilies = [] } = options;

    return `
        <style>
            /* Custom Fonts */
            ${customFontsCss}

            /* 统一设计Token */
            :root {
                /* 调色板 - 浅色模式 */
                --color-bg: #F5F7FA;
                --color-card-bg: rgba(255, 255, 255, 0.75);
                --color-text: #1A1A1A;
                --color-subtext: #5A5F66;
                --color-border: rgba(0, 0, 0, 0.08);
                --color-soft-bg: #F0F2F5;
                --color-soft-bg-2: #EDEFF3;
                --gradient-mix: ${gradientMix};
                --gradient-atmosphere: ${gradientAtmosphere};
                --gradient-content: ${gradientContent || 'none'};
                --gradient-overlay: ${gradientOverlay || 'none'};

                /* 强调色 */
                --color-primary: ${currentType?.color || '#FB7299'};
                --color-secondary: #00A1D6;
                --color-emphasis: #FF6699;

                /* 统一圆角 */
                --radius-sm: ${DESIGN_SYSTEM.radius.sm};
                --radius-md: ${DESIGN_SYSTEM.radius.md};
                --radius-lg: ${DESIGN_SYSTEM.radius.lg};
                --radius-container: ${DESIGN_SYSTEM.radius.container};

                /* 统一阴影 */
                --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);
                --shadow-md: 0 6px 20px rgba(0, 0, 0, 0.10);
                --shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.14);
                --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);

                /* 统一字体大小 */
                --font-title: ${DESIGN_SYSTEM.typography.title};
                --font-subtitle: ${DESIGN_SYSTEM.typography.subtitle};
                --font-section-title: ${DESIGN_SYSTEM.typography.sectionTitle};
                --font-body: ${DESIGN_SYSTEM.typography.body};
                --font-caption: ${DESIGN_SYSTEM.typography.caption};
                --font-small: ${DESIGN_SYSTEM.typography.small};

                /* 统一间距 */
                --spacing-container: ${DESIGN_SYSTEM.spacing.container};
                --spacing-card: ${DESIGN_SYSTEM.spacing.card};
                --spacing-section: ${DESIGN_SYSTEM.spacing.section};
                --spacing-item: ${DESIGN_SYSTEM.spacing.item};
            }

            /* 深色主题 */
            .theme-dark {
                --color-bg: rgba(0, 0, 0, 0.85);
                --color-card-bg: rgba(23, 27, 33, 0.75);
                --color-text: #E8EAED;
                --color-subtext: #A8ADB4;
                --color-border: rgba(255, 255, 255, 0.08);
                --color-soft-bg: #12161B;
                --color-soft-bg-2: #0D1014;
                --color-primary: ${badgeColor || '#FB7299'};

                --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.60);
                --shadow-md: 0 6px 20px rgba(0, 0, 0, 0.65);
                --shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.70);
                --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
            }

            body {
                margin: 0;
                padding: 0;
                background: transparent;
                width: ${width}px;
                min-width: ${width}px;
                max-width: ${width}px;
                font-family: ${buildPreviewFontFamily(customFontFamilies)};
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }

            /* 统一容器样式 */
            .container {
                padding: var(--spacing-container);
                background: var(--color-bg);
                box-sizing: border-box;
                width: 100%;
                min-height: 300px;
                display: inline-flex;
                flex-direction: column;
                align-items: flex-start;
                border-radius: var(--radius-container);
                transition: background-color .3s ease;
            }

            /* 统一卡片样式 - 毛玻璃效果 */
            .card {
                position: relative;
                background: var(--color-card-bg);
                border-radius: var(--radius-lg);
                overflow: hidden;
                box-shadow: var(--shadow-card);
                border: 1px solid var(--color-border);
                transition: background-color .3s ease, box-shadow .3s ease, border-color .3s ease;
                backdrop-filter: blur(24px) saturate(180%);
                -webkit-backdrop-filter: blur(24px) saturate(180%);
                padding: var(--spacing-card);
                width: 100%;
                box-sizing: border-box;
            }

            /* 毛玻璃高光边框效果 */
            .card::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: var(--radius-lg);
                padding: 1px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%);
                -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                -webkit-mask-composite: xor;
                mask-composite: exclude;
                pointer-events: none;
            }

            .theme-dark .card::before {
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 50%, rgba(255, 255, 255, 0.02) 100%);
            }

            /* 统一渐变背景 - 增强版 */
            .container.gradient-bg { position: relative; }
            .container.gradient-bg::before {
                content: '';
                position: absolute;
                inset: 0;
                background: var(--gradient-atmosphere);
                z-index: 0;
                border-radius: var(--radius-container);
            }
            @supports (backdrop-filter: blur(2px)) {
                .container.gradient-bg::before {
                    backdrop-filter: blur(4px);
                }
            }
            .container.gradient-bg::after {
                content: '';
                position: absolute;
                inset: 0;
                background: var(--gradient-overlay), var(--gradient-content);
                z-index: 0;
                border-radius: var(--radius-container);
                pointer-events: none;
            }
            .container.gradient-bg > * {
                position: relative;
                z-index: 1;
            }

            /* 统一 Type Badge 样式 - 与卡片一致的毛玻璃效果 */
            .type-badge {
                display: inline-flex;
                align-items: center;
                gap: ${DESIGN_SYSTEM.typeBadge.gap};
                margin-bottom: ${DESIGN_SYSTEM.typeBadge.marginBottom};
                margin-left: 6px;
                background: ${badgeBg || 'var(--color-primary)'};
                color: ${badgeTextColor || '#fff'};
                padding: ${DESIGN_SYSTEM.typeBadge.padding};
                border-radius: var(--radius-lg);
                font-size: ${DESIGN_SYSTEM.typeBadge.fontSize};
                font-weight: ${DESIGN_SYSTEM.typeBadge.fontWeight};
                box-shadow: ${badgeShadow || 'var(--shadow-sm)'};
                border: ${badgeBorder || 'none'};
                text-shadow: ${colorData?.themeClass === 'theme-dark' ? 'none' : '0 2px 4px rgba(0, 0, 0, 0.2)'};
                letter-spacing: 1px;
                line-height: 1;
                backdrop-filter: blur(24px) saturate(180%);
                -webkit-backdrop-filter: blur(24px) saturate(180%);
                position: relative;
            }

            /* 标签高光边框效果 - 与卡片一致 */
            .type-badge::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: var(--radius-lg);
                padding: 1px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.15) 50%, rgba(255, 255, 255, 0.05) 100%);
                -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                -webkit-mask-composite: xor;
                mask-composite: exclude;
                pointer-events: none;
            }

            .theme-dark .type-badge::before {
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.02) 100%);
            }

            /* 抖音徽章：品牌底色偏深，图标反白与文字同色（emoji 不受 color 影响，用滤镜转白色剪影）；
               invert(0.88) 保留一点点灰，避免与纯白文字完全融为一体 */
            .type-badge--douyin .badge-icon {
                filter: brightness(0) invert(0.88);
            }

            /* 充电专属标记 */
            .charging-mark {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 1.2em;
                height: 1.2em;
                margin-left: 6px;
                font-size: 0.95em;
                line-height: 1;
                color: rgba(255, 255, 255, 0.96);
                text-shadow: none;
                transform: translateY(0);
            }

            /* 充电专属动态占位样式 */
            .charging-blocked-hint {
                padding: 24px 0 14px;
                color: var(--color-subtext);
                text-align: center;
                line-height: 1.7;
            }

            .charging-blocked-panel {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
                gap: 10px;
                width: 100%;
                max-width: 100%;
                aspect-ratio: 21 / 9;
                box-sizing: border-box;
                padding: 26px 34px;
                border-radius: var(--radius-lg);
                border: 1px solid var(--color-border);
                background: rgba(0, 0, 0, 0.045);
                box-shadow: var(--shadow-sm);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            }

            .charging-blocked-panel--with-bg {
                padding: 22px 28px;
                background: transparent;
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }

            .charging-blocked-bg {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .charging-blocked-bg--day {
                display: block;
            }

            .charging-blocked-bg--dark {
                display: none;
            }

            .theme-dark .charging-blocked-bg--day {
                display: none;
            }

            .theme-dark .charging-blocked-bg--dark {
                display: block;
            }

            .charging-blocked-overlay {
                position: absolute;
                inset: 0;
                background: rgba(255, 255, 255, 0.45);
            }

            .theme-dark .charging-blocked-overlay {
                background: rgba(0, 0, 0, 0.5);
            }

            .charging-blocked-text {
                position: relative;
                z-index: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 8px;
                width: min(92%, 780px);
                padding: 8px 10px;
            }

            .theme-dark .charging-blocked-panel {
                background: rgba(255, 255, 255, 0.08);
            }

            .charging-blocked-hint p {
                margin: 0;
                font-size: calc(var(--font-caption) + 5px);
                font-weight: 560;
                line-height: 1.55;
                color: rgba(33, 38, 45, 0.92);
                text-shadow: 0 1px 2px rgba(255, 255, 255, 0.2);
            }

            .charging-blocked-hint p:first-child {
                font-size: calc(var(--font-caption) + 7px);
                font-weight: 650;
            }

            .theme-dark .charging-blocked-hint p {
                color: rgba(255, 255, 255, 0.93);
                text-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
            }

            /* 统一标题样式 */
            .page-title {
                font-size: var(--font-title);
                font-weight: 800;
                background: linear-gradient(135deg, #FB7299, #FF6699);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 8px;
                letter-spacing: 1px;
                text-align: center;
            }

            .page-subtitle {
                font-size: var(--font-subtitle);
                color: var(--color-subtext);
                font-weight: 500;
                text-align: center;
            }

            /* 统一章节标题 */
            .section {
                margin-bottom: var(--spacing-section);
            }

            .section-title {
                font-size: var(--font-section-title);
                font-weight: 700;
                color: var(--color-text);
                margin-bottom: var(--spacing-item);
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .section-title::before {
                content: '';
                display: block;
                width: 5px;
                height: 24px;
                background: linear-gradient(135deg, #00A1D6, #00B5E5);
                border-radius: 3px;
                box-shadow: 0 2px 8px rgba(0, 161, 214, 0.3);
            }

            /* 统一标题分隔线 */
            .header-divider {
                border-bottom: 2px solid var(--color-border);
                padding-bottom: 20px;
                margin-bottom: var(--spacing-section);
            }

            /* 统一数量徽章 */
            .count-badge {
                background: var(--color-primary);
                color: white;
                font-size: 12px;
                padding: 2px 8px;
                border-radius: 10px;
                font-weight: bold;
            }

            /* 统一页脚 */
            .footer {
                text-align: center;
                font-size: var(--font-small);
                color: var(--color-subtext);
                margin-top: 12px;
                font-weight: 400;
                opacity: 0.8;
            }
        </style>
    `;
}

// 统一的Type Badge渲染函数
function renderUnifiedTypeBadge(type, label, icon, isVisible = true) {
    if (!isVisible) return '';
    
    return `
        <div class="type-badge">
            <span>${icon}</span>
            <span>${label}</span>
        </div>
    `;
}

// 统一的页面头部渲染函数
function renderUnifiedHeader(title, subtitle = '', showDivider = true) {
    return `
        <div class="header ${showDivider ? 'header-divider' : ''}">
            <h1 class="page-title">${title}</h1>
            ${subtitle ? `<div class="page-subtitle">${subtitle}</div>` : ''}
        </div>
    `;
}

// 统一的页脚渲染函数
function renderUnifiedFooter(text, extraContent = '') {
    return `
        <div class="footer">
            ${extraContent}
            <div>${text}</div>
        </div>
    `;
}

// 导出统一配置
module.exports = {
    DESIGN_SYSTEM,
    buildPreviewFontFamily,
    generateUnifiedCSS,
    renderUnifiedTypeBadge,
    renderUnifiedHeader,
    renderUnifiedFooter
};
