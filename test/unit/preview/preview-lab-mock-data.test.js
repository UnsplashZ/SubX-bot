#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    buildMockPreviewTarget,
    normalizeStructureOptions
} = require('../../tools/preview-lab/mockData')

function testDynamicStructureOptionsProduceExpectedModules() {
    const target = buildMockPreviewTarget('dynamic', {
        mediaMode: 'video',
        isForward: true,
        withCommonCard: true,
        withEmbeddedResource: true,
        withOpusLinkCard: true,
        withVote: true
    })

    const item = target.info.data.item
    const dynamicModule = item.modules.module_dynamic

    assert.strictEqual(target.cardType, 'dynamic')
    assert.ok(dynamicModule.major.archive, 'video 模式应注入 archive')
    assert.ok(dynamicModule.major.medialist, 'withEmbeddedResource 应注入主动态引用资源卡')
    assert.ok(dynamicModule.additional.common, 'withCommonCard 应注入 common')
    assert.ok(Array.isArray(dynamicModule.additional.opus_link_cards), 'withOpusLinkCard 应注入 opus link cards')
    assert.ok(dynamicModule.additional.vote, 'withVote 应注入投票卡')
    assert.ok(item.orig, 'isForward 应注入 orig 结构')
}

function testBlockedDynamicTakesPriorityOverOtherOptions() {
    const target = buildMockPreviewTarget('dynamic', {
        blocked: true,
        mediaMode: 'grid',
        withCommonCard: true,
        withVote: true
    })

    const dynamicModule = target.info.data.item.modules.module_dynamic
    assert.strictEqual(dynamicModule.major.type, 'MAJOR_TYPE_BLOCKED')
    assert.ok(!dynamicModule.additional || Object.keys(dynamicModule.additional).length === 0, 'blocked 模式不应保留附加卡')
}

function testUserStructureOptionsApplyToRecentDynamic() {
    const target = buildMockPreviewTarget('user', {
        mediaMode: 'grid',
        withCommonCard: true,
        withOpusLinkCard: true
    })

    const recentDynamic = target.info.data.dynamic
    const dynamicModule = recentDynamic.modules.module_dynamic
    assert.ok(dynamicModule.major.draw, '用户最近动态应复用媒体模式')
    assert.ok(dynamicModule.additional.common, '用户最近动态应复用 common 小卡')
    assert.ok(Array.isArray(dynamicModule.additional.opus_link_cards), '用户最近动态应复用 opus link cards')
}

function testBangumiSeasonTypeAffectsPayload() {
    const movieTarget = buildMockPreviewTarget('bangumi', {
        seasonType: 'movie'
    })

    assert.strictEqual(movieTarget.info.data.season_type, 2)
    assert.ok(movieTarget.info.data.styles.includes('电影'))
    assert.strictEqual(normalizeStructureOptions({ seasonType: 'unknown' }).seasonType, 'bangumi')
}

function testArticleStructureIncludesPlaceholderImage() {
    const target = buildMockPreviewTarget('article')
    assert.ok(target.info.data.html_content.includes('<img '), '专栏结构预览应包含图片占位')
    assert.ok(target.info.data.html_content.includes('data:image/svg+xml'), '专栏结构预览图片应使用内联占位图')
}

function run() {
    testDynamicStructureOptionsProduceExpectedModules()
    testBlockedDynamicTakesPriorityOverOtherOptions()
    testUserStructureOptionsApplyToRecentDynamic()
    testBangumiSeasonTypeAffectsPayload()
    testArticleStructureIncludesPlaceholderImage()
    console.log('PASS preview-lab-mock-data')
}

run()
