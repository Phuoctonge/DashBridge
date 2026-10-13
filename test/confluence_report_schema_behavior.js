'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const context = { globalThis: null }; context.globalThis = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'confluence-report-schema.js'), 'utf8'), context);
const schema = context.DashBridgeConfluenceReportSchema; const plain = value => JSON.parse(JSON.stringify(value));
const normalized = schema.normalizeManifest({ schemaVersion: 3, kind: 'panels', captures: [{ file: 'captures/test-01/disk.png', testKey: ' Test-01 ', testTitle: ' Тест 1 ', metricGroup: ' Метрики   серверов ', metric: 'Disk', panelId: 8, panelTitle: 'Disk', rangeIndex: 0, from: 'now-1h', to: 'now', occurrence: 0 }] });
assert.strictEqual(normalized.schemaVersion, 3); assert.strictEqual(normalized.captures[0].metric, 'disk');
assert.strictEqual(schema.logicalKey(normalized.captures[0]), `test-01\u0000метрики серверов\u0000disk\u00000`);
assert.throws(() => schema.normalizeManifest({ captures: [{ file: '../escape.png' }] }), /unsafe|path/i);
assert.throws(() => schema.normalizeManifest({ captures: [{ file: '/absolute.png' }] }), /unsafe|path/i);
assert.deepStrictEqual(plain(schema.normalizeManifest({ schemaVersion: 3, captures: [] }).captures), []);
console.log('PASS report schema normalization');
const capture = {file: '01/image.png', panelId: '115', panelTitle: 'RPS', rangeIndex: 0, from: '1787774259463', to: '1787791648851'};
assert.throws(() => schema.normalizeManifest({schemaVersion: 2, captures: [capture]}), /версии 3/);
for (const field of ['panelId', 'panelTitle', 'rangeIndex', 'from', 'to']) {
    const incomplete = {...capture}; delete incomplete[field];
    assert.throws(() => schema.normalizeManifest({schemaVersion: 3, captures: [incomplete]}), /Неполные метаданные/);
}
assert.throws(() => schema.normalizeManifest({schemaVersion: 3, captures: [capture, {...capture, file: '01/other.png', to: '1787791648852'}]}), /Разные периоды/);
assert.throws(() => schema.normalizeManifest({schemaVersion: 3, captures: [capture, capture]}), /Duplicate capture/);
