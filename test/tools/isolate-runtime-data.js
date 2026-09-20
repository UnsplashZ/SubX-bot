'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { installWriteBarrier } = require('./runtime-data-safety')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-qq-bot-test-runtime-'))
const projectRoot = path.resolve(__dirname, '../..')
const realRuntimeRoots = [path.join(projectRoot, 'config'), path.join(projectRoot, 'data')]

// Install this before loading production singletons.  Tests may still choose
// their own temporary fixtures, but no Node fs API can mutate the repository's
// real config/data trees even if a module retains a construction-time default.
const barrier = installWriteBarrier({ protectedRoots: realRuntimeRoots })

function isolatedPath(...segments) {
    return path.join(root, ...segments)
}

const originalCwd = process.cwd()
let subscriptionManager
let stateStore
let deliveryStore
let cacheManager
let subscriptionUserMetaCache
try {
    // Construction-time process.cwd() defaults must resolve inside the same
    // isolated root; restore cwd immediately so test path semantics are intact.
    process.chdir(root)
    subscriptionManager = require('../../src/services/subscription/subscriptionManager')
    stateStore = require('../../src/services/subscription/subscriptionStateStore')
    deliveryStore = require('../../src/services/subscription/subscriptionDeliveryStore')
    cacheManager = require('../../src/utils/cacheManager')
    subscriptionUserMetaCache = require('../../src/services/subscriptionUserMetaCacheService')
} finally {
    process.chdir(originalCwd)
}

subscriptionManager.dataDir = isolatedPath('data')
subscriptionManager.subFile = isolatedPath('data', 'subscriptions.json')
subscriptionManager.followersFile = isolatedPath('data', 'subfollowers.json')

stateStore.dataDir = isolatedPath('data')
stateStore.stateFile = isolatedPath('data', 'subscription_state.json')
stateStore.users = {}
stateStore._loaded = false
stateStore._loadingPromise = null
stateStore._writeChain = Promise.resolve()

deliveryStore.dataDir = isolatedPath('data')
deliveryStore.deliveryFile = isolatedPath('data', 'subscription_delivery.json')
deliveryStore.records = {}
deliveryStore._loaded = false
deliveryStore._loadingPromise = null
deliveryStore._operationChain = Promise.resolve()

cacheManager.cacheDir = isolatedPath('data', 'cache')
cacheManager.initPromise = cacheManager.init()

subscriptionUserMetaCache.cacheFile = isolatedPath('data', 'subscription_user_meta_cache.json')

const officialIdStorePath = isolatedPath('data', 'qq-official-id-store.json')
const cookiePath = isolatedPath('data', 'cookies.json')
const cookieMapPath = isolatedPath('data', 'cookies_map.json')

global.__BILI_TEST_RUNTIME_ISOLATION__ = Object.freeze({
    root,
    projectRoot,
    realRuntimeRoots: Object.freeze(realRuntimeRoots.slice()),
    paths: Object.freeze({
        subscriptions: subscriptionManager.subFile,
        followers: subscriptionManager.followersFile,
        subscriptionState: stateStore.stateFile,
        delivery: deliveryStore.deliveryFile,
        cache: cacheManager.cacheDir,
        subscriptionUserMeta: subscriptionUserMetaCache.cacheFile,
        officialIds: officialIdStorePath,
        cookies: cookiePath,
        cookieMap: cookieMapPath
    })
})

// Node children spawned by tests inherit the same fail-closed barrier.  The
// parent runner inventory below covers Python and any child that cannot preload
// JavaScript.
const childBarrierPreload = path.join(__dirname, 'runtime-write-barrier-preload.js')
const preloadOption = `--require=${childBarrierPreload}`
const currentNodeOptions = String(process.env.NODE_OPTIONS || '').trim()
if (!currentNodeOptions.includes(preloadOption)) {
    process.env.NODE_OPTIONS = [currentNodeOptions, preloadOption].filter(Boolean).join(' ')
}

process.once('exit', () => {
    barrier.restore()
    fs.rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20
    })
})
