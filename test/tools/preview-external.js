#!/usr/bin/env node
'use strict'

// 外部平台（抖音 / 小红书）预览卡集成验证工具。
// 与 preview-lab 的区别：preview-lab 的 targetResolver 只支持 B 站类型，
// 本工具直接走 linkExtractor → linkRegistry handler.fetch 的真实链路。
//
// 用法:
//   node test/tools/preview-external.js "<抖音或小红书链接>" [--out-name <name>] [--html]

const fs = require('fs')
const path = require('path')

const linkServices = require('../../src/services/link')
const linkRegistry = require('../../src/services/link/linkRegistry')
const { generatePreviewCardArtifacts } = require('../../src/services/imageGenerator/generators/previewCard')
const imageGenerator = require('../../src/services/imageGenerator')
const config = require('../../src/config')

function parseArgs(argv) {
    const args = { input: '', outName: '', emitHtml: false }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--out-name') {
            args.outName = argv[++i] || ''
        } else if (arg === '--html') {
            args.emitHtml = true
        } else if (!arg.startsWith('--')) {
            args.input = arg
        }
    }
    return args
}

function sanitizeFileName(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

// 集成验证需要绕过平台开关（默认关闭）：直接写入测试兼容态
function enableExternalParsers() {
    const compatState = config.__getMutableCompatStateForTests()
    compatState.externalParsers = {
        douyin: {
            enabled: true,
            downloadEnabled: false,
            downloadMaxDurationSeconds: 120,
            downloadMaxFileSizeMB: 50,
        },
        xiaohongshu: { enabled: true, cookie: '' },
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    if (!args.input) {
        console.error('用法: node test/tools/preview-external.js "<抖音/小红书链接>" [--out-name <name>] [--html]')
        process.exit(1)
    }

    enableExternalParsers()

    const links = linkServices.extractLinksFromMessage(args.input, null)
    if (links.length === 0) {
        throw new Error(`未识别到可处理的外部平台链接: ${args.input}`)
    }

    const descriptor = links[0]
    const handler = linkRegistry.getHandler(descriptor.type)
    if (!handler) {
        throw new Error(`未注册的 handler 类型: ${descriptor.type}`)
    }

    console.log(`链接类型: ${descriptor.type} / id: ${descriptor.id}`)
    const info = await handler.fetch(null, descriptor)
    if (!info || info.status !== 'success') {
        throw new Error(`fetch 失败: ${info?.status} ${info?.message || ''}`)
    }

    const cardType = handler.resolveCardType(info, descriptor)
    console.log(`数据类型: ${info.data?.type} -> 卡片类型: ${cardType}`)

    const artifacts = await generatePreviewCardArtifacts(info, cardType, null, true, {})

    const outputDir = path.resolve(process.cwd(), 'test/output')
    fs.mkdirSync(outputDir, { recursive: true })
    const outputName = sanitizeFileName(args.outName) || `external-${cardType}`
    const pngPath = path.join(outputDir, `${outputName}.png`)
    const jsonPath = path.join(outputDir, `${outputName}.json`)
    const htmlPath = args.emitHtml ? path.join(outputDir, `${outputName}.html`) : ''

    fs.writeFileSync(pngPath, Buffer.from(artifacts.base64, 'base64'))
    fs.writeFileSync(jsonPath, JSON.stringify({
        input: args.input,
        descriptor,
        cardType,
        info,
        debugMeta: artifacts.debugMeta,
    }, null, 2))
    if (htmlPath) {
        fs.writeFileSync(htmlPath, artifacts.html)
    }

    console.log(`PNG: ${pngPath}`)
    console.log(`JSON: ${jsonPath}`)
    if (htmlPath) console.log(`HTML: ${htmlPath}`)
}

main()
    .catch((error) => {
        console.error(error?.stack || error?.message || String(error))
        process.exit(1)
    })
    .finally(async () => {
        await imageGenerator.cleanup()
    })
