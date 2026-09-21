const linkServices = require('../../../src/services/link')

async function expandPreviewInput(input, deps = {}) {
    const services = deps.linkServices || linkServices
    let rawInput = String(input || '').trim()
    if (!rawInput) {
        return rawInput
    }

    try {
        rawInput = await services.expandShortLinks(rawInput)
    } catch (_error) {
        // Ignore short-link expansion failures and continue with original input.
    }

    return String(rawInput || '').replace(/\[CQ:[^\]]+\]/g, '')
}

async function resolvePreviewInput(input, options = {}, deps = {}) {
    const services = deps.linkServices || linkServices
    const normalizedInput = await expandPreviewInput(input, deps)
    const links = services.extractLinksFromMessage(normalizedInput, options.groupId || null)

    if (!Array.isArray(links) || links.length === 0) {
        throw new Error('未识别到可处理的 B 站链接')
    }

    return {
        input: String(input || ''),
        normalizedInput,
        resolvedLink: links[0],
        skippedLinks: links.slice(1)
    }
}

module.exports = {
    resolvePreviewInput
}
