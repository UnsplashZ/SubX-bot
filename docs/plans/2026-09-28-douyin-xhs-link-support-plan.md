# 抖音与小红书链接解析接入方案

## 上下文

SubX Bot 当前只处理 B 站域名（`bilibili.com`、`b23.tv`）的链接。整条链路从域名门控
到短链展开、正则解析、数据抓取、预览卡生成、媒体投递，均已抽象为插件式结构，通过
`linkRegistry` 注册 handler 即可扩展新平台。本方案在不改动现有 B 站处理逻辑的前提下，
接入抖音（Douyin）和小红书（XiaoHongShu）的链接解析与媒体投递。

参考实现：`/Users/zheng/dev/Github/nonebot-plugin-parser`（Python）

---

## 一、可行性与风险评估

### 接口可用性（2026-09-28 验证）

| 能力 | 接口/路径 | 状态 |
|---|---|---|
| 抖音作品详情 | `GET /aweme/v1/web/aweme/detail/?aweme_id=&aid=6383` | HTTP 200，无签名 |
| 抖音普通视频播放地址 | `https://aweme.snssdk.com/aweme/v1/play/?video_id={uri}&ratio=1080p&line=0` | 200 video/mp4 |
| 抖音 Live Photo 图集 | 同上 detail 接口，images[] + clip_type | 正常返回 |
| 小红书 Explore HTML | `GET /explore/{id}?xsec_token=...` | HTML + `window.__INITIAL_STATE__` |
| 小红书 Discovery HTML | `GET /discovery/item/{id}?xsec_token=...` | 同上，回退路径 |

两个平台均为**非契约性网页接口**，需将接口失效和风控触发视为正常异常路径，而非
代码 bug。

### 主要风险

1. 抖音接口可能随时要求 Cookie 或 `X-Bogus` 签名，导致整个平台失效
2. 小红书 `xsec_token` 参数由分享链接携带，Bot 侧无法自行生成；若平台撤销 token，
   则该笔记无法访问
3. 抖音 CDN URL 有 TTL（通常数小时到数天），不能长期缓存最终播放地址
4. QQ Official 在 `file_data` 模式下将本地 MP4 整体 Base64，大文件内存压力显著
5. Live Photo 多组下载会延长响应时间，必须受并发上限和总大小限制约束

---

## 二、架构决策

### 数据抓取层位置

抖音和小红书的抓取**留在 Node.js 侧**，不进入 Python 服务（`bili_server_core`）。
理由：Python 服务的定位是 B 站 API 后端，扩展它会污染其单一职责，且 Node 22 原生
`fetch` / `https` 模块已足够完成简单的 HTTP 请求和 HTML 解析。

### Handler 契约复用

每个 handler 实现以下接口，与现有 B 站 handler 一致：

```js
module.exports = {
    type: 'douyin_video',          // 注册到 linkRegistry 的键
    fetch(groupId, descriptor),    // 返回 { status, data, type }
    buildUrl(descriptor, info),    // 生成原始分享链接（降级文本用）
    resolveCardType(info),         // 返回 cardType 字符串，传给 renderContentHtml
    getCacheIdentity(descriptor),  // 可选：决定 cache key 的唯一 ID
    afterSend(context),            // 可选：预览卡发送后投递媒体
}
```

### 预览卡渲染

新增两个 renderer，通过 `renderContentHtml` 的 if/else 链接入，未匹配则已经
有 `renderGenericContent` 兜底。平台专属 renderer 的意义：

- 显示正确的类型标签（抖音视频 / 抖音图集 / 抖音 Live Photo / 小红书视频 / 小红书笔记）
- 图集排布：最多显示 4 张缩略图组成的 2×2 网格，并标注总数
- 不展示 B 站统计栏（播放量、点赞、评论）

### 媒体投递

现有 `videoDownloadService._sendForwardMessage` 的功能已足够（NapCat 路径转换、
Official 文件上传、私聊/群聊路由），但它目前对外暴露的是 `downloadAndSend(bvid)`
这一 B 站专用入口。

方案：**新建 `externalMediaDeliveryService.js`**，封装相同的发送逻辑（复制
`_sendForwardMessage` 的核心部分），并提供一个与 B 站下载服务平行的、通用的
`deliverMediaFile(ws, groupId, filePath, label)` 接口。不修改
`videoDownloadService.js`，避免引入耦合。

### 配置

在 `schemaV1.js` 的顶层配置中新增 `externalParsers` 节点，各平台默认关闭，
管理员通过 Dashboard 或 YAML 按需开启。抖音的视频下载配置内嵌于
`externalParsers.douyin` 节点（而非独立 `douyinDownload` 节点），独立于现有
B 站 `videoDownload` 节点，避免互相影响。

Handler 中的配置访问统一使用直接属性路径，例如：
`config.externalParsers?.douyin?.enabled`。`config` 对象没有 `getSystemConfig()`
方法，顶层节点通过直接属性访问，这与现有 `config.videoDownload?.enabled` 的访问
模式一致。若需要兼容平铺访问，在 `FLAT_KEY_TO_PATH` 里加映射即可，但新增代码
应优先使用嵌套路径访问。

---

## 三、文件清单

### 新增文件

| 路径 | 职责 |
|---|---|
| `src/services/externalParsers/douyinService.js` | 抖音 HTTP 抓取与数据标准化 |
| `src/services/externalParsers/xiaohongshuService.js` | 小红书 HTML 抓取与数据标准化 |
| `src/services/externalParsers/externalShortLinkExpander.js` | 抖音/小红书短链展开 |
| `src/services/link/linkTypes/douyinVideo.js` | 抖音视频 handler |
| `src/services/link/linkTypes/douyinNote.js` | 抖音图集/Live Photo handler |
| `src/services/link/linkTypes/xiaohongshuNote.js` | 小红书笔记（图文/视频）handler |
| `src/services/imageGenerator/renderers/douyin.js` | 抖音预览卡 HTML 渲染器 |
| `src/services/imageGenerator/renderers/xiaohongshu.js` | 小红书预览卡 HTML 渲染器 |
| `src/services/externalMediaDeliveryService.js` | 通用本地媒体文件发送服务 |
| `test/unit/links/douyin.test.js` | 链接提取与 handler 单元测试 |
| `test/unit/links/xiaohongshu.test.js` | 链接提取与 handler 单元测试 |

