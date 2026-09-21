const express = require('express')
const authenticateToken = require('../../middleware/auth')
const logger = require('../../../utils/logger')

const authRoutes = require('./modules/auth')
const configRoutes = require('./modules/config')
const groupsRoutes = require('./modules/groups')
const groupVideoDownloadRoutes = require('./modules/group-video-download')
const subscriptionsRoutes = require('./modules/subscriptions')
const blacklistRoutes = require('./modules/blacklist')
const biliRoutes = require('./modules/bili')
const systemRoutes = require('./modules/system')
const logsRoutes = require('./modules/logs')

const router = express.Router()

router.use((req, res, next) => {
    req.logScope = req.logScope || logger.createScope('req', Date.now(), Math.random().toString(36).slice(2, 8))
    logger.logEvent('info', 'HTTP', req.logScope, 'recv', {
        method: req.method,
        path: req.path
    })
    res.on('finish', () => {
        logger.logEvent(res.statusCode >= 400 ? 'warn' : 'info', 'HTTP', req.logScope, 'done', {
            method: req.method,
            path: req.path,
            status: res.statusCode
        })
    })
    next()
})

// Public routes
router.use(authRoutes)

// Protected routes
router.use(authenticateToken)
router.use(configRoutes)
router.use(groupsRoutes)
router.use(groupVideoDownloadRoutes)
router.use(subscriptionsRoutes)
router.use(blacklistRoutes)
router.use(biliRoutes)
router.use(systemRoutes)
router.use(logsRoutes)

module.exports = router
