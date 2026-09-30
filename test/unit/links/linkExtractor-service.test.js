'use strict'

const assert = require('assert')
const { extractLinksFromMessage } = require('../../../src/services/link/linkExtractor')

describe('linkExtractor service', function () {
    it('保留现有 descriptor 结构', function () {
        const links = extractLinksFromMessage('https://www.bilibili.com/space/123/favlist?fid=456', '10001')

        assert.deepStrictEqual(links[0], {
            type: 'favorite_list',
            id: '456',
            cacheKey: 'favorite_list|video:456|10001',
            match: 'https://www.bilibili.com/space/123/favlist?fid=456',
            meta: {
                url: 'https://www.bilibili.com/space/123/favlist?fid=456',
                mediaId: '456',
                favoriteType: 'video',
                uniqueId: 'video:456'
            },
            sourceToken: 'https://www.bilibili.com/space/123/favlist?fid=456'
        })
    })

    it('将用户动态页解析为用户页', function () {
        const links = extractLinksFromMessage('https://space.bilibili.com/401742377/dynamic', '10001')

        assert.deepStrictEqual(links[0], {
            type: 'user',
            id: '401742377',
            cacheKey: 'user|401742377|10001',
            match: 'https://space.bilibili.com/401742377/dynamic',
            meta: {},
            sourceToken: 'https://space.bilibili.com/401742377/dynamic'
        })
    })

    it('将 www 空间动态页解析为用户页', function () {
        const links = extractLinksFromMessage('https://www.bilibili.com/space/401742377/dynamic', '10001')

        assert.deepStrictEqual(links[0], {
            type: 'user',
            id: '401742377',
            cacheKey: 'user|401742377|10001',
            match: 'https://www.bilibili.com/space/401742377/dynamic',
            meta: {},
            sourceToken: 'https://www.bilibili.com/space/401742377/dynamic'
        })
    })

    it('将带空格标签的 Markdown 小红书链接解析为目标 URL', function () {
        const links = extractLinksFromMessage(
            '[打开这条笔记](https://www.xiaohongshu.com/explore/68feefe40000000007030c4a?xsec_token=TOKEN\\&xsec_source=pc_feed)',
            '10001'
        )

        assert.strictEqual(links.length, 1)
        assert.strictEqual(links[0].type, 'xhs_note')
        assert.strictEqual(links[0].meta.queryString, '?xsec_token=TOKEN&xsec_source=pc_feed')
    })
})
