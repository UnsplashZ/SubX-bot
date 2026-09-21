(function () {
  const uiState = window.previewLabUiState
  const inputEl = document.getElementById('input')
  const inputFieldEl = document.getElementById('inputField')
  const mockTypeFieldEl = document.getElementById('mockTypeField')
  const seasonTypeFieldEl = document.getElementById('seasonTypeField')
  const groupIdEl = document.getElementById('groupId')
  const outNameEl = document.getElementById('outName')
  const freshEl = document.getElementById('fresh')
  const emitHtmlEl = document.getElementById('emitHtml')
  const showIdEl = document.getElementById('showId')
  const modeLinkEl = document.getElementById('modeLink')
  const modeStructureEl = document.getElementById('modeStructure')
  const mockTypeEl = document.getElementById('mockType')
  const seasonTypeEl = document.getElementById('seasonType')
  const dynamicOptionsPanelEl = document.getElementById('dynamicOptionsPanel')
  const mediaModeEl = document.getElementById('mediaMode')
  const isForwardEl = document.getElementById('isForward')
  const withEmbeddedResourceEl = document.getElementById('withEmbeddedResource')
  const withOpusLinkCardEl = document.getElementById('withOpusLinkCard')
  const withVoteEl = document.getElementById('withVote')
  const withCommonCardEl = document.getElementById('withCommonCard')
  const blockedEl = document.getElementById('blocked')
  const runBtnEl = document.getElementById('runBtn')
  const runStatusEl = document.getElementById('run-status')
  const healthStatusEl = document.getElementById('health-status')
  const errorBannerEl = document.getElementById('error-banner')
  const summaryEl = document.getElementById('summary')
  const previewFrameEl = document.getElementById('preview-frame')
  const renderHtmlEl = document.getElementById('render-html')
  const dataJsonEl = document.getElementById('data-json')
  const manifestJsonEl = document.getElementById('manifest-json')

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function setBusy(isBusy) {
    runBtnEl.disabled = isBusy
    runStatusEl.textContent = isBusy ? '执行中...' : '待执行'
  }

  function showError(message) {
    errorBannerEl.textContent = message
    errorBannerEl.classList.remove('hidden')
  }

  function clearError() {
    errorBannerEl.textContent = ''
    errorBannerEl.classList.add('hidden')
  }

  function getCurrentMode() {
    return modeStructureEl.checked ? 'structure' : 'link'
  }

  function setHidden(element, hidden) {
    element.classList.toggle('hidden', hidden)
  }

  function buildStructureOptions() {
    return {
      mediaMode: mediaModeEl.value,
      isForward: isForwardEl.checked,
      withCommonCard: withCommonCardEl.checked,
      withEmbeddedResource: withEmbeddedResourceEl.checked,
      withOpusLinkCard: withOpusLinkCardEl.checked,
      withVote: withVoteEl.checked,
      blocked: blockedEl.checked,
      seasonType: seasonTypeEl.value
    }
  }

  function syncModeVisibility() {
    const mode = getCurrentMode()
    const mockType = mockTypeEl.value
    const visibility = uiState.getVisibilityState(mode, mockType)
    setHidden(inputFieldEl, !visibility.showLinkInput)
    setHidden(mockTypeFieldEl, !visibility.showStructureControls)
    setHidden(dynamicOptionsPanelEl, !visibility.showDynamicOptions)
    setHidden(seasonTypeFieldEl, !visibility.showSeasonType)
  }

  function populateStructureTypes() {
    mockTypeEl.innerHTML = uiState.STRUCTURE_TYPE_OPTIONS.map((item) => (
      `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`
    )).join('')
  }

  function renderSummary(result) {
    const { manifest, previewTargetSummary } = result
    const debugMeta = manifest.debugMeta || {}
    const rows = [
      { key: 'Mode', value: escapeHtml(manifest.mode || 'link') },
      { key: 'Mock Type', value: escapeHtml(manifest.mockType || '') },
      { key: 'Input', value: escapeHtml(manifest.input) },
      { key: 'Resolved Type', value: escapeHtml(`${manifest.resolvedLink.type || ''}`) },
      { key: 'Resolved ID', value: escapeHtml(`${manifest.resolvedLink.id || ''}`) },
      { key: 'Card Type', value: escapeHtml(manifest.cardType) },
      {
        key: 'Canonical URL',
        value: `<a href="${escapeHtml(manifest.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(manifest.canonicalUrl)}</a>`,
        isHtml: true
      },
      { key: 'JSON 文件', value: escapeHtml(manifest.jsonPath) },
      { key: 'Manifest 文件', value: escapeHtml(manifest.manifestPath) },
      { key: '输出名', value: escapeHtml(manifest.outputName) },
      { key: 'Viewport', value: escapeHtml(JSON.stringify(debugMeta.viewport || {})) },
      { key: 'Theme', value: escapeHtml(debugMeta.themeClass || '') },
      { key: 'Structure Options', value: escapeHtml(JSON.stringify(manifest.structureOptions || {})) },
      { key: 'Preview Summary', value: escapeHtml(JSON.stringify(previewTargetSummary || {})) }
    ]

    summaryEl.innerHTML = `<div class="summary-list">${rows.map((row) => `
      <div class="summary-item">
        <div class="summary-key">${escapeHtml(row.key)}</div>
        <div class="summary-value">${row.isHtml ? row.value : row.value}</div>
      </div>
    `).join('')}</div>`
  }

  function renderPreview(result) {
    const imageSrc = uiState.buildResultImageUrl(result.imageUrl, result.manifest)
    previewFrameEl.innerHTML = `<img src="${imageSrc}" alt="preview image">`
    renderHtmlEl.textContent = result.renderHtml || '暂无数据'
    dataJsonEl.textContent = JSON.stringify(result.dataPayload, null, 2)
    manifestJsonEl.textContent = JSON.stringify(result.manifest, null, 2)
  }

  async function refreshHealth() {
    try {
      const response = await fetch('/api/health')
      const payload = await response.json()
      healthStatusEl.textContent = payload.busy
        ? '服务忙碌中'
        : `服务正常 · 输出目录 ${payload.outputDir}`
    } catch (_error) {
      healthStatusEl.textContent = '服务状态获取失败'
    }
  }

  async function runPreview() {
    const mode = getCurrentMode()
    const input = inputEl.value.trim()
    if (mode === 'link' && !input) {
      showError('请输入一个 B 站链接')
      return
    }

    clearError()
    setBusy(true)

    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mode,
          input,
          groupId: groupIdEl.value.trim(),
          outName: outNameEl.value.trim(),
          fresh: freshEl.checked,
          emitHtml: emitHtmlEl.checked,
          showId: showIdEl.checked,
          mockType: mode === 'structure' ? mockTypeEl.value : '',
          structureOptions: mode === 'structure' ? buildStructureOptions() : {}
        })
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || `请求失败: ${response.status}`)
      }

      renderSummary(payload)
      renderPreview(payload)
      runStatusEl.textContent = '执行完成'
      refreshHealth()
    } catch (error) {
      runStatusEl.textContent = '执行失败'
      showError(error.message || String(error))
    } finally {
      setBusy(false)
    }
  }

  populateStructureTypes()
  mockTypeEl.value = 'dynamic'
  seasonTypeEl.value = 'bangumi'
  mediaModeEl.value = 'single'
  modeLinkEl.addEventListener('change', syncModeVisibility)
  modeStructureEl.addEventListener('change', syncModeVisibility)
  mockTypeEl.addEventListener('change', syncModeVisibility)
  runBtnEl.addEventListener('click', runPreview)
  inputEl.value = 'https://www.bilibili.com/read/cv45123193'
  syncModeVisibility()
  refreshHealth()
}())
