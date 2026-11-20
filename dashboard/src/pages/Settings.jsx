import { useEffect, useRef, useState } from 'react'
import api from '../utils/auth'
import { useToast } from '../hooks/useToast'
import GeneralSettingsSection from './settings/components/GeneralSettingsSection'
import QqProviderSection from './settings/components/QqProviderSection'
import BiliGlobalSection from './settings/components/BiliGlobalSection'
import GlobalBlacklistSection from './settings/components/GlobalBlacklistSection'
import VideoDownloadSection from './settings/components/VideoDownloadSection'
import ExternalParserSection from './settings/components/ExternalParserSection'
import PreviewGradientSection from './settings/components/PreviewGradientSection'
import ConfigRuntimeStatusSection from './settings/components/ConfigRuntimeStatusSection'
import SystemControlSection from './settings/components/SystemControlSection'
import RestartConfirmModal from './settings/components/RestartConfirmModal'
import BiliQrModal from './settings/components/BiliQrModal'
import useSettingsData from './settings/hooks/useSettingsData'
import useBiliLogin from './settings/hooks/useBiliLogin'
import usePreviewGradientSettings from './settings/hooks/usePreviewGradientSettings'
import { Check, CloudUpload, Loader2, X } from 'lucide-react'

const formatSavedAt = (date) =>
  date
    ? date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : ''

const AUTO_SAVE_INDICATORS = {
  pending: { icon: CloudUpload, className: 'text-[var(--muted)]', text: '待保存' },
  saving: { icon: Loader2, className: 'text-[var(--accent)]', text: '自动保存中...', spin: true },
  saved: { icon: Check, className: 'text-emerald-500', text: '' },
  error: { icon: X, className: 'text-red-500', text: '自动保存失败，将在下次修改时重试' }
}

const createScrollLock = (id, top) => ({ id, top, expiresAt: Date.now() + 1500 })

const SETTINGS_SECTIONS = [
  { id: 'settings-general', label: '常规' },
  { id: 'settings-runtime', label: '运行状态' },
  { id: 'settings-qq-provider', label: 'QQ 连接' },
  { id: 'settings-bili', label: 'B站登录' },
  { id: 'settings-blacklist', label: '黑名单' },
  { id: 'settings-video', label: '视频下载' },
  { id: 'settings-external', label: '外部平台' },
  { id: 'settings-preview', label: '预览氛围' },
  { id: 'settings-system', label: '系统控制' }
]

const AutoSaveIndicator = ({ state }) => {
  if (!state || state.status === 'idle') return null
  const indicator = AUTO_SAVE_INDICATORS[state.status] || AUTO_SAVE_INDICATORS.pending
  const Icon = indicator.icon
  const text = state.status === 'saved'
    ? `已自动保存 ${formatSavedAt(state.savedAt)}`
    : indicator.text
  return (
    <div className={`flex items-center gap-1.5 text-xs ${indicator.className}`} role="status">
      <Icon size={14} className={indicator.spin ? 'animate-spin' : ''} />
      <span>{text}</span>
    </div>
  )
}

