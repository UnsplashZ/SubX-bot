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
testPlatformRenderersUseExternalRichText()
console.log('PASS external-richtext-rendering')
