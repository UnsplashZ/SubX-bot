'use strict'

const video = require('./linkTypes/video')
const bangumi = require('./linkTypes/bangumi')
const dynamic = require('./linkTypes/dynamic')
const article = require('./linkTypes/article')
const live = require('./linkTypes/live')
const opus = require('./linkTypes/opus')
const ep = require('./linkTypes/ep')
const media = require('./linkTypes/media')
const user = require('./linkTypes/user')
const favoriteList = require('./linkTypes/favoriteList')
const audio = require('./linkTypes/audio')
const audioList = require('./linkTypes/audioList')
const topic = require('./linkTypes/topic')
const channelSeries = require('./linkTypes/channelSeries')
const articleList = require('./linkTypes/articleList')
const note = require('./linkTypes/note')
const cheeseVideo = require('./linkTypes/cheeseVideo')
const douyinVideo = require('./linkTypes/douyinVideo')
const douyinNote = require('./linkTypes/douyinNote')
const douyinShort = require('./linkTypes/douyinShort')
const xhsNote = require('./linkTypes/xhsNote')
const xhsShort = require('./linkTypes/xhsShort')

const handlers = new Map([
    video,
    bangumi,
    dynamic,
    article,
    live,
    opus,
    ep,
    media,
    user,
    favoriteList,
    audio,
    audioList,
    topic,
    channelSeries,
    articleList,
    note,
    cheeseVideo,
    douyinVideo,
    douyinNote,
    douyinShort,
    xhsNote,
    xhsShort
].map((handler) => [handler.type, handler]))

function getHandler(type) {
    return handlers.get(type) || null
}

module.exports = {
    getHandler
}
