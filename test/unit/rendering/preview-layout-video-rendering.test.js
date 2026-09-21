#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderVideoContent } = require('../../../src/services/imageGenerator/renderers/video')
const { renderDynamicContent } = require('../../../src/services/imageGenerator/renderers/dynamic')
const { renderArticleContent } = require('../../../src/services/imageGenerator/renderers/article')
const { renderLiveContent } = require('../../../src/services/imageGenerator/renderers/live')
const { renderBangumiContent } = require('../../../src/services/imageGenerator/renderers/bangumi')
const { renderUserContent } = require('../../../src/services/imageGenerator/renderers/user')
const { buildMockPreviewTarget } = require('../../tools/preview-lab/mockData')

function assertLayoutKeys(html, keys) {
    for (const key of keys) {
        assert.match(html, new RegExp(`data-layout-key="${key}"`))
    }
}

describe('preview layout video renderer', function () {
    it('adds stable data-layout-key attributes for video elements', function () {
        const html = renderVideoContent({
            status: 'success',
            type: 'video',
            data: {
                title: '测试标题',
                desc: '测试简介',
                pic: 'https://example.com/cover.jpg',
                pubdate: 1710000000,
                duration: 120,
                owner: {
                    name: 'UP',
                    face: 'https://example.com/avatar.jpg',
                    official_verify: { type: 0 }
                },
                stat: {
                    view: 1,
                    like: 2,
                    reply: 3
                }
            }
        })

        assertLayoutKeys(html, [
            'cover',
            'content',
            'header',
            'avatar',
            'authorName',
            'pubTime',
            'title',
            'stats',
            'text'
        ])
    })

    it('adds stable data-layout-key attributes for dynamic elements', function () {
        const target = buildMockPreviewTarget('dynamic', {
            mediaMode: 'grid',
            isForward: true,
            withCommonCard: true,
            withEmbeddedResource: true,
            withOpusLinkCard: true,
            withVote: true
        })
        const html = renderDynamicContent(target.info)

        assertLayoutKeys(html, [
            'content',
            'header',
            'avatar',
            'authorName',
            'pubTime',
            'decorationCard',
            'text',
            'media',
            'embeddedResource',
            'supplementalCards',
            'origCard',
            'stats'
        ])
    })

    it('adds stable data-layout-key attributes for article elements', function () {
        const target = buildMockPreviewTarget('article')
        target.info.data.banner_url = 'https://example.com/article-cover.jpg'
        target.info.data.author_pendant_url = 'https://example.com/frame.png'
        target.info.data.author_card_url = 'https://example.com/card.png'
        const html = renderArticleContent(target.info)

        assertLayoutKeys(html, [
            'content',
            'header',
            'avatar',
            'authorName',
            'pubTime',
            'decorationCard',
            'cover',
            'title',
            'text',
            'stats'
        ])
    })

    it('adds stable data-layout-key attributes for live, bangumi and user elements', function () {
        const liveHtml = renderLiveContent(buildMockPreviewTarget('live').info)
        assertLayoutKeys(liveHtml, [
            'cover',
            'content',
            'header',
            'avatar',
            'authorName',
            'roomId',
            'liveBadge',
            'title',
            'stats'
        ])

        const bangumiHtml = renderBangumiContent(buildMockPreviewTarget('bangumi').info)
        assertLayoutKeys(bangumiHtml, [
            'cover',
            'content',
            'title',
            'statusLine',
            'stats',
            'text'
        ])

        const userHtml = renderUserContent(buildMockPreviewTarget('user', {
            mediaMode: 'grid',
            withEmbeddedResource: true,
            withCommonCard: true,
            withOpusLinkCard: true,
            withVote: true
        }).info, true)
        assertLayoutKeys(userHtml, [
            'content',
            'header',
            'avatar',
            'authorName',
            'uid',
            'medal',
            'signature',
            'stats',
            'dynamicSection',
            'dynamicText',
            'dynamicMedia',
            'supplementalCards'
        ])
    })
})
