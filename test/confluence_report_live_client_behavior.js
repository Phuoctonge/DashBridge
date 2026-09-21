'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { globalThis: null, URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'confluence-report-live-schema.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'confluence-report-live-client.js'), 'utf8'), context);

const calls = [];
const payloads = {
    '/rest/api/content/42?expand=body.storage,version,space,metadata.labels': {
        id: '42', type: 'page', title: 'Отчёт', version: { number: 7 }, space: { key: 'QA' }, body: { storage: { representation: 'storage', value: '<h3>Тест</h3>' } }
    },
    '/rest/api/content/42/child/attachment?limit=200&expand=version,metadata': { results: [], size: 0, limit: 200 }
};
const fetchRef = async (url, options) => {
    calls.push({ url, options });
    const pathname = new URL(url).pathname + new URL(url).search;
    return { ok: true, status: 200, url, json: async () => payloads[pathname] };
};

const client = context.DashBridgeConfluenceReportLiveClient.create({
    fetchRef,
    schema: context.DashBridgeConfluenceReportLiveSchema,
    scanner: { fromStorageHtml: (html, context) => ({ html, context }) }
});
client.scan({ baseUrl: 'https://itpm-wiki.mos.ru', pageId: '42' }).then(result => {
    assert.strictEqual(result.page.pageIdentity.pageId, '42');
    assert.strictEqual(result.snapshot.html, '<h3>Тест</h3>');
    assert.strictEqual(calls.length, 2);
    assert(calls.every(call => call.options.credentials === 'same-origin'));
    console.log('PASS live Confluence report client');
}).catch(error => { console.error(error); process.exitCode = 1; });
