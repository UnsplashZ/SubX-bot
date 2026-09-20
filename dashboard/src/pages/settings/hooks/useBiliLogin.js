import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import api from '../../../utils/auth'

export default function useBiliLogin({ show, setBiliGlobalStatus }) {
    const [biliLoading, setBiliLoading] = useState(false)
    const [qrCodeUrl, setQrCodeUrl] = useState('')
    const [isQrModalOpen, setIsQrModalOpen] = useState(false)
    const qrPollIntervalRef = useRef(null)
    const qrSessionIdRef = useRef(0)

    const clearQrPolling = () => {
        if (qrPollIntervalRef.current) {
            clearInterval(qrPollIntervalRef.current)
            qrPollIntervalRef.current = null
        }
    }

    const startQrPolling = (key, sessionId) => {
        let attempts = 0
        let inFlight = false
        const maxAttempts = 30

        clearQrPolling()
        const interval = setInterval(async () => {
            if (sessionId !== qrSessionIdRef.current) {
                clearInterval(interval)
                return
            }

            if (inFlight) return
            attempts++

            if (attempts > maxAttempts) {
                clearInterval(interval)
                qrPollIntervalRef.current = null
                setIsQrModalOpen(false)
                setBiliLoading(false)
                show('登录超时，请重试', 'error')
                return
            }

            inFlight = true
            try {
                const statusRes = await api.post('/api/bili/check-login', {
                    key
                })

                if (sessionId !== qrSessionIdRef.current) {
                    clearInterval(interval)
                    return
                }

                if (statusRes.data.status === 'success') {
                    clearInterval(interval)
                    qrPollIntervalRef.current = null
                    setIsQrModalOpen(false)
                    setBiliLoading(false)
                    show('B站全局登录成功！', 'success')

                    const newStatus = await api.get('/api/bili/global-status?refresh=1')
                    if (newStatus.data.isLoggedIn) {
                        setBiliGlobalStatus({
                            isLoggedIn: true,
                            uid: newStatus.data.uid,
                            username: newStatus.data.username,
                            timestamp: newStatus.data.timestamp
                        })
                    } else {
                        setBiliGlobalStatus({
                            isLoggedIn: false,
                            uid: null,
                            username: '',
                            timestamp: null
                        })
                        show(newStatus.data.message || '登录状态获取失败', 'error')
                    }
                } else if (statusRes.data.status === 'error' && statusRes.data.code !== 86038) {
                    clearInterval(interval)
                    qrPollIntervalRef.current = null
                    setBiliLoading(false)
                    setIsQrModalOpen(false)
                    show(statusRes.data.message || 'B站登录失败，请重试', 'error')
                } else if (statusRes.data.status === 'expired' || (statusRes.data.status === 'error' && statusRes.data.code === 86038)) {
                    clearInterval(interval)
                    qrPollIntervalRef.current = null
                    setBiliLoading(false)
                    show('二维码已过期', 'error')
                    setIsQrModalOpen(false)
                }
            } catch (error) {
                if (sessionId !== qrSessionIdRef.current) {
                    clearInterval(interval)
                    return
                }
                clearInterval(interval)
                qrPollIntervalRef.current = null
                setBiliLoading(false)
                console.error('Login polling error:', error)
                setIsQrModalOpen(false)
                show('登录检查失败', 'error')
            } finally {
                inFlight = false
            }
        }, 2000)

        qrPollIntervalRef.current = interval
    }

    const handleBiliGlobalLogin = async () => {
        if (biliLoading) return
        setBiliLoading(true)
        try {
            clearQrPolling()
            qrSessionIdRef.current += 1
            const sessionId = qrSessionIdRef.current

            const res = await api.get('/api/bili/login-url')

            if (res.data && res.data.status === 'error') {
                show(`获取登录二维码失败: ${res.data.message || '未知错误'}`, 'error')
                setBiliLoading(false)
                return
            }

            if (res.data && res.data.data && res.data.data.url) {
                const qrDataUrl = res.data.data.image || await QRCode.toDataURL(res.data.data.url, {
                    errorCorrectionLevel: 'M',
                    margin: 4,
                    width: 320
                })
                setQrCodeUrl(qrDataUrl)
                setIsQrModalOpen(true)

                startQrPolling(res.data.data.key, sessionId)
            } else {
                show('获取登录二维码失败: 响应格式错误', 'error')
                setBiliLoading(false)
            }
        } catch (error) {
            console.error('Failed to get QR code:', error)
            show('获取二维码失败', 'error')
            setBiliLoading(false)
        }
    }

    const handleBiliGlobalLogout = async () => {
        if (!window.confirm('确定要退出全局B站登录吗？这将影响所有未单独登录的群组。')) {
            return
        }

        setBiliLoading(true)
        try {
            await api.post('/api/bili/logout', {})
            setBiliGlobalStatus({
                isLoggedIn: false,
                uid: null,
                username: '',
                timestamp: null
            })
            show('已退出B站全局登录', 'success')
        } catch (error) {
            console.error('Failed to logout:', error)
            show('退出登录失败', 'error')
        } finally {
            setBiliLoading(false)
        }
    }

    const closeQrModal = () => {
        qrSessionIdRef.current += 1
        clearQrPolling()
        setIsQrModalOpen(false)
        setBiliLoading(false)
    }

    useEffect(() => {
        return () => {
            clearQrPolling()
            qrSessionIdRef.current += 1
        }
    }, [])

    return {
        biliLoading,
        qrCodeUrl,
        isQrModalOpen,
        handleBiliGlobalLogin,
        handleBiliGlobalLogout,
        closeQrModal
    }
}
