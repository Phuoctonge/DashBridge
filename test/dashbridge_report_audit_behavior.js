'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { Intl };
context.globalThis = context;
vm.createContext(context);
for (const file of ['js/shared/dashbridge-report.js', 'pages/dashbridge/dashbridge-report-audit.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const report = context.DashBridgeReport;
const audit = context.DashBridgeReportAudit;
assert(Object.isFrozen(audit), 'report audit API must be immutable');
assert(audit.runEngineSelfCheck(report).ok, 'synthetic check must resolve every declared variable');

const makeCollected = ({ profileTemplate = '{{profileName}}\n{{panels}}', panelTemplate = '{{panelTitle}}: {{aggregateValue}}{{unit}}',
    listTemplate = '- {{name}}: {{value}}{{unit}}', key = 'cpu', secondKey = null, state = 'ok',
    includeMode = 'always', output = null, contextPatch = {}, snapshotPatch = {} } = {}) => {
    const panel = {
        id: 'panel-1', title: 'CPU', tools: { thresholdEnabled: true },
        report: { enabled: true, key, includeMode, sla: { source: 'graph', value: 80 },
            templates: { normal: panelTemplate, listItem: listTemplate } }
    };
    const snapshot = {
        state, threshold: 80, unit: '%', aggregateValue: 42, maxValue: 50, minValue: 30,
        lastValue: 42, averageValue: 40, sumValue: 120, dataStatusText: 'Данные получены',
        series: [{ name: 'srv-1', value: 42, level: 'normal', cpuCapacity: 4, threshold: 80 }],
        ...snapshotPatch
    };
    const profile = { name: 'Production', report: { template: profileTemplate } };
    const reportPanels = [panel];
    if (secondKey !== null) reportPanels.push({ ...panel, id: 'panel-2', title: 'Memory', report: { ...panel.report, key: secondKey } });
    const liveContext = {
        testName: 'Test 42', environment: 'production', testStartedAt: '2026-01-01T10:00',
        stableLoadStartedAt: '2026-01-01T11:00', testDuration: '2 часа', stableLoadDuration: '1 час',
        period: '15 минут', generatedAt: '01.01.2026 12:00', ...contextPatch
    };
    const panelResults = reportPanels.map(currentPanel => {
        const rendered = report.renderPanel(currentPanel, snapshot, liveContext);
        return { ...rendered, key: report.normalizePanel(currentPanel.report, currentPanel).key,
            panel: currentPanel, snapshot };
    });
    return { profile, reportPanels, context: liveContext, panelResults,
        output: output === null ? report.compose(profile, panelResults, liveContext) : output };
};

const valid = audit.audit(report, makeCollected());
assert.strictEqual(valid.summary.errors, 0, 'complete live fixture must pass without errors');
assert(valid.variables.find(item => item.scope === 'list' && item.name === 'value').hasData,
    'list variables must be checked against their exact live field');
assert(!valid.variables.find(item => item.scope === 'list' && item.name === 'vCpu').value.includes('ряд'),
    'list-variable result must show its own value rather than only a series count');

const issueCodes = options => audit.audit(report, makeCollected(options)).issues.map(item => item.code);
assert(issueCodes({ profileTemplate: '{{notSupported}}\n{{panels}}' }).includes('unknown_variable'));
assert(issueCodes({ profileTemplate: '{{panel:missing}}' }).includes('missing_panel_key'));
assert(issueCodes({ secondKey: 'cpu' }).includes('duplicate_panel_key'));
assert(issueCodes({ output: '{{stillHere}}' }).includes('unresolved_output'));
assert(issueCodes({ profileTemplate: '{{testName}}\n{{panels}}', contextPatch: { testName: '' } }).includes('empty_live_value'));
assert(issueCodes({ state: 'timeout', snapshotPatch: { dataStatusText: 'Timeout' } }).includes('panel_data_error'));
assert(issueCodes({ profileTemplate: '{{profileName}}' }).includes('panels_not_inserted'));
assert(valid.variables.some(item => !item.used), 'supported but unused variables must remain informational');
assert(audit.audit(report, { profile: { name: 'Empty', report: {} }, reportPanels: [], panelResults: [],
    context: {}, output: '' }).issues.some(item => item.code === 'no_panels'),
    'audit must diagnose a profile with no enabled report panels');
assert(issueCodes({ panelTemplate: '{{allSeriesList}}', listTemplate: '{{name}} {{vCpu}}', snapshotPatch: {
    source: 'cpu_capacity', series: [{ name: 'srv-1', value: 42, level: 'normal' }]
} }).includes('empty_live_value'), 'an active series list must report missing row values');
const unitlessIssues = audit.audit(report, makeCollected({ panelTemplate: '{{unit}} {{threshold}} {{criticalList}}', snapshotPatch: {
    source: 'none', unit: '', threshold: null, criticalThreshold: null,
    series: [{ name: 'srv-1', value: 42, level: 'normal' }]
} })).issues;
assert(!unitlessIssues.some(item => item.code === 'empty_live_value'
    && /\{\{(?:unit|threshold|criticalList)\}\}/u.test(item.message)),
    `unitless informational panels must allow inapplicable SLA values to stay empty: ${unitlessIssues.map(item => item.message).join('; ')}`);
const excludedIssues = audit.audit(report, makeCollected({ panelTemplate: '{{tableMarkdown}}',
    includeMode: 'critical_only', state: 'ok' })).issues;
assert(!excludedIssues.some(item => item.code === 'empty_live_value' && /\{\{tableMarkdown\}\}/u.test(item.message)),
    'panels excluded by their current include mode must not emit live-value warnings');

const perPanel = audit.audit(report, makeCollected({ secondKey: 'memory' }));
const aggregateRows = perPanel.variables.filter(item => item.scope === 'panel'
    && item.name === 'aggregateValue' && item.used);
assert.deepStrictEqual(Array.from(aggregateRows, item => item.panelTitle), ['CPU', 'Memory'],
    'live variable rows must preserve values separately for each panel');

console.log('PASS report audit checks variable contracts, live values, panel references and output');
