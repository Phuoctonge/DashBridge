'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-preview.js'), 'utf8'), context);

const preview = context.DashBridgeConfluenceReportPreview;
const snapshot = { tests: [
    { testKey: 'test-01', title: 'Тест 1', groups: [{ title: 'Метрики серверов системы', images: [
        { occurrence: 0, imageReference: { filename: 'использование диска_1_1789736989.png' } },
        { occurrence: 1, imageReference: { filename: 'использование CPU_1_1789736964.png' } }
    ] }] },
    { testKey: 'test-02', title: 'Тест 2', groups: [{ title: 'Метрики серверов системы', images: [
        { occurrence: 0, imageReference: { filename: 'использование диска_2_1789737123.png' } }
    ] }] }
] };
const archive = {
    manifest: { captures: [
        { file: '01/panel-8_использование_диска_now-1h_now_a.png' },
        { file: '02/panel-8_использование_диска_now-2h_now-1h_b.png' }
    ] },
    sources: new Map([
        ['01/panel-8_использование_диска_now-1h_now_a.png', { path: '01/panel-8_использование_диска_now-1h_now_a.png' }],
        ['02/panel-8_использование_диска_now-2h_now-1h_b.png', { path: '02/panel-8_использование_диска_now-2h_now-1h_b.png' }]
    ])
};

const metrics = JSON.parse(JSON.stringify(preview.metricOptions(snapshot)));
assert(metrics.some(item => item.metric === 'использование диска' && item.count === 2));
const plan = preview.plan(snapshot, archive, { metric: 'использование диска', metricGroup: 'Метрики серверов системы' });
assert.strictEqual(plan.length, 2);
assert(plan.every(item => item.status === 'exact'));
assert.strictEqual(plan[0].source.path, '01/panel-8_использование_диска_now-1h_now_a.png');
assert.strictEqual(plan[1].source.path, '02/panel-8_использование_диска_now-2h_now-1h_b.png');
const selected = preview.plan(snapshot, archive, { targetKeys: ['test-01:Метрики серверов системы:0', 'test-02:Метрики серверов системы:0'] });
assert.strictEqual(selected.length, 2);
assert(selected.every(item => item.status === 'exact'));
console.log('PASS Confluence report replacement preview');
