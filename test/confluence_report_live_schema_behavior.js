'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'confluence-report-live-schema.js'), 'utf8'), context);

const api = context.DashBridgeConfluenceReportLiveSchema;
const plain = value => JSON.parse(JSON.stringify(value));
const result = api.normalizePage({
    currentUrl: 'https://itpm-wiki.mos.ru/pages/viewpage.action?pageId=707522489',
    content: {
        id: '707522489', type: 'page', title: 'Отчёт',
        version: { number: 2 },
        space: { key: 'TESTREPORTS', name: 'Отчёты' },
        body: { storage: { representation: 'storage', value: '<h3>Тест</h3>' } }
    },
    attachments: {
        results: [{ id: '99', title: 'disk.png', version: { number: 3 }, metadata: { mediaType: 'image/png' }, extensions: { fileSize: 12 }, _links: { download: '/download/attachments/707522489/disk.png' } }],
        size: 1, limit: 200
    }
});

assert.deepStrictEqual(plain(result.pageIdentity), { pageId: '707522489', title: 'Отчёт', spaceKey: 'TESTREPORTS', version: 2 });
assert.strictEqual(result.storageHtml, '<h3>Тест</h3>');
assert.strictEqual(result.attachments.length, 1);
assert.deepStrictEqual(plain(result.attachments[0]), { id: '99', title: 'disk.png', version: 3, mediaType: 'image/png', fileSize: 12, download: '/download/attachments/707522489/disk.png' });
assert.strictEqual(result.editorKind, 'storage-rest');
console.log('PASS live Confluence report schema');
