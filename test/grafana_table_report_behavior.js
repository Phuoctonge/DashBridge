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
