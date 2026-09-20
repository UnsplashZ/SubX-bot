import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'
import useSettingsData from './settings/hooks/useSettingsData'

vi.mock('../hooks/useToast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('./settings/hooks/useSettingsData', () => ({ default: vi.fn() }))
vi.mock('./settings/hooks/useBiliLogin', () => ({
  default: () => ({
    biliLoading: false,
    handleBiliGlobalLogin: vi.fn(),
    handleBiliGlobalLogout: vi.fn(),
    isQrModalOpen: false,
    closeQrModal: vi.fn(),
    qrCodeUrl: ''
  })
}))

function recoverySettingsData() {
  return {
    loading: false,
    generalConfig: { subscriptionCheckInterval: 300, linkCacheTimeout: 600, showId: true },
    handleGeneralChange: vi.fn(),
    blacklist: [],
    newBlacklistQQ: '',
    setNewBlacklistQQ: vi.fn(),
    addingBlacklist: false,
    handleAddBlacklist: vi.fn(),
    handleRemoveBlacklist: vi.fn(),
    videoDownloadConfig: {
      videoDownloadEnabled: false,
      videoDownloadResolution: '1080p',
      videoDownloadMaxDuration: 600,
      videoDownloadAutoClean: true,
      videoDownloadCleanTimeout: 6
    },
    setVideoDownloadConfig: vi.fn(),
    qqProviderConfig: { qqProvider: 'napcat', qqOfficialRootOpenids: [] },
    setQqProviderConfig: vi.fn(),
    qqProviderStatus: null,
    clearOfficialSecret: vi.fn(),
    autoSaveState: { status: 'idle', savedAt: null },
    configStatus: {
      valid: true,
      documentGeneration: 8,
      effectiveGeneration: 7,
      recoveryRequired: { required: true, code: 'CONFIG_RECOVERY_FAILED', reason: 'runtime-reload-failed' }
    },
    migrationStatus: null,
    lastApplyResult: null,
    reloadingConfig: false,
    reloadConfig: vi.fn(),
    recoveringConfig: false,
    recoveryResult: null,
    recoverConfig: vi.fn(),
    biliGlobalStatus: { isLoggedIn: false },
    setBiliGlobalStatus: vi.fn()
  }
}

describe('Settings recovery lockout', () => {
  beforeEach(() => useSettingsData.mockReturnValue(recoverySettingsData()))

  it('disables reload and ordinary configuration controls while recovery is required', () => {
    render(<Settings />)

    expect(screen.getByRole('button', { name: /从磁盘重载/ })).toBeDisabled()
    expect(screen.getByRole('switch', { name: '显示 UID' })).toBeDisabled()
    expect(screen.getByPlaceholderText('输入 QQ 号')).toBeDisabled()
    expect(screen.getAllByRole('spinbutton').every(control => control.disabled)).toBe(true)
    expect(screen.getByRole('button', { name: /恢复运行时/ })).toBeEnabled()
  })
})
