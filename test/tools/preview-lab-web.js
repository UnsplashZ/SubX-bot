#!/usr/bin/env node
'use strict'

const serviceManager = require('../../src/services/ServiceManager')
const imageGenerator = require('../../src/services/imageGenerator')
const {
    DEFAULT_HOST,
    DEFAULT_PORT,
    startPreviewLabWebServer
} = require('./preview-lab/webServer')

async function cleanupAndExit(server, code) {
    try {
        if (server) {
            await new Promise((resolve) => server.close(resolve))
        }
        await imageGenerator.cleanup()
    } finally {
        process.exit(code)
    }
}

async function main() {
    const hadExistingService = await serviceManager.isServiceHealthy(200)
    const { server, host, port } = await startPreviewLabWebServer({
        host: DEFAULT_HOST,
        port: DEFAULT_PORT
    })

    console.log(`Preview Lab Web 已启动: http://${host}:${port}`)

    const handleSignal = () => {
        ;(async () => {
            if (!hadExistingService) {
                await serviceManager.stop()
            }
            await cleanupAndExit(server, 0)
        })().catch((error) => {
            console.error(error?.stack || error?.message || String(error))
            process.exit(1)
        })
    }

    process.on('SIGINT', handleSignal)
    process.on('SIGTERM', handleSignal)
}

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error))
    process.exit(1)
})
