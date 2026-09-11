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
const durationPanel = { report: { templates: { listItem: '- {{name}} - {{value}} {{unit}};' }, listLimit: 3 } };
const durations = { unit: 'ms', series: [90000, 15000, 800, 350, 120].map((value, index) => ({ name: `time-${index}`, value })) };
const durationText = report.panelVariables(durationPanel, durations).allSeriesList;
assert(durationText.includes('time-0 - 1,5 мин;'));
assert(durationText.includes('time-1 - 15 с;'));
assert(durationText.includes('time-2 - 800 мс;'));
assert(durationText.includes('от 120 до 350 мс'));
for (const [value, unit, expected] of [[60, 's', '1 мин'], [1.5, 'min', '1,5 мин'], [.8, 'с', '800 мс'],
    [-.8, 's', '-800 мс'], [0, 'ms', '0 мс'], [1500, '%', '1 500 %'], [3600, 's', '1 ч']]) {
    const snapshot = { unit, series: [{ value }] };
    const before = JSON.stringify(snapshot);
    assert(report.panelVariables(durationPanel, snapshot).allSeriesList.includes(expected));
    assert.equal(JSON.stringify(snapshot), before, 'display conversion must not mutate snapshot values');
}
assert(report.panelVariables({ report: { listLimit: 1 } }, { unit: 's', series: [100, 90, .35].map(value => ({ name: String(value), value })) }).allSeriesList.includes('от 350 мс до 1,5 мин'));
assert(report.panelVariables({ report: { templates: { listItem: '{{value}}' } } }, { unit: 'ms', series: [{ value: 90000 }] }).allSeriesList.includes('90 000'), 'unitless templates must keep their original numeric scale');
for (const limit of [3, null]) {
    const result = report.renderPanel({ report: { enabled: true, detailsEnabled: true, listLimit: limit,
        templates: { breached: '{{criticalList}}.' } } }, { state: 'critical', unit: 's',
        series: [9, 8, 7, 6].map((value, index) => ({ name: `unique-${index}`, value, level: 'critical' })) });
    assert.strictEqual(result.text.split('unique-0').length - 1, 1, 'automatic details must not repeat an existing list, with or without a limit');
}
assert.strictEqual(report.normalizePanel({}).listLimit, null);
const mixed = report.panelVariables({ report: { listLimit: 2 } }, { series: [
    { name: 'critical-a', value: 9, level: 'critical' }, { name: 'critical-b', value: 8, level: 'critical' },
    { name: 'warning-a', value: 7, level: 'warning' }, { name: 'warning-b', value: 6, level: 'warning' }
] }).breachesList;
assert(!mixed.includes('warning-a') && mixed.includes('ещё 2 записи'), 'the combined list has one limit, not a separate limit per severity');
const detailSnapshot = { state: 'warning', series: [{ name: 'warning-row', value: 4, level: 'warning' }] };
const detailsPanel = { report: { enabled: true, detailsEnabled: true, templates: { warning: '{{warningList}}', details: 'Дополнительный контекст' } } };
assert(report.renderPanel(detailsPanel, detailSnapshot).text.includes('Дополнительный контекст'), 'custom details remain intact');
detailsPanel.report.templates.details = '{{stateQuote}}';
assert.strictEqual(report.renderPanel(detailsPanel, detailSnapshot).text.split('warning-row').length - 1, 1);
detailsPanel.report.templates.warning = 'Предупреждение';
assert(report.renderPanel(detailsPanel, detailSnapshot).text.includes('warning-row'), 'automatic details remain when the main phrase has no list');
const limitedPanel = { report: { listLimit: 3 } };
const limitSnapshot = { unit: 's', series: [48.9, 35.7, 30.2, 13.6, 5.66].map((value, index) => ({ name: `row-${index}`, value })) };
const limitedText = report.panelVariables(limitedPanel, limitSnapshot).allSeriesList;
assert(limitedText.includes('row-2') && !limitedText.includes('row-3'));
assert(limitedText.includes('ещё 2 записи - от 5,66 до 13,6 с'));
assert(report.panelVariables({}, limitSnapshot).allSeriesList.includes('row-4'));
assert(!report.panelVariables({ report: { listLimit: 5 } }, limitSnapshot).allSeriesList.includes('ещё'));
assert(report.panelVariables({ report: { listLimit: 1 } }, { series: [{ name: 'a', value: 2 }, { name: 'b', value: 2 }] }).allSeriesList.includes('ещё 1 запись - 2'));
assert.equal(report.normalizeProfile({}).attachments.selectedIds, null);
assert.deepStrictEqual(Array.from(report.normalizeProfile({}).attachments.forcedIds), []);
assert.deepStrictEqual(Array.from(report.normalizeProfile({ attachments: { forcedIds: ['opm', 'opm', 4, '', 'p95'] } }).attachments.forcedIds), ['opm', 'p95']);
assert.deepStrictEqual(Array.from(report.normalizeProfile({ attachments: { selectedIds: [] } }).attachments.selectedIds), []);
assert.equal(report.normalizeProfile({ attachments: { slaOnly: false, heading: false } }).attachments.slaOnly, false);
assert.equal(report.normalizeProfile({ attachments: { layout: 'invalid' } }).attachments.layout, 'auto');
assert.equal(report.normalizeProfile({ attachments: { selectedIds: Array.from({ length: 12 }, (_, i) => String(i)) } }).attachments.selectedIds.length, 8);