const Settings = () => {
  const { show } = useToast()
  const [isRestartModalOpen, setIsRestartModalOpen] = useState(false)
  const [activeSection, setActiveSection] = useState(SETTINGS_SECTIONS[0].id)
  const previewGradientGenerationRef = useRef(null)
  const sectionNavRef = useRef(null)
  const programmaticScrollRef = useRef(null)

  const settingsData = useSettingsData(show)
  const biliActions = useBiliLogin({
    show,
    setBiliGlobalStatus: settingsData.setBiliGlobalStatus
  })
  const previewGradientSettings = usePreviewGradientSettings(show, previewGradientGenerationRef)

  useEffect(() => {
    if (settingsData.loading) return undefined
    const sections = SETTINGS_SECTIONS
      .map((item) => document.getElementById(item.id))
      .filter(Boolean)
    if (sections.length === 0) return undefined

    let frameId = 0
    const requestFrame = window.requestAnimationFrame
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 16)
    const cancelFrame = window.cancelAnimationFrame
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window)

    const updateActiveSection = () => {
      frameId = 0
      const pendingScroll = programmaticScrollRef.current
      if (pendingScroll) {
        if (Date.now() < pendingScroll.expiresAt && Math.abs(window.scrollY - pendingScroll.top) > 2) {
          return
        }
        programmaticScrollRef.current = null
      }

      const scrollTop = window.scrollY
      const viewportHeight = window.innerHeight
      const documentHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0
      )
      if (!viewportHeight || !documentHeight) return

      // 页面触底时强制高亮最后一个分区，避免短分区永远进不了观察区间。
      if (scrollTop + viewportHeight >= documentHeight - 2) {
        setActiveSection(sections[sections.length - 1].id)
        return
      }

      const activationLine = scrollTop + Math.min(viewportHeight * 0.28, 220)
      let nextSectionId = sections[0].id
      for (const section of sections) {
        const sectionTop = section.getBoundingClientRect().top + scrollTop
        if (sectionTop > activationLine + 1) break
        nextSectionId = section.id
      }
      setActiveSection(nextSectionId)
    }

    const requestUpdate = () => {
      if (frameId) return
      frameId = requestFrame(updateActiveSection)
    }

    window.addEventListener('scroll', requestUpdate, { passive: true })
    window.addEventListener('resize', requestUpdate)
    requestUpdate()

    return () => {
      if (frameId) cancelFrame(frameId)
      window.removeEventListener('scroll', requestUpdate)
      window.removeEventListener('resize', requestUpdate)
    }
  }, [settingsData.loading])

  useEffect(() => {
    const nav = sectionNavRef.current
    if (!nav) return
    const activeButton = nav.querySelector('button[aria-current="true"]')
    if (!activeButton) return
    const needsHorizontalScroll = nav.scrollWidth > nav.clientWidth + 1
    const needsVerticalScroll = nav.scrollHeight > nav.clientHeight + 1
    if (!needsHorizontalScroll && !needsVerticalScroll) return
    const navRect = nav.getBoundingClientRect()
    const buttonRect = activeButton.getBoundingClientRect()
    const maxLeft = nav.scrollWidth - nav.clientWidth
    const maxTop = nav.scrollHeight - nav.clientHeight
    const nextLeft = needsHorizontalScroll
      ? Math.max(0, Math.min(
        nav.scrollLeft + buttonRect.left - navRect.left - (nav.clientWidth - buttonRect.width) / 2,
        maxLeft
      ))
      : nav.scrollLeft
    const nextTop = needsVerticalScroll
      ? Math.max(0, Math.min(
        nav.scrollTop + buttonRect.top - navRect.top - (nav.clientHeight - buttonRect.height) / 2,
        maxTop
      ))
      : nav.scrollTop
    if (Math.abs(nav.scrollLeft - nextLeft) < 1 && Math.abs(nav.scrollTop - nextTop) < 1) return
    nav.scrollTo({ left: nextLeft, top: nextTop, behavior: 'smooth' })
  }, [activeSection])

  const scrollToSection = (id) => {
    const section = document.getElementById(id)
    if (!section) return
    const isDesktop = window.matchMedia?.('(min-width: 1024px)').matches
    let offset = 96
    if (!isDesktop) {
      const fixedHeader = Array.from(document.querySelectorAll('header'))
        .find((header) => window.getComputedStyle(header).position === 'fixed')
      offset = (fixedHeader?.getBoundingClientRect().height || 0)
        + (sectionNavRef.current?.getBoundingClientRect().height || 0)
        + 12
    }
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const targetTop = Math.min(
      Math.max(0, section.getBoundingClientRect().top + window.scrollY - offset),
      maxScroll
    )
    programmaticScrollRef.current = createScrollLock(id, targetTop)
    setActiveSection(id)
    window.scrollTo({ top: targetTop, behavior: 'smooth' })
  }

  const handleRestart = () => {
    setIsRestartModalOpen(true)
  }

  const confirmRestart = async () => {
    setIsRestartModalOpen(false)
    try {
      await api.post('/api/restart')
      show('系统重启已启动。', 'success')
    } catch (error) {
      console.error('Failed to restart:', error)
      show('重启系统失败', 'error')
    }
  }

  if (settingsData.loading) {
    return <div className="p-8 text-center text-[var(--muted)]">正在加载设置...</div>
  }

  const recoveryRequired = settingsData.configStatus?.recoveryRequired?.required === true

  return (
    <div className="admin-page space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-[var(--fg)]">系统设置</h1>
          <p className="mt-1.5 text-sm text-[var(--muted)]">配置运行环境、连接方式和全局行为，修改后自动保存。</p>
        </div>
        <AutoSaveIndicator state={settingsData.autoSaveState} />
      </header>

      <div className="grid gap-5 lg:grid-cols-[176px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav
          ref={sectionNavRef}
          aria-label="设置分区"
          className="sticky top-14 z-20 -mx-3 flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 md:top-0 lg:top-8 lg:mx-0 lg:block lg:max-h-[calc(100dvh-4rem)] lg:space-y-0.5 lg:overflow-y-auto lg:border-0 lg:bg-transparent lg:px-0 lg:py-0"
        >
          <div className="hidden px-3 pb-2 text-xs font-semibold text-[var(--muted)] lg:block">设置分区</div>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              aria-current={activeSection === section.id ? 'true' : undefined}
              className={`flex min-h-11 shrink-0 lg:min-h-10 items-center justify-between rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-full ${
                activeSection === section.id
                  ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-muted)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-quiet)] hover:text-[var(--fg)]'
              }`}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-6 md:space-y-8">
          <div id="settings-general" className="scroll-mt-24">
            <GeneralSettingsSection
              generalConfig={settingsData.generalConfig}
              onGeneralChange={settingsData.handleGeneralChange}
              disabled={recoveryRequired}
            />
          </div>

          <div id="settings-runtime" className="scroll-mt-24">
            <ConfigRuntimeStatusSection
              status={settingsData.configStatus}
              migration={settingsData.migrationStatus}
              lastApplyResult={settingsData.lastApplyResult}
              reloading={settingsData.reloadingConfig}
              onReload={settingsData.reloadConfig}
              recovering={settingsData.recoveringConfig}
              recoveryResult={settingsData.recoveryResult}
              onRecover={settingsData.recoverConfig}
            />
          </div>

          <div id="settings-qq-provider" className="scroll-mt-24">
            <QqProviderSection
              config={settingsData.qqProviderConfig}
              status={settingsData.qqProviderStatus}
              onClearSecret={settingsData.clearOfficialSecret}
              onClearToken={settingsData.clearOnebotToken}
              disabled={recoveryRequired}
              onChange={(field, value) => settingsData.setQqProviderConfig(p => ({ ...p, [field]: value }))}
            />
          </div>

          <div id="settings-bili" className="scroll-mt-24">
            <BiliGlobalSection
              biliGlobalStatus={settingsData.biliGlobalStatus}
              biliLoading={biliActions.biliLoading}
              onLogin={biliActions.handleBiliGlobalLogin}
              onLogout={biliActions.handleBiliGlobalLogout}
            />
          </div>

          <div id="settings-blacklist" className="scroll-mt-24">
            <GlobalBlacklistSection
              blacklist={settingsData.blacklist}
              newBlacklistQQ={settingsData.newBlacklistQQ}
              addingBlacklist={settingsData.addingBlacklist}
              onNewBlacklistQQChange={settingsData.setNewBlacklistQQ}
              onAddBlacklist={settingsData.handleAddBlacklist}
              onRemoveBlacklist={settingsData.handleRemoveBlacklist}
              disabled={recoveryRequired}
            />
          </div>

          <div id="settings-video" className="scroll-mt-24">
            <VideoDownloadSection
              videoDownloadConfig={settingsData.videoDownloadConfig}
              onVideoDownloadChange={(field, value) => settingsData.setVideoDownloadConfig(p => ({ ...p, [field]: value }))}
              disabled={recoveryRequired}
            />
          </div>

          <div id="settings-external" className="scroll-mt-24">
            <ExternalParserSection
              config={settingsData.externalParserConfig}
              onChange={(field, value) => settingsData.setExternalParserConfig(p => ({ ...p, [field]: value }))}
              onClearCookie={settingsData.clearXiaohongshuCookie}
              disabled={recoveryRequired}
            />
          </div>

          <div id="settings-preview" className="scroll-mt-24">
            <PreviewGradientSection
              previewGradientConfig={previewGradientSettings.previewGradientConfig}
              onPreviewGradientChange={previewGradientSettings.handlePreviewGradientChange}
              onResetPreviewGradient={previewGradientSettings.resetPreviewGradientSettings}
              onSavePreviewGradient={previewGradientSettings.savePreviewGradientSettings}
              saving={previewGradientSettings.savingPreviewGradient}
            />
          </div>

          <div id="settings-system" className="scroll-mt-24">
            <SystemControlSection onRestart={handleRestart} />
          </div>
        </div>
      </div>

      <RestartConfirmModal
        isOpen={isRestartModalOpen}
        onClose={() => setIsRestartModalOpen(false)}
        onConfirm={confirmRestart}
      />

      <BiliQrModal
        isOpen={biliActions.isQrModalOpen}
        onClose={biliActions.closeQrModal}
        qrCodeUrl={biliActions.qrCodeUrl}
      />
    </div>
  )
}

export default Settings