### 改动文件

| 路径 | 改动点 |
|---|---|
| `src/services/link/linkExtractor.js` | 扩展域名门控：加入抖音、小红书域名 |
| `src/services/link/structuredLinkParser.js` | `buildTokenInfo` 的 https 前缀补全扩展域名 |
| `src/services/link/regexLinkParser.js` | **取消 `?` 截断**；新增抖音和小红书正则；支持 `extractMeta` |
| `src/services/link/linkFetchService.js` | 支持 handler 暴露 `cacheTtlSeconds` 属性，传给 `cacheManager.set` |
| `src/utils/cacheManager.js` | `set(key, data, ttlSeconds?)` 增加可选第三参数；`get` 优先读 per-key TTL |
| `src/services/link/linkRegistry.js` | 注册五个新 handler |
| `src/services/imageGenerator/core/theme.js` | `TYPE_CONFIG` 新增 5 个类型；`generateCSS` 新增图集/Live Photo 相关 CSS |
| `src/services/imageGenerator/generators/previewCard.js` | `renderContentHtml` 新增分支 |
| `src/config/schemaV1.js` | 新增 `externalParsers` 配置节点（含下载子节点） |

---

## 四、详细实现步骤

### 步骤 1：扩展域名门控

**文件：`src/services/link/linkExtractor.js:49`**

当前检查：
```js
const hasBilibiliDomain = checkStr.includes('bilibili.com')
    || checkStr.includes('b23.tv')
    || checkStr.includes('bilibili')
    || /\b(?:[mM][lL]|[aA][uU]|[aA][mM]|[rR][lL])\d+\b/.test(checkStr)
```

修改后（增加外部平台，用独立变量避免污染 hasBilibiliDomain 的语义）：
```js
const hasBilibiliDomain = checkStr.includes('bilibili.com')
    || checkStr.includes('b23.tv')
    || checkStr.includes('bilibili')
    || /\b(?:[mM][lL]|[aA][uU]|[aA][mM]|[rR][lL])\d+\b/.test(checkStr)

const hasExternalPlatformDomain = checkStr.includes('douyin.com')
    || checkStr.includes('iesdouyin.com')
    || checkStr.includes('xhslink.com')
    || checkStr.includes('xhslink.cn')
    || checkStr.includes('xiaohongshu.com')

if (!hasBilibiliDomain && !hasExternalPlatformDomain) {
    // ... 原有 return
}
```

**文件：`src/services/link/structuredLinkParser.js:18`**

`buildTokenInfo` 中 `https://` 前缀补全：
```js
const EXTERNAL_DOMAINS = [
    'douyin.com', 'iesdouyin.com', 'xhslink.com', 'xhslink.cn', 'xiaohongshu.com'
]
const needsPrefix = urlCandidate.includes('bilibili.com')
    || urlCandidate.includes('b23.tv')
    || EXTERNAL_DOMAINS.some((d) => urlCandidate.includes(d))
if (!/^https?:\/\//i.test(urlCandidate) && needsPrefix) {
    urlCandidate = `https://${urlCandidate.replace(/^\/+/, '')}`
}
```

`parseStructuredToken` 的早期返回也需要类似扩展：
```js
if (!tokenInfo?.normalizedToken
    || (!tokenInfo.normalizedToken.includes('bilibili.com')
        && !tokenInfo.normalizedToken.includes('b23.tv')
        && !EXTERNAL_DOMAINS.some((d) => tokenInfo.normalizedToken.includes(d)))) {
    return { handled: false, link: null }
}
```

---

### 步骤 2：短链展开

**新文件：`src/services/externalParsers/externalShortLinkExpander.js`**

```js
'use strict'

const https = require('https')
const logger = require('../../utils/logger')

// 允许展开的域名白名单，防止 SSRF 跟随任意跳转
const ALLOWED_REDIRECT_HOSTS = new Set([
    'v.douyin.com',
    'jx.douyin.com',
    'www.douyin.com',
    'm.douyin.com',
    'iesdouyin.com',
    'jingxuan.douyin.com',
    'xhslink.com',
    'xhslink.cn',
    'www.xiaohongshu.com',
])

const SHORT_LINK_DOMAINS = [
    /https?:\/\/v\.douyin\.com\/[a-zA-Z0-9_\-]+/,
    /https?:\/\/jx\.douyin\.com\/[a-zA-Z0-9_\-]+/,
    /https?:\/\/xhslink\.(com|cn)\/[A-Za-z0-9._?%&+=\/#@\-]+/,
]

function isDouyinOrXhsShortLink(url) {
    return SHORT_LINK_DOMAINS.some((r) => r.test(url))
}

function expandExternalShortUrl(shortUrl, maxHops = 4) {
    return new Promise((resolve) => {
        let hopsLeft = maxHops
        let currentUrl = shortUrl

        function follow(url) {
            if (hopsLeft <= 0) {
                resolve(currentUrl)
                return
            }

            let parsed
            try {
                parsed = new URL(url)
            } catch (_) {
                resolve(currentUrl)
                return
            }

            if (!ALLOWED_REDIRECT_HOSTS.has(parsed.hostname)) {
                resolve(currentUrl)
                return
            }

            hopsLeft -= 1
            const isIos = parsed.hostname.includes('xhslink')
            const req = https.request(url, {
                method: 'HEAD',
                timeout: 5000,
                headers: {
                    'User-Agent': isIos
                        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
                        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                }
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    currentUrl = res.headers.location
                    follow(res.headers.location)
                } else {
                    resolve(currentUrl)
                }
            })

            req.on('timeout', () => { req.destroy(); resolve(currentUrl) })
            req.on('error', () => { resolve(currentUrl) })
            req.end()
        }

        follow(currentUrl)
    })
}

