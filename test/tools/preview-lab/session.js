const fs = require('fs')
const path = require('path')
const { generatePreviewCardArtifacts } = require('../../../src/services/imageGenerator/generators/previewCard')
const { generateHelpCard } = require('../../../src/services/imageGenerator/generators/helpCard')
const { generateSubscriptionList } = require('../../../src/services/imageGenerator/generators/subscriptionList')
const { isNightMode } = require('../../../src/services/imageGenerator/core/theme')
const { resolvePreviewInput } = require('./inputResolver')
const { resolvePreviewTarget } = require('./targetResolver')
const { buildPreviewDebugHtml } = require('./htmlReport')
const { buildMockPreviewTarget, normalizeStructureOptions } = require('./mockData')

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true })
}

function sanitizeFileName(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function buildDefaultOutputName(resolvedLink) {
    const datePrefix = new Date().toISOString().slice(0, 10)
    return sanitizeFileName(`${datePrefix}-${resolvedLink.type}-${resolvedLink.id}`) || `${datePrefix}-preview`
}

function createStructureResolvedInput(options = {}) {
    const mockType = String(options.mockType || 'dynamic')
    const previewUrl = `preview-lab://structure/${mockType}`
    return {
        input: '',
        normalizedInput: previewUrl,
        resolvedLink: {
            type: mockType,
            id: 'structure',
            match: previewUrl
        },
        skippedLinks: []
    }
}

function createGeneratorDebugMeta(label, icon, groupId) {
    return {
        viewport: {},
        themeClass: isNightMode(groupId || null) ? 'theme-dark' : 'theme-light',
        resolvedTypeConfig: {
            label,
            icon
        },
        colorSummary: {}
    }
}

async function generateStructureArtifacts(previewTarget, options = {}, deps = {}) {
    const runPreviewCardArtifacts = deps.generatePreviewCardArtifacts || generatePreviewCardArtifacts
    const mockType = previewTarget.mockType || options.mockType

    if (mockType === 'help_user') {
        return {
            base64: await (deps.generateHelpCard || generateHelpCard)('user', options.groupId || null),
            html: '',
            debugMeta: createGeneratorDebugMeta('使用帮助', '💡', options.groupId)
        }
    }

    if (mockType === 'help_admin') {
        return {
            base64: await (deps.generateHelpCard || generateHelpCard)('admin', options.groupId || null),
            html: '',
            debugMeta: createGeneratorDebugMeta('管理面板', '⚙️', options.groupId)
        }
    }

    if (mockType === 'subscription_list') {
        return {
            base64: await (deps.generateSubscriptionList || generateSubscriptionList)(
                previewTarget.info?.data || {},
                options.groupId || null,
                options.showId,
                '订阅列表'
            ),
            html: '',
            debugMeta: createGeneratorDebugMeta('订阅列表', '📋', options.groupId)
        }
    }

    return runPreviewCardArtifacts(
        previewTarget.info,
        previewTarget.cardType,
        options.groupId || null,
        options.showId,
        {
            renderOverrides: options.renderOverrides || {},
            collectElementMetadata: Boolean(options.collectElementMetadata)
        }
    )
}

async function runPreviewDebugSession(input, options = {}, deps = {}) {
    const startedAt = new Date().toISOString()
    const outputDir = path.resolve(process.cwd(), options.outputDir || 'test/output')
    const mode = options.mode === 'structure' ? 'structure' : 'link'
    const normalizedStructureOptions = normalizeStructureOptions(options.structureOptions || {})
    const resolvedInput = mode === 'structure'
        ? createStructureResolvedInput(options)
        : await (deps.resolvePreviewInput || resolvePreviewInput)(input, options, deps)
    const previewTarget = mode === 'structure'
        ? (deps.buildMockPreviewTarget || buildMockPreviewTarget)(options.mockType, normalizedStructureOptions)
        : await (deps.resolvePreviewTarget || resolvePreviewTarget)(resolvedInput.resolvedLink, options, deps)

    if (!previewTarget.info || previewTarget.info.status !== 'success') {
        const targetUrl = previewTarget.url || resolvedInput.resolvedLink.match || input
        throw new Error(`预览数据获取失败: ${previewTarget.info?.message || previewTarget.info?.status || targetUrl}`)
    }

    const artifacts = mode === 'structure'
        ? await generateStructureArtifacts(previewTarget, options, deps)
        : await (deps.generatePreviewCardArtifacts || generatePreviewCardArtifacts)(
            previewTarget.info,
            previewTarget.cardType,
            options.groupId || null,
            options.showId,
            {
                renderOverrides: options.renderOverrides || {},
                collectElementMetadata: Boolean(options.collectElementMetadata)
            }
        )

    const outputName = sanitizeFileName(options.outName) || buildDefaultOutputName(resolvedInput.resolvedLink)
    ensureDirectory(outputDir)

    const pngPath = path.join(outputDir, `${outputName}.png`)
    const jsonPath = path.join(outputDir, `${outputName}.json`)
    const manifestPath = path.join(outputDir, `${outputName}.manifest.json`)
    const htmlPath = options.emitHtml ? path.join(outputDir, `${outputName}.html`) : ''

    fs.writeFileSync(pngPath, Buffer.from(artifacts.base64, 'base64'))

    const dataPayload = {
        mode,
        input: resolvedInput.input,
        normalizedInput: resolvedInput.normalizedInput,
        resolvedLink: resolvedInput.resolvedLink,
        skippedLinks: resolvedInput.skippedLinks,
        cardType: previewTarget.cardType,
        canonicalUrl: previewTarget.canonicalUrl,
        info: previewTarget.info,
        renderHtml: artifacts.html,
        debugMeta: artifacts.debugMeta,
        renderOverrides: options.renderOverrides || {},
        mockType: mode === 'structure' ? String(options.mockType || '') : '',
        structureOptions: mode === 'structure' ? normalizedStructureOptions : {}
    }
    fs.writeFileSync(jsonPath, JSON.stringify(dataPayload, null, 2))

    const manifest = {
        mode,
        input: resolvedInput.input,
        resolvedLink: resolvedInput.resolvedLink,
        skippedLinks: resolvedInput.skippedLinks,
        cardType: previewTarget.cardType,
        canonicalUrl: previewTarget.canonicalUrl,
        status: 'success',
        jsonPath,
        pngPath,
        htmlPath,
        startedAt,
        finishedAt: new Date().toISOString(),
        outputName,
        debugMeta: artifacts.debugMeta,
        renderOverrides: options.renderOverrides || {},
        mockType: mode === 'structure' ? String(options.mockType || '') : '',
        structureOptions: mode === 'structure' ? normalizedStructureOptions : {}
    }

    if (options.emitHtml) {
        const html = buildPreviewDebugHtml({
            manifest,
            dataPayload,
            dataFileName: path.basename(jsonPath),
            imageFileName: path.basename(pngPath),
            renderHtml: artifacts.html
        })
        fs.writeFileSync(htmlPath, html)
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    manifest.manifestPath = manifestPath
    return {
        status: 'success',
        manifest,
        dataPayload,
        previewTargetSummary: {
            status: previewTarget.status,
            cardType: previewTarget.cardType,
            canonicalUrl: previewTarget.canonicalUrl
        },
        artifactsSummary: {
            renderHtml: artifacts.html,
            debugMeta: artifacts.debugMeta
        }
    }
}

module.exports = {
    runPreviewDebugSession
}
