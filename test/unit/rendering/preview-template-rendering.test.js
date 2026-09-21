#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { buildMockPreviewTarget } = require('../../tools/preview-lab/mockData')
const { getDefaultTemplate } = require('../../../src/services/previewTemplate/defaults')
const { generatePreviewCard, generatePreviewCardArtifacts } = require('../../../src/services/imageGenerator/generators/previewCard')
const imageGenerator = require('../../../src/services/imageGenerator')
const config = require('../../../src/config')

describe('preview template rendering', function () {
    this.timeout(60000)
    const originalPreviewLayoutConfig = config.previewLayoutConfig

    after(async function () {
        config.__getMutableCompatStateForTests().previewLayoutConfig = originalPreviewLayoutConfig
        await imageGenerator.cleanup()
    })

    it('renders all editable default templates through Puppeteer and returns node metadata', async function () {
        const types = ['video', 'dynamic', 'article', 'live', 'bangumi', 'user']

        for (const type of types) {
            const target = buildMockPreviewTarget(type, {
                mediaMode: 'grid',
                isForward: true,
                withCommonCard: true,
                withEmbeddedResource: true,
                withOpusLinkCard: true,
                withVote: true
            })
            const artifacts = await generatePreviewCardArtifacts(target.info, type, null, true, {
                draftTemplate: getDefaultTemplate(type),
                collectElementMetadata: true
            })

            assert.ok(artifacts.base64.length > 1000, `${type} should render a png`)
            assert.strictEqual(artifacts.debugMeta.renderer, 'preview-template-v2')
            assert.ok(artifacts.html.includes('data-template-node-id="root"'), `${type} should expose template ids`)
            assert.ok(artifacts.html.includes('data-layout-key='), `${type} should keep layout keys`)
            assert.ok(artifacts.elementMetadata.container.width > 0, `${type} should return container metadata`)
            assert.ok(artifacts.elementMetadata.elements.root?.box, `${type} should return root metadata`)
        }
    })

    it('generates editable cards through the v2 template path even with legacy config', async function () {
        config.__getMutableCompatStateForTests().previewLayoutConfig = {
            version: 1,
            global: {
                video: {
                    elements: {
                        cover: { layout: { offsetX: 12 } }
                    }
                }
            }
        }
        const target = buildMockPreviewTarget('video')
        const base64 = await generatePreviewCard(target.info, 'video', null, true)
        assert.ok(base64.length > 1000)
    })
})
