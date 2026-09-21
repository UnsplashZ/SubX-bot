#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const { parseCliArgs } = require('../../tools/preview-lab/cliOptions')

function testParseCliArgsDefaults() {
    const parsed = parseCliArgs(['https://www.bilibili.com/read/cv45123193'])
    assert.strictEqual(parsed.help, false)
    assert.strictEqual(parsed.input, 'https://www.bilibili.com/read/cv45123193')
    assert.strictEqual(parsed.options.groupId, null)
    assert.strictEqual(parsed.options.cacheMode, 'cached')
    assert.strictEqual(parsed.options.emitHtml, false)
    assert.strictEqual(parsed.options.showId, true)
    assert.strictEqual(parsed.options.outName, '')
    assert.strictEqual(parsed.options.outputDir, path.resolve(process.cwd(), 'test/output'))
}

function testParseCliArgsFlags() {
    const parsed = parseCliArgs([
        '--group-id', '1000',
        '--fresh',
        '--html',
        '--show-id', 'false',
        '--out-name', 'demo 文件名',
        'https://t.bilibili.com/1180316687231090707'
    ])

    assert.strictEqual(parsed.options.groupId, '1000')
    assert.strictEqual(parsed.options.cacheMode, 'fresh')
    assert.strictEqual(parsed.options.emitHtml, true)
    assert.strictEqual(parsed.options.showId, false)
    assert.strictEqual(parsed.options.outName, 'demo')
    assert.strictEqual(parsed.input, 'https://t.bilibili.com/1180316687231090707')
}

function testParseCliArgsHelp() {
    const parsed = parseCliArgs(['--help'])
    assert.strictEqual(parsed.help, true)
    assert.strictEqual(parsed.input, '')
}

function run() {
    testParseCliArgsDefaults()
    testParseCliArgsFlags()
    testParseCliArgsHelp()
    console.log('PASS preview-lab-cli-options')
}

run()