module.exports = { isDouyinOrXhsShortLink, expandExternalShortUrl }
```

调用位置：在 `regexLinkParser.js` 解析出含短链域名的 token 后，或者在 handler 的
`fetch()` 里展开（推荐在 handler 层，避免 extractor 变成异步）。

---

### 步骤 3：正则解析器扩展

**文件：`src/services/link/regexLinkParser.js`**

#### 3a. 取消 `?` 截断

`parseRegexToken` 当前在运行正则前把 `?` 之后的 query string 全部截掉
（`regexLinkParser.js:27-30`）。B 站所有现有正则（BV、av、ss、cv、ep、md、opus、
live、user、ML、AU、AM、RL）全部只匹配路径片段，没有一个依赖 query string，因此
直接去掉截断对 B 站逻辑**低风险**（不是零影响），同时也让小红书正则能匹配到 `?xsec_token=...` 部分。

**回归风险说明**：`/(BV[a-zA-Z0-9]{10})|(av[0-9]+)/` 这条正则取消截断后可能在
`?bvid=BV...` 这类 query string 里二次命中，产生重复的 link descriptor。实际影响
可控——`linkPipeline.processLinkDescriptors` 有 `seenCacheKeys` 去重，重复描述符会被
过滤；但**必须把"现有 B 站链接解析单测回归"列为第一期验收条件**，跑完
`test/unit/links/` 下现有测试并确认无新增命中才算通过。

将：

```js
const questionMarkIndex = tokenInfo.normalizedToken.indexOf('?')
const regexInput = questionMarkIndex !== -1
    ? tokenInfo.normalizedToken.substring(0, questionMarkIndex)
    : tokenInfo.normalizedToken
```

改为：

```js
const regexInput = tokenInfo.normalizedToken
```

#### 3b. 支持 `extractMeta`

在 `parseRegexToken` 的匹配循环中，调用可选的 `linkType.extractMeta` 并传入
`meta` 参数。现有 `createLink` 已接受 `meta`，只需在调用处加上：

```js
for (const match of matches) {
    const id = linkType.extractId(match)
    const meta = typeof linkType.extractMeta === 'function'
        ? linkType.extractMeta(match)
        : {}
    links.push(createLink(linkType.type, id, groupId, match[0], meta, tokenInfo.normalizedToken))
}
```

#### 3c. 新增抖音和小红书正则

在 `linkTypes` 数组末尾追加：

```js
// 抖音长链：www.douyin.com/video/1234  www.douyin.com/note/1234
// m.douyin.com/share/video/1234  ← 两段路径，需要 (?:[a-z]+\/)+ 而非 [a-z]+\/
// jingxuan.douyin.com/m/video/1234 ← 同上
// 使用 (?:[a-z]+\/)+ 覆盖任意段数路径
{ regex: /(?:www\.|m\.|jingxuan\.)?douyin\.com\/(?:[a-z]+\/)+(\d{15,20})/,
    type: 'douyin_video', extractId: (match) => match[1] },
{ regex: /iesdouyin\.com\/share\/(?:[a-z]+\/)+(\d{15,20})/,
    type: 'douyin_video', extractId: (match) => match[1] },
// 短链（v.douyin.com 和 xhslink）由 handler.fetch() 在内部展开，这里只做域名捕获
{ regex: /v\.douyin\.com\/([a-zA-Z0-9_\-]{5,20})/,
    type: 'douyin_short', extractId: (match) => match[1] },
{ regex: /jx\.douyin\.com\/([a-zA-Z0-9_\-]{5,20})/,
    type: 'douyin_short', extractId: (match) => match[1] },
// 小红书长链
// xsec_token 在 query string 里，依赖 3a 取消截断后才能被 (\?[^\s]*) 捕获
{ regex: /xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]{24})(\?[^\s]*)?/,
    type: 'xhs_note',
    extractId: (match) => match[1],
    extractMeta: (match) => ({ queryString: match[2] || '' }) },
