'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const YAML = require('yaml')
const { atomicWriteFile, atomicWriteJson } = require('../migrations/common/atomicFile')
const { readPrivateText } = require('../migrations/common/privateFile')
const { MigrationError } = require('../migrations/common/errors')
const { validateConfigFile } = require('../migrations/config')
const { DASHBOARD_INGRESS_PORT } = require('../config/schemaV1')

const BOT_SERVICE = 'bili-qq-bot'
const NAPCAT_SERVICE = 'napcat'
const OWNERSHIP_VERSION = 2

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (!isPlainObject(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function canonicalValue(value) {
    return JSON.stringify(canonicalize(value === undefined ? null : value))
}

function valueHash(value) {
    return crypto.createHash('sha256').update(canonicalValue(value)).digest('hex')
}

function decodePointer(pointer) {
    if (pointer === '') return []
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
    return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function getPointer(root, pointer) {
    let current = root
    for (const part of decodePointer(pointer)) {
        if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined
        current = current[part]
    }
    return current
}

function pointerNetworkName(pointer) {
    const parts = decodePointer(pointer)
    return parts.length === 2 && parts[0] === 'networks' ? parts[1] : null
}

function readYamlObject(filePath) {
    let source
    try {
        source = fs.readFileSync(filePath, 'utf8')
    } catch (error) {
        throw new MigrationError(error?.code === 'ENOENT' ? 'COMPOSE_FILE_NOT_FOUND' : 'COMPOSE_FILE_READ_FAILED')
    }
    const document = YAML.parseDocument(source, {
        schema: 'core',
        uniqueKeys: true,
        merge: false,
        prettyErrors: false,
        strict: true
    })
    if (document.errors.length > 0) throw new MigrationError('COMPOSE_YAML_INVALID')
    let alias = false
    YAML.visit(document, { Alias() { alias = true; return YAML.visit.BREAK } })
    if (alias) throw new MigrationError('COMPOSE_YAML_ALIAS_FORBIDDEN')
    const value = document.toJS({ maxAliasCount: 0, mapAsMap: false })
    if (!isPlainObject(value)) throw new MigrationError('COMPOSE_ROOT_OBJECT_REQUIRED')
    return value
}

function readOwnership(filePath, options = {}) {
    if (!filePath) return null
    let value
    try {
        value = JSON.parse(readPrivateText(filePath, {
            fileCode: 'COMPOSE_OWNERSHIP_UNSAFE',
            linkCode: 'COMPOSE_OWNERSHIP_UNSAFE',
            permissionCode: 'COMPOSE_OWNERSHIP_UNSAFE',
            changedCode: 'COMPOSE_OWNERSHIP_CHANGED',
            beforeRead: options.beforeRead
        }))
    } catch (error) {
        if (['COMPOSE_OWNERSHIP_UNSAFE', 'COMPOSE_OWNERSHIP_CHANGED'].includes(error?.code)) throw error
        throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
    }
    if (!isPlainObject(value) || ![1, OWNERSHIP_VERSION].includes(value.version) || !Array.isArray(value.ownedPointers) ||
        value.ownedPointers.some((item) => typeof item !== 'string' || !item.startsWith('/'))) {
        throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
    }
    if (value.version === OWNERSHIP_VERSION) {
        if (!isPlainObject(value.fields) || Object.keys(value.fields).sort().join('\n') !== [...value.ownedPointers].sort().join('\n')) {
            throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
        }
        for (const [pointer, field] of Object.entries(value.fields)) {
            let parsed
            try {
                parsed = isPlainObject(field) && typeof field.value === 'string' ? JSON.parse(field.value) : undefined
            } catch {
                throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
            }
            if (!isPlainObject(field) || typeof field.value !== 'string' || !/^[a-f0-9]{64}$/.test(field.hash) ||
                valueHash(parsed) !== field.hash || !value.ownedPointers.includes(pointer)) {
                throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
            }
        }
    }
    return value
}

function managedNetworkNames(ownership) {
    if (!ownership) return []
    return [...new Set(ownership.ownedPointers.map(pointerNetworkName).filter(Boolean))]
}

function networkNames(value) {
    if (Array.isArray(value)) return value.map(String)
    if (isPlainObject(value)) return Object.keys(value)
    return []
}

function removeNetworkAttachment(service, networkName) {
    if (!isPlainObject(service)) return
    if (Array.isArray(service.networks)) {
        service.networks = service.networks.filter((item) => String(item) !== networkName)
        if (service.networks.length === 0) delete service.networks
        return
    }
    if (isPlainObject(service.networks)) {
        delete service.networks[networkName]
        if (Object.keys(service.networks).length === 0) delete service.networks
    }
}

function addNetworkAttachment(service, networkName) {
    if (isPlainObject(service.networks)) {
        if (!Object.prototype.hasOwnProperty.call(service.networks, networkName)) service.networks[networkName] = null
        return
    }
    service.networks = [...new Set([...(Array.isArray(service.networks) ? service.networks.map(String) : []), networkName])]
}

function assertOwnershipCas(existingCompose, renderedCompose, ownership, options = {}) {
    if (!ownership || options.adoptExisting) return
    if (ownership.version === 1) {
        throw new MigrationError('COMPOSE_LEGACY_OWNERSHIP_ADOPTION_REQUIRED')
    }
    for (const pointer of ownership.ownedPointers) {
        const current = getPointer(existingCompose, pointer)
        const desired = getPointer(renderedCompose, pointer)
        const recorded = ownership.fields[pointer]
        let recordedValue
        try {
            recordedValue = JSON.parse(recorded.value)
        } catch {
            throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
        }
        if (recorded.hash !== valueHash(recordedValue)) throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
        const currentMatchesLastRender = canonicalValue(current) === canonicalValue(recordedValue)
        const currentAlreadyDesired = canonicalValue(current) === canonicalValue(desired)
        if (!currentMatchesLastRender && !currentAlreadyDesired) {
            const error = new MigrationError('COMPOSE_OWNED_FIELD_DRIFT')
            error.path = pointer
            throw error
        }
    }
}

function recordedOwnershipValue(ownership, pointer) {
    if (!ownership || ownership.version !== OWNERSHIP_VERSION || !ownership.fields?.[pointer]) return undefined
    try {
        return JSON.parse(ownership.fields[pointer].value)
    } catch {
        throw new MigrationError('COMPOSE_OWNERSHIP_INVALID')
    }
}

function createOwnership(compose, ownedPointers) {
    const pointers = [...new Set(ownedPointers)].sort()
    const fields = {}
    for (const pointer of pointers) {
        const value = getPointer(compose, pointer)
        const serialized = canonicalValue(value)
        fields[pointer] = { value: serialized, hash: valueHash(JSON.parse(serialized)) }
    }
    return { version: OWNERSHIP_VERSION, ownedPointers: pointers, fields }
}

function stringifyPort(host, container) {
    return `${host}:${container}`
}

function parsePortTarget(value) {
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string') {
        const base = value.split('/')[0]
        return base.split(':').pop()
    }
    if (isPlainObject(value) && value.target !== undefined) return String(value.target)
    return ''
}

function parseVolumeTarget(value) {
    if (typeof value === 'string') {
        const parts = value.split(':')
        return { source: parts[0] || '', target: parts[1] || '' }
    }
    if (isPlainObject(value)) return { source: String(value.source || ''), target: String(value.target || '') }
    return { source: '', target: '' }
}

function mergeManagedList(existing, desired, targetResolver) {
    const desiredTargets = new Set(desired.map(targetResolver))
    const preserved = (Array.isArray(existing) ? existing : []).filter((item) => !desiredTargets.has(targetResolver(item)))
    return [...preserved, ...desired]
}

function detectUnownedConflict(existing, desired, targetResolver, valueResolver = (value) => JSON.stringify(value)) {
    const desiredByTarget = new Map(desired.map((item) => [targetResolver(item), valueResolver(item)]))
    for (const item of Array.isArray(existing) ? existing : []) {
        const target = targetResolver(item)
        if (!desiredByTarget.has(target)) continue
        if (desiredByTarget.get(target) !== valueResolver(item)) return true
    }
    return false
}

function matchesKnownSetupTemplate(existingCompose) {
    if (!isPlainObject(existingCompose?.services)) return false
    const bot = existingCompose.services[BOT_SERVICE]
    const napcat = existingCompose.services[NAPCAT_SERVICE]
    const llbot = existingCompose.services.llbot
    const isLlbot = isPlainObject(llbot) && !napcat
    if (!isPlainObject(bot) || (!isPlainObject(napcat) && !isLlbot)) return false
    const requiredBotVolumes = [
        ['./config', '/app/config'], ['./data', '/app/data'], ['./logs', '/app/logs'],
        ['./fonts/custom', '/app/fonts/custom'],
        isLlbot ? ['./onebot/media', '/app/.config/QQ/tmp'] : ['./napcat/qq', '/app/.config/QQ']
    ]
    const hasUniqueManagedVolumes = (values, required) => required.every(([source, target]) => {
        const matches = (Array.isArray(values) ? values : []).filter((item) => {
            const parsed = parseVolumeTarget(item)
            return parsed.source === source && parsed.target === target
        })
        return matches.length === 1 && (Array.isArray(values) ? values : []).filter((item) => (
            parseVolumeTarget(item).target === target
        )).length === 1
    })
    const expectedNapcat = {
        image: '${BILI_NAPCAT_IMAGE:-mlikiowa/napcat-docker:latest}',
        container_name: 'napcat',
        restart: 'always',
        init: true,
        stop_grace_period: '30s',
        ports: [
            '${BILI_NAPCAT_WEBUI_HOST_PORT:-6099}:6099',
            '${BILI_NAPCAT_WS_HOST_PORT:-3001}:3001'
        ],
        environment: { TZ: 'Asia/Shanghai', WS_ENABLE: 'true', HTTP_ENABLE: 'true' },
        volumes: [
            { type: 'bind', source: './napcat/config', target: '/app/napcat/config' },
            { type: 'bind', source: './napcat/qq', target: '/app/.config/QQ' }
        ],
        networks: ['bot_network']
    }
    const expectedLlbot = {
        image: '${BILI_LLBOT_IMAGE:-linyuchen/llbot:latest}',
        restart: 'always', init: true, stop_grace_period: '30s',
        environment: { TZ: 'Asia/Shanghai', AUTO_LOGIN_QQ: '${BILI_BOT_QQ:-}' },
        ports: ['${BILI_LLBOT_WEBUI_HOST_PORT:-3080}:3080'],
        volumes: ['./llbot/data:/app/llbot/data', './onebot/media:/app/.config/QQ/tmp'],
        networks: ['bot_network']
    }
    const expectedHealthcheck = {
        test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/api/live') .then(r=>{if(!r.ok)process.exit(1)}) .catch(()=>process.exit(1))"],
        interval: '10s', timeout: '5s', retries: 12, start_period: '30s'
    }
    return bot.image === '${BILI_BOT_IMAGE:-unsplash/bili-qq-bot:latest}' &&
        canonicalValue(isLlbot ? llbot : napcat) === canonicalValue(isLlbot ? expectedLlbot : expectedNapcat) &&
        canonicalValue(bot.ports) === canonicalValue(['${BILI_DASHBOARD_HOST_PORT:-3000}:3000']) &&
        hasUniqueManagedVolumes(bot.volumes, requiredBotVolumes) &&
        canonicalValue(bot.healthcheck) === canonicalValue(expectedHealthcheck) &&
        isPlainObject(bot.depends_on) &&
        canonicalValue(bot.depends_on[isLlbot ? 'llbot' : 'napcat']) === canonicalValue({ condition: 'service_started' }) &&
        networkNames(bot.networks).includes('bot_network') &&
        canonicalValue(existingCompose.networks?.bot_network) === canonicalValue({ driver: 'bridge' })
}

function hasNapcatDependency(dependsOn) {
    if (Array.isArray(dependsOn)) return dependsOn.some((item) => String(item) === NAPCAT_SERVICE)
    return isPlainObject(dependsOn) && Object.prototype.hasOwnProperty.call(dependsOn, NAPCAT_SERVICE)
}

function reconcileNapcatDependency(dependsOn, enabled) {
    if (Array.isArray(dependsOn)) {
        const preserved = dependsOn.filter((item) => String(item) !== NAPCAT_SERVICE)
        if (enabled) preserved.push(NAPCAT_SERVICE)
        return [...new Set(preserved)]
    }
    const next = isPlainObject(dependsOn) ? clone(dependsOn) : {}
    delete next[NAPCAT_SERVICE]
    if (enabled) next[NAPCAT_SERVICE] = { condition: 'service_started' }
    return next
}

function desiredDeployment(config, options = {}, existingCompose = null) {
    const externalGateway = Boolean(existingCompose?.services?.[BOT_SERVICE] && !existingCompose.services.napcat)
    const ports = config.deployment?.ports || {}
    const mounts = config.deployment?.mounts || {}
    const network = config.deployment?.network || {}
    const dashboardHost = ports.dashboardHost || config.dashboard.hostPort || config.dashboard.listenPort
    const botVolumes = [
        `${mounts.config || './config'}:/app/config`,
        `${mounts.data || './data'}:/app/data`,
        `${mounts.logs || './logs'}:/app/logs`,
        `${mounts.fonts || './fonts/custom'}:/app/fonts/custom`
    ]
    if (config.qq.provider === 'napcat' && !externalGateway) botVolumes.push(`${mounts.napcatQq || './napcat/qq'}:/app/.config/QQ`)
    return {
        networkName: network.name || 'bot_network',
        networkExternal: Boolean(network.external),
        bot: {
            image: options.botImage || null,
            healthPort: DASHBOARD_INGRESS_PORT,
            ports: [stringifyPort(dashboardHost, DASHBOARD_INGRESS_PORT)],
            volumes: botVolumes
        },
        napcat: config.qq.provider === 'napcat' && !externalGateway ? {
            image: options.napcatImage || null,
            ports: [
                stringifyPort(ports.napcatWebuiHost || 6099, 6099),
                stringifyPort(ports.napcatWsHost || 3001, 3001)
            ],
            volumes: [
                `${mounts.napcatConfig || './napcat/config'}:/app/napcat/config`,
                `${mounts.napcatQq || './napcat/qq'}:/app/.config/QQ`
            ]
        } : null
    }
}

function analyzeDeployment(config, existingCompose, options = {}) {
    const desired = desiredDeployment(config, options, existingCompose)
    const existingBot = existingCompose?.services?.[BOT_SERVICE]
    const existingNapcat = existingCompose?.services?.[NAPCAT_SERVICE]
    const changes = []
    let ownershipRequired = false
    let mountRelocationRequired = false

    if (existingBot) {
        const existingPorts = Array.isArray(existingBot.ports) ? existingBot.ports : []
        if (canonicalValue(existingPorts) !== canonicalValue(desired.bot.ports)) {
            ownershipRequired = true
            changes.push('/services/bili-qq-bot/ports')
        }
        if (detectUnownedConflict(
            existingBot.volumes,
            desired.bot.volumes,
            (item) => parseVolumeTarget(item).target,
            (item) => parseVolumeTarget(item).source
        )) {
            ownershipRequired = true
            mountRelocationRequired = true
            changes.push('/services/bili-qq-bot/volumes')
        }
    } else {
        changes.push('/services/bili-qq-bot')
    }
    if (desired.napcat && existingNapcat) {
        const existingPorts = Array.isArray(existingNapcat.ports) ? existingNapcat.ports : []
        if (existingPorts.length > 0 && canonicalValue(existingPorts) !== canonicalValue(desired.napcat.ports)) {
            ownershipRequired = true
            changes.push('/services/napcat/ports')
        }
        if (detectUnownedConflict(
            existingNapcat.volumes,
            desired.napcat.volumes,
            (item) => parseVolumeTarget(item).target,
            (item) => parseVolumeTarget(item).source
        )) {
            ownershipRequired = true
            mountRelocationRequired = true
            changes.push('/services/napcat/volumes')
        }
    } else if (desired.napcat && !existingNapcat) {
        changes.push('/services/napcat')
    } else if (!desired.napcat && existingNapcat) {
        ownershipRequired = true
        changes.push('/services/napcat')
    }
    if (config.qq.provider === 'official' && existingCompose?.services?.llbot) {
        ownershipRequired = true
        changes.push('/services/llbot', '/services/bili-qq-bot/depends_on/llbot')
    }
    const botDependsOnNapcat = hasNapcatDependency(existingBot?.depends_on)
    if (Boolean(desired.napcat) !== botDependsOnNapcat) {
        if (!desired.napcat && botDependsOnNapcat) ownershipRequired = true
        changes.push('/services/bili-qq-bot/depends_on/napcat')
    }
    if (existingBot && !networkNames(existingBot.networks).includes(desired.networkName)) {
        changes.push('/services/bili-qq-bot/networks')
    }
    if (desired.napcat && existingNapcat && !networkNames(existingNapcat.networks).includes(desired.networkName)) {
        changes.push('/services/napcat/networks')
    }
    const desiredNetworkDefinition = desired.networkExternal ? { external: true } : { driver: 'bridge' }
    const existingNetworkDefinition = existingCompose?.networks?.[desired.networkName]
    if (canonicalValue(existingNetworkDefinition) !== canonicalValue(desiredNetworkDefinition)) {
        if (existingNetworkDefinition !== undefined) ownershipRequired = true
        changes.push(`/networks/${desired.networkName}`)
    }
    return {
        version: 1,
        existingComposePresent: Boolean(existingCompose),
        provider: config.qq.provider,
        deploymentApplyRequired: changes.length > 0,
        ownershipRequired,
        mountRelocationRequired,
        validatedRelocationArtifact: false,
        changes: [...new Set(changes)].sort()
    }
}

function buildCompose(config, existingCompose, options = {}) {
    const desired = desiredDeployment(config, options, existingCompose)
    const ownership = readOwnership(options.ownershipPath)
    const plan = analyzeDeployment(config, existingCompose, options)
    const adoptKnownTemplate = Boolean(options.adoptKnownTemplate && matchesKnownSetupTemplate(existingCompose))
    if (options.adoptKnownTemplate && existingCompose && !adoptKnownTemplate && !ownership && !options.adoptExisting) {
        throw new MigrationError('COMPOSE_UNKNOWN_TEMPLATE_ADOPTION_REQUIRED')
    }
    const adoptionAllowed = Boolean(options.adoptExisting || adoptKnownTemplate)
    if (plan.ownershipRequired && !ownership && !adoptionAllowed) {
        throw new MigrationError('COMPOSE_OWNERSHIP_REQUIRED')
    }
    if (plan.mountRelocationRequired && !options.validatedRelocationArtifact) {
        throw new MigrationError('COMPOSE_MOUNT_RELOCATION_REQUIRED')
    }

    const compose = clone(existingCompose || {})
    compose.services = isPlainObject(compose.services) ? compose.services : {}
    if (config.qq.provider === 'official' && compose.services.llbot) {
        if (!adoptionAllowed && !ownership?.ownedPointers?.includes('/services/llbot')) {
            throw new MigrationError('COMPOSE_OWNERSHIP_REQUIRED')
        }
        delete compose.services.llbot
        const dependencies = compose.services[BOT_SERVICE]?.depends_on
        if (Array.isArray(dependencies)) compose.services[BOT_SERVICE].depends_on = dependencies.filter(name => name !== 'llbot')
        else if (isPlainObject(dependencies)) delete dependencies.llbot
    }
    const previousManagedNetworks = managedNetworkNames(ownership)
    for (const networkName of previousManagedNetworks) {
        if (networkName === desired.networkName) continue
        removeNetworkAttachment(compose.services[BOT_SERVICE], networkName)
        removeNetworkAttachment(compose.services[NAPCAT_SERVICE], networkName)
        if (compose.services.llbot && ownership?.ownedPointers?.includes('/services/llbot')) {
            removeNetworkAttachment(compose.services.llbot, networkName)
            addNetworkAttachment(compose.services.llbot, desired.networkName)
        }
        const stillAttached = Object.values(compose.services).some((service) => networkNames(service?.networks).includes(networkName))
        if (stillAttached) throw new MigrationError('COMPOSE_MANAGED_NETWORK_IN_USE')
        if (isPlainObject(compose.networks)) delete compose.networks[networkName]
    }
    const bot = isPlainObject(compose.services[BOT_SERVICE]) ? compose.services[BOT_SERVICE] : {}
    bot.image = desired.bot.image || bot.image || 'unsplash/bili-qq-bot:latest'
    if (desired.bot.image) bot.pull_policy = 'never'
    bot.restart = bot.restart || 'unless-stopped'
    // The host port is deployment-managed, while the container target stays
    // stable across application-level dashboard.listenPort hot reloads.
    bot.ports = [...desired.bot.ports]
    let existingBotVolumes = Array.isArray(bot.volumes) ? bot.volumes : []
    if (!desired.napcat && existingBotVolumes.some((item) => parseVolumeTarget(item).target === '/app/.config/QQ')) {
        const recordedVolumes = recordedOwnershipValue(ownership, '/services/bili-qq-bot/volumes')
        const setupOwnedQqMount = Array.isArray(recordedVolumes) && recordedVolumes.some((item) =>
            parseVolumeTarget(item).target === '/app/.config/QQ')
        if (!setupOwnedQqMount && !adoptionAllowed) {
            throw new MigrationError(ownership?.version === 1
                ? 'COMPOSE_LEGACY_OWNERSHIP_ADOPTION_REQUIRED'
                : 'COMPOSE_OWNERSHIP_REQUIRED')
        }
        existingBotVolumes = existingBotVolumes.filter((item) => parseVolumeTarget(item).target !== '/app/.config/QQ')
    }
    bot.volumes = mergeManagedList(existingBotVolumes, desired.bot.volumes, (item) => parseVolumeTarget(item).target)
    bot.healthcheck = {
        test: ['CMD', 'node', '-e', `fetch("http://127.0.0.1:${desired.bot.healthPort}/api/live").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`],
        interval: '10s',
        timeout: '5s',
        retries: 6,
        start_period: '20s'
    }
    addNetworkAttachment(bot, desired.networkName)
    bot.depends_on = reconcileNapcatDependency(bot.depends_on, Boolean(desired.napcat))
    if ((Array.isArray(bot.depends_on) && bot.depends_on.length === 0) ||
        (isPlainObject(bot.depends_on) && Object.keys(bot.depends_on).length === 0)) {
        delete bot.depends_on
    }
    compose.services[BOT_SERVICE] = bot

    if (desired.napcat) {
        const napcat = isPlainObject(compose.services[NAPCAT_SERVICE]) ? compose.services[NAPCAT_SERVICE] : {}
        napcat.image = desired.napcat.image || napcat.image || 'mlikiowa/napcat-docker:latest'
        if (desired.napcat.image) napcat.pull_policy = 'never'
        napcat.restart = napcat.restart || 'unless-stopped'
        napcat.ports = mergeManagedList(napcat.ports, desired.napcat.ports, parsePortTarget)
        napcat.volumes = mergeManagedList(napcat.volumes, desired.napcat.volumes, (item) => parseVolumeTarget(item).target)
        addNetworkAttachment(napcat, desired.networkName)
        compose.services[NAPCAT_SERVICE] = napcat
    } else {
        delete compose.services[NAPCAT_SERVICE]
    }

    compose.networks = isPlainObject(compose.networks) ? compose.networks : {}
    compose.networks[desired.networkName] = desired.networkExternal ? { external: true } : { driver: 'bridge' }
    const ownedPointers = [
        '/services/bili-qq-bot/image',
        '/services/bili-qq-bot/ports',
        '/services/bili-qq-bot/volumes',
        '/services/bili-qq-bot/healthcheck',
        '/services/bili-qq-bot/networks',
        '/services/bili-qq-bot/depends_on/napcat',
        `/networks/${desired.networkName}`
    ]
    if (desired.napcat) {
        ownedPointers.push(
            '/services/napcat/image',
            '/services/napcat/ports',
            '/services/napcat/volumes',
            '/services/napcat/networks'
        )
    }
    if (compose.services.llbot && (adoptKnownTemplate || ownership?.ownedPointers?.includes('/services/llbot'))) {
        ownedPointers.push('/services/llbot', '/services/bili-qq-bot/depends_on/llbot')
    }
    assertOwnershipCas(existingCompose || {}, compose, ownership, { ...options, adoptExisting: adoptionAllowed })
    return {
        compose,
        plan,
        ownership: createOwnership(compose, ownedPointers)
    }
}

function renderCompose(options = {}) {
    const config = validateConfigFile(options.configPath, { validator: options.validator })
    const existingCompose = options.existingComposePath ? readYamlObject(options.existingComposePath) : null
    const result = buildCompose(config, existingCompose, options)
    const yaml = YAML.stringify(result.compose, { indent: 2, lineWidth: 0 })
    if (!options.dryRun) {
        if (!options.outputPath || !options.ownershipOutputPath) throw new MigrationError('COMPOSE_OUTPUT_REQUIRED')
        atomicWriteFile(options.outputPath, yaml, { mode: 0o600 })
        atomicWriteJson(options.ownershipOutputPath, result.ownership, { mode: 0o600 })
    }
    return { ...result, yaml }
}

function writeDeploymentPlan(options = {}) {
    const config = validateConfigFile(options.configPath, { validator: options.validator })
    const existingCompose = options.existingComposePath ? readYamlObject(options.existingComposePath) : null
    const plan = analyzeDeployment(config, existingCompose, options)
    if (!options.dryRun) {
        if (!options.outputPath) throw new MigrationError('DEPLOYMENT_PLAN_OUTPUT_REQUIRED')
        atomicWriteJson(options.outputPath, plan, { mode: 0o600 })
    }
    return plan
}

module.exports = {
    BOT_SERVICE,
    NAPCAT_SERVICE,
    OWNERSHIP_VERSION,
    readYamlObject,
    readOwnership,
    desiredDeployment,
    analyzeDeployment,
    hasNapcatDependency,
    reconcileNapcatDependency,
    canonicalValue,
    valueHash,
    getPointer,
    assertOwnershipCas,
    matchesKnownSetupTemplate,
    buildCompose,
    renderCompose,
    writeDeploymentPlan
}
