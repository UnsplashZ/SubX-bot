const express = require('express')
const path = require('path')
const fs = require('fs')
const { runPreviewDebugSession } = require('./session')
const { parseBoolean, sanitizeOutputName } = require('./cliOptions')
const {
    SUPPORTED_MOCK_TYPES,
    normalizeStructureOptions
} = require('./mockData')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 17870
const ALLOWED_FILE_SUFFIXES = ['.png', '.json', '.manifest.json', '.html']

function resolveOutputDir(customOutputDir) {
    return path.resolve(process.cwd(), customOutputDir || 'test/output')
}

function isAllowedOutputFile(fileName) {
    const normalized = path.basename(String(fileName || ''))
    if (!normalized || normalized !== fileName) {
        return false
    }
    return ALLOWED_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

function normalizeMode(value) {
    return value === 'structure' ? 'structure' : 'link'
}

function normalizeRunOptions(body = {}, outputDir) {
    return {
        mode: normalizeMode(body.mode),
        groupId: body.groupId ? String(body.groupId) : null,
        cacheMode: parseBoolean(body.fresh, false) ? 'fresh' : 'cached',
        emitHtml: parseBoolean(body.emitHtml, false),
        showId: parseBoolean(body.showId, true),
        outName: sanitizeOutputName(body.outName || ''),
        outputDir,
        mockType: body.mockType ? String(body.mockType) : '',
        structureOptions: normalizeStructureOptions(
            body.structureOptions && typeof body.structureOptions === 'object'
                ? body.structureOptions
                : {}
        ),
        renderOverrides: body.renderOverrides && typeof body.renderOverrides === 'object'
            ? body.renderOverrides
            : {}
    }
}

function createPreviewLabWebApp(deps = {}) {
    const app = express()
    const runSession = deps.runPreviewDebugSession || runPreviewDebugSession
    const outputDir = resolveOutputDir(deps.outputDir)
    const webDir = path.join(__dirname, 'web')
    const state = {
        busy: false,
        lastRunSummary: null
    }

    app.use(express.json({ limit: '2mb' }))
    app.use(express.static(webDir))

    app.get('/api/health', (req, res) => {
        res.json({
            status: 'ok',
            busy: state.busy,
            outputDir,
            lastRunSummary: state.lastRunSummary
        })
    })

    app.post('/api/run', async (req, res) => {
        if (state.busy) {
            return res.status(409).json({
                status: 'busy',
                message: '已有预览任务在执行，请稍后重试'
            })
        }

        const options = normalizeRunOptions(req.body, outputDir)
        const input = String(req.body?.input || '').trim()

        if (options.mode === 'link' && !input) {
            return res.status(400).json({
                status: 'error',
                message: '缺少输入链接'
            })
        }

        if (options.mode === 'structure' && !options.mockType) {
            return res.status(400).json({
                status: 'error',
                message: '结构预览模式缺少类型'
            })
        }

        if (options.mode === 'structure' && !SUPPORTED_MOCK_TYPES.includes(options.mockType)) {
            return res.status(400).json({
                status: 'error',
                message: `未支持的结构预览类型: ${options.mockType}`
            })
        }

        state.busy = true
        const startedAt = new Date().toISOString()

        try {
            const result = await runSession(input, options)
            const { manifest, dataPayload, previewTargetSummary, artifactsSummary } = result
            const imageUrl = `/api/files/${encodeURIComponent(path.basename(manifest.pngPath))}`

            state.lastRunSummary = {
                status: 'success',
                input,
                startedAt,
                finishedAt: manifest.finishedAt,
                cardType: manifest.cardType,
                canonicalUrl: manifest.canonicalUrl,
                outputName: manifest.outputName
            }

            return res.json({
                status: 'success',
                manifest,
                dataPayload,
                previewTargetSummary,
                artifactsSummary,
                renderHtml: artifactsSummary.renderHtml,
                imageUrl
            })
        } catch (error) {
            state.lastRunSummary = {
                status: 'error',
                input,
                startedAt,
                finishedAt: new Date().toISOString(),
                error: error.message
            }
            return res.status(500).json({
                status: 'error',
                message: error.message
            })
        } finally {
            state.busy = false
        }
    })

    app.get('/api/files/:filename', (req, res) => {
        const fileName = String(req.params.filename || '')
        if (!isAllowedOutputFile(fileName)) {
            return res.status(400).json({
                status: 'error',
                message: '不允许访问该文件'
            })
        }

        const filePath = path.join(outputDir, fileName)
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                status: 'error',
                message: '文件不存在'
            })
        }

        return res.sendFile(filePath)
    })

    app.get(/(.*)/, (req, res) => {
        res.sendFile(path.join(webDir, 'index.html'))
    })

    return {
        app,
        state,
        outputDir
    }
}

function startPreviewLabWebServer(options = {}, deps = {}) {
    const host = options.host || DEFAULT_HOST
    const port = Number(options.port) || DEFAULT_PORT
    const { app } = createPreviewLabWebApp({
        ...deps,
        outputDir: options.outputDir
    })

    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            resolve({ server, host, port })
        })
        server.on('error', reject)
    })
}

module.exports = {
    DEFAULT_HOST,
    DEFAULT_PORT,
    createPreviewLabWebApp,
    startPreviewLabWebServer,
    isAllowedOutputFile
}
