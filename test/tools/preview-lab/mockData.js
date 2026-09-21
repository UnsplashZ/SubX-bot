'use strict'

const ALLOWED_MEDIA_MODES = ['none', 'single', 'grid', 'video', 'live_rcmd']
const ALLOWED_BANGUMI_SEASON_TYPES = ['bangumi', 'movie', 'doc', 'tv', 'guocha', 'variety']
const SUPPORTED_MOCK_TYPES = [
    'video',
    'live',
    'article',
    'bangumi',
    'user',
    'dynamic',
    'help_user',
    'help_admin',
    'subscription_list'
]

const DEFAULT_STRUCTURE_OPTIONS = {
    mediaMode: 'single',
    isForward: false,
    withCommonCard: false,
    withEmbeddedResource: false,
    withOpusLinkCard: false,
    withVote: false,
    blocked: false,
    seasonType: 'bangumi'
}

function encodeSvg(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function createPlaceholderImage(label, width, height, options = {}) {
    const bg = options.bg || '#E7EDF7'
    const accent = options.accent || '#B8C8E6'
    const text = options.text || '#5B6B85'
    const safeLabel = String(label || '').slice(0, 24)
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${bg}" />
                    <stop offset="100%" stop-color="${accent}" />
                </linearGradient>
            </defs>
            <rect width="${width}" height="${height}" rx="18" fill="url(#bg)" />
            <rect x="24" y="24" width="${Math.max(width - 48, 40)}" height="${Math.max(height - 48, 40)}" rx="14" fill="rgba(255,255,255,0.28)" />
            <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
                font-family="Arial, sans-serif" font-size="${Math.max(Math.floor(Math.min(width, height) / 9), 18)}"
                letter-spacing="2" fill="${text}">${safeLabel}</text>
        </svg>
    `
    return encodeSvg(svg)
}

function createTextNode(text) {
    return {
        type: 'RICH_TEXT_NODE_TYPE_TEXT',
        text,
        orig_text: text
    }
}

function normalizeBoolean(value, fallback = false) {
    if (value === undefined) return fallback
    return value === true
}

function normalizeStringChoice(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback
}

function normalizeStructureOptions(raw = {}) {
    const safe = raw && typeof raw === 'object' ? raw : {}
    return {
        mediaMode: normalizeStringChoice(safe.mediaMode, ALLOWED_MEDIA_MODES, DEFAULT_STRUCTURE_OPTIONS.mediaMode),
        isForward: normalizeBoolean(safe.isForward, DEFAULT_STRUCTURE_OPTIONS.isForward),
        withCommonCard: normalizeBoolean(safe.withCommonCard, DEFAULT_STRUCTURE_OPTIONS.withCommonCard),
        withEmbeddedResource: normalizeBoolean(safe.withEmbeddedResource, DEFAULT_STRUCTURE_OPTIONS.withEmbeddedResource),
        withOpusLinkCard: normalizeBoolean(safe.withOpusLinkCard, DEFAULT_STRUCTURE_OPTIONS.withOpusLinkCard),
        withVote: normalizeBoolean(safe.withVote, DEFAULT_STRUCTURE_OPTIONS.withVote),
        blocked: normalizeBoolean(safe.blocked, DEFAULT_STRUCTURE_OPTIONS.blocked),
        seasonType: normalizeStringChoice(
            safe.seasonType,
            ALLOWED_BANGUMI_SEASON_TYPES,
            DEFAULT_STRUCTURE_OPTIONS.seasonType
        )
    }
}

function buildPreviewUrl(mockType) {
    return `preview-lab://structure/${mockType}`
}

function createAuthorFace() {
    return createPlaceholderImage('AVATAR', 160, 160, {
        bg: '#FFD6E5',
        accent: '#FFDFF4',
        text: '#A75073'
    })
}

function createCover(label, width = 1200, height = 675) {
    return createPlaceholderImage(label, width, height, {
        bg: '#DDEBFF',
        accent: '#F9D8E9',
        text: '#51627E'
    })
}

function createGalleryImage(label, index) {
    const bgColors = ['#DBEAFE', '#E9D5FF', '#FCE7F3', '#FDE68A', '#BFDBFE', '#FBCFE8']
    const accentColors = ['#C7D2FE', '#DDD6FE', '#F9A8D4', '#FCD34D', '#93C5FD', '#F9A8D4']
    return createPlaceholderImage(label, 720, 720, {
        bg: bgColors[index % bgColors.length],
        accent: accentColors[index % accentColors.length],
        text: '#4B5563'
    })
}

function buildDynamicDesc(text) {
    return {
        text,
        rich_text_nodes: [createTextNode(text)]
    }
}

function buildCommonCard() {
    return {
        head_text: '相关游戏',
        title: '结构占位 common 小卡',
        desc1: '角色扮演 / 二次元 / 冒险',
        desc2: '用于观察 common 小卡在媒体区后的高度与留白',
        cover: createCover('COMMON', 360, 240),
        stat: {
            count: 12,
            follower: 34
        },
        jump_url: '//www.biligame.com/detail?id=123456',
        badge: {
            bg_color: '#FB7299'
        }
    }
}

function buildEmbeddedResourceCard() {
    return {
        title: '结构占位收藏夹',
        sub_title: '9 个内容',
        desc: '用于观察主动态引用资源卡的整体占位高度',
        cover: createCover('LIST', 640, 360),
        jump_url: '//www.bilibili.com/medialist/detail/ml123456',
        badge: {
            text: '收藏',
            bg_color: '#FF8A00'
        },
        stats: [
            { label: '内容', value: 9 },
            { label: '收藏', value: 3210 }
        ]
    }
}

function buildOpusLinkCards() {
    return [
        {
            card_type: 'LINK_CARD_TYPE_UGC',
            title: '结构占位视频卡',
            subtitle: '独立视频资源位',
            cover_url: createCover('LINK-A', 640, 360),
            duration_text: '07:01',
            stats: [
                { label: '播放', value: '1.8万' },
                { label: '弹幕', value: '245' }
            ]
        },
        {
            card_type: 'LINK_CARD_TYPE_ARTICLE',
            title: '结构占位文章卡',
            subtitle: '补充资源位',
            desc: '用于观察第二张 Opus link card 的纵向叠放效果',
            cover_url: createCover('LINK-B', 640, 360),
            badge_text: '专栏',
            stats: [
                { label: '阅读', value: '2.4万' }
            ]
        }
    ]
}

function buildVote() {
    return {
        desc: '结构预览投票卡',
        join_num: 128,
        choice_cnt: 1,
        items: [
            { desc: '选项 A', cnt: 52 },
            { desc: '选项 B', cnt: 41 },
            { desc: '选项 C', cnt: 35 }
        ]
    }
}

function buildDynamicMediaMajor(mediaMode) {
    if (mediaMode === 'none') {
        return {
            type: 'MAJOR_TYPE_NONE'
        }
    }

    if (mediaMode === 'grid') {
        return {
            type: 'MAJOR_TYPE_DRAW',
            draw: {
                items: Array.from({ length: 6 }, (_, index) => ({
                    src: createGalleryImage(`GRID-${index + 1}`, index),
                    width: 720,
                    height: 720
                }))
            }
        }
    }

    if (mediaMode === 'video') {
        return {
            type: 'MAJOR_TYPE_ARCHIVE',
            archive: {
                cover: createCover('VIDEO', 1280, 720),
                title: '结构占位视频卡',
                desc: '用于观察 inline 视频卡在动态中的高度',
                duration_text: '12:34',
                stat: {
                    play: 123456,
                    danmaku: 789
                }
            }
        }
    }

    if (mediaMode === 'live_rcmd') {
        return {
            type: 'MAJOR_TYPE_LIVE_RCMD',
            live_rcmd: {
                content: JSON.stringify({
                    live_play_info: {
                        cover: createCover('LIVE', 1280, 720),
                        title: '结构占位直播推荐',
                        live_status: 1,
                        parent_area_name: '聊天',
                        area_name: '陪伴',
                        watched_show: {
                            text_large: '12.3万观看'
                        }
                    }
                })
            }
        }
    }

    return {
        type: 'MAJOR_TYPE_DRAW',
        draw: {
            items: [{
                src: createGalleryImage('SINGLE', 0),
                width: 1200,
                height: 900
            }]
        }
    }
}

function buildBlockedDynamicPayload() {
    const pubTs = 1710000000
    const face = createAuthorFace()
    return {
        status: 'success',
        type: 'dynamic',
        data: {
            pub_ts: pubTs,
            item: {
                id_str: 'mock-dynamic-blocked',
                type: 'DYNAMIC_TYPE_WORD',
                author: {
                    level: 5
                },
                modules: {
                    module_author: {
                        name: '结构占位作者',
                        face,
                        pub_ts: pubTs,
                        official_verify: { type: 0 }
                    },
                    module_dynamic: {
                        major: {
                            type: 'MAJOR_TYPE_BLOCKED',
                            blocked: {
                                hint_message: '充电专属内容\n用于观察占位面板结构',
                                bg_img: {
                                    img_day: createCover('BLOCKED-DAY', 960, 320),
                                    img_dark: createCover('BLOCKED-NIGHT', 960, 320)
                                }
                            }
                        }
                    },
                    module_stat: {
                        forward: { count: 12 },
                        comment: { count: 34 },
                        like: { count: 56 }
                    }
                }
            }
        }
    }
}

function buildOrigDynamicModule() {
    return {
        major: {
            type: 'MAJOR_TYPE_DRAW',
            draw: {
                items: [{
                    src: createGalleryImage('ORIG', 1),
                    width: 1080,
                    height: 1080
                }]
            }
        },
        desc: buildDynamicDesc('原动态正文占位文本，用于观察转发结构。')
    }
}

function buildDynamicPayload(structureOptions = {}) {
    const options = normalizeStructureOptions(structureOptions)
    if (options.blocked) {
        return buildBlockedDynamicPayload()
    }

    const pubTs = 1710000000
    const face = createAuthorFace()
    const pendant = createPlaceholderImage('FRAME', 220, 220, {
        bg: '#FFE7F0',
        accent: '#D7ECFF',
        text: '#8A5D7A'
    })
    const decorationCard = createCover('CARD', 420, 220)
    const major = buildDynamicMediaMajor(options.mediaMode)
    const dynamicModule = {
        desc: buildDynamicDesc('正文占位文本，用于观察动态正文、媒体区与附加卡的组合结构。'),
        major,
        additional: {}
    }

    if (options.withCommonCard) {
        dynamicModule.additional.common = buildCommonCard()
    }
    if (options.withOpusLinkCard) {
        dynamicModule.additional.opus_link_cards = buildOpusLinkCards()
    }
    if (options.withVote) {
        dynamicModule.additional.vote = buildVote()
    }
    if (options.withEmbeddedResource) {
        dynamicModule.major.type = 'MAJOR_TYPE_MEDIALIST'
        dynamicModule.major.medialist = buildEmbeddedResourceCard()
        if (options.mediaMode === 'grid' || options.mediaMode === 'single') {
            dynamicModule.major.draw = major.draw
        } else if (options.mediaMode === 'video') {
            dynamicModule.major.archive = major.archive
        } else if (options.mediaMode === 'live_rcmd') {
            dynamicModule.major.live_rcmd = major.live_rcmd
        }
    }

    const item = {
        id_str: 'mock-dynamic',
        type: options.isForward ? 'DYNAMIC_TYPE_FORWARD' : 'DYNAMIC_TYPE_DRAW',
        author: {
            level: 6,
            pendant_url: pendant,
            card_url: decorationCard,
            card_number: '1024',
            fan_color: '#FB7299',
            card_focus_color: '#B7D7FF',
            avatar_focus_color: '#FFD0E1'
        },
        modules: {
            module_author: {
                name: '结构占位作者',
                face,
                pub_ts: pubTs,
                official_verify: { type: 0 },
                pendant: { image: pendant },
                decoration_card: {
                    card_url: decorationCard,
                    fan: {
                        num_desc: '1024',
                        color: '#FB7299'
                    }
                }
            },
            module_dynamic: dynamicModule,
            module_stat: {
                forward: { count: 345 },
                comment: { count: 678 },
                like: { count: 9012 }
            }
        }
    }

    if (options.isForward) {
        item.orig = {
            type: 'DYNAMIC_TYPE_DRAW',
            modules: {
                module_author: {
                    name: '原动态作者',
                    face,
                    pub_ts: pubTs - 86400,
                    official_verify: { type: 0 }
                },
                module_dynamic: buildOrigDynamicModule()
            }
        }
    }

    return {
        status: 'success',
        type: 'dynamic',
        data: {
            pub_ts: pubTs,
            item
        }
    }
}

function buildUserPayload(structureOptions = {}) {
    const options = normalizeStructureOptions(structureOptions)
    const dynamicPayload = buildDynamicPayload({
        ...options,
        blocked: false
    })
    const face = createAuthorFace()
    return {
        status: 'success',
        type: 'user',
        data: {
            uid: '15156331',
            name: '结构占位用户',
            face,
            sign: '签名占位文本，用于观察简介区域高度。',
            level: 6,
            likes: 123456,
            archive_view: 7890123,
            pendant: {
                image: createPlaceholderImage('FRAME', 220, 220, {
                    bg: '#FDE7F3',
                    accent: '#E0F2FE',
                    text: '#8A5D7A'
                })
            },
            relation: {
                follower: 432109,
                following: 256
            },
            vip: {
                status: 1,
                label: {
                    text: '年度大会员'
                }
            },
            fans_medal: {
                medal: {
                    medal_name: '粉丝牌',
                    level: 12
                }
            },
            dynamic: dynamicPayload.data.item
        }
    }
}

function buildArticlePayload() {
    const articleImage = createCover('ARTICLE', 1280, 720)
    return {
        status: 'success',
        type: 'article',
        data: {
            title: '结构占位专栏标题',
            summary: '正文占位文本，用于观察专栏摘要模式下的正文区、统计区与总体高度。',
            html_content: `
                <p>正文占位文本，用于观察专栏正文与插图之间的留白关系。</p>
                <figure><img src="${articleImage}" alt="article placeholder"></figure>
                <p>插图后的补充正文，用于观察图片占位加入后的整体高度。</p>
            `,
            publish_time: 1710000000,
            author_name: '结构占位作者',
            author_face: createAuthorFace(),
            stats: {
                share: 123,
                like: 456,
                reply: 78
            },
            focus: {
                cover: '#B7D7FF',
                avatar: '#FFD0E1'
            }
        }
    }
}

function buildVideoPayload() {
    return {
        status: 'success',
        type: 'video',
        data: {
            title: '结构占位视频标题',
            desc: '简介占位文本，用于观察视频卡在标题、统计与简介同时存在时的高度。',
            pic: createCover('VIDEO', 1280, 720),
            pubdate: 1710000000,
            duration: 3723,
            owner: {
                name: '结构占位 UP',
                face: createAuthorFace(),
                official_verify: { type: 0 }
            },
            stat: {
                view: 1234567,
                like: 67890,
                reply: 1234
            },
            focus: {
                cover: '#B7D7FF',
                avatar: '#FFD0E1'
            }
        }
    }
}

function buildLivePayload() {
    return {
        status: 'success',
        type: 'live',
        data: {
            room_info: {
                room_id: 27354807,
                cover: createCover('LIVE', 1280, 720),
                title: '结构占位直播间标题',
                parent_area_name: '聊天电台',
                area_name: '陪伴互动',
                live_status: 1
            },
            anchor_info: {
                base_info: {
                    uname: '结构占位主播',
                    face: createAuthorFace()
                }
            },
            watched_show: {
                text_large: '12.3万观看'
            },
            focus: {
                cover: '#B7D7FF',
                avatar: '#FFD0E1'
            }
        }
    }
}

function buildBangumiPayload(structureOptions = {}) {
    const options = normalizeStructureOptions(structureOptions)
    const seasonMeta = {
        bangumi: { seasonType: 1, styles: ['动画'], areas: ['日本'], typeDesc: '番剧' },
        movie: { seasonType: 2, styles: ['电影'], areas: ['中国大陆'], typeDesc: '电影' },
        doc: { seasonType: 3, styles: ['纪录片'], areas: ['中国大陆'], typeDesc: '纪录片' },
        tv: { seasonType: 5, styles: ['电视剧'], areas: ['中国大陆'], typeDesc: '电视剧' },
        guocha: { seasonType: 4, styles: ['国创'], areas: ['中国大陆'], typeDesc: '国创' },
        variety: { seasonType: 7, styles: ['综艺'], areas: ['中国大陆'], typeDesc: '综艺' }
    }[options.seasonType]

    return {
        status: 'success',
        type: 'bangumi',
        data: {
            title: '结构占位番剧标题',
            desc: '简介占位文本，用于观察状态行与简介组合高度。',
            cover: createCover('BANGUMI', 1200, 1600),
            season_type: seasonMeta.seasonType,
            type_desc: seasonMeta.typeDesc,
            styles: seasonMeta.styles,
            areas: seasonMeta.areas.map((name) => ({ name })),
            publish: {
                release_date_show: '2026-03-18',
                is_finish: 0,
                pub_time: '2026-03-22 20:00:00'
            },
            new_ep: {
                desc: '更新至第12集',
                title: '12',
                index_show: '12'
            },
            stat: {
                views: 1234567,
                follow: 345678,
                danmakus: 45678
            },
            rating: {
                score: '9.6'
            },
            focus: {
                cover: '#B7D7FF'
            }
        }
    }
}

function buildHelpPayload(type) {
    const titleMap = {
        help_user: '用户帮助结构预览',
        help_admin: '管理帮助结构预览'
    }
    return {
        status: 'success',
        type,
        data: {
            title: titleMap[type] || '结构预览'
        }
    }
}

function buildSubscriptionListPayload() {
    const face = createAuthorFace()
    return {
        status: 'success',
        type: 'subscription_list',
        data: {
            users: [
                { uid: '15156331', name: '结构占位 UP', face, officialVerify: { type: 0 } },
                { uid: '946974', name: '第二个占位 UP', face, officialVerify: { type: 1 } }
            ],
            bangumis: [
                { title: '结构占位番剧 A' },
                { title: '结构占位番剧 B' }
            ],
            accountFollows: [
                { uid: '123456', name: '关注占位用户', face, officialVerify: { type: 0 } }
            ],
            accountFollowsTitle: '账户关注列表'
        }
    }
}

function buildMockPreviewTarget(mockType, structureOptions = {}) {
    if (!SUPPORTED_MOCK_TYPES.includes(mockType)) {
        throw new Error(`未支持的结构预览类型: ${mockType}`)
    }

    const options = normalizeStructureOptions(structureOptions)
    const canonicalUrl = buildPreviewUrl(mockType)
    let info
    let cardType = mockType

    switch (mockType) {
        case 'video':
            info = buildVideoPayload()
            cardType = 'video'
            break
        case 'live':
            info = buildLivePayload()
            cardType = 'live'
            break
        case 'article':
            info = buildArticlePayload()
            cardType = 'article'
            break
        case 'bangumi':
            info = buildBangumiPayload(options)
            cardType = 'bangumi'
            break
        case 'user':
            info = buildUserPayload(options)
            cardType = 'user'
            break
        case 'dynamic':
            info = buildDynamicPayload(options)
            cardType = 'dynamic'
            break
        case 'help_user':
        case 'help_admin':
            info = buildHelpPayload(mockType)
            break
        case 'subscription_list':
            info = buildSubscriptionListPayload()
            break
        default:
            throw new Error(`未支持的结构预览类型: ${mockType}`)
    }

    return {
        status: 'success',
        info,
        cardType,
        canonicalUrl,
        url: canonicalUrl,
        mockType,
        structureOptions: options
    }
}

module.exports = {
    ALLOWED_MEDIA_MODES,
    ALLOWED_BANGUMI_SEASON_TYPES,
    DEFAULT_STRUCTURE_OPTIONS,
    SUPPORTED_MOCK_TYPES,
    normalizeStructureOptions,
    buildMockPreviewTarget
}
