import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useBiliLogin from './useBiliLogin'
import api from '../../../utils/auth'

vi.mock('../../../utils/auth', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    api.get.mockResolvedValue({ data: { data: { url: 'https://example.com', key: 'test-key', image: 'data:image/png;base64,test' } } })
})
afterEach(() => vi.useRealTimers())

it('shows a backend credential error and stops polling', async () => {
    const show = vi.fn()
    api.post.mockResolvedValue({ data: { status: 'error', message: 'B站未返回完整登录凭据，请重新扫码' } })
    const { result, unmount } = renderHook(() => useBiliLogin({ show, setBiliGlobalStatus: vi.fn() }))
    await act(async () => result.current.handleBiliGlobalLogin())
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(show).toHaveBeenCalledWith('B站未返回完整登录凭据，请重新扫码', 'error')
    expect(result.current.isQrModalOpen).toBe(false)
    expect(result.current.biliLoading).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(api.post).toHaveBeenCalledTimes(1)
    unmount()
})

it('does not overlap slow polling requests', async () => {
    let resolvePoll
    api.post.mockReturnValue(new Promise(resolve => { resolvePoll = resolve }))
    const { result, unmount } = renderHook(() => useBiliLogin({ show: vi.fn(), setBiliGlobalStatus: vi.fn() }))
    await act(async () => result.current.handleBiliGlobalLogin())
    await act(async () => vi.advanceTimersByTimeAsync(8000))
    expect(api.post).toHaveBeenCalledTimes(1)
    await act(async () => resolvePoll({ data: { status: 'pending' } }))
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(api.post).toHaveBeenCalledTimes(2)
    unmount()
})
