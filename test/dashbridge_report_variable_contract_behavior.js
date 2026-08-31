'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { Intl };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/dashbridge-report.js', 'utf8'), context,
    { filename: 'dashbridge-report.js' });
const report = context.DashBridgeReport;

const panelVariables = [
    'panelTitle', 'warningThreshold', 'criticalThreshold', 'threshold', 'unit',
    'criticalServers', 'warningServers', 'criticalCount', 'warningCount',
    'criticalList', 'warningList', 'breachesList', 'allSeriesList', 'top3List',
    'stateList', 'stateQuote', 'aggregateValue', 'cpuCapacityCoefficient',
    'dataStatus', 'maxValue', 'minValue', 'lastValue', 'averageValue', 'sumValue',
];
const listVariables = ['name', 'rawName', 'vCpu', 'cpuCapacity', 'seriesThreshold', 'value', 'unit', 'level'];
const completeTemplate = panelVariables.map(name => `${name}={{${name}}}`).join('\n');
const listTemplate = listVariables.map(name => `${name}={{${name}}}`).join('|');
const panel = {
    id: 'cpu-panel',
    title: 'CPU utilization',
    tools: { thresholdEnabled: true, thresholdValue: 80 },
    report: {
        enabled: true,
        key: 'cpu',
        includeMode: 'always',
        sla: { source: 'graph', operator: 'gt', warningValue: 70, evaluation: 'period_max' },
        templates: { breached: completeTemplate, listItem: listTemplate },
    },
};
const rendered = report.renderPanel(panel, {
    state: 'critical',
    source: 'cpu_capacity',
    threshold: 80,
    criticalThreshold: 80,
    warningThreshold: 70,
    unit: '%',
    aggregateValue: 91,
    maxValue: 96,
    minValue: 55,
    lastValue: 88,
    averageValue: 76,
    sumValue: 304,
    cpuCapacityCoefficient: 0.8,
    dataStatusText: 'Данные получены',
    series: [
        { name: 'srv-critical', value: 96, level: 'critical', cpuCapacity: 8, threshold: 6.4 },
        { name: 'srv-warning', value: 75, level: 'warning', cpuCapacity: 4, threshold: 3.2 },
        { name: 'srv-normal', value: 55, level: 'normal', cpuCapacity: 2, threshold: 1.6 },
    ],
}, { period: '15 минут', generatedAt: '31.08.2026 12:00' });

assert.strictEqual(rendered.included, true);
for (const name of panelVariables) {
    assert.notStrictEqual(String(rendered.variables[name] ?? ''), '',
        `documented panel variable ${name} must resolve to a non-empty value for a complete snapshot`);
    assert(!rendered.text.includes(`{{${name}}}`), `panel output must resolve {{${name}}}`);
}
for (const name of listVariables) {
    assert(!rendered.text.includes(`{{${name}}}`), `list output must resolve {{${name}}}`);
}

const profileVariables = [
    'profileName', 'testName', 'environment', 'testDuration', 'stableLoadDuration',
    'period', 'generatedAt', 'panels',
];
const profileTemplate = [
    ...profileVariables.map(name => `${name}={{${name}}}`),
    'selected={{panel:cpu}}',
].join('\n');
const output = report.compose({
    name: 'Production',
    report: { template: profileTemplate },
}, [{ included: true, key: 'cpu', text: rendered.text }], {
    testName: 'Load test 42',
    environment: 'production',
    testDuration: '2 часа',
    stableLoadDuration: '1 час',
    period: '15 минут',
    generatedAt: '31.08.2026 12:00',
});

for (const name of profileVariables) {
    assert(!output.includes(`{{${name}}}`), `profile output must resolve {{${name}}}`);
}
assert(!/\{\{\s*panel:/u.test(output), 'named panel references must resolve');
assert(!/\{\{\s*[a-zA-Zа-яА-ЯёЁ0-9_.:-]+\s*\}\}/u.test(output),
    'complete report fixture must not leave placeholder-shaped text');
assert(output.includes('Load test 42') && output.includes('srv-critical'));

console.log('PASS every documented report variable resolves against a complete SLI fixture');
