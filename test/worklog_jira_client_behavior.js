'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const calls = [];
const responses = [
    { ok: true, json: async () => ({ displayName: 'Tester' }) },
    { ok: true, json: async () => ({ fields: { summary: 'Issue summary' } }) },
    { ok: true, status: 201, text: async () => '' },
];
const context = {
    console,
    Date,
    Intl,
    fetch: async (url, options = {}) => {
        calls.push({ url, options });
        return responses.shift();
    },
    globalThis: null,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/worklog/worklog-jira-client.js', 'utf8'), context);

(async () => {
    const client = context.DashBridgeWorklogJiraClient.create({
        getBaseUrl: () => 'https://jira.example',
        getTimeZone: () => 'UTC',
        request: context.fetch,
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await client.checkAuth())), {
        ok: true, displayName: 'Tester'
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await client.fetchIssueTitle('ABC-1'))), {
        ok: true, title: 'Issue summary'
    });
    const result = await client.submitWorklog({
        key: 'ABC-1', timeSpent: '1,5', description: 'Comment', date: new Date('2026-08-24T10:30:00Z')
    });
    assert.strictEqual(result.ok, true);
    const payload = JSON.parse(calls[2].options.body);
    assert.strictEqual(payload.timeSpent, '1.5h');
    assert.strictEqual(payload.comment, 'Comment');
    assert.strictEqual(payload.started, '2026-08-24T10:30:00.000+0000');
    assert.strictEqual(calls[2].options.method, 'POST');
    assert.strictEqual(calls[2].options.headers['X-Atlassian-Token'], 'no-check');
    console.log('PASS Worklog Jira client owns auth, issue lookup and worklog payloads');
})().catch(error => { console.error(error); process.exitCode = 1; });