// 小红书短链 xhslink（短链内部含 query 的完整 path 由 handler 展开后处理）
{ regex: /xhslink\.(com|cn)\/([A-Za-z0-9._?%&+=\/#@\-]{5,100})/,
    type: 'xhs_short', extractId: (match) => match[2] },
```

**注意**：小红书 `xhs_note` handler 的 `fetch()` 从 `descriptor.meta.queryString`
读取完整 query（含 `xsec_token`），而不是从 `descriptor.sourceToken` 再次解析，因为
`sourceToken` 经过 `normalizeUrlToken` 处理可能丢失部分特殊字符。`extractMeta` 在
正则匹配时直接存入 descriptor，是最可靠的传递路径。

---

### 步骤 4：数据抓取服务

#### 4a. `src/services/externalParsers/douyinService.js`

```js
'use strict'

const https = require('https')
const logger = require('../../utils/logger')
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

module.exports = { fetchDouyinContent, buildPlayUrl }
```

#### 4b. `src/services/externalParsers/xiaohongshuService.js`

```js
'use strict'

const https = require('https')
const logger = require('../../utils/logger')
const { expandExternalShortUrl } = require('./externalShortLinkExpander')

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const PC_UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function fetchHtml(url, headers) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers, timeout: 12000 }, (res) => {
            // 跟随 302，但只允许同域跳转
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const loc = res.headers.location
                if (loc.includes('xiaohongshu.com')) {
                    fetchHtml(loc, headers).then(resolve).catch(reject)
                } else {
                    reject(new Error(`xhs redirect to unexpected host: ${loc}`))
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

function extractInitialState(html) {
    const m = html.match(/window\.__INITIAL_STATE__=(.*?)<\/script>/)
    if (!m) throw new Error('xhs: window.__INITIAL_STATE__ not found')
    const raw = m[1].replace(/undefined/g, 'null')
    try {
        return JSON.parse(raw)
    } catch (e) {
        throw new Error(`xhs: __INITIAL_STATE__ JSON parse failed: ${e.message}`)
    }
}

// Explore 路径（PC UA，无额外请求头）
async function parseExplore(noteId, queryString) {
    const url = `https://www.xiaohongshu.com/explore/${noteId}${queryString}`
    const html = await fetchHtml(url, {
        'User-Agent': PC_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    })
    const state = extractInitialState(html)
    const wrapper = state?.note?.noteDetailMap?.[noteId]
    if (!wrapper?.note) throw new Error(`xhs explore: note ${noteId} not found in state`)
    return { state, note: wrapper.note, path: 'explore' }
}

// Discovery 回退路径（iOS UA + 额外请求头）
async function parseDiscovery(noteId, queryString) {
    const url = `https://www.xiaohongshu.com/discovery/item/${noteId}${queryString}`
    const html = await fetchHtml(url, {
        'User-Agent': IOS_UA,
        'Origin': 'https://www.xiaohongshu.com',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
    })
    const state = extractInitialState(html)
    const note = state?.noteData?.data?.noteData
    if (!note) throw new Error('xhs discovery: noteData not found in state')
    const preload = state?.noteData?.normalNotePreloadData || null
    return { state, note, preload, path: 'discovery' }
}

// 从 Video.media.stream 提取最优播放 URL（h265 无水印优先）
function extractVideoUrl(video) {
    const stream = video?.media?.stream
    if (!stream) return { url: null, duration: 0 }
    for (const codec of ['h265', 'h264', 'av1', 'h266']) {
        const items = stream[codec]
        if (Array.isArray(items) && items.length > 0) {
            return {
                url: items[0].masterUrl,
                duration: Math.floor((items[0].duration || 0) / 1000),
            }
        }
    }
    return { url: null, duration: 0 }
}

function normalizeNote(noteData, path) {
    const user = noteData.user || noteData.author || {}
    const author = {
        name: user.nickname || user.nickName || 'Unknown',
        face: user.avatar || user.avatarUrl || '',
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
        const cover = coverList[0]?.urlDefault || coverList[0]?.url || ''
        return { ...base, type: 'xhs_video', video_url: url, video_duration: duration, cover }
    }

    // 图文笔记
    const images = (noteData.imageList || []).map((img) => img.urlDefault || img.url).filter(Boolean)
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

// 从分享链接提取 noteId 和 queryString
function extractNoteId(url) {
    const m = url.match(/(?:explore|discovery\/item)\/([0-9a-f]{24})(\?[^\s]*)/)
    if (!m) return null
    return { noteId: m[1], queryString: m[2] || '' }
}

module.exports = { fetchXhsContent, extractNoteId, expandExternalShortUrl }
```

---

### 步骤 5：Link Type Handlers

#### 5a. `src/services/link/linkTypes/douyinVideo.js`

```js
'use strict'

const { fetchDouyinContent, buildPlayUrl } = require('../../externalParsers/douyinService')
const { expandExternalShortUrl } = require('../../externalParsers/externalShortLinkExpander')
const externalMediaDelivery = require('../../externalMediaDeliveryService')
const logger = require('../../../utils/logger')

module.exports = {
    type: 'douyin_video',

    getCacheIdentity(descriptor) {
        return descriptor.id  // aweme_id
    },

    async fetch(groupId, descriptor) {
        try {
            // descriptor.id は aweme_id（長鎖の場合）または短链 token
            const data = await fetchDouyinContent(descriptor.id)
            return { status: 'success', data, type: data.type }
        } catch (error) {
            logger.logEvent('warn', 'LINK', '', 'douyin-fetch-failed', {
                id: descriptor.id,
                error: String(error.message || error)
            })
            return { status: 'error', message: error.message }
        }
    },

    buildUrl(descriptor, info) {
        if (info?.data?.share_url) return info.data.share_url
        return `https://www.douyin.com/video/${descriptor.id}`
    },

    resolveCardType(info) {
        return info?.data?.type || 'douyin_video'
    },

    async afterSend(context) {
        const data = context.info?.data
        if (!data || data.type !== 'douyin_video' || !data.play_addr_uri) return

        // 检查群组是否开启了抖音视频下载
        // 配置路径：externalParsers.douyin.downloadEnabled（嵌套访问）
        // config 对象没有 getSystemConfig()，顶层节点直接属性访问，与 config.videoDownload?.enabled 模式一致
        const config = require('../../../config')
        const sysEnabled = config.externalParsers?.douyin?.downloadEnabled ?? false
        const groupEnabled = config.getGroupConfig(String(context.groupId), 'douyinDownloadEnabled') ?? false
        if (!sysEnabled && !groupEnabled) return

        const douyinCfg = config.externalParsers?.douyin || {}
        try {
            await externalMediaDelivery.downloadAndSend({
                ws: context.ws,
                groupId: context.groupId,
                url: buildPlayUrl(data.play_addr_uri),
                label: data.title || '抖音视频',
                author: data.author.name,
                platform: 'douyin',
                // data.duration 单位为秒（normalizeAweme 中已做 /1000）
                durationSeconds: data.duration ?? 0,
                maxDurationSeconds: douyinCfg.downloadMaxDurationSeconds ?? 120,
                maxFileSizeBytes: (douyinCfg.downloadMaxFileSizeMB ?? 50) * 1024 * 1024,
            })
        } catch (err) {
            logger.logEvent('error', 'LINK', '', 'douyin-download-failed', {
                groupId: context.groupId,
                id: data.aweme_id,
                error: String(err.message || err)
            })
        }
    }
}
```

`douyinNote.js` 和 `xiaohongshuNote.js` 结构类似，`afterSend` 中图集直接发图片数组，
Live Photo 按组发送（封面图 + MP4），具体实现见步骤 8（`externalMediaDeliveryService`
的 `deliverImages` 和 `deliverLivePhotoGroup`）。

#### 5b. `src/services/link/linkTypes/douyinShort.js`

短链类型 handler 的 `fetch()` 先展开 URL，再委托给 `douyinService.fetchDouyinContent`，
其余逻辑与 `douyinVideo.js` 相同。`type: 'douyin_short'`，`resolveCardType` 依然
返回 `info.data.type`（即 `douyin_video` / `douyin_note` / `douyin_live_photo`）。

#### 5c. `src/services/link/linkTypes/xhsNote.js`

```js
'use strict'

const { fetchXhsContent, extractNoteId } = require('../../externalParsers/xiaohongshuService')
const { expandExternalShortUrl } = require('../../externalParsers/externalShortLinkExpander')
const logger = require('../../../utils/logger')

module.exports = {
    type: 'xhs_note',

    getCacheIdentity(descriptor) {
        return descriptor.id  // note_id
    },

    async fetch(groupId, descriptor) {
        try {
            const queryString = descriptor.meta?.queryString || ''
            const data = await fetchXhsContent(descriptor.id, queryString)
            return { status: 'success', data, type: data.type }
        } catch (error) {
            logger.logEvent('warn', 'LINK', '', 'xhs-fetch-failed', {
                id: descriptor.id,
                error: String(error.message || error)
            })
            return { status: 'error', message: error.message }
        }
    },

    buildUrl(descriptor) {
        return `https://www.xiaohongshu.com/explore/${descriptor.id}`
    },

    resolveCardType(info) {
        return info?.data?.type || 'xhs_note'
    }
    // 小红书视频暂不自动下载（视频通常带平台水印），afterSend 留空
}
```

`xhsShort.js` 先展开短链，从展开后 URL 提取 noteId + queryString，再委托
`fetchXhsContent`。

---

### 步骤 6：注册 Handler

**文件：`src/services/link/linkRegistry.js`**

```js
const douyinVideo  = require('./linkTypes/douyinVideo')
const douyinNote   = require('./linkTypes/douyinNote')
const douyinShort  = require('./linkTypes/douyinShort')
const xhsNote      = require('./linkTypes/xhsNote')
const xhsShort     = require('./linkTypes/xhsShort')

const handlers = new Map([
    // ... 现有 B 站 handlers ...
    douyinVideo,
    douyinNote,
    douyinShort,
    xhsNote,
    xhsShort,
].map((h) => [h.type, h]))
```

---

### 步骤 7：渲染器

#### 7a. `src/services/imageGenerator/renderers/douyin.js`

```js
'use strict'

const { escapeHtml, formatPubTime, formatDuration } = require('../core/formatters')

// 抖音色系：品牌黑底 + 白字，但预览卡颜色由主题层控制，这里只输出内容 HTML
function renderDouyinVideoContent(data) {
    const info = data.data
    const author = info.author || {}
    const face = author.face || ''
    const name = escapeHtml(author.name || 'Unknown')
    const sig  = author.signature ? `<span class="user-signature">${escapeHtml(author.signature)}</span>` : ''
    const dur  = info.duration ? ` • 时长: ${formatDuration(info.duration)}` : ''

    return `
        <div class="cover-container" data-layout-key="cover">
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
            <div class="title" data-layout-key="title">${escapeHtml(info.title || '')}</div>
        </div>
    `
}

function renderDouyinNoteContent(data) {
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
            <div class="title">${escapeHtml(info.title || '')}</div>
            <div class="note-image-grid">
                ${imageGrid}
                ${remaining > 0 ? `<div class="note-more">+${remaining}</div>` : ''}
            </div>
        </div>
    `
}

function renderDouyinLivePhotoContent(data) {
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
            <div class="title">${escapeHtml(info.title || '')}</div>
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
```

#### 7b. `src/services/imageGenerator/renderers/xiaohongshu.js`

结构与抖音类似：

- `renderXhsVideoContent`：封面 + 作者 + 标题 + 时长，右上角品牌标记"小红书"
- `renderXhsNoteContent`：图集网格（同样最多 4 张缩略图）+ 标题 + desc（正文截断）

#### 7c. 接入 `previewCard.js`

在 `renderContentHtml` 函数中追加分支（位于 `return renderGenericContent` 之前）：

```js
} else if (type === 'douyin_video') {
    return renderDouyinVideoContent(data, emojiContext)
} else if (type === 'douyin_note') {
    return renderDouyinNoteContent(data, emojiContext)
} else if (type === 'douyin_live_photo') {
    return renderDouyinLivePhotoContent(data, emojiContext)
} else if (type === 'xhs_video') {
    return renderXhsVideoContent(data, emojiContext)
} else if (type === 'xhs_note') {
    return renderXhsNoteContent(data, emojiContext)
}
```

---

### 步骤 8：通用媒体投递服务

**新文件：`src/services/externalMediaDeliveryService.js`**

从 `videoDownloadService._sendForwardMessage` 提取核心投递逻辑，不做 B 站特定操作：

```js
'use strict'

const path = require('path')
const fs   = require('fs')
const fsPromises = require('fs').promises
const https = require('https')
const crypto = require('crypto')
const notificationService = require('./notificationService')
const logger = require('../utils/logger')
const config = require('../config')
const qqRuntime = require('../providers/qq/runtime')
const { isOfficialTransport, isQqTransportReady } = require('../providers/qq/readiness')

function getDownloadsDir() {
    const napcatTemp = config.napcatTempPath || config.paths?.napcatTemp || '/app/.config/QQ/tmp/'
    return path.join(path.resolve(napcatTemp), 'ext-downloads')
}

function toNapcatPath(filePath) {
    const writeBase = path.resolve(config.napcatTempPath || config.paths?.napcatTemp || '/app/.config/QQ/tmp/')
    const readBase  = path.resolve(config.napcatReadPath || config.paths?.napcatRead  || writeBase)
    const abs = path.resolve(filePath)
    if (abs.startsWith(writeBase)) {
        return path.join(readBase, path.relative(writeBase, abs))
    }
    return filePath
}

// 流式下载 URL 到 destPath
async function streamDownload(url, destPath, maxBytes) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath + '.tmp')
        let received = 0

        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 60000,
        }, (res) => {
            const contentLength = parseInt(res.headers['content-length'] || '0', 10)
            if (contentLength > maxBytes) {
                req.destroy()
                file.destroy()
                fs.unlink(destPath + '.tmp', () => {})
                reject(new Error(`file too large: ${contentLength} > ${maxBytes}`))
                return
            }

            res.on('data', (chunk) => {
                received += chunk.length
                if (received > maxBytes) {
                    req.destroy()
                    file.destroy()
                    fs.unlink(destPath + '.tmp', () => {})
                    reject(new Error(`downloaded size exceeded limit`))
                    return
                }
                file.write(chunk)
            })

            res.on('end', () => {
                file.end(() => {
                    fsPromises.rename(destPath + '.tmp', destPath).then(resolve).catch(reject)
                })
            })
        })

        req.on('timeout', () => { req.destroy(); reject(new Error('download timeout')) })
        req.on('error', (err) => { file.destroy(); reject(err) })
    })
}

// 投递单个视频文件到群/私聊
async function deliverVideoFile(ws, groupId, filePath, label, author) {
    if (!isQqTransportReady(ws)) return false

    const isOfficial = isOfficialTransport(ws)
    const videoFilePath = isOfficial ? filePath : toNapcatPath(filePath)
    const videoFile = `file://${videoFilePath.replace(/\\/g, '/')}`
    const textMsg = { type: 'text', data: { text: `「${label}」- ${author}` } }
    const videoMsg = { type: 'video', data: { file: videoFile } }

    if (typeof groupId === 'string' && groupId.startsWith('private_')) {
        const uid = groupId.replace('private_', '')
        if (!uid) return false
        await notificationService.sendPrivateMessage(ws, uid, [textMsg, videoMsg], 'ExternalMedia', false)
        return true
    }

    const numericGroupId = isOfficial ? String(groupId) : Number(groupId)
    await notificationService.sendGroupMessage(ws, numericGroupId, [textMsg, videoMsg], 'ExternalMedia', false)
    return true
}

// 主入口：下载视频 URL 并发送
// 注意：maxDurationSeconds 必须在此处预检，不能仅靠 maxFileSizeBytes 兜底，
// 否则超长视频会在下载完成后才失败，浪费带宽和磁盘。
// durationSeconds 由 afterSend 调用方从 data.duration 取得并传入。
async function downloadAndSend({ ws, groupId, url, label, author, platform,
    durationSeconds, maxDurationSeconds, maxFileSizeBytes }) {
    // 时长预检（仿照 videoDownloadService.js:357-367 的模式）
    if (maxDurationSeconds > 0 && durationSeconds > 0 && durationSeconds > maxDurationSeconds) {
        const durMin = Math.round(durationSeconds / 60)
        const limMin = Math.round(maxDurationSeconds / 60)
        logger.logEvent('info', 'SEND', '', 'external-download-skipped-duration', {
            groupId, platform, durationSeconds, maxDurationSeconds
        })
        // groupId 类型处理与 deliverVideoFile 保持一致
        const isOfficial = isOfficialTransport(ws)
        const targetGroupId = (typeof groupId === 'string' && groupId.startsWith('private_'))
            ? null  // 私聊场景不发提示，直接跳过
            : isOfficial ? String(groupId) : Number(groupId)
        if (targetGroupId !== null) {
            await notificationService.sendGroupMessage(ws, targetGroupId, [{
                type: 'text',
                data: { text: `⚠️ 视频时长 ${durMin} 分钟，超出当前限制（${limMin} 分钟），已跳过下载` }
            }], 'ExternalMedia', false)
        }
        return false
    }

    const dir = getDownloadsDir()
    await fsPromises.mkdir(dir, { recursive: true })

    const filename = `${platform}-${crypto.randomBytes(8).toString('hex')}.mp4`
    const filePath = path.join(dir, filename)

    try {
        await streamDownload(url, filePath, maxFileSizeBytes ?? 50 * 1024 * 1024)
        const sent = await deliverVideoFile(ws, groupId, filePath, label, author || platform)

        // 发送后延迟 5 分钟清理
        setTimeout(() => {
            fsPromises.unlink(filePath).catch(() => {})
        }, 5 * 60 * 1000)

        return sent
    } catch (err) {
        fsPromises.unlink(filePath).catch(() => {})
        throw err
    }
}

// 发送图片数组（图集）
// notificationService.js:472 已支持 { type: 'image', data: { file: 'base64://...' } }，
// NapCat 模式自动将 base64 转存文件再以 file:// 发出；Official 模式直接传 base64。
// 每张图片单独 fetch，存 .tmp 后改名，失败单张静默跳过，不影响其余。
async function deliverImages(ws, groupId, imageUrls, label, maxImages = 9) {
    if (!isQqTransportReady(ws)) return 0
    const toSend = imageUrls.slice(0, maxImages)
    let sent = 0

    for (const url of toSend) {
        try {
            const buf = await fetchBuffer(url, 10 * 1024 * 1024)  // 单图 10MB 上限
            const b64 = buf.toString('base64')
            await notificationService.sendGroupMessage(ws,
                isOfficialTransport(ws) ? String(groupId) : Number(groupId),
                [{ type: 'image', data: { file: `base64://${b64}` } }],
                'ExternalMedia', false)
            sent++
        } catch (e) {
            logger.logEvent('warn', 'SEND', '', 'external-image-send-failed', {
                groupId, url: url.slice(0, 80), error: String(e.message || e)
            })
        }
    }
    return sent
}

// 发送一组 Live Photo（封面图 + 短视频）
async function deliverLivePhotoGroup(ws, groupId, livePhotos, platform, maxGroups = 4,
    maxVideoSizeBytes = 30 * 1024 * 1024) {
    if (!isQqTransportReady(ws)) return
    const toSend = livePhotos.slice(0, maxGroups)

    for (const lp of toSend) {
        // 封面图
        if (lp.cover) {
            try {
                const buf = await fetchBuffer(lp.cover, 10 * 1024 * 1024)
                await notificationService.sendGroupMessage(ws,
                    isOfficialTransport(ws) ? String(groupId) : Number(groupId),
                    [{ type: 'image', data: { file: `base64://${buf.toString('base64')}` } }],
                    'ExternalMedia', false)
            } catch (e) { /* 封面失败不阻断短视频 */ }
        }

        // 短视频
        if (lp.play_addr_uri) {
            const videoUrl = buildPlayUrl(lp.play_addr_uri)
            const dir = getDownloadsDir()
            await fsPromises.mkdir(dir, { recursive: true })
            const filename = `${platform}-lp-${crypto.randomBytes(6).toString('hex')}.mp4`
            const filePath = path.join(dir, filename)
            try {
                await streamDownload(videoUrl, filePath, maxVideoSizeBytes)
                await deliverVideoFile(ws, groupId, filePath, 'Live Photo', platform)
                setTimeout(() => fsPromises.unlink(filePath).catch(() => {}), 5 * 60 * 1000)
            } catch (e) {
                fsPromises.unlink(filePath).catch(() => {})
                logger.logEvent('warn', 'SEND', '', 'external-livephoto-send-failed', {
                    groupId, error: String(e.message || e)
                })
            }
        }
    }
}

// 辅助：流式 fetch 到内存 Buffer（用于图片，不落盘）
function fetchBuffer(url, maxBytes) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        }, (res) => {
            const cl = parseInt(res.headers['content-length'] || '0', 10)
            if (cl > maxBytes) { req.destroy(); reject(new Error(`image too large: ${cl}`)); return }
            const chunks = []
            let received = 0
            res.on('data', (chunk) => {
                received += chunk.length
                if (received > maxBytes) { req.destroy(); reject(new Error('image size exceeded')); return }
                chunks.push(chunk)
            })
            res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')) })
        req.on('error', reject)
    })
}

// buildPlayUrl 从 douyinService 按需传入，此处仅用于 deliverLivePhotoGroup
let buildPlayUrl = (uri) => `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=1080p&line=0`
function setBuildPlayUrl(fn) { buildPlayUrl = fn }

module.exports = { downloadAndSend, deliverVideoFile, deliverImages, deliverLivePhotoGroup, setBuildPlayUrl }
```

---

### 步骤 9：配置 Schema

**文件：`src/config/schemaV1.js`**

在 `videoDownload` 节点之后，`logging` 节点之前插入：

```js
externalParsers: objectNode({
    douyin: objectNode({
        enabled: booleanNode(false, { effects: ['externalParsers'] }),
        downloadEnabled: booleanNode(false, { effects: ['externalParsers'] }),
        downloadMaxDurationSeconds: integerNode(120, { minimum: 0, maximum: 600, effects: ['externalParsers'] }),
        downloadMaxFileSizeMB: integerNode(50, { minimum: 1, maximum: 500, effects: ['externalParsers'] }),
        downloadMaxConcurrent: integerNode(2, { minimum: 1, maximum: 5, effects: ['externalParsers'] }),
    }),
    xiaohongshu: objectNode({
        enabled: booleanNode(false, { effects: ['externalParsers'] }),
        cookie: stringNode('', { secret: true, effects: ['externalParsers'] }),
    }),
}),
```

在 `groupConfigSchema` 中追加（允许群级覆盖）：

```js
douyinEnabled: booleanNode(false),
douyinDownloadEnabled: booleanNode(false),
xiaohongshuEnabled: booleanNode(false),
```

config handler 与 effect 注册按现有 `download` effect 的模式添加 `externalParsers`
effect，重新载入时重置运行期参数即可（无需重启 Python 或 Browser）。

---

### 步骤 10：在 `fetch()` 中检查平台开关

**配置访问说明**

`config` 对象没有 `getSystemConfig()` 方法（该方法不存在）。顶层节点通过直接属性
访问，与现有代码一致：

```js
// 正确：直接属性访问，与 config.videoDownload?.enabled 模式相同
config.externalParsers?.douyin?.enabled

// 错误（不存在该方法）：
config.getSystemConfig().externalParsers?.douyin?.enabled
```

每个 external handler 的 `fetch()` 入口加：

```js
const config = require('../../../config')
const sysEnabled = config.externalParsers?.douyin?.enabled ?? false
const groupEnabled = config.getGroupConfig(String(groupId), 'douyinEnabled') ?? false
if (!sysEnabled && !groupEnabled) {
    // 平台关闭时静默跳过：同时让 buildUrl 返回 null，使 pipeline 不发任何消息
    return { status: 'disabled', message: 'douyin parser is disabled' }
}
```

**静默跳过的正确实现**

`linkPipeline.js` 的 `buildFetchFailureText`（`linkPipeline.js:60-74`）逻辑是：
`handler.buildFetchFailureText` 返回 falsy 且 `targetUrl`（来自 `handler.buildUrl`）
也为 falsy 时才会真正静默跳过；只要 `buildUrl` 返回了 URL，pipeline 就会
发默认降级文本。

因此需要两个条件同时成立：

```js
// handler 上同时定义：
buildFetchFailureText(info, descriptor) {
    if (info?.status === 'disabled') return null  // 返回 null，禁止发自定义文本
    return null  // 始终 null，让 pipeline 用默认降级文本或静默
},

buildUrl(descriptor, info) {
    // 平台关闭时返回 null（或空字符串）而非有效 URL
    if (info?.status === 'disabled') return null
    if (info?.data?.share_url) return info.data.share_url
    return `https://www.douyin.com/video/${descriptor.id}`
},
```

当 `buildFetchFailureText` 返回 `null` 且 `buildUrl` 返回 `null` 时，
`linkPipeline.js:128-138` 的逻辑会走 `status: 'failed'` 路径但不向群里发任何消息，
实现真正的静默跳过。

---

## 五、降级与错误处理策略

| 场景 | 处理 |
|---|---|
| 接口 HTTP 4xx/5xx | `fetch()` 返回 `{ status: 'error' }`，pipeline 发降级文本（原始链接） |
| `__INITIAL_STATE__` 不存在 | XHS 自动切换 discovery 路径；若均失败则降级 |
| 视频下载超时 | `afterSend` 捕获异常，记录 warn 日志，不影响已发出的预览卡 |
| 文件大小超限 | `afterSend` 静默跳过，日志记录 skipped 原因 |
| Provider 不可用 | 检查 `isQqTransportReady` 直接返回 false，不重试 |
| 平台未开启 | `fetch()` 返回 `{ status: 'disabled' }`，`buildUrl` 返回 `null`，`buildFetchFailureText` 返回 `null`，pipeline 静默跳过 |
| 短链 SSRF 防护 | `externalShortLinkExpander` 只跟随白名单域名的 302 |

---

## 六、数据缓存 TTL

**现状分析（源码确认）**

`cacheManager.js:42` 的 TTL 判断硬读全局 `config.dataCacheTTL`：

```js
if (config.dataCacheTTL && fetchedAtMs && ageSeconds > config.dataCacheTTL) {
```

`cacheManager.set(key, data)` 只接受两个参数，`__cacheMeta` 里只存 `fetchedAt`
时间戳，没有任何 per-key TTL 字段。这是**真实的遗漏**，不是伪代码；要让抖音使用
独立 TTL 必须改动 `cacheManager.js` 本身，且该文件之前不在改动清单里。

**改动 1：`src/utils/cacheManager.js`**

`set` 增加可选第三参数；`get` 优先读 per-key TTL：

```js
// set(key, data, ttlSeconds?)
async set(key, data, ttlSeconds) {
    await this.initPromise;
    try {
        const filePath = path.join(this.cacheDir, `${key}.json`);
        const wrapped = {
            __cacheMeta: {
                fetchedAt: Date.now(),
                // 只有显式传入时才写入，undefined 不写
                ...(ttlSeconds != null ? { ttlSeconds } : {})
            },
            payload: data
        };
        await fs.writeFile(filePath, JSON.stringify(wrapped));
        this.checkSizeAndCleanup().catch(/* ... */);
    } catch (error) { /* ... */ }
}

// get 里，优先用 per-key TTL
const ttl = parsed?.__cacheMeta?.ttlSeconds ?? config.dataCacheTTL
if (ttl && fetchedAtMs && ageSeconds > ttl) {
    // ... 同现有逻辑
}
```

改动向后兼容：现有调用方不传第三参数，`ttlSeconds` 为 `undefined`，不写入
`__cacheMeta`，`get` 里回退到 `config.dataCacheTTL`，行为与改前完全一致。

**改动 2：`src/services/link/linkFetchService.js`**

让 handler 可以声明 `cacheTtlSeconds` 属性，`linkFetchService.fetch` 读取并
透传给 `cacheManager.set`：

```js
async function fetch(handler, groupId, descriptor, options = {}) {
    // ...（现有 cache get 逻辑不变）
    info = await handler.fetch(groupId, descriptor)
    if (info && info.status === 'success') {
        const ttl = handler.cacheTtlSeconds  // undefined = 用全局默认
        await cacheManager.set(cacheKey, info, ttl)
    }
    // ...
}
```

**Handler 声明**

抖音 handler 加一行：

```js
module.exports = {
    type: 'douyin_video',
    cacheTtlSeconds: 60,   // 抖音 CDN URL 有 TTL，60s 后重新请求
    // ...
}
```

小红书 handler 不声明该属性，沿用全局 `dataCacheTTL`（默认 120s）。

---

## 七、测试策略

### 单元测试（纯逻辑，不调用真实 API）

**`test/unit/links/douyin.test.js`**

- 正则从完整 URL 中提取正确的 `aweme_id`
- `normalizeAweme` 对视频/图集/Live Photo 三种 fixture 产生正确的数据结构
- `buildPlayUrl(uri)` 拼出正确的播放地址
- `expandExternalShortUrl` 对白名单域名外的跳转正确终止

**`test/unit/links/xiaohongshu.test.js`**

- `extractInitialState` 正确解析含 `undefined` 字面值的 HTML
- `normalizeNote` 对视频/图文两种 state fixture 输出正确结构
- `extractNoteId` 从 explore 和 discovery URL 均能提取 noteId + queryString

### 集成验证（需网络，手动）

```bash
# 抖音普通视频
node test/tools/preview-lab.js "https://www.douyin.com/video/7521023890996514083" --fresh --out-name douyin-video

# 抖音图集
node test/tools/preview-lab.js "https://www.douyin.com/note/7469411074119322899" --fresh --out-name douyin-note

# 小红书图文（需在 config 中填入 xsec_token 的含参链接）
node test/tools/preview-lab.js "https://www.xiaohongshu.com/explore/68feefe40000000007030c4a?xsec_token=..." --fresh --out-name xhs-note

# 短链展开
node -e "const {expandExternalShortUrl}=require('./src/services/externalParsers/externalShortLinkExpander'); expandExternalShortUrl('https://v.douyin.com/iLxxx/').then(console.log)"
```

---

## 八、分期实施建议

### 第一期（核心链路）

1. 扩展域名门控（`linkExtractor.js`、`structuredLinkParser.js`）
2. 实现 `externalShortLinkExpander.js`
3. 实现 `douyinService.js` 和 `xiaohongshuService.js`
4. 实现 `regexLinkParser.js` 扩展
5. 实现三个 handler（`douyinVideo`、`douyinShort`、`xhsNote`）
6. 实现两个 renderer（抖音视频、小红书笔记）并接入 `previewCard.js`
7. 接入 `linkRegistry.js`
8. 单元测试

验收：抖音长链/短链和小红书笔记链接均能发出预览卡，失败时降级为文本链接。

### 第二期（媒体投递与完整图集）

1. 实现 `externalMediaDeliveryService.js`
2. 实现 `douyinNote.js` handler（图集/Live Photo 的 `afterSend`）
3. 在 `douyinVideo.js` 的 `afterSend` 中接入下载投递
4. 配置 Schema 扩展（`externalParsers` 节点）
5. 群组级开关检查
6. 完整测试（两个 Provider）

验收：抖音视频发完预览卡后追加视频文件；图集发完预览卡后追加图片数组；
Live Photo 按组发送封面图和短视频。

---

## 九、不在本方案范围内的事项

- 小红书视频下载（视频通常带水印，默认不下载；如有需求作为第三期）
- Dashboard 配置 UI（平台开关可通过 YAML 或 CLI 管理，UI 作为后续迭代）
- 抖音直播间解析（结构不同，作为独立扩展点）
- `X-Bogus` / `a_bogus` 签名实现（目前接口无需签名；如未来失效则需单独研究）
