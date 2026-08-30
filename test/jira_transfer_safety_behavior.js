'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'popup', 'popup-jira.js'), 'utf8');

function createContext(overrides = {}) {
    const alerts = [];
    const fetchCalls = [];
    const loggedErrors = [];
    const prompts = [...(overrides.prompts || [])];
    const confirms = [...(overrides.confirms || [])];
    const context = {
        console: { error: (...args) => loggedErrors.push(args) },
        encodeURIComponent,
        setTimeout,
        location: { origin: overrides.origin || 'https://jira.example.test', pathname: overrides.pathname || '/browse/SRC-1' },
        document: {
            addEventListener() {},
            querySelector() { return { content: overrides.sourceKey || 'SRC-1' }; },
        },
        alert(message) { alerts.push(message); },
        prompt() { return prompts.shift(); },
        confirm() { return confirms.shift(); },
        async fetch(url, init = {}) {
            fetchCalls.push({ url, method: init.method || 'GET' });
            return overrides.fetchResponses.shift();
        },
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'popup-jira.js' });
    return { context, alerts, fetchCalls, loggedErrors };
}

(async () => {
    {
        const fixture = createContext({ prompts: ['', 'SRC-1'], confirms: [], fetchResponses: [] });
        const result = await fixture.context.dashbridgeTransferJiraWorklogs('https://jira.example.test');
        assert.strictEqual(result.status, 'same-issue');
        assert.strictEqual(fixture.fetchCalls.length, 0, 'same-issue transfer must not call Jira');
    }

    {
        const fixture = createContext({ origin: 'https://evil.example', fetchResponses: [] });
        const result = await fixture.context.dashbridgeTransferJiraWorklogs('https://jira.example.test');
        assert.strictEqual(result.status, 'origin-mismatch');
        assert.strictEqual(fixture.fetchCalls.length, 0, 'origin mismatch must fail before Jira calls');
    }

    {
        const fixture = createContext({
            pathname: '/jira/browse/SRC-1', prompts: ['', 'DST-2'], confirms: [],
            fetchResponses: [{ ok: true, async json() { return { worklogs: [] }; } }],
        });
        const result = await fixture.context.dashbridgeTransferJiraWorklogs('https://jira.example.test', '/jira');
        assert.strictEqual(result.status, 'empty');
        assert.strictEqual(fixture.fetchCalls[0].url, '/jira/rest/api/2/issue/SRC-1/worklog');
    }

    {
        const fixture = createContext({
            prompts: ['', 'DST-2'],
            confirms: [true, true],
            fetchResponses: [
                { ok: true, async json() { return { worklogs: [{ id: '7', timeSpentSeconds: 60, started: '2026-08-18', comment: 'x' }] }; } },
                { ok: true, status: 201 },
                { ok: false, status: 403 },
            ],
        });
        const result = await fixture.context.dashbridgeTransferJiraWorklogs('https://jira.example.test');
        assert.deepStrictEqual(
            { status: result.status, copied: result.copied, deleted: result.deleted, deleteFailed: result.deleteFailed },
            { status: 'partial', copied: 1, deleted: 0, deleteFailed: 1 }
        );
        assert.deepStrictEqual(fixture.fetchCalls.map(call => call.method), ['GET', 'POST', 'DELETE']);
        assert(fixture.alerts.at(-1).includes('Скопировано, но не удалено: 1'));
        assert.strictEqual(fixture.loggedErrors.length, 1, 'partial deletion is logged exactly once');
    }

    console.log('PASS Jira transfer validates origin and reports partial move accurately');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
