#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const config = require(path.join(__dirname, '../../../src/config'))
const notificationService = require(path.join(__dirname, '../../../src/services/notificationService'))
const requestApprovalService = require(path.join(__dirname, '../../../src/services/requestApprovalService'))
const qqGroupAdminService = require(path.join(__dirname, '../../../src/services/qqGroupAdminService'))
const toolRegistry = require(path.join(__dirname, '../../../src/agent/tools/registry'))
const { checkToolPermission } = require(path.join(__dirname, '../../../src/agent/tools/permissionGate'))

const originals = {
    callAction: notificationService.callAction,
    rootAdmin: config.getRootAdminQQ
}

function restore() {
    notificationService.callAction = originals.callAction
    config.getRootAdminQQ = originals.rootAdmin
    requestApprovalService.pendingByKey.clear()
    requestApprovalService.queue = []
    requestApprovalService.keyByNotifyMessageId.clear()
    requestApprovalService.keyByShortId.clear()
    requestApprovalService.inflightKeys.clear()
}

function makeWs() {
    return { readyState: 1, send() {} }
}

async function run() {
    const calls = []
    let botRole = 'admin'
    let mixedSystemRequests = false
    notificationService.callAction = async (_ws, action, params) => {
        calls.push({ action, params })
        if (action === 'send_private_msg') {
            return { status: 'ok', retcode: 0, data: { message_id: 'notify-1' } }
        }
        if (action === 'get_group_member_info') {
            const userId = String(params.user_id)
            const roles = {
                999: botRole,
                42: 'admin',
                43: 'member',
                100: 'owner',
                123: 'member'
            }
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    group_id: Number(params.group_id),
                    user_id: Number(params.user_id),
                    nickname: `U${userId}`,
                    role: roles[userId] || 'member',
                    shut_up_timestamp: 0
                }
            }
        }
        if (action === 'get_group_member_list') {
            return {
                status: 'ok',
                retcode: 0,
                data: [
                    { group_id: 1000, user_id: 42, nickname: 'Admin42', card: '管理员', role: 'admin', shut_up_timestamp: 0 },
                    { group_id: 1000, user_id: 123, nickname: 'Normal123', card: '普通成员', role: 'member', shut_up_timestamp: 0 },
                    { group_id: 1000, user_id: 321, nickname: 'Applicant321', card: '申请人', role: 'member', shut_up_timestamp: 0 }
                ]
            }
        }
        if (action === 'get_group_shut_list') {
            return {
                status: 'ok',
                retcode: 0,
                data: [
                    { group_id: 1000, uin: 123, nick: 'Normal123', cardName: '普通成员', role: 1, shutUpTime: 1999999999 }
                ]
            }
        }
        if (action === 'get_essence_msg_list') {
            return {
                status: 'ok',
                retcode: 0,
                data: [{ message_id: 'msg-to-delete', sender_id: 123, sender_nick: 'Normal123', content: '精华内容' }]
            }
        }
        if (action === '_get_group_notice') {
            return {
                status: 'ok',
                retcode: 0,
                data: [{ notice_id: 'notice-1', sender_id: 42, message: { text: '群公告内容' } }]
            }
        }
        if (action === 'get_group_system_msg' || action === 'get_group_ignored_notifies') {
            if (mixedSystemRequests) return { status: 'ok', retcode: 0, data: [
                { group_id: 1000, request_id: 7, requester_uin: 321 },
                { group_id: 2000, request_id: 8, requester_uin: 999 }
            ] }
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    InvitedRequest: [],
                    join_requests: [
                        { request_id: 1, group_id: 1000, requester_uin: 321, requester_nick: 'Applicant321', message: '申请入群' },
                        { request_id: 2, group_id: 2000, requester_uin: 322, requester_nick: 'Other', message: '其他群' }
                    ]
                }
            }
        }
        if (action === 'get_group_at_all_remain') {
            return {
                status: 'ok',
                retcode: 0,
                data: { can_at_all: true, remain_at_all_count_for_group: 2, remain_at_all_count_for_uin: 1 }
            }
        }
        if (action === 'get_msg') {
            const messageId = String(params.message_id)
            const senderUserId = messageId === 'msg-to-delete' ? 123 : 100
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    group_id: 1000,
                    message_id: params.message_id,
                    user_id: senderUserId,
                    sender: { user_id: senderUserId }
                }
            }
        }
        if (
            action === 'set_group_ban' ||
            action === 'set_group_kick' ||
            action === 'set_group_card' ||
            action === 'set_group_whole_ban' ||
            action === 'delete_msg' ||
            action === 'set_essence_msg' ||
            action === 'delete_essence_msg' ||
            action === 'set_group_add_request' ||
            action === 'set_friend_add_request' ||
            action === '_send_group_notice' ||
            action === '_del_group_notice' ||
            action === 'set_online_status' ||
            action === 'set_input_status'
        ) {
            return { status: 'ok', retcode: 0, data: {} }
        }
        throw new Error(`unexpected action: ${action}`)
    }

    const memberActor = { userId: '43', groupId: '1000', isRoot: false, qqRole: 'member' }
    const adminActor = { userId: '42', groupId: '1000', isRoot: false, qqRole: 'admin' }
    const rootActor = { userId: '42', groupId: '1000', isRoot: true, qqRole: 'owner' }
    const mutePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.mute_member',
        arguments: { groupId: '1000', targetUserId: '123', duration: 60 }
    }, { groupId: '1000' })
    assert.strictEqual(checkToolPermission({ plan: mutePlan, actor: memberActor }).allowed, false)
    assert.strictEqual(checkToolPermission({ plan: mutePlan, actor: adminActor }).allowed, true)

    botRole = 'member'
    await assert.rejects(() => qqGroupAdminService.muteMember({
        groupId: '1000',
        targetUserId: '123',
        duration: 60
    }, {
        ws: makeWs(),
        selfId: '999',
        actor: adminActor
    }), /bot_not_group_admin/)

    botRole = 'admin'
    await assert.rejects(() => qqGroupAdminService.kickMember({
        groupId: '1000',
        targetUserId: '100'
    }, {
        ws: makeWs(),
        selfId: '999',
        actor: adminActor
    }), /target_is_group_owner/)

    await assert.rejects(() => qqGroupAdminService.muteMember({
        groupId: '1000',
        targetUserId: '42',
        duration: 60
    }, {
        ws: makeWs(),
        selfId: '999',
        actor: { userId: '100', groupId: '1000', isRoot: false, qqRole: 'owner' }
    }), /bot_role_not_higher_than_target/)

    const deletePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.delete_message',
        arguments: { targetUserId: '100' }
    }, {
        groupId: '1000',
        replyTarget: { messageId: 'msg-to-delete', userId: '123' }
    })
    assert.strictEqual(deletePlan.args.messageId, 'msg-to-delete')
    assert.strictEqual(deletePlan.args.targetUserId, undefined)
    const deleteResult = await toolRegistry.executeToolPlan(deletePlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(deleteResult.message.includes('已撤回'))
    assert.ok(calls.some(call => call.action === 'delete_msg' && call.params.message_id === 'msg-to-delete'))

    const searchPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.search_members',
        arguments: { groupId: '1000', query: '普通' }
    }, { groupId: '1000' })
    const searchResult = await toolRegistry.executeToolPlan(searchPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(searchResult.message.includes('普通成员'))

    const muteListPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.get_group_mute_list',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    const muteListResult = await toolRegistry.executeToolPlan(muteListPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(muteListResult.message.includes('禁言成员'))

    const essenceListPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.get_essence_messages',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    const essenceListResult = await toolRegistry.executeToolPlan(essenceListPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(essenceListResult.message.includes('精华消息'))

    const noticeListPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.get_group_notices',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    const noticeListResult = await toolRegistry.executeToolPlan(noticeListPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(noticeListResult.message.includes('群公告'))

    const sendNoticePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.send_group_notice',
        arguments: { groupId: '1000', content: '新的群公告', pinned: true, confirmRequired: false }
    }, { groupId: '1000' })
    assert.strictEqual(sendNoticePlan.risk, 'high')
    const sendNoticeResult = await toolRegistry.executeToolPlan(sendNoticePlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(sendNoticeResult.message.includes('已发布'))
    assert.ok(calls.some(call => call.action === '_send_group_notice' && call.params.content === '新的群公告' && call.params.pinned === 1 && call.params.confirm_required === 0))

    const deleteNoticePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.delete_group_notice',
        arguments: { groupId: '1000', noticeId: 'notice-1' }
    }, { groupId: '1000' })
    const deleteNoticeResult = await toolRegistry.executeToolPlan(deleteNoticePlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(deleteNoticeResult.message.includes('已删除'))
    assert.ok(calls.some(call => call.action === '_del_group_notice' && call.params.notice_id === 'notice-1'))

    const replaceNoticeStart = calls.length
    const replaceNoticePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.replace_group_notice',
        arguments: { groupId: '1000', noticeId: 'notice-1', content: '替换后的群公告' }
    }, { groupId: '1000' })
    const replaceNoticeResult = await toolRegistry.executeToolPlan(replaceNoticePlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(replaceNoticeResult.message.includes('已替换'))
    const replaceNoticeCalls = calls.slice(replaceNoticeStart).map(call => call.action)
    assert.deepStrictEqual(replaceNoticeCalls.filter(action => action === '_del_group_notice' || action === '_send_group_notice'), ['_del_group_notice', '_send_group_notice'])
    assert.throws(() => toolRegistry.normalizeToolIntent({
        name: 'qq.send_group_notice',
        arguments: { groupId: '1000', content: '' }
    }, { groupId: '1000' }), /missing_notice_content/)

    const systemPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.get_group_system_messages',
        arguments: { groupId: '1000', count: 10 }
    }, { groupId: '1000' })
    const systemResult = await toolRegistry.executeToolPlan(systemPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(systemResult.message.includes('系统消息'))
    assert.strictEqual(systemResult.data.joinRequests.length, 1)
    mixedSystemRequests = true
    const mixedResult = await toolRegistry.executeToolPlan(systemPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(mixedResult.message.includes('1 条'))
    assert.strictEqual(mixedResult.data.unclassifiedRequests.length, 1)
    assert.strictEqual(mixedResult.data.joinRequests.length, 0)
    mixedSystemRequests = false

    const ignoredPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.get_group_ignored_notifies',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    const ignoredResult = await toolRegistry.executeToolPlan(ignoredPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(ignoredResult.message.includes('被忽略系统消息'))

    const atAllPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.get_at_all_remain',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    const atAllResult = await toolRegistry.executeToolPlan(atAllPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(atAllResult.message.includes('@全体'))

    const cardPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.set_member_card',
        arguments: { groupId: '1000', targetUserId: '123', card: '新名片' }
    }, { groupId: '1000' })
    assert.strictEqual(cardPlan.risk, 'medium')
    const cardResult = await toolRegistry.executeToolPlan(cardPlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(cardResult.message.includes('新名片'))
    assert.ok(calls.some(call => call.action === 'set_group_card' && call.params.card === '新名片'))
    assert.throws(() => toolRegistry.normalizeToolIntent({
        name: 'qq.set_member_card',
        arguments: { groupId: '1000', targetUserId: '123' }
    }, { groupId: '1000' }), /missing_member_card/)

    const wholeBanPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.set_whole_ban',
        arguments: { groupId: '1000', enabled: true }
    }, { groupId: '1000' })
    assert.strictEqual(wholeBanPlan.risk, 'high')
    const wholeBanResult = await toolRegistry.executeToolPlan(wholeBanPlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(wholeBanResult.message.includes('开启'))
    assert.ok(calls.some(call => call.action === 'set_group_whole_ban' && call.params.enable === true))

    const essencePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.set_essence_message',
        arguments: {}
    }, {
        groupId: '1000',
        replyTarget: { messageId: 'msg-to-delete', userId: '123' }
    })
    const essenceResult = await toolRegistry.executeToolPlan(essencePlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(essenceResult.message.includes('设置为群精华'))
    assert.ok(calls.some(call => call.action === 'set_essence_msg' && call.params.message_id === 'msg-to-delete'))

    const deleteEssencePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.delete_essence_message',
        arguments: { groupId: '1000', messageId: 'msg-to-delete' }
    }, { groupId: '1000' })
    const deleteEssenceResult = await toolRegistry.executeToolPlan(deleteEssencePlan, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    })
    assert.ok(deleteEssenceResult.message.includes('移出群精华'))
    assert.ok(calls.some(call => call.action === 'delete_essence_msg' && call.params.message_id === 'msg-to-delete'))

    await assert.rejects(() => qqGroupAdminService.deleteMessage({
        messageId: 'owner-message'
    }, {
        ws: makeWs(),
        selfId: '999',
        groupId: '1000',
        actor: adminActor
    }), /target_is_group_owner/)

    config.getRootAdminQQ = () => '42'
    await requestApprovalService.handleRequestEvent(makeWs(), {
        post_type: 'request',
        request_type: 'group',
        sub_type: 'add',
        flag: 'flag-1',
        user_id: '321',
        group_id: '1000',
        comment: '申请入群'
    })
    const pending = requestApprovalService.listPendingApprovals()
    assert.strictEqual(pending.pendingCount, 1)
    const listPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.list_pending_requests',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    const listResult = await toolRegistry.executeToolPlan(listPlan, { ws: makeWs(), actor: adminActor })
    assert.ok(listResult.message.includes('待处理申请 1 个'))

    const crossGroupApprovePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.handle_group_request',
        arguments: { groupId: '2000', decision: 'approve', shortId: pending.items[0].shortId }
    }, { groupId: '2000' })
    await assert.rejects(
        () => toolRegistry.executeToolPlan(crossGroupApprovePlan, { ws: makeWs(), actor: { ...adminActor, groupId: '2000' } }),
        /approval_cross_group_denied/
    )

    const approvePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.handle_group_request',
        arguments: { groupId: '1000', decision: 'approve', shortId: pending.items[0].shortId }
    }, { groupId: '1000' })
    const approveResult = await toolRegistry.executeToolPlan(approvePlan, { ws: makeWs(), actor: adminActor })
    assert.ok(approveResult.message.includes('已同意申请'))
    assert.ok(calls.some(call => call.action === 'set_group_add_request' && call.params.approve === true))

    await requestApprovalService.handleRequestEvent(makeWs(), {
        post_type: 'request',
        request_type: 'friend',
        flag: 'friend-flag-1',
        user_id: '555',
        comment: '加好友'
    })
    const friendPending = requestApprovalService.listPendingApprovals().items.find(item => item.requestType === 'friend')
    assert.ok(friendPending)
    const friendListPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.list_friend_requests',
        arguments: {}
    }, { groupId: '1000' })
    assert.strictEqual(checkToolPermission({ plan: friendListPlan, actor: adminActor }).allowed, false)
    assert.strictEqual(checkToolPermission({ plan: friendListPlan, actor: rootActor }).allowed, true)
    const friendListResult = await toolRegistry.executeToolPlan(friendListPlan, { ws: makeWs(), actor: rootActor })
    assert.ok(friendListResult.message.includes('好友申请'))

    const friendApprovePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.handle_friend_request',
        arguments: { decision: 'approve', shortId: friendPending.shortId }
    }, { groupId: '1000' })
    const friendApproveResult = await toolRegistry.executeToolPlan(friendApprovePlan, { ws: makeWs(), actor: rootActor })
    assert.ok(friendApproveResult.message.includes('已同意好友申请'))
    assert.ok(calls.some(call => call.action === 'set_friend_add_request' && call.params.flag === 'friend-flag-1'))

    const onlinePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.set_online_status',
        arguments: { preset: 'busy' }
    }, { groupId: '1000' })
    const onlineResult = await toolRegistry.executeToolPlan(onlinePlan, { ws: makeWs(), actor: rootActor })
    assert.ok(onlineResult.message.includes('在线状态'))
    assert.ok(calls.some(call => call.action === 'set_online_status' && call.params.status === 50))

    const inputPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.set_input_status',
        arguments: { targetUserId: '123', preset: 'typing' }
    }, { groupId: '1000' })
    const inputResult = await toolRegistry.executeToolPlan(inputPlan, { ws: makeWs(), actor: rootActor })
    assert.ok(inputResult.message.includes('输入状态'))
    assert.ok(calls.some(call => call.action === 'set_input_status' && call.params.user_id === '123' && call.params.event_type === 1))

    console.log('✓ QQ 群管理工具权限与审批链路正常')
}

run()
    .then(() => {
        restore()
        process.exit(0)
    })
    .catch((error) => {
        restore()
        console.error(error)
        process.exit(1)
    })
