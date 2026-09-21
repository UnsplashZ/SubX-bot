const browserManager = require('../core/browser');
const { isNightMode } = require('../core/theme');
const { getCustomFonts } = require('../core/formatters');
const { buildPreviewFontFamily, generateUnifiedCSS } = require('../../../utils/designSystem');

const LEGACY_LIGHT_GRADIENT = 'linear-gradient(135deg, #fef5f6 0%, #e8f5ff 50%, #f0f9ff 100%)';
const LEGACY_DARK_GRADIENT = 'linear-gradient(135deg, #1a1a1a 0%, #2c3e50 100%)';

/**
 * 生成帮助卡片图片
 * @param {String} type - 帮助类型 ('user' 或 'admin')
 * @param {String} groupId - 群组ID
 * @returns {Promise<String>} Base64编码的图片
 */
async function generateHelpCard(type = 'user', groupId) {
    return browserManager.withRetry(async () => {
        await browserManager.init();
        const page = await browserManager.createPage({
            width: 1000,
            height: 1500,
            deviceScaleFactor: 1.2
        });

        try {
            // Theme: auto switch by config
            const isNight = isNightMode(groupId);
            const themeClass = isNight ? 'theme-dark' : 'theme-light';

            const { css: customFontsCss, families: customFontFamilies } = getCustomFonts();

            // Unified Design System Integration
            const colorData = {
                themeClass,
                badgeColor: '#FB7299',
                gradientMix: isNight ? LEGACY_DARK_GRADIENT : LEGACY_LIGHT_GRADIENT,
                currentType: { label: type === 'user' ? '使用帮助' : '管理面板', color: '#FB7299', icon: type === 'user' ? '💡' : '⚙️' }
            };
            const viewport = { width: 1000, minWidth: 400 };
            const baseCss = generateUnifiedCSS(colorData, viewport, { customFontsCss, customFontFamilies });

    const style = `
        ${baseCss}
        <style>
            :root {
                --link-bg: linear-gradient(135deg, #f8f9fa 0%, #f4f6f8 100%);
                --link-text: #555;
                --cmd-item-bg: #fff;
                --cmd-item-border: #f0f0f0;
                --cmd-code-bg: linear-gradient(135deg, #FFF0F6, #FFE8F0);
                --cmd-code-color: #FB7299;
                --cmd-desc: #666;
                --footer-text: #bbb;
            }

            .theme-dark {
                --link-bg: #12161B;
                --link-text: #D1D5DB;
                --cmd-item-bg: #12161B;
                --cmd-item-border: rgba(255, 255, 255, 0.08);
                --cmd-code-bg: rgba(251, 114, 153, 0.15);
                --cmd-code-color: #FF6699;
                --cmd-desc: #B0B3B8;
                --footer-text: #8A8F99;
            }

            body {
                width: 1000px;
                font-family: ${buildPreviewFontFamily(customFontFamilies)};
            }

            .container {
                padding: 24px;
                box-sizing: border-box;
                width: 100%;
                display: inline-block;
                border-radius: var(--radius-container);
            }

            .card {
                background: var(--color-card-bg);
                border-radius: var(--radius-container);
                overflow: hidden;
                box-shadow: var(--shadow-card);
                border: 1px solid var(--color-border);
                padding: 28px;
                backdrop-filter: blur(24px) saturate(180%);
                -webkit-backdrop-filter: blur(24px) saturate(180%);
                position: relative;
            }

            .card::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: var(--radius-container);
                padding: 1px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%);
                -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                -webkit-mask-composite: xor;
                mask-composite: exclude;
                pointer-events: none;
            }

            .header {
                text-align: center;
                margin-bottom: 28px;
                border-bottom: 2px solid var(--cmd-item-border);
                padding-bottom: 20px;
            }

            .title {
                font-size: var(--font-title);
                font-weight: 800;
                background: linear-gradient(135deg, #FB7299, #FF6699);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 8px;
                letter-spacing: 1px;
            }

            .subtitle {
                font-size: 22px;
                color: var(--color-subtext);
                font-weight: 500;
            }

            .section {
                margin-bottom: 28px;
            }

            .section-title {
                font-size: 26px;
                font-weight: 700;
                color: var(--color-text);
                margin-bottom: 16px;
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

            .link-list {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }

            .link-item {
                background: var(--link-bg);
                padding: 12px 16px;
                border-radius: 12px;
                font-size: 20px;
                color: var(--link-text);
                display: flex;
                align-items: center;
                gap: 10px;
                transition: all 0.2s;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                font-weight: 500;
            }

            .icon {
                font-size: 26px;
            }

            .cmd-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .cmd-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: var(--cmd-item-bg);
                border: 2px solid var(--cmd-item-border);
                padding: 14px 18px;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
            }

            .cmd-code {
                font-family: 'Consolas', 'Monaco', monospace;
                font-weight: bold;
                color: var(--cmd-code-color);
                background: var(--cmd-code-bg);
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 20px;
            }

            .cmd-desc {
                font-size: 18px;
                color: var(--cmd-desc);
                font-weight: 500;
            }

            .cmd-tag {
                font-size: 12px;
                padding: 2px 6px;
                border-radius: 4px;
                margin-left: 8px;
                vertical-align: middle;
                font-weight: 600;
                letter-spacing: 0.5px;
                border: 1px solid transparent;
                background: transparent;
            }

            .tag-root {
                color: #FF6666;
                border-color: rgba(255, 100, 100, 0.4);
            }

            .tag-admin {
                color: #44AAFF;
                border-color: rgba(68, 170, 255, 0.4);
            }

            .theme-dark .tag-root {
                color: #FF8888;
                border-color: rgba(255, 136, 136, 0.4);
            }

            .theme-dark .tag-admin {
                color: #88DDFF;
                border-color: rgba(136, 221, 255, 0.4);
            }

            .footer {
                text-align: center;
                font-size: 16px;
                color: var(--footer-text);
                margin-top: 12px;
                font-weight: 400;
            }
        </style>
    `;

    let contentHtml = '';
    let title = 'SubX Bot';
    let subtitle = '全能 B 站链接解析 & 订阅助手';

    if (type === 'user') {
        contentHtml = `
            <div class="section">
                <div class="section-title">用户指令</div>
                <div class="cmd-list">
                    <div class="cmd-item">
                        <span class="cmd-code">发送 B 站链接</span>
                        <span class="cmd-desc">解析视频/动态/直播等内容</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/订阅列表</span>
                        <span class="cmd-desc">查看本群订阅 & 账户关注</span>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">管理指令<span class="cmd-tag tag-admin">群管</span></div>
                <div class="cmd-list">
                    <div class="cmd-item">
                        <span class="cmd-code">/订阅用户 &lt;uid&gt;</span>
                        <span class="cmd-desc">订阅用户（动态+直播）</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/订阅番剧 &lt;season_id&gt;</span>
                        <span class="cmd-desc">订阅番剧新剧集更新</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/取消订阅用户 &lt;uid&gt;</span>
                        <span class="cmd-desc">取消用户订阅</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/取消订阅番剧 &lt;season_id&gt;</span>
                        <span class="cmd-desc">取消番剧订阅</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/查询订阅 &lt;uid|用户名&gt;</span>
                        <span class="cmd-desc">立即检查某用户动态</span>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">控制面板</div>
                <div class="cmd-list">
                    <div class="cmd-item">
                        <span class="cmd-code">/菜单</span>
                        <span class="cmd-desc">显示用户帮助菜单</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 帮助</span>
                        <span class="cmd-desc">显示管理配置面板</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/管理 帮助</span>
                        <span class="cmd-desc">显示管理指令说明</span>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">支持解析</div>
                <div class="link-list">
                    <div class="link-item"><span class="icon">📺</span> 视频 (BV/av)</div>
                    <div class="link-item"><span class="icon">🎬</span> 番剧 (ss/ep)</div>
                    <div class="link-item"><span class="icon">📰</span> 专栏文章 (cv)</div>
                    <div class="link-item"><span class="icon">📡</span> 直播间 (live)</div>
                    <div class="link-item"><span class="icon">📱</span> 动态 (dynamic)</div>
                    <div class="link-item"><span class="icon">🖼️</span> Opus图文</div>
                    <div class="link-item"><span class="icon">⭐</span> 收藏夹 / 文集 / 合集</div>
                    <div class="link-item"><span class="icon">🎵</span> 音频 / 歌单 / 话题</div>
                    <div class="link-item"><span class="icon">📝</span> 笔记 / 课程 / 互动视频</div>
                    <div class="link-item"><span class="icon">🔗</span> 短链 (b23.tv)</div>
                    <div class="link-item"><span class="icon">📦</span> 小程序分享</div>
                </div>
            </div>
        `;
    } else if (type === 'admin') {
        title = '管理面板';
        subtitle = '系统配置与权限管理';
        contentHtml = `
            <div class="section">
                <div class="section-title">管理员菜单<span class="cmd-tag tag-admin">群管</span></div>
                <div class="cmd-list">
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 功能 &lt;开|关&gt;</span>
                        <span class="cmd-desc">开关Bot权限</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 关注同步 &lt;开|关&gt;</span>
                        <span class="cmd-desc">开启/关闭关注同步功能</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 关注同步 &lt;添加|删除&gt; &lt;分组&gt;</span>
                        <span class="cmd-desc">管理同步的 B 站关注分组</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 推送AT全体 &lt;开|关&gt;</span>
                        <span class="cmd-desc">订阅/同步推送时 @全体成员</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 黑名单 &lt;操作&gt;</span>
                        <span class="cmd-desc">管理/查看黑名单</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 标签 &lt;操作&gt;</span>
                        <span class="cmd-desc">设置解析标签</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 深色模式</span>
                        <span class="cmd-desc">配置深色模式</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 冷却 &lt;秒数&gt;</span>
                        <span class="cmd-desc">设置相同链接解析冷却</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 显示UID &lt;开|关&gt;</span>
                        <span class="cmd-desc">开关订阅列表UID</span>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">系统菜单<span class="cmd-tag tag-root">Root</span></div>
                <div class="cmd-list">
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 登录</span>
                        <span class="cmd-desc">获取二维码 (支持自动验证)</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 验证 &lt;key&gt;</span>
                        <span class="cmd-desc">手动验证登录状态 (超时可用)</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/管理 &lt;群列表|清理&gt;</span>
                        <span class="cmd-desc">查看状态或清理群数据</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 管理员 &lt;添加|移除&gt;</span>
                        <span class="cmd-desc">设置本群管理员</span>
                    </div>
                    <div class="cmd-item">
                        <span class="cmd-code">/设置 轮询 &lt;秒数&gt;</span>
                        <span class="cmd-desc">设置轮询间隔</span>
                    </div>
                </div>
            </div>
        `;
    }

    const html = `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        ${style}
    </head>
    <body class="${themeClass}">
        <div class="container" style="background: ${colorData.gradientMix}">
            <div class="card">
                <div class="header">
                    <div class="title">${title}</div>
                    <div class="subtitle">${subtitle}</div>
                </div>

                ${contentHtml}

                <div class="footer" style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                    <div style="font-size: 14px; opacity: 0.8; font-weight: normal;">输入指令（不带参数）即可获取指令帮助</div>
                    <div style="font-size: 14px; font-weight: normal;">Powered by SubX</div>
                </div>
            </div>
        </div>
    </body>
    </html>`;

    await page.setContent(html);
    const container = await page.$('.container');
    const buffer = await container.screenshot({
        type: 'png',
        omitBackground: true
    });

        return buffer.toString('base64');
    } catch (error) {
        throw error;
    } finally {
        // 确保页面在任何情况下都会被关闭
        await browserManager.closePage(page);
    }
});
}

module.exports = { generateHelpCard };
