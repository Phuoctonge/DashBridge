'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
    window: {
        DashBridgeGrafanaDom: {
            legendItems: () => [], legendSeriesNames: () => [], legendLabel: () => null,
        },
    },
    document: {},
};
context.window.window = context.window;
context.window.document = context.document;
vm.createContext(context);
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-report-snapshot.js'), 'utf8'
), context);

const factory = context.window.DashBridgeGrafanaReportSnapshot;
assert(factory && Object.isFrozen(factory), 'report snapshot factory must expose one immutable MAIN dependency');
const report = factory.create({
    mergeAxisAndPanelUnit: value => value,
    inferUnitFromAxisTicks: () => ({ unit: '', factor: 1 }),
    getCachedPanelDefinition: () => null,
    unitFromPanelDefinition: () => ({ unit: '', factor: 1 }),
    collectGrafanaTableData: () => ({
        columns: ['Metric', 'Value'], rows: [['requests', '3']],
        numericColumns: [false, true], totalRows: 1, truncated: false, source: 'dom'
    }),
    collectGrafanaTableRecords: () => [{ name: 'requests', visible: true, values: [1, 3, 2] }],
    findUPlot: () => null,
    getUPlotYScaleKey: () => 'y',
    getUPlotUnitDetails: () => ({ unit: '', factor: 1 }),
});
const snapshot = report.collectPanelReportSnapshot({ root: {}, sla: { source: 'none' } });
assert.strictEqual(snapshot.engine, 'table-dom');
assert.strictEqual(snapshot.state, 'no_threshold');
assert.strictEqual(snapshot.table.rows[0][1], '3');
assert.deepStrictEqual(Array.from(snapshot.series, item => ({ name: item.name, value: item.value })), [
    { name: 'requests', value: 3 },
]);

context.window.__dashbridgePanelToolsVisualMetadata = {
    responseTableRecords: [{ name: 'raw requests', value: 1159 }]
};
const responseSnapshot = report.collectPanelReportSnapshot({ root: {}, sla: { source: 'none' } });
assert.strictEqual(responseSnapshot.engine, 'table-response');
assert.strictEqual(responseSnapshot.series[0].value, 1159,
    'raw response values must be preferred when a visible Grafana table confirms the visualization type');

context.window.__dashbridgePanelToolsVisualMetadata = { responseTableRecords: [] };
const wideTableReport = factory.create({
    mergeAxisAndPanelUnit: value => value,
    inferUnitFromAxisTicks: () => ({ unit: '', factor: 1 }),
    getCachedPanelDefinition: () => null,
    unitFromPanelDefinition: () => ({ unit: '', factor: 1 }),
    collectGrafanaTableData: () => ({
        columns: ['transaction', 'Total', 'OK', 'KO'],
        rows: [['request-a', '100', '98', '2']], numericColumns: [false, true, true, true],
        totalRows: 1, truncated: false, source: 'dom'
    }),
    collectGrafanaTableRecords: () => [],
    findUPlot: () => null,
    getUPlotYScaleKey: () => 'y',
    getUPlotUnitDetails: () => ({ unit: '', factor: 1 }),
});
const wideTableSnapshot = wideTableReport.collectPanelReportSnapshot({ root: {}, sla: { source: 'none' } });
assert.strictEqual(wideTableSnapshot.state, 'no_threshold');
assert.strictEqual(wideTableSnapshot.engine, 'table-dom');
assert.strictEqual(wideTableSnapshot.table.columns[0], 'transaction');
assert.strictEqual(wideTableSnapshot.series.length, 0,
    'a wide informational table must finish without guessing which numeric column is the SLA value');

