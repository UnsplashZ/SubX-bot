#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    renderExternalRichText
} = require('../../../src/services/imageGenerator/renderers/components/richtext')
const { renderDouyinVideoContent } = require('../../../src/services/imageGenerator/renderers/douyin')
const { renderXhsNoteContent } = require('../../../src/services/imageGenerator/renderers/xiaohongshu')

function testExternalRichTextTokens() {
    const html = renderExternalRichText('标题 #旅行# @小明 https://example.com?a=1&b=2\n下一行 <script>alert(1)</script>')

    assert.ok(html.includes('<span class="topic-tag">#旅行#</span>'))
    assert.ok(html.includes('<span class="at-user">@小明</span>'))
    assert.ok(html.includes('class="rich-link external-link"'))
    assert.ok(html.includes('title="https://example.com?a=1&amp;b=2"'))
    assert.ok(html.includes('<br>下一行'))
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assert.ok(!html.includes('<script>'))
}

function testDouyinChainedTopics() {
    // 抖音链式话题："#抽象#搞笑#精神状态#耀祖" 应拆成 4 个独立标签，空格分隔
    const html = renderExternalRichText('你就叫我声爸爸吧，好不好。#抽象#搞笑#精神状态#耀祖')

    assert.ok(html.includes('好不好。'), '正文保留')
    assert.ok(html.includes('<span class="topic-tag">#抽象</span> <span class="topic-tag">#搞笑</span> <span class="topic-tag">#精神状态</span> <span class="topic-tag">#耀祖</span>'))
    assert.ok(!html.includes('#抽象#'), '不应残留链式原始串')
}

function testXhsSpacedOpenTopics() {
    // 小红书空格分隔的开式话题："#穿搭 #ootd" 是两个独立标签
    const html = renderExternalRichText('今日穿搭 #穿搭 #ootd 完毕')

    assert.strictEqual(
        html,
        '今日穿搭 <span class="topic-tag">#穿搭</span> <span class="topic-tag">#ootd</span> 完毕'
    )
}

function testTopicEdgeCases() {
    // 闭合话题后紧跟标点
    assert.ok(renderExternalRichText('#旅行#，出发').includes('<span class="topic-tag">#旅行#</span>，出发'))
    // 话题内含 HTML 特殊字符应转义且不截断
    assert.ok(renderExternalRichText('#A&B# 文本').includes('<span class="topic-tag">#A</span>'))
    // 孤立的 # 按普通文本渲染
    assert.strictEqual(renderExternalRichText('1 # 2'), '1 # 2')
    // 连续 ## 且后随空白时不生成空标签
    assert.strictEqual(renderExternalRichText('a## b'), 'a## b')
}

function testPlatformRenderersUseExternalRichText() {
    const douyin = renderDouyinVideoContent({
        data: {
            author: { name: '作者', signature: '#签名# @用户' },
            title: '视频 #话题# https://example.com',
            cover: '',
            pubdate: 0,
            duration: 0
        }
    })
    assert.ok(douyin.includes('class="topic-tag">#话题#</span>'))
    assert.ok(douyin.includes('class="user-signature"'))
    assert.ok(douyin.includes('class="topic-tag">#签名#</span>'))

    const xhs = renderXhsNoteContent({
        data: {
            author: { name: '作者', face: '' },
            title: '笔记 #旅行#',
            desc: '正文 @小红书 https://example.com',
            images: [],
            pubdate: 0
        }
    })
    assert.ok(xhs.includes('class="topic-tag">#旅行#</span>'))
    assert.ok(xhs.includes('class="at-user">@小红书</span>'))
}

testExternalRichTextTokens()
testDouyinChainedTopics()
testXhsSpacedOpenTopics()
testTopicEdgeCases()
testPlatformRenderersUseExternalRichText()
console.log('PASS external-richtext-rendering')
