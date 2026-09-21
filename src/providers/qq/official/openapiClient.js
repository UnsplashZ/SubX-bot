const { OfficialOpenApiError, parseRetryAfterMs } = require('./errors')

const DEFAULT_API_BASE = 'https://api.sgroup.qq.com'

function joinUrl(base, path) {
    const cleanBase = String(base || '').replace(/\/+$/, '')
    const cleanPath = String(path || '').startsWith('/') ? String(path) : `/${path}`
    return `${cleanBase}${cleanPath}`
}

function getHeader(headers, name) {
    if (!headers) return null
    if (typeof headers.get === 'function') return headers.get(name)
    const lower = String(name).toLowerCase()
    for (const [key, value] of Object.entries(headers)) {
        if (String(key).toLowerCase() === lower) return value
    }
    return null
}

class OfficialOpenApiClient {
    constructor(options = {}) {
        this.apiBase = String(options.apiBase || DEFAULT_API_BASE).trim()
        this.tokenManager = options.tokenManager
        this.fetchImpl = options.fetchImpl || global.fetch
        this.logger = options.logger || null
    }

    async requestJson(method, path, options = {}) {
        if (typeof this.fetchImpl !== 'function') throw new Error('fetch_unavailable')
        const body = options.body
        const headers = {
            'content-type': 'application/json',
            ...(options.headers || {}),
            authorization: await this.tokenManager.getAuthorizationHeader({
                forceRefresh: Boolean(options.forceAuthRefresh)
            })
        }

        const response = await this.fetchImpl(joinUrl(this.apiBase, path), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        })

        if (response.status === 401 && !options._retriedAuth) {
            return this.requestJson(method, path, {
                ...options,
                forceAuthRefresh: true,
                _retriedAuth: true
            })
        }

        const text = await response.text()
        let payload = null
        if (text) {
            try {
                payload = JSON.parse(text)
            } catch {
                payload = { message: text.slice(0, 200) }
            }
        }

        if (!response.ok) {
            const retryAfterMs = parseRetryAfterMs(getHeader(response.headers, 'retry-after'))
            const qqCode = payload?.code ?? payload?.errcode ?? null
            const message = payload?.message || payload?.msg || `qq_openapi_http_${response.status}`
            throw new OfficialOpenApiError(message, {
                httpStatus: response.status,
                qqCode,
                retryAfterMs,
                path,
                method
            })
        }

        return payload || {}
    }

    getGateway() {
        return this.requestJson('GET', '/gateway')
    }

    getGatewayBot() {
        return this.requestJson('GET', '/gateway/bot')
    }

    sendGroupMessage(groupOpenId, body) {
        return this.requestJson('POST', `/v2/groups/${encodeURIComponent(groupOpenId)}/messages`, { body })
    }

    sendC2CMessage(userOpenId, body) {
        return this.requestJson('POST', `/v2/users/${encodeURIComponent(userOpenId)}/messages`, { body })
    }

    uploadGroupMedia(groupOpenId, body) {
        return this.requestJson('POST', `/v2/groups/${encodeURIComponent(groupOpenId)}/files`, { body })
    }

    uploadC2CMedia(userOpenId, body) {
        return this.requestJson('POST', `/v2/users/${encodeURIComponent(userOpenId)}/files`, { body })
    }

    recallGroupMessage(groupOpenId, messageId, options = {}) {
        const query = options.hidetip ? '?hidetip=true' : ''
        return this.requestJson('DELETE', `/v2/groups/${encodeURIComponent(groupOpenId)}/messages/${encodeURIComponent(messageId)}${query}`)
    }

    recallC2CMessage(userOpenId, messageId, options = {}) {
        const query = options.hidetip ? '?hidetip=true' : ''
        return this.requestJson('DELETE', `/v2/users/${encodeURIComponent(userOpenId)}/messages/${encodeURIComponent(messageId)}${query}`)
    }

    listPanels(scope, options = {}) {
        const params = new URLSearchParams()
        if (scope) params.set('scope', scope)
        if (options.cursor) params.set('cursor', String(options.cursor))
        if (options.limit) params.set('limit', String(options.limit))
        const query = params.toString()
        return this.requestJson('GET', `/v2/panels${query ? `?${query}` : ''}`)
    }

    createPanel(body) {
        return this.requestJson('POST', '/v2/panels', { body })
    }

    getPanel(panelId) {
        return this.requestJson('GET', `/v2/panels/${encodeURIComponent(panelId)}`)
    }

    updatePanel(panelId, body) {
        return this.requestJson('PUT', `/v2/panels/${encodeURIComponent(panelId)}`, { body })
    }

    deletePanel(panelId) {
        return this.requestJson('DELETE', `/v2/panels/${encodeURIComponent(panelId)}`)
    }

    // 群信息接口需要白名单权限（错误码 11253 = 无权限），调用方需自行容错。
    getGroupInfo(groupOpenId) {
        return this.requestJson('GET', `/v2/groups/${encodeURIComponent(groupOpenId)}/info`)
    }
}

module.exports = OfficialOpenApiClient
module.exports.DEFAULT_API_BASE = DEFAULT_API_BASE
