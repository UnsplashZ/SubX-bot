#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { runPreviewDebugSession } = require('../../tools/preview-lab/session')

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'preview-lab-'))
}

async function testRunPreviewDebugSessionWritesManifestJsonPngAndHtml() {
    const outputDir = createTempDir()
    const resolvedLink = {
        type: 'dynamic',
        id: '1180316687231090707',
        match: 'https://t.bilibili.com/1180316687231090707'
    }
    const result = await runPreviewDebugSession('https://t.bilibili.com/1180316687231090707', {
        outputDir,
        emitHtml: true,
        outName: 'demo-preview',
        showId: false,
        renderOverrides: { future: true }
    }, {
        resolvePreviewInput: async () => ({
            input: 'https://t.bilibili.com/1180316687231090707',
            normalizedInput: 'https://t.bilibili.com/1180316687231090707',
            resolvedLink,
            skippedLinks: []
        }),
        resolvePreviewTarget: async () => ({
            status: 'success',
            cardType: 'dynamic',
            canonicalUrl: 'https://t.bilibili.com/1180316687231090707',
            info: {
                status: 'success',
                type: 'dynamic',
                data: {
                    item: {
                        id_str: '1180316687231090707'
                    }
                }
            }
        }),
        generatePreviewCardArtifacts: async (_info, cardType, _groupId, showId, options) => {
            assert.strictEqual(cardType, 'dynamic')
            assert.strictEqual(showId, false)
            assert.deepStrictEqual(options.renderOverrides, { future: true })
            return {
                base64: Buffer.from('fake-png').toString('base64'),
                html: '<html><body>preview</body></html>',
                debugMeta: {
                    viewport: { width: 1200, height: 800 },
                    themeClass: 'theme-light',
                    resolvedTypeConfig: { label: '动态', icon: 'D' },
                    colorSummary: { background: '#fff' }
                }
            }
        }
    })
    const { manifest } = result

    assert.strictEqual(result.status, 'success')
    assert.strictEqual(manifest.status, 'success')
    assert.strictEqual(manifest.mode, 'link')
    assert.strictEqual(manifest.outputName, 'demo-preview')
    assert.ok(fs.existsSync(manifest.pngPath))
    assert.ok(fs.existsSync(manifest.jsonPath))
    assert.ok(fs.existsSync(manifest.manifestPath))
    assert.ok(fs.existsSync(manifest.htmlPath))
    assert.strictEqual(result.previewTargetSummary.cardType, 'dynamic')
    assert.strictEqual(result.artifactsSummary.debugMeta.themeClass, 'theme-light')

    const jsonPayload = JSON.parse(fs.readFileSync(manifest.jsonPath, 'utf8'))
    assert.strictEqual(jsonPayload.cardType, 'dynamic')
    assert.strictEqual(jsonPayload.canonicalUrl, 'https://t.bilibili.com/1180316687231090707')
    assert.deepStrictEqual(jsonPayload.renderOverrides, { future: true })

    const htmlPayload = fs.readFileSync(manifest.htmlPath, 'utf8')
    assert.match(htmlPayload, /demo-preview\.png/)
    assert.match(htmlPayload, /preview/)
}

async function testRunPreviewDebugSessionSupportsStructureModeWithoutLinkResolution() {
    const outputDir = createTempDir()
    let resolvePreviewInputCalled = false
    let resolvePreviewTargetCalled = false

    const result = await runPreviewDebugSession('', {
        mode: 'structure',
        mockType: 'dynamic',
        outputDir,
        outName: 'structure-preview',
        emitHtml: true,
        structureOptions: {
            mediaMode: 'grid',
            withCommonCard: true
        }
    }, {
        resolvePreviewInput: async () => {
            resolvePreviewInputCalled = true
            throw new Error('should not resolve input in structure mode')
        },
        resolvePreviewTarget: async () => {
            resolvePreviewTargetCalled = true
            throw new Error('should not resolve target in structure mode')
        },
        buildMockPreviewTarget: (mockType, structureOptions) => ({
            status: 'success',
            mockType,
            cardType: 'dynamic',
            canonicalUrl: 'preview-lab://structure/dynamic',
            info: {
                status: 'success',
                type: 'dynamic',
                data: {
                    item: {
                        id_str: 'mock-dynamic'
                    }
                }
            },
            structureOptions
        }),
        generatePreviewCardArtifacts: async (_info, cardType, _groupId, _showId, options) => {
            assert.strictEqual(cardType, 'dynamic')
            assert.deepStrictEqual(options.renderOverrides, {})
            return {
                base64: Buffer.from('structure-png').toString('base64'),
                html: '<html><body>structure</body></html>',
                debugMeta: {
                    viewport: { width: 1200, height: 800 },
                    themeClass: 'theme-dark',
                    resolvedTypeConfig: { label: '动态', icon: 'D' },
                    colorSummary: { background: '#000' }
                }
            }
        }
    })

    assert.strictEqual(resolvePreviewInputCalled, false)
    assert.strictEqual(resolvePreviewTargetCalled, false)
    assert.strictEqual(result.manifest.mode, 'structure')
    assert.strictEqual(result.manifest.mockType, 'dynamic')
    assert.deepStrictEqual(result.manifest.structureOptions, {
        mediaMode: 'grid',
        isForward: false,
        withCommonCard: true,
        withEmbeddedResource: false,
        withOpusLinkCard: false,
        withVote: false,
        blocked: false,
        seasonType: 'bangumi'
    })

    const jsonPayload = JSON.parse(fs.readFileSync(result.manifest.jsonPath, 'utf8'))
    assert.strictEqual(jsonPayload.mode, 'structure')
    assert.strictEqual(jsonPayload.mockType, 'dynamic')
    assert.strictEqual(jsonPayload.resolvedLink.type, 'dynamic')
    assert.strictEqual(jsonPayload.resolvedLink.id, 'structure')
}

