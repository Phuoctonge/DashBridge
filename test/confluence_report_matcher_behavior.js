'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const context = { globalThis: null }; context.globalThis = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-matcher.js'), 'utf8'), context);
const matcher = context.DashBridgeConfluenceReportMatcher;
const snapshot = { tests: [
    { testKey: 'test-01', title: 'Тест 1', groups: [{ title: 'Метрики серверов системы', images: [{ occurrence: 0, caption: 'Использование диска', imageReference: { filename: 'old-1.png' } }] }] },
    { testKey: 'test-02', title: 'Тест 2', groups: [{ title: 'Метрики серверов системы', images: [{ occurrence: 0, caption: 'Использование диска', imageReference: { filename: 'old-2.png' } }] }] },
] };
const archive = { manifest: { captures: [
    { file: 'new-1.png', testKey: 'test-01', metricGroup: 'Метрики серверов системы', metric: 'disk', occurrence: 0 },
    { file: 'new-2.png', testKey: 'test-02', metricGroup: 'Метрики серверов системы', metric: 'disk', occurrence: 0 },
] } };
const results = matcher.match(snapshot, archive, { metric: 'disk', metricGroup: 'Метрики серверов системы', testKeys: ['test-01', 'test-02'] });
assert.strictEqual(results.length, 2); assert(results.every(item => item.status === 'exact' && item.operation === 'replace'));
assert.strictEqual(results[0].source.file, 'new-1.png');
console.log('PASS report image matcher');
