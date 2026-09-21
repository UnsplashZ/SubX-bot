#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const request = require('supertest')
const { createPreviewLabWebApp, isAllowedOutputFile } = require('../../tools/preview-lab/webServer')

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'preview-lab-web-'))
}

async function testIndexPageLoads() {
    const { app } = createPreviewLabWebApp({
        outputDir: createTempDir(),
        runPreviewDebugSession: async () => {
            throw new Error('should not run')
        }
    })

    const res = await request(app).get('/')
    assert.strictEqual(res.status, 200)
    assert.match(res.text, /本地预览实验台/)
}

async function testRunApiReturnsStructuredPayload() {
    const outputDir = createTempDir()
    const { app } = createPreviewLabWebApp({
        outputDir,
        runPreviewDebugSession: async () => ({
            status: 'success',
            manifest: {
                status: 'success',
                input: 'https://t.bilibili.com/1180316687231090707',
                resolvedLink: { type: 'dynamic', id: '1180316687231090707' },
                cardType: 'dynamic',
                canonicalUrl: 'https://t.bilibili.com/1180316687231090707',
                pngPath: path.join(outputDir, 'demo.png'),
                jsonPath: path.join(outputDir, 'demo.json'),
                manifestPath: path.join(outputDir, 'demo.manifest.json'),
                outputName: 'demo',
                debugMeta: { themeClass: 'theme-light' }
            },
            dataPayload: {
                input: 'https://t.bilibili.com/1180316687231090707',
                cardType: 'dynamic'
            },
            previewTargetSummary: {
                cardType: 'dynamic',
                canonicalUrl: 'https://t.bilibili.com/1180316687231090707'
            },
            artifactsSummary: {
                renderHtml: '<div>preview</div>',
                debugMeta: { themeClass: 'theme-light' }
            }
        })
    })

    const res = await request(app)
        .post('/api/run')
        .send({
            input: 'https://t.bilibili.com/1180316687231090707',
            emitHtml: true
        })

    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.status, 'success')
    assert.strictEqual(res.body.manifest.cardType, 'dynamic')
    assert.strictEqual(res.body.imageUrl, '/api/files/demo.png')
    assert.strictEqual(res.body.renderHtml, '<div>preview</div>')
}

async function testRunApiAcceptsStructureModePayload() {
    const outputDir = createTempDir()
    let capturedOptions = null
    const { app } = createPreviewLabWebApp({
        outputDir,
        runPreviewDebugSession: async (_input, options) => {
            capturedOptions = options
            return {
                status: 'success',
                manifest: {
                    status: 'success',
                    mode: 'structure',
                    mockType: 'dynamic',
                    structureOptions: options.structureOptions,
                    input: '',
                    resolvedLink: { type: 'dynamic', id: 'structure' },
                    cardType: 'dynamic',
                    canonicalUrl: 'preview-lab://structure/dynamic',
                    pngPath: path.join(outputDir, 'structure.png'),
                    jsonPath: path.join(outputDir, 'structure.json'),
                    manifestPath: path.join(outputDir, 'structure.manifest.json'),
                    outputName: 'structure',
                    debugMeta: { themeClass: 'theme-light' }
                },
                dataPayload: {
                    mode: 'structure',
                    mockType: 'dynamic',
                    structureOptions: options.structureOptions
                },
                previewTargetSummary: {
                    cardType: 'dynamic',
                    canonicalUrl: 'preview-lab://structure/dynamic'
                },
                artifactsSummary: {
                    renderHtml: '<div>structure</div>',
                    debugMeta: { themeClass: 'theme-light' }
                }
            }
        }
    })

    const res = await request(app)
        .post('/api/run')
        .send({
            mode: 'structure',
            mockType: 'dynamic',
            structureOptions: {
                mediaMode: 'grid',
                withCommonCard: true
            }
        })

    assert.strictEqual(res.status, 200)
    assert.strictEqual(capturedOptions.mode, 'structure')
    assert.strictEqual(capturedOptions.mockType, 'dynamic')
    assert.deepStrictEqual(capturedOptions.structureOptions, {
        mediaMode: 'grid',
        isForward: false,
        withCommonCard: true,
        withEmbeddedResource: false,
        withOpusLinkCard: false,
        withVote: false,
        blocked: false,
        seasonType: 'bangumi'
    })
    assert.strictEqual(res.body.manifest.mode, 'structure')
    assert.strictEqual(res.body.manifest.mockType, 'dynamic')
}

async function testRunApiRejectsStructureModeWithoutMockType() {
    const { app } = createPreviewLabWebApp({
        outputDir: createTempDir(),
        runPreviewDebugSession: async () => {
            throw new Error('should not run')
        }
    })

    const res = await request(app)
        .post('/api/run')
        .send({
            mode: 'structure'
        })

    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.status, 'error')
    assert.match(res.body.message, /缺少类型/)
}

async function testRunApiReturnsBusyWhenJobIsRunning() {
    const outputDir = createTempDir()
    const { app, state } = createPreviewLabWebApp({
        outputDir,
        runPreviewDebugSession: async () => {
            throw new Error('should not run')
        }
    })

    state.busy = true

    const secondResponse = await request(app)
        .post('/api/run')
        .send({ input: 'https://t.bilibili.com/2' })

    assert.strictEqual(secondResponse.status, 409)
    assert.strictEqual(secondResponse.body.status, 'busy')
}

async function testFileApiOnlyAllowsWhitelistedOutputFiles() {
    const outputDir = createTempDir()
    fs.writeFileSync(path.join(outputDir, 'demo.png'), 'fake')
    fs.writeFileSync(path.join(outputDir, 'secret.txt'), 'nope')

    const { app } = createPreviewLabWebApp({
        outputDir,
        runPreviewDebugSession: async () => {
            throw new Error('should not run')
        }
    })

    const allowed = await request(app).get('/api/files/demo.png')
    assert.strictEqual(allowed.status, 200)

    const denied = await request(app).get('/api/files/secret.txt')
    assert.strictEqual(denied.status, 400)

    assert.strictEqual(isAllowedOutputFile('demo.manifest.json'), true)
    assert.strictEqual(isAllowedOutputFile('../demo.png'), false)
}

async function run() {
    await testIndexPageLoads()
    await testRunApiReturnsStructuredPayload()
    await testRunApiAcceptsStructureModePayload()
    await testRunApiRejectsStructureModeWithoutMockType()
    await testRunApiReturnsBusyWhenJobIsRunning()
    await testFileApiOnlyAllowsWhitelistedOutputFiles()
    console.log('PASS preview-lab-web-server')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
