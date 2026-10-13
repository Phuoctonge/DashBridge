'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-report-snapshot.js'), 'utf8');
const unitSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-unit.js'), 'utf8');
const tableSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-table-report.js'), 'utf8');

const context = {};
vm.createContext(context);
vm.runInContext(unitSource, context);
vm.runInContext(tableSource, context);
const tableReport = context.DashBridgeGrafanaTableReport;
assert(tableReport && Object.isFrozen(tableReport), 'table report API must be installed as an immutable runtime dependency');

const cell = value => ({ textContent: value });
const row = (values, header = false) => ({
    cells: values.map(cell),
    querySelector: selector => header && /columnheader|th/.test(selector) ? {} : null,
    querySelectorAll: () => []
});
const header = row(['Metric', 'Value'], true);
const rows = [
    row(['DEV_service_/api/v1/data', '1.25 K']),
    row(['PROD_service_/api/v1/data', '949.00']),
    row(['ignored', 'No data'])
];
const table = {
    querySelector: selector => selector === 'thead tr' ? header : null,
    querySelectorAll: selector => selector === 'tbody tr, [role="row"]' ? rows : []
};
const root = {
    matches: () => false,
    querySelectorAll: selector => selector === 'table, [role="table"], [role="grid"]' ? [table] : []
};
const records = tableReport.collectGrafanaTableRecords(root);
const tableData = tableReport.collectGrafanaTableData(root);
assert.strictEqual(records.length, 2, 'non-numeric table rows must not become report series');
assert.deepStrictEqual(Array.from(tableData.columns), ['Metric', 'Value']);
assert.strictEqual(tableData.rows[0][1], '1.25 K', 'table output must preserve the value displayed by Grafana');
assert.strictEqual(records[0].name, 'DEV_service_/api/v1/data');
assert.strictEqual(records[0].values[0], 1250, 'Grafana compact K values must be expanded before SLA comparison');
assert.strictEqual(records[1].values[0], 949);
assert.strictEqual(tableReport.parseGrafanaTableDisplayValue('−1,5 MiB'), -1.5 * 1024 ** 2);
assert.strictEqual(tableReport.parseGrafanaTableDisplayValue('1.2e3'), 1200);
assert.strictEqual(tableReport.parseGrafanaTableDisplayValue('No data'), null);
const responseShape = tableReport.getResponseTableFrameShape({
    schema: { fields: [{ name: 'Metric', type: 'string' }, { name: 'Value', type: 'number' }] },
    data: { values: [['one', 'two'], [1, 2]] }
});
assert(responseShape && responseShape.nameIndex === 0 && responseShape.valueIndex === 1
    && responseShape.rowCount === 2 && responseShape.timeIndexes.length === 0,
    'response Metric/Value frame shape must share the table-report parser contract');
assert.strictEqual(tableReport.getResponseTableFrameShape({
    schema: { fields: [{ name: 'Metric', type: 'string' }, { name: 'Status', type: 'string' }] },
    data: { values: [['one'], ['ok']] }
}), null, 'response tables without a numeric value column must fail open');
vm.runInContext(tableSource, context);
assert.strictEqual(context.DashBridgeGrafanaTableReport, tableReport, 'reinstallation must preserve the table report API');
assert(source.includes("engine = table && responseTableRecords.length ? 'table-response' : 'table-dom'")
    && source.includes('records = tableRecords;'),
    'report snapshots must use table rows when neither Flot nor uPlot exists');
const collectorSource = source.slice(source.indexOf('const collectPanelReportSnapshot'));
assert(collectorSource.indexOf('records = tableRecords;') < collectorSource.indexOf('const failureKinds = new Set')
    && collectorSource.includes("new Set(['http_error', 'network_error', 'decode_error', 'aborted'])"),
    'a visible Metric/Value table must be evaluated before a stale request failure is reported');