async function testRunPreviewDebugSessionStructureModeWithEmbeddedResourceUsesDirectRendererOutput() {
    const outputDir = createTempDir()

    const result = await runPreviewDebugSession('', {
        mode: 'structure',
        mockType: 'dynamic',
        outputDir,
        outName: 'structure-embedded-resource',
        structureOptions: {
            withEmbeddedResource: true
        }
    }, {
        buildMockPreviewTarget: (mockType, structureOptions) => ({
            status: 'success',
            mockType,
            cardType: 'dynamic',
            canonicalUrl: 'preview-lab://structure/dynamic',
            info: {
                status: 'success',
                type: 'dynamic',
                data: {
                    item: {
                        id_str: 'mock-dynamic',
                        modules: {
                            module_dynamic: {
                                major: {
                                    type: 'MAJOR_TYPE_MEDIALIST',
                                    medialist: {
                                        title: '结构占位收藏夹',
                                        sub_title: '9个内容',
                                        cover: 'https://example.com/list.jpg'
                                    }
                                }
                            }
                        }
                    }
                }
            },
            structureOptions
        }),
        generatePreviewCardArtifacts: async () => ({
            base64: Buffer.from('direct-render').toString('base64'),
            html: '<html><body><div class="container"><div class="card"><div class="content"><div class="embedded-resource-card"></div><div class="action-bar"></div></div></div></div></body></html>',
            debugMeta: {
                viewport: { width: 1200, height: 800 },
                themeClass: 'theme-light',
                resolvedTypeConfig: { label: '动态', icon: 'D' },
                colorSummary: {}
            }
        }),
        renderInjectedStructureArtifacts: async () => {
            throw new Error('should not use preview-only injection path')
        }
    })

    assert.strictEqual(result.manifest.mode, 'structure')
    assert.strictEqual(result.manifest.mockType, 'dynamic')
    assert.match(result.artifactsSummary.renderHtml, /embedded-resource-card/)
    assert.deepStrictEqual(result.manifest.structureOptions, {
        mediaMode: 'single',
        isForward: false,
        withCommonCard: false,
        withEmbeddedResource: true,
        withOpusLinkCard: false,
        withVote: false,
        blocked: false,
        seasonType: 'bangumi'
    })
}

async function testRunPreviewDebugSessionSupportsStructureModeSpecialGenerators() {
    const outputDir = createTempDir()
    const result = await runPreviewDebugSession('', {
        mode: 'structure',
        mockType: 'help_admin',
        outputDir,
        outName: 'help-admin-structure'
    }, {
        buildMockPreviewTarget: () => ({
            status: 'success',
            mockType: 'help_admin',
            cardType: 'help_admin',
            canonicalUrl: 'preview-lab://structure/help_admin',
            info: {
                status: 'success',
                type: 'help_admin',
                data: { title: 'help' }
            }
        }),
        generateHelpCard: async (type) => {
            assert.strictEqual(type, 'admin')
            return Buffer.from('help-admin').toString('base64')
        }
    })

    assert.strictEqual(result.manifest.mode, 'structure')
    assert.strictEqual(result.manifest.mockType, 'help_admin')
    assert.strictEqual(result.artifactsSummary.renderHtml, '')
    assert.strictEqual(result.artifactsSummary.debugMeta.resolvedTypeConfig.label, '管理面板')

}

async function testRunPreviewDebugSessionThrowsOnFailedTarget() {
    let error = null
    try {
        await runPreviewDebugSession('https://www.bilibili.com/read/cv45123193', { outputDir: createTempDir() }, {
            resolvePreviewInput: async () => ({
                input: 'https://www.bilibili.com/read/cv45123193',
                normalizedInput: 'https://www.bilibili.com/read/cv45123193',
                resolvedLink: { type: 'article', id: '45123193', match: 'https://www.bilibili.com/read/cv45123193' },
                skippedLinks: []
            }),
            resolvePreviewTarget: async () => ({
                status: 'error',
                url: 'https://www.bilibili.com/read/cv45123193',
                info: { status: 'error', message: 'mock failed' }
            })
        })
    } catch (caught) {
        error = caught
    }

    assert.ok(error)
    assert.match(error.message, /预览数据获取失败: mock failed/)
}

async function run() {
    await testRunPreviewDebugSessionWritesManifestJsonPngAndHtml()
    await testRunPreviewDebugSessionSupportsStructureModeWithoutLinkResolution()
    await testRunPreviewDebugSessionStructureModeWithEmbeddedResourceUsesDirectRendererOutput()
    await testRunPreviewDebugSessionSupportsStructureModeSpecialGenerators()
    await testRunPreviewDebugSessionThrowsOnFailedTarget()
    console.log('PASS preview-lab-session')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
