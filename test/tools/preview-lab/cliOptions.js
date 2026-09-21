const path = require('path')

function parseBoolean(value, fallback) {
    if (value === undefined) return fallback
    const normalized = String(value).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    return fallback
}

function sanitizeOutputName(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function parseCliArgs(argv = []) {
    const args = Array.from(argv)
    const options = {
        groupId: null,
        cacheMode: 'cached',
        emitHtml: false,
        showId: true,
        outName: '',
        outputDir: path.resolve(process.cwd(), 'test/output'),
        renderOverrides: {}
    }

    let input = ''
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]
        if (arg === '--help' || arg === '-h') {
            return { help: true, input: '', options }
        }
        if (arg === '--group-id') {
            options.groupId = args[index + 1] || null
            index += 1
            continue
        }
        if (arg === '--fresh') {
            options.cacheMode = 'fresh'
            continue
        }
        if (arg === '--html') {
            options.emitHtml = true
            continue
        }
        if (arg === '--show-id') {
            const next = args[index + 1]
            const consumesValue = next && !next.startsWith('--')
            options.showId = parseBoolean(consumesValue ? next : undefined, true)
            if (consumesValue) {
                index += 1
            }
            continue
        }
        if (arg === '--out-name') {
            options.outName = sanitizeOutputName(args[index + 1] || '')
            index += 1
            continue
        }
        if (!input) {
            input = arg
        }
    }

    return {
        help: false,
        input,
        options
    }
}

module.exports = {
    parseBoolean,
    sanitizeOutputName,
    parseCliArgs
}
