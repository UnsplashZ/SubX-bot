const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

class OfficialIdStore {
    constructor(options = {}) {
        this.groups = new Map()
        this.users = new Map()
        this.members = new Map()
        this.storagePath = options.storagePath || ''
        this.saveTimer = null
        this._dirty = { groups: new Set(), users: new Set(), members: new Set() }
        this._revision = 0
        this._persistedRevision = -1
        this._flushInProgress = false
        this._flushQueued = false
        this._isFork = Boolean(options.isFork)
        this._committed = false
        if (options.snapshot) this._restoreSnapshot(options.snapshot)
        else this.load()
    }

    load() {
        if (!this.storagePath || !fs.existsSync(this.storagePath)) return
        try {
            const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))
            for (const group of Array.isArray(data.groups) ? data.groups : []) {
                if (group?.groupOpenId) this.groups.set(String(group.groupOpenId), group)
            }
            for (const user of Array.isArray(data.users) ? data.users : []) {
                if (user?.userOpenId) this.users.set(String(user.userOpenId), user)
            }
            for (const member of Array.isArray(data.members) ? data.members : []) {
                const key = this.makeMemberKey(member?.groupOpenId, member?.memberOpenId)
                if (key) this.members.set(key, member)
            }
            fs.chmodSync(this.storagePath, 0o600)
            this._persistedRevision = this._revision
        } catch {}
    }

    serialize() {
        return {
            schemaVersion: 1,
            groups: Array.from(this.groups.values()),
            users: Array.from(this.users.values()),
            members: Array.from(this.members.values())
        }
    }

    _restoreSnapshot(snapshot) {
        this.groups = new Map((snapshot?.groups || []).map((item) => [String(item.groupOpenId), clone(item)]))
        this.users = new Map((snapshot?.users || []).map((item) => [String(item.userOpenId), clone(item)]))
        this.members = new Map((snapshot?.members || []).map((item) => [this.makeMemberKey(item.groupOpenId, item.memberOpenId), clone(item)]))
    }

    _markDirty(kind, key) {
        this._dirty[kind].add(key)
        this._revision += 1
    }

    fork() {
        return new OfficialIdStore({ snapshot: this.serialize(), isFork: true })
    }

    captureState() {
        let disk = { exists: false, content: null }
        if (this.storagePath && fs.existsSync(this.storagePath)) {
            disk = { exists: true, content: fs.readFileSync(this.storagePath) }
        }
        return {
            data: this.serialize(),
            revision: this._revision,
            persistedRevision: this._persistedRevision,
            dirty: {
                groups: [...this._dirty.groups],
                users: [...this._dirty.users],
                members: [...this._dirty.members]
            },
            disk
        }
    }

    restoreState(state) {
        if (!state) throw new TypeError('OfficialIdStore restore state is required')
        if (this.saveTimer) {
            clearTimeout(this.saveTimer)
            this.saveTimer = null
        }
        if (this.storagePath) {
            if (state.disk?.exists) {
                this._atomicFlush(state.disk.content)
            } else if (fs.existsSync(this.storagePath)) {
                fs.unlinkSync(this.storagePath)
                const dirFd = fs.openSync(path.dirname(this.storagePath), 'r')
                try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
            }
        }
        this._restoreSnapshot(state.data)
        this._revision = Number(state.revision || 0)
        this._persistedRevision = Number(state.persistedRevision ?? -1)
        this._dirty = {
            groups: new Set(state.dirty?.groups || []),
            users: new Set(state.dirty?.users || []),
            members: new Set(state.dirty?.members || [])
        }
        this._flushQueued = false
        this._flushInProgress = false
        return this
    }

    commitFrom(candidate) {
        if (!(candidate instanceof OfficialIdStore) || !candidate._isFork) {
            throw new TypeError('OfficialIdStore commit source must be a fork')
        }
        if (candidate._committed) return this
        const previous = this.serialize()
        const previousRevision = this._revision
        for (const kind of ['groups', 'users', 'members']) {
            for (const key of candidate._dirty[kind]) {
                const value = candidate[kind].get(key)
                if (value === undefined) this[kind].delete(key)
                else this[kind].set(key, clone(value))
                this._markDirty(kind, key)
            }
        }
        try {
            this.flush()
        } catch (error) {
            this._restoreSnapshot(previous)
            this._revision = previousRevision
            throw error
        }
        candidate._committed = true
        return this
    }

    scheduleSave() {
        if (!this.storagePath) return
        if (this.saveTimer) clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null
            try { this.flush() } catch {}
        }, 50)
        if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
    }

    _atomicFlush(payload) {
        const directory = path.dirname(this.storagePath)
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
        const tempPath = path.join(
            directory,
            `.${path.basename(this.storagePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
        )
        let fd = null
        try {
            fd = fs.openSync(tempPath, 'wx', 0o600)
            fs.writeFileSync(fd, payload, 'utf8')
            fs.fsyncSync(fd)
            fs.closeSync(fd)
            fd = null
            fs.renameSync(tempPath, this.storagePath)
            const dirFd = fs.openSync(directory, 'r')
            try {
                fs.fsyncSync(dirFd)
            } finally {
                fs.closeSync(dirFd)
            }
        } finally {
            if (fd !== null) fs.closeSync(fd)
            try { fs.unlinkSync(tempPath) } catch {}
        }
    }

    flush() {
        if (!this.storagePath) return
        if (this.saveTimer) {
            clearTimeout(this.saveTimer)
            this.saveTimer = null
        }
        if (this._flushInProgress) {
            this._flushQueued = true
            return
        }
        if (this._persistedRevision === this._revision && fs.existsSync(this.storagePath) &&
            (fs.statSync(this.storagePath).mode & 0o777) === 0o600) return
        this._flushInProgress = true
        try {
            do {
                this._flushQueued = false
                const revision = this._revision
                this._atomicFlush(`${JSON.stringify(this.serialize(), null, 2)}\n`)
                this._persistedRevision = revision
            } while (this._flushQueued || this._persistedRevision !== this._revision)
        } finally {
            this._flushInProgress = false
        }
    }

    upsertGroup(groupOpenId, patch = {}) {
        const id = String(groupOpenId || '').trim()
        if (!id) return null
        const current = this.groups.get(id) || {
            groupOpenId: id,
            groupName: '',
            reachable: true,
            reachabilityReason: 'unknown',
            activeMessageEnabled: null,
            fullMessageEnabled: null,
            atMessageEnabled: null,
            lastEventType: '',
            lastStatusAt: 0,
            updatedAt: 0
        }
        const next = {
            ...current,
            ...patch,
            groupOpenId: id,
            updatedAt: Date.now()
        }
        this.groups.set(id, next)
        this._markDirty('groups', id)
        this.scheduleSave()
        return next
    }

    setGroupReachability(groupOpenId, reachable, reason = 'event') {
        return this.upsertGroup(groupOpenId, {
            reachable: Boolean(reachable),
            reachabilityReason: reason,
            activeMessageEnabled: Boolean(reachable),
            lastEventType: reason,
            lastStatusAt: Date.now()
        })
    }

    markGroupMessageEvent(groupOpenId, eventType = '') {
        const type = String(eventType || '')
        const patch = {
            reachable: true,
            reachabilityReason: 'observed',
            lastEventType: type,
            lastStatusAt: Date.now()
        }
        if (type === 'GROUP_MESSAGE_CREATE') {
            patch.fullMessageEnabled = true
        }
        if (type === 'GROUP_AT_MESSAGE_CREATE') {
            patch.atMessageEnabled = true
        }
        return this.upsertGroup(groupOpenId, patch)
    }

    makeMemberKey(groupOpenId, memberOpenId) {
        const groupId = String(groupOpenId || '').trim()
        const memberId = String(memberOpenId || '').trim()
        if (!groupId || !memberId) return ''
        return `${groupId}:${memberId}`
    }

    upsertMember(groupOpenId, memberOpenId, patch = {}) {
        const key = this.makeMemberKey(groupOpenId, memberOpenId)
        if (!key) return null
        const current = this.members.get(key) || {
            groupOpenId: String(groupOpenId || '').trim(),
            memberOpenId: String(memberOpenId || '').trim(),
            userOpenId: '',
            nickname: '',
            role: 'member',
            status: 'observed',
            updatedAt: 0
        }
        const next = {
            ...current,
            ...patch,
            groupOpenId: current.groupOpenId,
            memberOpenId: current.memberOpenId,
            updatedAt: Date.now()
        }
        this.members.set(key, next)
        this._markDirty('members', key)
        this.scheduleSave()
        return next
    }

    getMember(groupOpenId, memberOpenId) {
        const key = this.makeMemberKey(groupOpenId, memberOpenId)
        return key ? (this.members.get(key) || null) : null
    }

    listGroupMembers(groupOpenId) {
        const groupId = String(groupOpenId || '').trim()
        if (!groupId) return []
        const prefix = `${groupId}:`
        const result = []
        for (const [key, member] of this.members.entries()) {
            if (!key.startsWith(prefix)) continue
            result.push({ ...member })
        }
        return result
    }

    markGroupMembership(groupOpenId, status) {
        return this.upsertGroup(groupOpenId, {
            reachable: status !== 'left',
            reachabilityReason: status,
            lastEventType: status,
            lastStatusAt: Date.now()
        })
    }

    upsertUser(userOpenId, patch = {}) {
        const id = String(userOpenId || '').trim()
        if (!id) return null
        const current = this.users.get(id) || {
            userOpenId: id,
            nickname: '',
            updatedAt: 0
        }
        const next = {
            ...current,
            ...patch,
            userOpenId: id,
            updatedAt: Date.now()
        }
        this.users.set(id, next)
        this._markDirty('users', id)
        this.scheduleSave()
        return next
    }

    getGroup(groupOpenId) {
        return this.groups.get(String(groupOpenId || '').trim()) || null
    }

    toGroupListMap() {
        const map = new Map()
        for (const [groupOpenId, group] of this.groups.entries()) {
            map.set(groupOpenId, {
                group_id: groupOpenId,
                group_name: group.groupName || groupOpenId,
                official: true,
                reachable: group.reachable,
                reachabilityReason: group.reachabilityReason,
                activeMessageEnabled: group.activeMessageEnabled,
                fullMessageEnabled: group.fullMessageEnabled,
                atMessageEnabled: group.atMessageEnabled,
                lastEventType: group.lastEventType || ''
            })
        }
        return map
    }

    getStatus() {
        return {
            groupCount: this.groups.size,
            userCount: this.users.size,
            memberCount: this.members.size,
            groups: Array.from(this.groups.values()).slice(-50).map((group) => ({
                groupOpenId: group.groupOpenId,
                groupName: group.groupName || '',
                reachable: group.reachable,
                reachabilityReason: group.reachabilityReason,
                activeMessageEnabled: group.activeMessageEnabled,
                fullMessageEnabled: group.fullMessageEnabled,
                atMessageEnabled: group.atMessageEnabled,
                lastEventType: group.lastEventType || '',
                lastStatusAt: group.lastStatusAt || 0,
                updatedAt: group.updatedAt
            })),
            members: Array.from(this.members.values()).slice(-50).map((member) => ({
                groupOpenId: member.groupOpenId,
                memberOpenId: member.memberOpenId,
                userOpenId: member.userOpenId || '',
                nickname: member.nickname || '',
                role: member.role || 'member',
                status: member.status || 'observed',
                updatedAt: member.updatedAt
            }))
        }
    }
}

module.exports = OfficialIdStore
