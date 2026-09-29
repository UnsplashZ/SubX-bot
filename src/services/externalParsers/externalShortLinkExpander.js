'use strict'

const https = require('https')

// 允许展开的域名白名单，防止 SSRF 跟随任意跳转
const ALLOWED_REDIRECT_HOSTS = new Set([
    'v.douyin.com',
    'jx.douyin.com',
    'www.douyin.com',
    'm.douyin.com',
    'iesdouyin.com',
    'www.iesdouyin.com',
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

        function follow(url, method = 'HEAD') {
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
                method,
                timeout: 5000,
                headers: {
                    'User-Agent': isIos
                        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
                        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                }
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const location = res.headers.location
                    // 先校验下一跳域名在白名单内，再更新 currentUrl：
                    // 白名单外的跳转直接终止，返回最后一个白名单 URL
                    let locationHost = null
                    try {
                        locationHost = new URL(location).hostname
                    } catch (_) {
                        res.resume()
                        resolve(currentUrl)
                        return
                    }
                    if (!ALLOWED_REDIRECT_HOSTS.has(locationHost)) {
                        res.resume()
                        resolve(currentUrl)
                        return
                    }
                    currentUrl = location
                    follow(location)
                    return
                }

                if (method === 'HEAD') {
                    // GET fallback：部分短链服务不支持 HEAD（返回 405/200），
                    // 用 GET 重试一次以提高 v.douyin.com / xhslink 展开成功率。
                    // 先释放当前响应再重试。
                    res.resume()
                    follow(url, 'GET')
                    return
                }

                // GET 仍非 3xx：已到达最终地址（或失败），返回当前 URL
                res.resume()
                resolve(currentUrl)
            })

            req.on('timeout', () => { req.destroy(); resolve(currentUrl) })
            req.on('error', () => { resolve(currentUrl) })
            req.end()
        }

        follow(currentUrl)
    })
}

module.exports = { isDouyinOrXhsShortLink, expandExternalShortUrl }
