#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    STRUCTURE_TYPE_OPTIONS,
    buildResultImageUrl,
    supportsDynamicOptions,
    supportsSeasonType,
    getVisibilityState
} = require('../../tools/preview-lab/web/uiState')

function testStructureTypeOptionsIncludeSupportedEntries() {
    const values = STRUCTURE_TYPE_OPTIONS.map((item) => item.value)
    assert.ok(values.includes('dynamic'))
    assert.ok(values.includes('help_admin'))
    assert.ok(values.includes('subscription_list'))
}

function testVisibilityStateForLinkMode() {
    const visibility = getVisibilityState('link', 'dynamic')
    assert.strictEqual(visibility.showLinkInput, true)
    assert.strictEqual(visibility.showStructureControls, false)
    assert.strictEqual(visibility.showDynamicOptions, false)
    assert.strictEqual(visibility.showSeasonType, false)
}

function testVisibilityStateForDynamicStructureMode() {
    const visibility = getVisibilityState('structure', 'dynamic')
    assert.strictEqual(visibility.showLinkInput, false)
    assert.strictEqual(visibility.showStructureControls, true)
    assert.strictEqual(visibility.showDynamicOptions, true)
    assert.strictEqual(visibility.showSeasonType, false)
    assert.strictEqual(supportsDynamicOptions('dynamic'), true)
}

function testVisibilityStateForBangumiStructureMode() {
    const visibility = getVisibilityState('structure', 'bangumi')
    assert.strictEqual(visibility.showDynamicOptions, false)
    assert.strictEqual(visibility.showSeasonType, true)
    assert.strictEqual(supportsSeasonType('bangumi'), true)
}

function testBuildResultImageUrlAppendsCacheBuster() {
    const imageUrl = buildResultImageUrl('/api/files/demo.png', {
        finishedAt: '2026-03-18T10:00:00.000Z'
    })
    assert.ok(imageUrl.startsWith('/api/files/demo.png?'))
    assert.ok(imageUrl.includes('2026-03-18T10%3A00%3A00.000Z'))
}

function run() {
    testStructureTypeOptionsIncludeSupportedEntries()
    testVisibilityStateForLinkMode()
    testVisibilityStateForDynamicStructureMode()
    testVisibilityStateForBangumiStructureMode()
    testBuildResultImageUrlAppendsCacheBuster()
    console.log('PASS preview-lab-ui-state')
}

run()
