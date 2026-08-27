'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { Intl };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/shared/dashbridge-report.js'), 'utf8'), context);
const report = context.DashBridgeReport;

const graphPanel = { id: 'p1', title: 'CPU', tools: { thresholdEnabled: true }, report: { enabled: true } };
assert.strictEqual(report.normalizePanel(graphPanel.report, graphPanel).sla.source, 'graph');
assert.strictEqual(report.normalizePanel({ enabled: true, includeMode: 'breach_only', sla: { source: 'none' } }, graphPanel).includeMode, 'always');

const breach = report.renderPanel(graphPanel, {
    state: 'breached', threshold: 80, unit: '%', aggregateValue: 95,
    series: [{ name: 'srv-1', exceeded: true }, { name: 'srv-2', exceeded: true }]
});
assert.strictEqual(breach.included, true);
assert(breach.text.includes('srv-1, srv-2'));
assert(breach.text.includes('80'));

const warningPanel = { ...graphPanel, report: { enabled: true, includeMode: 'issue_only', detailsEnabled: true,
    sla: { source: 'graph', warningValue: 70 }, templates: { details: '{{stateQuote}}' } } };
const warning = report.renderPanel(warningPanel, {
    state: 'warning', threshold: 80, warningThreshold: 70, unit: '%',
    series: [{ name: 'srv-warning Load 1m', value: 75.25, cpuCapacity: 8, level: 'warning' },
        { name: 'srv-ok', value: 42, level: 'normal' }]
});
assert.strictEqual(warning.included, true);
assert(warning.text.includes('srv-warning Load 1m (8 vCPU)')
    && warning.text.includes('> - srv-warning Load 1m (8 vCPU) — 75,25%'),
    'warning report includes a formatted quote block');
assert.strictEqual(warning.variables.warningCount, 1);

const customCapacityPanel = { ...graphPanel, report: { enabled: true, detailsEnabled: true,
    sla: { source: 'graph' }, templates: { details: '{{stateList}}', listItem: '{{rawName}}|{{vCpu}}|{{cpuCapacity}}|{{name}}|{{value}}' } } };
const customCapacity = report.renderPanel(customCapacityPanel, {
    state: 'critical', source: 'cpu_capacity', cpuCapacityCoefficient: 0.8, threshold: null, unit: '',
    series: [{ name: 'vm-01 Load 1m', value: 12.5, cpuCapacity: 4, threshold: 3.2, level: 'critical' }]
});
assert(customCapacity.text.includes('vm-01 Load 1m|4|4|vm-01 Load 1m (4 vCPU)|12,5'),
    'list templates expose both raw and vCPU-decorated Load Average names');
assert.strictEqual(customCapacity.variables.threshold, 'vCPU × 0,8',
    'dynamic Load Average reports expose a readable threshold expression to existing templates');
assert.strictEqual(customCapacity.variables.cpuCapacityCoefficient, '0,8');

const onlyBreach = { ...graphPanel, report: { enabled: true, includeMode: 'breach_only', sla: { source: 'graph' } } };
assert.strictEqual(report.renderPanel(onlyBreach, { state: 'ok', series: [] }).included, false);

const unavailable = report.renderPanel(graphPanel, {
    state: 'error', dataStatus: 'http_error',
    dataStatusText: 'Ошибка HTTP 502 при получении данных', series: []
});
assert(unavailable.text.includes('Причина: Ошибка HTTP 502 при получении данных.'),
    'the default unavailable phrase includes the exact datasource failure');
const legacyUnavailablePanel = { ...graphPanel, report: { enabled: true,
    templates: { unavailable: '⚠ Панель «{{panelTitle}}» недоступна.' } } };
const legacyUnavailable = report.renderPanel(legacyUnavailablePanel, {
    state: 'timeout', dataStatus: 'timeout', dataStatusText: 'Панель не ответила за 4 секунды', series: []
});
assert.strictEqual((legacyUnavailable.text.match(/Панель не ответила за 4 секунды/g) || []).length, 1,
    'legacy unavailable templates receive the exact cause once');

const output = report.compose({ name: 'Prod', report: { template: '{{profileName}}\n{{panels}}\n{{panel:cpu}}' } }, [
    { included: true, key: 'cpu', text: 'CPU OK' }
], { period: '24 часа', generatedAt: 'сейчас' });
assert.strictEqual(output, 'Prod\nCPU OK\nCPU OK');
assert.strictEqual(report.renderTemplate('<b>{{value}}</b>', { value: '<img>' }), '<b><img></b>', 'renderer returns text and never parses HTML');
assert.strictEqual(report.formatDuration('2026-08-26T10:00:00', Date.parse('2026-08-26T14:30:00')), '4 часа 30 минут');
console.log('PASS dashboard report templates and inclusion rules');
