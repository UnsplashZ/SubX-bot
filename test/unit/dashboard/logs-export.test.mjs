import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import {
    buildLogExportContent,
    formatLogExportFilename,
    getLogMessageText,
} from '../../../dashboard/src/pages/logs/logExport.js'

describe('dashboard logs export helpers', function () {
    it('serializes current logs as JSONL with structured fields and rendered message', function () {
        const content = buildLogExportContent([
            {
                timestamp: '2026-06-01T01:02:03.000Z',
                level: 'INFO',
                channel: 'HTTP',
                scope: 'req:1',
                action: 'recv',
                fields: { path: '/api/logs/recent', elapsed: 12 },
                rendered: 'ignored when action exists',
            },
            {
                timestamp: '2026-06-01T01:02:04.000Z',
                level: 'ERR',
                channel: 'DASH',
                scope: 'ui:logs',
                fields: {},
                message: 'line one\nline two',
            },
        ])

        const lines = content.split('\n').map((line) => JSON.parse(line))
        assert.deepEqual(lines, [
            {
                timestamp: '2026-06-01T01:02:03.000Z',
                level: 'INFO',
                channel: 'HTTP',
                scope: 'req:1',
                action: 'recv',
                fields: { path: '/api/logs/recent', elapsed: 12 },
                message: 'recv path=/api/logs/recent elapsed=12',
            },
            {
                timestamp: '2026-06-01T01:02:04.000Z',
                level: 'ERR',
                channel: 'DASH',
                scope: 'ui:logs',
                action: '',
                fields: {},
                message: 'line one\nline two',
            },
        ])
    })

    it('formats field values consistently with the UI message text', function () {
        assert.equal(
            getLogMessageText({
                action: 'history-load-failed',
                fields: { error: 'network timeout', retry: false },
            }),
            'history-load-failed error="network timeout" retry=false'
        )

        assert.equal(getLogMessageText({ rendered: 'raw rendered' }), 'raw rendered')
        assert.equal(getLogMessageText({}), '-')
    })

    it('builds deterministic jsonl filenames', function () {
        const date = new Date(2026, 5, 1, 2, 3, 4)
        assert.equal(
            formatLogExportFilename(date),
            'subx-bot-logs-20260601-020304.jsonl'
        )
    })
})
