function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function buildPreviewDebugHtml({ manifest, dataPayload, dataFileName, imageFileName, renderHtml = '' }) {
    const resolvedLink = manifest.resolvedLink || {}
    const skippedLinks = manifest.skippedLinks || []
    const debugMeta = manifest.debugMeta || {}
    const prettyManifest = JSON.stringify(manifest, null, 2)
    const prettyDataPayload = JSON.stringify(dataPayload || {}, null, 2)

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview Lab - ${escapeHtml(manifest.outputName)}</title>
  <style>
    body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #0f1115; color: #e8eaed; }
    .layout { display: grid; grid-template-columns: 320px minmax(420px, 1fr) 420px; gap: 16px; padding: 16px; min-height: 100vh; box-sizing: border-box; }
    .panel { background: #171a21; border: 1px solid #2b313d; border-radius: 14px; padding: 16px; box-sizing: border-box; overflow: hidden; }
    .panel h2 { margin: 0 0 12px; font-size: 16px; }
    .field { margin-bottom: 12px; }
    .field-label { display: block; color: #9aa4b2; font-size: 12px; margin-bottom: 4px; }
    .field-value { word-break: break-all; white-space: pre-wrap; line-height: 1.5; }
    .preview-frame { width: 100%; max-width: 100%; display: flex; justify-content: center; align-items: flex-start; overflow: auto; }
    .preview-frame img { max-width: 100%; border-radius: 12px; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35); }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; line-height: 1.45; color: #d4dae2; }
    details { margin-top: 12px; }
    summary { cursor: pointer; color: #8ab4f8; }
    a { color: #8ab4f8; }
    ul { margin: 0; padding-left: 18px; }
  </style>
</head>
<body>
  <div class="layout">
    <section class="panel">
      <h2>输入与解析</h2>
      <div class="field"><span class="field-label">Input</span><div class="field-value">${escapeHtml(manifest.input)}</div></div>
      <div class="field"><span class="field-label">Resolved Type</span><div class="field-value">${escapeHtml(resolvedLink.type)}</div></div>
      <div class="field"><span class="field-label">Resolved ID</span><div class="field-value">${escapeHtml(resolvedLink.id)}</div></div>
      <div class="field"><span class="field-label">Card Type</span><div class="field-value">${escapeHtml(manifest.cardType)}</div></div>
      <div class="field"><span class="field-label">Canonical URL</span><div class="field-value"><a href="${escapeHtml(manifest.canonicalUrl)}">${escapeHtml(manifest.canonicalUrl)}</a></div></div>
      <div class="field"><span class="field-label">JSON 文件</span><div class="field-value">${escapeHtml(dataFileName)}</div></div>
      <div class="field"><span class="field-label">Viewport</span><div class="field-value">${escapeHtml(JSON.stringify(debugMeta.viewport || {}))}</div></div>
      <div class="field"><span class="field-label">Theme</span><div class="field-value">${escapeHtml(debugMeta.themeClass || '')}</div></div>
      <div class="field"><span class="field-label">Skipped Links</span><div class="field-value">${skippedLinks.length ? `<ul>${skippedLinks.map(link => `<li>${escapeHtml(`${link.type}:${link.id}`)}</li>`).join('')}</ul>` : '无'}</div></div>
    </section>
    <section class="panel">
      <h2>最终预览图</h2>
      <div class="preview-frame">
        <img src="./${escapeHtml(imageFileName)}" alt="preview image">
      </div>
      <details>
        <summary>查看渲染 HTML</summary>
        <pre>${escapeHtml(renderHtml)}</pre>
      </details>
    </section>
    <section class="panel">
      <h2>标准化 JSON</h2>
      <pre>${escapeHtml(prettyDataPayload)}</pre>
      <details>
        <summary>查看 Manifest</summary>
        <pre>${escapeHtml(prettyManifest)}</pre>
      </details>
    </section>
  </div>
</body>
</html>`
}

module.exports = {
    buildPreviewDebugHtml
}
