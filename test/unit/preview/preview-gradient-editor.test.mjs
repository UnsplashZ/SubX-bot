#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..', '..')

async function loadPreviewGradientModel() {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, 'dashboard/src/pages/settings/components/previewGradientModel.js')
  ).href
  return import(moduleUrl)
}

async function testResolveEffectivePreviewGradientColors() {
  const { resolveEffectivePreviewGradientColors } = await loadPreviewGradientModel()

  const resolved = resolveEffectivePreviewGradientColors(
    {
      previewGradientColor1: '#f6b7d8',
      previewGradientColor2: 'invalid'
    },
    {
      previewGradientColor1: '#fb7299',
      previewGradientColor2: '#bfd9ff'
    }
  )

  assert.deepStrictEqual(resolved, {
    previewGradientColor1: '#F6B7D8',
    previewGradientColor2: '#BFD9FF'
  })
}

function testPreviewGradientSectionUsesPreviewModalEntry() {
  const source = fs.readFileSync(
    path.join(repoRoot, 'dashboard/src/pages/settings/components/PreviewGradientSection.jsx'),
    'utf8'
  )

  assert.ok(source.includes('PreviewGradientModal'))
  assert.ok(source.includes('查看预览'))
  assert.ok(source.includes('保存氛围色'))
  assert.ok(!source.includes('即时渐变反馈'))
}

function testSettingsPageHostsPreviewGradientSection() {
  const source = fs.readFileSync(
    path.join(repoRoot, 'dashboard/src/pages/Settings.jsx'),
    'utf8'
  )

  assert.ok(source.includes('PreviewGradientSection'))
  assert.ok(source.includes('usePreviewGradientSettings'))
}

function testPreviewModalExists() {
  const source = fs.readFileSync(
    path.join(repoRoot, 'dashboard/src/pages/settings/components/PreviewGradientModal.jsx'),
    'utf8'
  )

  assert.ok(source.includes('预览图效果'))
  assert.ok(source.includes('当前氛围色合成后的卡片效果'))
  assert.ok(source.includes('buildGradientBackground'))
}

await testResolveEffectivePreviewGradientColors()
testPreviewGradientSectionUsesPreviewModalEntry()
testSettingsPageHostsPreviewGradientSection()
testPreviewModalExists()

console.log('PASS preview-gradient-editor')
