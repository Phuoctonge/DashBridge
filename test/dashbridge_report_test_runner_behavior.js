'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { Intl };
context.globalThis = context;
vm.createContext(context);
for (const file of [
    'js/shared/dashbridge-report.js',
    'pages/dashbridge/dashbridge-report-audit.js',
    'pages/dashbridge/dashbridge-report-test-runner.js'
]) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

const report = context.DashBridgeReport;
const audit = context.DashBridgeReportAudit;
const runner = context.DashBridgeReportTestRunner;
assert(Object.isFrozen(runner), 'Message Test Runner API must be immutable');

const fixtures = runner.runFixtureSuite(report, audit);
assert(fixtures.length >= 10, 'runner must cover a meaningful deterministic scenario suite');
assert(fixtures.every(item => item.source === 'fixture'));
assert(fixtures.every(item => item.status === 'pass'),
    fixtures.filter(item => item.status !== 'pass').map(item => `${item.id}: ${item.details}`).join('\n'));
assert(fixtures.some(item => item.id === 'large-series-table' && item.details.includes('2500')),
    'runner must exercise a thousands-of-series snapshot');
assert(fixtures.some(item => item.id === 'engine-contract' && item.details.includes(String(
    report.PROFILE_VARIABLES.length + report.PANEL_VARIABLES.length + report.LIST_VARIABLES.length))),
    'runner must exercise every declared report variable');

const panel = {
    id: 'live-cpu', title: 'Live CPU', tools: { thresholdEnabled: true },
    report: { enabled: true, key: 'cpu', sla: { source: 'graph', value: 80 },
        templates: { normal: '{{panelTitle}}={{aggregateValue}}{{unit}}' } }
};
const snapshot = { state: 'ok', aggregateValue: 42, threshold: 80, unit: '%',
    dataStatusText: 'Данные получены', series: [{ name: 'srv', value: 42, level: 'normal' }] };
const liveContext = { period: '15 минут', generatedAt: '01.01.2026 12:00' };
const rendered = report.renderPanel(panel, snapshot, liveContext);
const profile = { name: 'Live', report: { template: '{{profileName}}\n{{panels}}' } };
const collected = { profile, reportPanels: [panel], snapshots: [snapshot], context: liveContext,
    panelResults: [{ ...rendered, key: 'cpu', panel, snapshot }],
    output: report.compose(profile, [{ ...rendered, key: 'cpu' }], liveContext) };
const live = runner.evaluateLiveSuite(report, audit, collected);
assert(live.scenarios.every(item => item.source === 'live'));
assert(live.scenarios.some(item => item.id === 'live-snapshot-cpu' && item.status === 'pass'));
assert(live.scenarios.some(item => item.id === 'live-render-cpu' && item.status === 'pass'));
assert(live.scenarios.some(item => item.id === 'live-compose' && item.status === 'pass'));

const failedSnapshot = { ...snapshot, state: 'timeout', dataStatusText: 'Timeout' };
const failedRendered = report.renderPanel(panel, failedSnapshot, liveContext);
const failed = runner.evaluateLiveSuite(report, audit, { ...collected, snapshots: [failedSnapshot],
    panelResults: [{ ...failedRendered, key: 'cpu', panel, snapshot: failedSnapshot }] });
assert(failed.scenarios.some(item => item.id === 'live-snapshot-cpu' && item.status === 'fail'),
    'a real timeout must fail its live scenario');

console.log('PASS Message Test Runner separates deterministic fixtures from one live report audit');
