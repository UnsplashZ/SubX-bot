(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
  if (root) {
    root.previewLabUiState = api
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STRUCTURE_TYPE_OPTIONS = [
    { value: 'dynamic', label: '动态' },
    { value: 'user', label: '用户主页' },
    { value: 'video', label: '视频' },
    { value: 'live', label: '直播间' },
    { value: 'article', label: '专栏' },
    { value: 'bangumi', label: '番剧/电影' },
    { value: 'help_user', label: '帮助菜单' },
    { value: 'help_admin', label: '管理菜单' },
    { value: 'subscription_list', label: '订阅列表' }
  ]

  function supportsDynamicOptions(mockType) {
    return mockType === 'dynamic' || mockType === 'user'
  }

  function supportsSeasonType(mockType) {
    return mockType === 'bangumi'
  }

  function getVisibilityState(mode, mockType) {
    const isStructureMode = mode === 'structure'
    return {
      showLinkInput: !isStructureMode,
      showStructureControls: isStructureMode,
      showDynamicOptions: isStructureMode && supportsDynamicOptions(mockType),
      showSeasonType: isStructureMode && supportsSeasonType(mockType)
    }
  }

  function buildResultImageUrl(imageUrl, manifest) {
    const finishedAt = manifest && manifest.finishedAt ? String(manifest.finishedAt) : `${Date.now()}`
    const separator = String(imageUrl || '').includes('?') ? '&' : '?'
    return `${imageUrl}${separator}t=${encodeURIComponent(finishedAt)}`
  }

  return {
    STRUCTURE_TYPE_OPTIONS,
    buildResultImageUrl,
    supportsDynamicOptions,
    supportsSeasonType,
    getVisibilityState
  }
}))
