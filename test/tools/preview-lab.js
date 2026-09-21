#!/usr/bin/env node
'use strict'

const path = require('path')
const serviceManager = require('../../src/services/ServiceManager')
const imageGenerator = require('../../src/services/imageGenerator')
const { parseCliArgs } = require('./preview-lab/cliOptions')
const { runPreviewDebugSession } = require('./preview-lab/session')

function printHelp() {
    console.log(`用法:
  node test/tools/preview-lab.js "<B站链接>" [--group-id <gid>] [--fresh] [--html] [--show-id <true|false>] [--out-name <name>]

示例:
  node test/tools/preview-lab.js "https://www.bilibili.com/read/cv45123193"
  node test/tools/preview-lab.js "https://t.bilibili.com/1180316687231090707" --fresh --html
`)
}

async function main() {
    const parsed = parseCliArgs(process.argv.slice(2))
    if (parsed.help || !parsed.input) {
        printHelp()
        process.exit(parsed.help ? 0 : 1)
    }

    const hadExistingService = await serviceManager.isServiceHealthy(200)

    try {
        const result = await runPreviewDebugSession(parsed.input, parsed.options)
        const { manifest } = result
        console.log(`状态: ${manifest.status}`)
        console.log(`类型: ${manifest.resolvedLink.type} -> ${manifest.cardType}`)
        console.log(`链接: ${manifest.canonicalUrl}`)
        console.log(`PNG: ${manifest.pngPath}`)
        console.log(`JSON: ${manifest.jsonPath}`)
        if (manifest.htmlPath) {
            console.log(`HTML: ${manifest.htmlPath}`)
        }
        console.log(`Manifest: ${manifest.manifestPath}`)
    } finally {
        await imageGenerator.cleanup()
        if (!hadExistingService) {
            await serviceManager.stop()
        }
    }
}

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error))
    process.exit(1)
})