console.log('PASS Grafana table Metric/Value rows feed report snapshots');
rows.splice(0, rows.length, row(['fast', '510 ms']), row(['slow', '1.40 mins']));
const durations = tableReport.collectGrafanaTableRecords(root, { unit: 'ms' });
assert.deepStrictEqual(Array.from(durations, item => item.values[0]), [510, 84000]);

assert.strictEqual(tableReport.parseGrafanaTableDisplayValue('1.50 mystery'), null,
    'an unknown numeric suffix must never default to factor 1');
assert.strictEqual(tableReport.parseGrafanaTableDisplayValue('1.50 Mil'), 1500000);
context.window = context;
vm.runInContext(source, context);
const unitApi = context.DashBridgeGrafanaUnit;
const report = context.DashBridgeGrafanaReportSnapshot.create({
    mergeAxisAndPanelUnit: unitApi.mergeAxisAndPanelUnit,
    inferUnitFromAxisTicks: unitApi.inferUnitFromAxisTicks,
    getCachedPanelDefinition: () => ({ fieldConfig: { defaults: { unit: 'short' } } }),
    unitFromPanelDefinition: unitApi.unitFromPanelDefinition,
    collectGrafanaTableData: tableReport.collectGrafanaTableData,
    collectGrafanaTableRecords: tableReport.collectGrafanaTableRecords,
    findUPlot: () => null, getUPlotYScaleKey: () => 'y', getUPlotUnitDetails: () => null
});
const snapshot = (sla = {}) => report.collectPanelReportSnapshot({ root,
    sla: { source: 'custom', value: 1000000, ...sla } });
rows.splice(0, rows.length, row(['small', '949.00']), row(['currency', '1.50 Mil']));
const mil = snapshot();
assert.strictEqual(mil.state, 'critical', 'the DOM fallback must not drop the actual violating Mil row');
assert.strictEqual(mil.maxValue, 1500000);
assert.strictEqual(mil.series.length, 2);
assert.strictEqual(snapshot({ unit: 'ms' }).state, 'configuration_error',
    'a count table cannot be relabeled as a duration SLA');
const summary = row(['Total', '7.93 Mil']);
summary.matches = selector => selector.includes('.rdg-summary-row');
rows.push(summary, row(['Total', '5']));
const summarized = snapshot();
assert.strictEqual(summarized.maxValue, 1500000, 'Grafana summary footer must not become an SLA series');
assert.strictEqual(summarized.series.filter(item => item.name === 'Total').length, 1,
    'an ordinary series named Total remains valid');
for (const invalid of ['1.50 mystery', '1.50 ms', '', 'No data']) {
    rows.splice(0, rows.length, row(['small', '949.00']), row(['unparsed', invalid]));
    const incomplete = snapshot();
    assert.strictEqual(incomplete.state, 'configuration_error', `${invalid} must prevent a false successful SLA`);
    assert.strictEqual(incomplete.dataStatus, 'table_numeric_incomplete');
    assert.strictEqual(incomplete.series.length, 0);
    assert.strictEqual(incomplete.table.rows.length, 2, 'literal cells must survive numeric failure');
    assert.strictEqual(snapshot({ source: 'none' }).state, 'configuration_error',
        'informational numeric tables must not hide an incomplete numeric aggregate');
}
rows.splice(0, rows.length, row(['unknown', '1.50 mystery']));
assert.strictEqual(snapshot().state, 'configuration_error', 'all-unparsed numeric table must remain explicit');
rows.splice(0, rows.length, row(['small', '949.00']), row(['missing value cell']));
assert.strictEqual(snapshot().state, 'configuration_error', 'an absent Value cell must prevent a false successful SLA');
rows.splice(0, rows.length, row(['zero', '0']));
assert.strictEqual(snapshot().maxValue, 0, 'a real zero must remain numeric data');
rows.splice(0, rows.length, row(['service', 'Healthy']), row(['other', 'No data']));
const literal = snapshot({ source: 'none' });
assert.strictEqual(literal.state, 'no_threshold');
assert.strictEqual(literal.series.length, 0);
assert.strictEqual(literal.aggregateValue, null, 'literal tables must not manufacture a numeric zero');
