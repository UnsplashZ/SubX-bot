const BaseQqProvider = require('./baseProvider')
const { NAPCAT_CAPABILITIES } = require('./capabilities')

class NapcatProvider extends BaseQqProvider {
    constructor(ws = null) {
        super({
            id: 'napcat',
            name: 'NapCat OneBot',
            capabilities: NAPCAT_CAPABILITIES
        })
        this.ws = ws
        this._stopPromise = null
        this.stopTimeoutMs = 3000
        this.stopForceGraceMs = 500
        this.loginReady = false
        this.selfId = null
    }

    setWebSocket(ws) {
        this.ws = ws
    }

    get readyState() {
        return this.ws?.readyState ?? 0
    }

    getStatus() {
        return {
            ...super.getStatus(),
            connectionState: this.readyState === 1 && this.loginReady ? 'ready' : (this.readyState === 1 ? 'authenticating' : 'disconnected'),
            wsReadyState: this.readyState
        }
    }

    isRuntimeReady() {
        return this.readyState === 1 && this.loginReady && Boolean(String(this.selfId || '').trim())
    }

    async waitUntilReady(timeoutMs = 10000) {
        if (!this.ws) throw new Error('NapCat WebSocket is not configured')
        if (this.readyState !== 1) await new Promise((resolve, reject) => {
            let timer = null
            const cleanup = () => {
                if (timer) clearTimeout(timer)
                this.ws?.removeListener?.('open', onOpen)
                this.ws?.removeListener?.('error', onError)
                this.ws?.removeListener?.('close', onClose)
            }
            const onOpen = () => { cleanup(); resolve() }
            const onError = (error) => { cleanup(); reject(error) }
            const onClose = () => { cleanup(); reject(new Error('NapCat WebSocket closed before ready')) }
            this.ws.once?.('open', onOpen)
            this.ws.once?.('error', onError)
            this.ws.once?.('close', onClose)
            timer = setTimeout(() => {
                cleanup()
                const error = new Error('NapCat WebSocket readiness timed out')
                error.code = 'NAPCAT_READY_TIMEOUT'
                reject(error)
            }, Math.max(1, Number(timeoutMs) || 10000))
        })
        if (this.loginReady) return this
        const echo = `provider_ready#${Date.now()}#${Math.random().toString(36).slice(2, 10)}`
        await new Promise((resolve, reject) => {
            let timer = null
            const cleanup = () => {
                if (timer) clearTimeout(timer)
                this.ws?.removeListener?.('message', onMessage)
                this.ws?.removeListener?.('error', onError)
                this.ws?.removeListener?.('close', onClose)
            }
            const onMessage = (raw) => {
                let payload
                try {
                    payload = JSON.parse(String(raw))
                } catch {
                    return
                }
                if (payload?.echo !== echo) return
                if (Number(payload.retcode ?? 0) !== 0 || !payload.data?.user_id) {
                    cleanup()
                    const error = new Error('NapCat login identity probe failed')
                    error.code = 'NAPCAT_LOGIN_PROBE_FAILED'
                    reject(error)
                    return
                }
                this.markLoginReady(payload.data.user_id)
                cleanup()
                resolve()
            }
            const onError = (error) => { cleanup(); reject(error) }
            const onClose = () => { cleanup(); reject(new Error('NapCat WebSocket closed during login probe')) }
            this.ws.on?.('message', onMessage)
            this.ws.once?.('error', onError)
            this.ws.once?.('close', onClose)
            timer = setTimeout(() => {
                cleanup()
                const error = new Error('NapCat login identity probe timed out')
                error.code = 'NAPCAT_LOGIN_PROBE_TIMEOUT'
                reject(error)
            }, Math.max(1, Number(timeoutMs) || 10000))
            try {
                this.ws.send?.(JSON.stringify({ action: 'get_login_info', params: {}, echo }))
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
        return this
    }

    markLoginReady(selfId) {
        const value = String(selfId ?? '').trim()
        if (!value) return false
        this.selfId = value
        this.loginReady = true
        return true
    }

    async stop() {
        if (this._stopPromise) return this._stopPromise
        const ws = this.ws
        this.loginReady = false
        const stopPromise = (async () => {
            if (!ws) return
            ws.removeAllListeners?.('open')
            ws.removeAllListeners?.('message')
            ws.removeAllListeners?.('error')
            // Closing a CONNECTING ws emits an asynchronous error before close.
            // Keep it handled after the readiness listener has been removed.
            ws.on?.('error', () => {})
            ws.removeAllListeners?.('unexpected-response')
            if (ws.readyState === 3) {
                ws.removeAllListeners?.('close')
                if (this.ws === ws) this.ws = null
                return
            }
            await new Promise((resolve, reject) => {
                let timer = null
                let forceGraceTimer = null
                let settled = false
                const cleanup = () => {
                    if (timer) clearTimeout(timer)
                    if (forceGraceTimer) clearTimeout(forceGraceTimer)
                    ws.removeListener?.('close', done)
                }
                const done = () => {
                    if (settled) return
                    settled = true
                    cleanup()
                    resolve()
                }
                ws.once?.('close', done)
                timer = setTimeout(() => {
                    try {
                        ws.terminate?.()
                    } catch (cause) {
                        settled = true
                        cleanup()
                        const error = new Error(`NapCat WebSocket terminate failed: ${cause.message}`)
                        error.code = 'NAPCAT_STOP_FAILED'
                        error.cause = cause
                        reject(error)
                        return
                    }
                    if (ws.readyState === 3) {
                        done()
                        return
                    }
                    forceGraceTimer = setTimeout(() => {
                        if (settled) return
                        settled = true
                        cleanup()
                        const error = new Error('NapCat WebSocket did not close before hard deadline')
                        error.code = 'NAPCAT_STOP_TIMEOUT'
                        error.readyState = ws.readyState
                        reject(error)
                    }, Math.max(1, this.stopForceGraceMs))
                }, Math.max(1, this.stopTimeoutMs))
                try {
                    if (ws.readyState === 0 || ws.readyState === 1) ws.close?.()
                    else if (ws.readyState === 3) done()
                } catch (cause) {
                    settled = true
                    cleanup()
                    const error = new Error(`NapCat WebSocket close failed: ${cause.message}`)
                    error.code = 'NAPCAT_STOP_FAILED'
                    error.cause = cause
                    reject(error)
                }
            })
            if (this.ws === ws) this.ws = null
        })()
        this._stopPromise = stopPromise
        try {
            return await stopPromise
        } catch (error) {
            if (this._stopPromise === stopPromise) this._stopPromise = null
            if (!this.ws) this.ws = ws
            throw error
        }
    }
}

module.exports = NapcatProvider
