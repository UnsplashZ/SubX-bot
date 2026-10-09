const { subscriptionManager, biliApi, logger } = require('../adapters/deps')
const { resolveArticleTitle } = require('../helpers/article')
const { decideAdvance } = require('../helpers/stateAdvance')

function subLog(level, message, fields = {}, scope = 'svc:unified-checks') {
    logger.logEvent(level, 'SUB', scope, message, fields)
}

module.exports = {
    async fetchWithGroupFallback(groupIds, fetcher, contextLabel) {
        const candidates = Array.isArray(groupIds)
            ? groupIds.map(id => String(id)).filter(Boolean)
            : []

        if (candidates.length === 0) {
            return { groupId: '', res: { status: 'error', message: 'no_target_groups' } }
        }

        let lastRes = null
        let lastError = null

        for (const groupId of candidates) {
            try {
                const res = await fetcher(groupId)
                if (res && res.status === 'success') {
                    return { groupId, res }
                }
                lastRes = res
                subLog('warn', 'fetch-with-group-fallback-failed', {
                    groupId,
                    contextLabel,
                    error: res?.message || res?.status || 'unknown'
                })
            } catch (error) {
                lastError = error
                subLog('warn', 'fetch-with-group-fallback-threw', {
                    groupId,
                    contextLabel,
                    error: logger.getErrorMessage(error)
                })
            }
        }

        if (lastError) throw lastError
        return { groupId: candidates[0], res: lastRes || { status: 'error', message: 'all_groups_failed' } }
    },

    /**
     * 统一的视频检查方法（支持手动订阅和Cookie同步）
     * @param {Object} userItem - 从buildUserCheckList返回的用户对象
     * @param {boolean} force - 是否强制检查
     */
    async checkUserVideoUnified(userItem, force = false, options = {}) {
        const persistState = options.persistState !== false
        const disableDedup = Boolean(options && options.disableDedup)
        const persistDelivery = options?.persistDelivery !== false && !force
        const {
            uid,
            name,
            targetGroups: rawTargetGroups,
            source,
            manualSub,
            cookieFollower,
            accountUid,
            targetGroupSourceMap
        } = userItem

        const fallbackSource = source === 'cookie' ? 'cookieSync' : 'manual'
        const normalizedTargetGroupSourceMap = this.normalizeGroupSourceMap(targetGroupSourceMap || rawTargetGroups, fallbackSource)
        const targetGroups = this.getGroupIdsFromSourceMap(normalizedTargetGroupSourceMap)
        const userScope = logger.createScope('sub', 'user', uid)

        try {
            if (targetGroups.length === 0) return
            const listFetch = await this.fetchWithGroupFallback(
                targetGroups,
                (groupId) => biliApi.getUserVideos(uid, groupId),
                `getUserVideos uid=${uid}`
            )
            const groupId = listFetch.groupId
            const res = listFetch.res

            if (res.status !== 'success' || !res.data.videos || res.data.videos.length === 0) {
                return
            }

            const videos = res.data.videos
            videos.sort((a, b) => b.created - a.created)
            const latestVideo = videos[0]
            const latestBvid = latestVideo.bvid
            const latestVideoCreatedRaw = Number(latestVideo.created)
            const latestVideoCreated = Number.isFinite(latestVideoCreatedRaw) ? latestVideoCreatedRaw : null

            const normalizeTimestamp = value => {
                if (value === null || value === undefined || value === '') return null
                const num = Number(value)
                return Number.isFinite(num) ? num : null
            }
            let unifiedState = await this.getUnifiedUserState(uid)
            unifiedState = await this.ensureTargetBaselinesForUser(userItem, normalizedTargetGroupSourceMap, unifiedState)
            const legacyVideoAnchor = unifiedState ? null : {
                videoId: manualSub ? manualSub.lastVideoId : cookieFollower?.lastVideoId,
                videoCreated: manualSub ? manualSub.lastVideoCreated : cookieFollower?.lastVideoCreated
            }
            const videoAnchor = this.getVideoAnchor(unifiedState, legacyVideoAnchor)
            let lastVideoId = videoAnchor.videoId
            let lastVideoCreated = videoAnchor.videoCreated
            lastVideoCreated = normalizeTimestamp(lastVideoCreated)

            // Media has its own ledger: retry failed attempts even after the card anchor advances.
            // Scan the returned recent items so a newer post does not hide a failed upload.
            if (!force) {
                for (const video of videos) {
                    try {
                        const mediaRetryMap = await this.getUndeliveredGroupSourceMap({
                            uid,
                            contentType: 'video',
                            contentId: video.bvid,
                            contentTime: video.created,
                            targetGroupSourceMap: normalizedTargetGroupSourceMap,
                            deliveryPart: 'auto-download'
                        })
                        const retryGroups = this.getGroupIdsFromSourceMap(mediaRetryMap)
                        if (retryGroups.length === 0) continue
                        subLog('info', 'video-media-retry-start', { bvid: video.bvid, groupCount: retryGroups.length }, userScope)
                        const retryInfo = await this.fetchWithGroupFallback(
                            retryGroups,
                            candidate => biliApi.getVideoInfo(video.bvid, candidate),
                            `retryVideoInfo bvid=${video.bvid}`
                        )
                        if (retryInfo.res?.status !== 'success') continue
                        const videoDownloadService = require('../../../videoDownloadService')
                        await videoDownloadService.downloadAndSendToGroups(this.ws, retryGroups, video.bvid, retryInfo.res, 0, {
                            recordDelivery: persistDelivery,
                            contentType: 'video',
                            contentId: video.bvid,
                            deliveryPart: 'auto-download'
                        })
                    } catch (error) {
                        subLog('error', 'video-media-retry-failed', {
                            bvid: video.bvid,
                            error: logger.getErrorMessage(error)
                        }, userScope)
                    }
                }
            }

            // 首次检查：记录最新视频但不推送
            if (!lastVideoId && !force) {
                if (persistState) {
                    await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated })
                }
                subLog('info', 'video-anchor-initialized', {
                    name,
                    source,
                    bvid: latestBvid
                }, userScope)
                return
            }

            // 检查是否有新视频；若当前最新已在锚点内，仍通过投递台账补偿缺失群
            const latestAlreadyAnchored = !force && latestBvid === lastVideoId
            const ledgerRetryMap = latestAlreadyAnchored
                ? await this.getUndeliveredGroupSourceMap({
                    uid,
                    contentType: 'video',
                    contentId: latestBvid,
                    contentTime: latestVideoCreated,
                    targetGroupSourceMap: normalizedTargetGroupSourceMap
                })
                : null
            const shouldRetryMissingGroups = ledgerRetryMap && this.getGroupIdsFromSourceMap(ledgerRetryMap).length > 0

            if (latestBvid !== lastVideoId || force || shouldRetryMissingGroups) {
                // 兼容旧状态：仅有 lastVideoId 无时间戳，且 lastVideoId 已不在列表中
                // 避免升级后的首轮回放旧视频
                if (!force && lastVideoId && lastVideoCreated === null && !videos.some(v => v.bvid === lastVideoId)) {
                    if (persistState) {
                        await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated })
                    }
                    subLog('debug', 'video-anchor-refreshed', {
                        name,
                        source,
                        bvid: latestBvid,
                        reason: 'legacy_anchor_missing'
                    }, userScope)
                    return
                }

                const newVideos = []
                if (!shouldRetryMissingGroups) {
                    for (const video of videos) {
                        if (video.bvid === lastVideoId) break

                        if (!force && lastVideoCreated !== null) {
                            const createdRaw = Number(video.created)
                            const created = Number.isFinite(createdRaw) ? createdRaw : null
                            if (created !== null && created <= lastVideoCreated) break
                        }

                        newVideos.push(video)
                    }
                }

                let videoToPush
                if (shouldRetryMissingGroups) {
                    videoToPush = [latestVideo]
                } else if (newVideos.length === 0) {
                    if (!force) {
                        if (persistState) {
                            await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated })
                        }
                        subLog('debug', 'video-state-updated-without-push', {
                            name,
                            source,
                            bvid: latestBvid,
                            reason: 'no_new_videos'
                        }, userScope)
                        return
                    } else {
                        subLog('debug', 'video-force-push-selected', {
                            name,
                            source,
                            bvid: latestBvid
                        }, userScope)
                        videoToPush = [latestVideo]
                    }
                } else {
                    videoToPush = [newVideos[0]]
                    subLog('debug', 'video-new-items-detected', {
                        name,
                        source,
                        newVideoCount: newVideos.length,
                        bvid: newVideos[0].bvid
                    }, userScope)
                }

                for (const video of videoToPush) {
                    let canAdvanceCurrentVideo = false
                    try {
                        const bvid = video.bvid
                        const detailGroupCandidates = [groupId, ...targetGroups.filter(gid => String(gid) !== String(groupId))]
                        const detailFetch = await this.fetchWithGroupFallback(
                            detailGroupCandidates,
                            (candidateGroupId) => biliApi.getVideoInfo(bvid, candidateGroupId),
                            `getVideoInfo bvid=${bvid}`
                        )
                        const info = detailFetch.res

                        if (info.status !== 'success') {
                            subLog('warn', 'video-detail-fetch-failed', {
                                bvid
                            }, userScope)
                            continue
                        }

                        if (video.is_charging_arc || video.is_upower_exclusive) {
                            info.data.is_charging_arc = true
                            info.data.is_upower_exclusive = true
                        }

                        const notificationText = `${name} 投稿了新视频：\n${info.data.title}`
                        const url = `https://www.bilibili.com/video/${bvid}`
                        const effectiveGroupSourceMap = shouldRetryMissingGroups ? ledgerRetryMap : normalizedTargetGroupSourceMap
                        const effectiveTargetGroups = this.getGroupIdsFromSourceMap(effectiveGroupSourceMap)
                        const notifyResult = await this.notifyGroupsWithImageAndCache(
                            effectiveGroupSourceMap,
                            info,
                            'video',
                            url,
                            notificationText,
                            { actorUid: uid, fallbackSources: [fallbackSource], disableDedup }
                        )
                        if (persistDelivery) {
                            await this.recordNotifyDeliveredGroups('video', bvid, notifyResult)
                        }
                        const decision = decideAdvance(notifyResult)
                        canAdvanceCurrentVideo = decision.action === 'advance'

                        // 订阅推送后下载视频一次，目标集必须与本次实际推送一致。
                        const mediaTargetGroups = [...new Set([
                            ...(notifyResult?.successGroups || []),
                            ...(notifyResult?.dedupSkippedGroups || [])
                        ].map(String))].filter(gid => effectiveTargetGroups.includes(gid))
                        if (canAdvanceCurrentVideo && mediaTargetGroups.length > 0) {
                            const videoDownloadService = require('../../../videoDownloadService')
                            try {
                                await videoDownloadService.downloadAndSendToGroups(
                                    this.ws,
                                    mediaTargetGroups,
                                    bvid,
                                    info,
                                    0,
                                    {
                                        recordDelivery: persistDelivery,
                                        contentType: 'video',
                                        contentId: bvid,
                                        deliveryPart: 'auto-download'
                                    }
                                )
                            } catch (e) {
                                subLog('error', 'video-download-dispatch-failed', {
                                    bvid,
                                    error: logger.getErrorMessage(e)
                                }, userScope)
                            }
                        } else if (!canAdvanceCurrentVideo) {
                            subLog('warn', 'video-state-advance-skipped', {
                                name,
                                source,
                                bvid,
                                decision: decision.action,
                                reason: decision.reason
                            }, userScope)
                        }

                        subLog('info', 'video-pushed', {
                            name,
                            source,
                            bvid,
                            effectiveGroupCount: effectiveTargetGroups.length,
                            retryMode: shouldRetryMissingGroups
                        }, userScope)
                    } catch (e) {
                        subLog('error', 'video-push-failed', {
                            bvid: video.bvid,
                            error: logger.getErrorMessage(e)
                        }, userScope)
                    }

                    if (persistState && canAdvanceCurrentVideo && !shouldRetryMissingGroups) {
                        await this.updateVideoState(userItem, { videoId: latestBvid, videoCreated: latestVideoCreated })
                    }
                }
            }
        } catch (e) {
            subLog('error', 'video-check-failed', {
                name,
                source,
                error: logger.getErrorMessage(e)
            }, userScope)
        }
    },

    /**
     * 统一的专栏检查方法（支持手动订阅和Cookie同步）
     * @param {Object} userItem - 从buildUserCheckList返回的用户对象
     * @param {boolean} force - 是否强制检查
     */
    async checkUserArticleUnified(userItem, force = false, options = {}) {
        const persistState = options.persistState !== false
        const disableDedup = Boolean(options && options.disableDedup)
        const persistDelivery = options?.persistDelivery !== false && !force
        const {
            uid,
            name,
            targetGroups: rawTargetGroups,
            source,
            manualSub,
            cookieFollower,
            accountUid,
            targetGroupSourceMap
        } = userItem

        const fallbackSource = source === 'cookie' ? 'cookieSync' : 'manual'
        const normalizedTargetGroupSourceMap = this.normalizeGroupSourceMap(targetGroupSourceMap || rawTargetGroups, fallbackSource)
        const targetGroups = this.getGroupIdsFromSourceMap(normalizedTargetGroupSourceMap)
        const userScope = logger.createScope('sub', 'user', uid)

        try {
            if (targetGroups.length === 0) return
            const listFetch = await this.fetchWithGroupFallback(
                targetGroups,
                (groupId) => biliApi.getUserArticles(uid, groupId),
                `getUserArticles uid=${uid}`
            )
            const groupId = listFetch.groupId
            const res = listFetch.res

            if (res.status !== 'success' || !res.data.articles || res.data.articles.length === 0) {
                return
            }

            const articles = res.data.articles
            articles.sort((a, b) => b.publish_time - a.publish_time)
            const latestArticle = articles[0]
            const latestCvid = `cv${latestArticle.id}`
            const latestArticlePublishRaw = Number(latestArticle.publish_time)
            const latestArticlePublishTime = Number.isFinite(latestArticlePublishRaw) ? latestArticlePublishRaw : null

            const normalizeTimestamp = value => {
                if (value === null || value === undefined || value === '') return null
                const num = Number(value)
                return Number.isFinite(num) ? num : null
            }
            let unifiedState = await this.getUnifiedUserState(uid)
            unifiedState = await this.ensureTargetBaselinesForUser(userItem, normalizedTargetGroupSourceMap, unifiedState)
            const legacyArticleAnchor = unifiedState ? null : {
                articleId: manualSub ? manualSub.lastArticleId : cookieFollower?.lastArticleId,
                articlePublishTime: manualSub ? manualSub.lastArticlePublishTime : cookieFollower?.lastArticlePublishTime
            }
            const articleAnchor = this.getArticleAnchor(unifiedState, legacyArticleAnchor)
            let lastArticleId = articleAnchor.articleId
            let lastArticlePublishTime = articleAnchor.articlePublishTime
            lastArticlePublishTime = normalizeTimestamp(lastArticlePublishTime)

            // 首次检查：记录最新专栏但不推送
            if (!lastArticleId && !force) {
                if (persistState) {
                    await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime })
                }
                subLog('info', 'article-anchor-initialized', {
                    name,
                    source,
                    cvid: latestCvid
                }, userScope)
                return
            }

            // 检查是否有新专栏；若当前最新已在锚点内，仍通过投递台账补偿缺失群
            const latestAlreadyAnchored = !force && latestCvid === lastArticleId
            const ledgerRetryMap = latestAlreadyAnchored
                ? await this.getUndeliveredGroupSourceMap({
                    uid,
                    contentType: 'article',
                    contentId: latestCvid,
                    contentTime: latestArticlePublishTime,
                    targetGroupSourceMap: normalizedTargetGroupSourceMap
                })
                : null
            const shouldRetryMissingGroups = ledgerRetryMap && this.getGroupIdsFromSourceMap(ledgerRetryMap).length > 0

            if (latestCvid !== lastArticleId || force || shouldRetryMissingGroups) {
                // 兼容旧状态：仅有 lastArticleId 无时间戳，且 lastArticleId 已不在列表中
                // 避免升级后的首轮回放旧专栏
                if (!force && lastArticleId && lastArticlePublishTime === null && !articles.some(a => `cv${a.id}` === lastArticleId)) {
                    if (persistState) {
                        await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime })
                    }
                    subLog('debug', 'article-anchor-refreshed', {
                        name,
                        source,
                        cvid: latestCvid,
                        reason: 'legacy_anchor_missing'
                    }, userScope)
                    return
                }

                const newArticles = []
                if (!shouldRetryMissingGroups) {
                    for (const article of articles) {
                        const cvid = `cv${article.id}`
                        if (cvid === lastArticleId) break

                        if (!force && lastArticlePublishTime !== null) {
                            const publishRaw = Number(article.publish_time)
                            const publishTime = Number.isFinite(publishRaw) ? publishRaw : null
                            if (publishTime !== null && publishTime <= lastArticlePublishTime) break
                        }

                        newArticles.push(article)
                    }
                }

                let articleToPush
                if (shouldRetryMissingGroups) {
                    articleToPush = [latestArticle]
                } else if (newArticles.length === 0) {
                    if (!force) {
                        if (persistState) {
                            await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime })
                        }
                        subLog('debug', 'article-state-updated-without-push', {
                            name,
                            source,
                            cvid: latestCvid,
                            reason: 'no_new_articles'
                        }, userScope)
                        return
                    } else {
                        subLog('debug', 'article-force-push-selected', {
                            name,
                            source,
                            cvid: latestCvid
                        }, userScope)
                        articleToPush = [latestArticle]
                    }
                } else {
                    articleToPush = [newArticles[0]]
                    subLog('debug', 'article-new-items-detected', {
                        name,
                        source,
                        newArticleCount: newArticles.length,
                        cvid: `cv${newArticles[0].id}`
                    }, userScope)
                }

                for (const article of articleToPush) {
                    let canAdvanceCurrentArticle = false
                    try {
                        const cvid = `cv${article.id}`
                        const detailGroupCandidates = [groupId, ...targetGroups.filter(gid => String(gid) !== String(groupId))]
                        const detailFetch = await this.fetchWithGroupFallback(
                            detailGroupCandidates,
                            (candidateGroupId) => biliApi.getArticleInfo(cvid, candidateGroupId),
                            `getArticleInfo cvid=${cvid}`
                        )
                        const info = detailFetch.res

                        if (info.status !== 'success') {
                            subLog('warn', 'article-detail-fetch-failed', {
                                cvid
                            }, userScope)
                            continue
                        }

                        const { actualType, title: articleTitle, url } = resolveArticleTitle(info)
                        const notificationText = `${name} 发布了新专栏：\n${articleTitle}`
                        const effectiveGroupSourceMap = shouldRetryMissingGroups ? ledgerRetryMap : normalizedTargetGroupSourceMap
                        const notifyResult = await this.notifyGroupsWithImageAndCache(
                            effectiveGroupSourceMap,
                            info,
                            actualType,
                            url || `https://www.bilibili.com/read/${cvid}`,
                            notificationText,
                            { actorUid: uid, fallbackSources: [fallbackSource], disableDedup }
                        )
                        if (persistDelivery) {
                            await this.recordNotifyDeliveredGroups('article', cvid, notifyResult)
                        }
                        const decision = decideAdvance(notifyResult)
                        canAdvanceCurrentArticle = decision.action === 'advance'
                        if (!canAdvanceCurrentArticle) {
                            subLog('warn', 'article-state-advance-skipped', {
                                name,
                                source,
                                cvid,
                                decision: decision.action,
                                reason: decision.reason
                            }, userScope)
                        }

                        subLog('info', 'article-pushed', {
                            name,
                            source,
                            cvid
                        }, userScope)
                    } catch (e) {
                        subLog('error', 'article-push-failed', {
                            cvid: `cv${article.id}`,
                            error: logger.getErrorMessage(e)
                        }, userScope)
                    }

                    if (persistState && canAdvanceCurrentArticle && !shouldRetryMissingGroups) {
                        await this.updateArticleState(userItem, { articleId: latestCvid, articlePublishTime: latestArticlePublishTime })
                    }
                }
            }
        } catch (e) {
            subLog('error', 'article-check-failed', {
                name,
                source,
                error: logger.getErrorMessage(e)
            }, userScope)
        }
    },

    /**
     * 更新用户的视频状态
     * @param {Object} userItem - 用户对象
     * @param {Object|string} videoState - 最新视频状态或视频ID
     */
    async updateVideoState(userItem, videoState) {
        await this.advanceVideoState(userItem, typeof videoState === 'string'
            ? { videoId: videoState, videoCreated: null }
            : (videoState || {}))
    },

    async updateVideoLegacyState(userItem, videoState) {
        const { source, manualSub, cookieFollower, accountUid, uid } = userItem
        const state = typeof videoState === 'string'
            ? { videoId: videoState, videoCreated: null }
            : (videoState || {})
        const normalizeTimestamp = value => {
            if (value === null || value === undefined || value === '') return null
            const num = Number(value)
            return Number.isFinite(num) ? num : null
        }
        const updates = {
            lastVideoId: state.videoId || null,
            lastVideoCreated: normalizeTimestamp(state.videoCreated)
        }

        try {
            // 更新手动订阅的状态
            if (manualSub) {
                await subscriptionManager.updateUserSub(uid, updates)
            }

            // 更新Cookie follower的状态
            // 使用 updateCookieFollowerState 直接操作当前数组中的对象，
            // 避免 refreshCookieFollowings 并发替换数组引用导致的竞态条件
            if (cookieFollower) {
                await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates)
            }
        } catch (e) {
            subLog('error', 'video-state-update-failed', {
                uid,
                source,
                error: logger.getErrorMessage(e)
            }, logger.createScope('sub', 'user', uid))
        }
    },

    /**
     * 更新用户的专栏状态
     * @param {Object} userItem - 用户对象
     * @param {Object|string} articleState - 最新专栏状态或专栏ID
     */
    async updateArticleState(userItem, articleState) {
        await this.advanceArticleState(userItem, typeof articleState === 'string'
            ? { articleId: articleState, articlePublishTime: null }
            : (articleState || {}))
    },

    async updateArticleLegacyState(userItem, articleState) {
        const { source, manualSub, cookieFollower, accountUid, uid } = userItem
        const state = typeof articleState === 'string'
            ? { articleId: articleState, articlePublishTime: null }
            : (articleState || {})
        const normalizeTimestamp = value => {
            if (value === null || value === undefined || value === '') return null
            const num = Number(value)
            return Number.isFinite(num) ? num : null
        }
        const updates = {
            lastArticleId: state.articleId || null,
            lastArticlePublishTime: normalizeTimestamp(state.articlePublishTime)
        }

        try {
            // 更新手动订阅的状态
            if (manualSub) {
                await subscriptionManager.updateUserSub(uid, updates)
            }

            // 更新Cookie follower的状态
            // 使用 updateCookieFollowerState 直接操作当前数组中的对象，
            // 避免 refreshCookieFollowings 并发替换数组引用导致的竞态条件
            if (cookieFollower) {
                await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates)
            }
        } catch (e) {
            subLog('error', 'article-state-update-failed', {
                uid,
                source,
                error: logger.getErrorMessage(e)
            }, logger.createScope('sub', 'user', uid))
        }
    }
}