const graphPanel = { id: 'p1', title: 'CPU', tools: { thresholdEnabled: true }, report: { enabled: true } };
assert.deepStrictEqual(Array.from(report.orderPanels(
    [{ id: 'cpu' }, { id: 'ram' }, { id: 'disk' }], ['ram', 'cpu']
), panel => panel.id), ['ram', 'cpu', 'disk'],
'saved report order takes priority and appends newly added panels in dashboard order');
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
    && warning.text.includes('> - srv-warning Load 1m (8 vCPU) - 75,25%'),
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

const tablePanel = { id: 'table', title: 'Количество неуспешных All', report: {
    enabled: true, sla: { source: 'none' }, templates: { neutral: '{{tableMarkdown}}' }
} };
const tableRendered = report.renderPanel(tablePanel, {
    state: 'no_threshold', source: 'none', series: [],
    table: {
        columns: ['Metric', 'Value'],
        rows: [['DEV | API', '1.16 K'], ['PROD API', '530.00']],
        numericColumns: [false, true], totalRows: 2, truncated: false
    }
});
assert(tableRendered.text.includes('| Metric | Value |')
    && tableRendered.text.includes('| DEV \\| API | 1.16 K |')
    && tableRendered.variables.tableRowCount === 2
    && tableRendered.variables.tableColumnCount === 2,
'table templates must preserve Grafana display values and escape Markdown delimiters');

const messageOnlyPanel = { id: 'http', title: 'HTTP', report: {
    enabled: true, detailsEnabled: true, sla: { source: 'graph' },
    templates: { breached: '{{criticalList}}', listItem: '{{rawName}} - {{value}}{{unit}}' }
} };
const rawMessageSnapshot = {
    state: 'critical', unit: 's', series: [
        { name: 'PROD_<_/get', value: 29.7, level: 'critical' },
        { name: 'PROD_>_/post', value: 10.8, level: 'critical' },
        { name: 'PROD_*_/delete', value: 1, level: 'critical' },
        { name: 'PROD_^_/put', value: 2, level: 'critical' }
    ]
};
const messageOnly = report.renderPanel(messageOnlyPanel, rawMessageSnapshot);
assert(messageOnly.text.includes('PROD_GET_/get - 29,7с')
    && messageOnly.text.includes('PROD_POST_/post - 10,8с')
    && messageOnly.text.includes('PROD_DELETE_/delete - 1с')
    && messageOnly.text.includes('PROD_PUT_/put - 2с'),
'HTTP markers and duration units are normalized at the generated-message boundary');
assert.strictEqual(rawMessageSnapshot.series[0].name, 'PROD_<_/get',
    'message normalization must not mutate captured Grafana data');
assert.strictEqual(report.localizeMessageText('29,7s; 10,8mins; 915ms; x < y; a > b'),
    '29,7с; 10,8мин; 915мс; x < y; a > b');
assert(report.formatMarkdownTable({ columns: ['Name', 'Max'], rows: [['<_/housing', '1.40 mins']] })
    .includes('| GET_/housing | 1.40 мин |'), 'tableMarkdown uses the same message-only normalization');

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
const common = {
    profileName: 'Profile', testName: 'Load test', environment: 'Stage',
    testStartedAt: '2026-09-09T10:00', stableLoadStartedAt: '2026-09-09T11:00',
    testDuration: '2 часа', stableLoadDuration: '1 час', period: '10:00–12:00', generatedAt: '09.09.2026 12:00'
};
const commonTemplate = Object.keys(common).map(name => `{{${name}}}`).join('|');
const expectedCommon = Object.values(common).join('|');
const commonPanel = { id: 'common', report: { enabled: true, detailsEnabled: true,
    templates: { breached: commonTemplate, details: commonTemplate + '\n{{allSeriesList}}',
        listItem: commonTemplate + '|{{name}}' } } };
const commonRendered = report.renderPanel(commonPanel, {
    state: 'critical', series: [{ name: 'server', value: 1 }]
}, common);
assert.strictEqual(commonRendered.text, `${expectedCommon}\n${expectedCommon}\n${expectedCommon}|server`);
assert.deepStrictEqual(Array.from(report.extractTemplateVariables(commonRendered.text)), []);
assert(!report.PANEL_VARIABLES.includes('panels') && !report.LIST_VARIABLES.includes('panels'),
    'composite message insertions must not recurse through panel or list templates');
assert.strictEqual(report.compose({ name: 'Profile', report: {
    template: '{{profileName}}|{{testName}}|{{environment}}', context: common
} }, []), 'Profile|Load test|Stage', 'compose uses saved test context without requiring a caller override');
assert.strictEqual(report.renderTemplate('{{testName}}', { testName: '{{environment}}', environment: 'Stage' }),
    '{{environment}}', 'user values are not recursively evaluated as templates');
console.log('PASS dashboard report templates and inclusion rules');
