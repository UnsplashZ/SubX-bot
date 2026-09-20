'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

describe('Dashboard settings recovery UI source contract', () => {
    const root = path.resolve(__dirname, '../../..')
    const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

    it('shows recovery state, disables normal mutations, and exposes retry', () => {
        const settings = read('dashboard/src/pages/Settings.jsx')
        const status = read('dashboard/src/pages/settings/components/ConfigRuntimeStatusSection.jsx')
        assert.match(settings, /recoveryRequired/)
        assert.match(settings, /disabled=\{recoveryRequired\}/)
        assert.match(settings, /AutoSaveIndicator/)
        assert.match(status, /Recovery required/)
        assert.match(status, /disabled=\{reloading \|\| recovering \|\| Boolean\(recovery\)\}/)
        assert.match(status, /重试恢复/)
        assert.match(status, /onClick=\{onRecover\}/)
    })

    it('never binds a returned Secret value into the recovery UI', () => {
        const status = read('dashboard/src/pages/settings/components/ConfigRuntimeStatusSection.jsx')
        const recovery = read('dashboard/src/pages/settings/hooks/settingsRecovery.js')
        assert.doesNotMatch(status, /clientSecret|qqOfficialClientSecret/)
        assert.doesNotMatch(recovery, /payload\.error|error\.message/)
    })
})