const legendRow = { querySelector: () => ({ textContent: '12.4%' }) };
context.window.DashBridgeGrafanaDom = {
    legendItems: () => [legendRow],
    legendSeriesNames: () => ['Неуспешные Неуспешные'],
    legendLabel: () => ({ textContent: 'Неуспешные Неуспешные' }),
};
const percentReport = factory.create({
    mergeAxisAndPanelUnit: value => value,
    inferUnitFromAxisTicks: () => ({ unit: '%', factor: 1 }),
    getCachedPanelDefinition: () => null,
    unitFromPanelDefinition: () => ({ unit: '%', factor: 1 }),
    collectGrafanaTableData: () => null,
    collectGrafanaTableRecords: () => [],
    findUPlot: () => ({
        series: [{}, { label: 'Failed', show: true }], data: [[1, 2], [100, 90]], scales: { y: {} }
    }),
    getUPlotYScaleKey: () => 'y',
    getUPlotUnitDetails: () => ({ unit: '%', factor: 1 }),
});
const percentSnapshot = percentReport.collectPanelReportSnapshot({ root: {}, sla: { source: 'none', evaluation: 'period_max' } });
assert.strictEqual(percentSnapshot.aggregateValue, 12.4,
    'one chart series and one legend row must use the unambiguous displayed Max despite different labels');
assert.deepStrictEqual(Array.from(percentSnapshot.series, item => ({ name: item.name, value: item.value })), [
    { name: 'Неуспешные Неуспешные', value: 12.4 },
], 'period Max must use the visible legend as the report-series contract');

const helperSeriesReport = factory.create({
    mergeAxisAndPanelUnit: value => value,
    inferUnitFromAxisTicks: () => ({ unit: '%', factor: 1 }),
    getCachedPanelDefinition: () => null,
    unitFromPanelDefinition: () => ({ unit: '%', factor: 1 }),
    collectGrafanaTableData: () => null,
    collectGrafanaTableRecords: () => [],
    findUPlot: () => ({
        series: [{}, { label: 'Value', show: true }, { label: 'Value', show: true }],
        data: [[1, 2], [100, 90], [100, 85.7]], scales: { y: {} }
    }),
    getUPlotYScaleKey: () => 'y',
    getUPlotUnitDetails: () => ({ unit: '%', factor: 1 }),
});
const helperSeriesSnapshot = helperSeriesReport.collectPanelReportSnapshot({
    root: {}, sla: { source: 'none', evaluation: 'period_max' }
});
assert.strictEqual(helperSeriesSnapshot.aggregateValue, 12.4,
    'one visible legend Max must exclude generic uPlot helper series hidden from the legend');
assert.deepStrictEqual(Array.from(helperSeriesSnapshot.series, item => ({ name: item.name, value: item.value })), [
    { name: 'Неуспешные Неуспешные', value: 12.4 },
]);

const nonTableReport = factory.create({
    mergeAxisAndPanelUnit: value => value,
    inferUnitFromAxisTicks: () => ({ unit: '', factor: 1 }),
    getCachedPanelDefinition: () => null,
    unitFromPanelDefinition: () => ({ unit: '', factor: 1 }),
    collectGrafanaTableData: () => null,
    collectGrafanaTableRecords: () => [],
    findUPlot: () => null,
    getUPlotYScaleKey: () => 'y',
    getUPlotUnitDetails: () => ({ unit: '', factor: 1 }),
});
const nonTableSnapshot = nonTableReport.collectPanelReportSnapshot({ root: {}, sla: { source: 'none' } });
assert.notStrictEqual(nonTableSnapshot.engine, 'table-response',
    'one-point response frames must not turn a non-table panel into a report table');
context.window.__dashbridgePanelToolsVisualMetadata = {
    responseFilterEmptyIsNormal: true,
    responseDataStatus: { kind: 'filtered_empty', text: 'Нет превышений по заданному фильтру' },
};
const informationalFilteredSnapshot = nonTableReport.collectPanelReportSnapshot({
    root: {}, sla: { source: 'none', evaluation: 'period_max', value: 1 }
});
assert.strictEqual(informationalFilteredSnapshot.state, 'no_threshold',
    'an informational panel must remain no_threshold when its display filter removes every series');
assert.strictEqual(informationalFilteredSnapshot.threshold, null,
    'hidden stale SLA values must not leak into informational phrases');
assert.throws(() => factory.create({}), /dependencies are incomplete/);
console.log('PASS report snapshot module preserves bounded Table aggregation behind the visual facade');
