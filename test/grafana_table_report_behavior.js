'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-visual-engine.js'), 'utf8');
const unitSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-unit.js'), 'utf8');
const tableStart = source.indexOf('    const parseGrafanaTableDisplayValue');
const tableEnd = source.indexOf('    const collectPanelReportSnapshot', tableStart);
assert(tableStart >= 0 && tableEnd > tableStart,
    'table report helpers must remain independently testable');

const context = {};
vm.createContext(context);
vm.runInContext(unitSource, context);
vm.runInContext(`const { parseAxisUnitLabel } = globalThis.DashBridgeGrafanaUnit;\n${source.slice(tableStart, tableEnd)}\n`
    + 'globalThis.collectTable = collectGrafanaTableRecords;', context);

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
const records = context.collectTable(root);
assert.strictEqual(records.length, 2, 'non-numeric table rows must not become report series');
assert.strictEqual(records[0].name, 'DEV_service_/api/v1/data');
assert.strictEqual(records[0].values[0], 1250, 'Grafana compact K values must be expanded before SLA comparison');
assert.strictEqual(records[1].values[0], 949);
assert(source.includes("engine = responseTableRecords.length ? 'table-response' : 'table-dom'")
    && source.includes('records = tableRecords;'),
    'report snapshots must use table rows when neither Flot nor uPlot exists');
const collectorSource = source.slice(source.indexOf('const collectPanelReportSnapshot'), source.indexOf('const getThresholdDebug'));
assert(collectorSource.indexOf('records = tableRecords;') < collectorSource.indexOf('const failureKinds = new Set')
    && collectorSource.includes("new Set(['http_error', 'network_error', 'decode_error', 'aborted'])"),
    'a visible Metric/Value table must be evaluated before a stale request failure is reported');
console.log('PASS Grafana table Metric/Value rows feed report snapshots');
