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
assert(source.includes('records = tableRecords;'),
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

// The offscreen maximum must come from the selected, committed table frame.
const nativeNames = Array.from({ length: 100 }, (_, i) => `metric-${i}`);
const nativeValues = Array.from({ length: 100 }, (_, i) => i === 99 ? 1504287 : 949);
const frame = { length: 100, fields: [
    { name: 'Metric', type: 'string', values: nativeNames },
    { name: 'Value', type: 'number', config: { unit: 'short' }, values: nativeValues }
] };
const host = { stateNode: table, memoizedProps: { role: 'grid' } };
const grid = { memoizedProps: { rows: nativeNames.map((Metric, i) => ({ Metric, Value: nativeValues[i] })),
    columns: frame.fields.map(field => ({ field, name: field.name })) }, child: host };
const component = { memoizedProps: { data: frame }, child: grid };
const panel = { memoizedProps: { id: 31, data: { series: [frame] } }, child: component };
const reactRoot = { tag: 3, stateNode: {}, child: panel };
reactRoot.stateNode.current = reactRoot;
host.return = grid; grid.return = component; component.return = panel; panel.return = reactRoot;
table.__reactFiber$test = host;
table.getAttribute = name => ({ role: 'grid', 'aria-rowcount': '102' })[name] ?? null;
rows.splice(0, rows.length, ...nativeNames.slice(0, 24).map(name => row([name, '949.00'])));
assert.strictEqual(snapshot().maxValue, 1504287, 'virtualized report must include offscreen maximum');
assert.strictEqual(snapshot().series.length, 100);
assert.strictEqual(snapshot().engine, 'table-native');
const wrapPanel = count => {
    let child = panel;
    for (let index = 0; index < count; index += 1) {
        const parent = { child };
        child.return = parent;
        child = parent;
    }
    child.return = reactRoot;
    reactRoot.child = child;
};
wrapPanel(100);
assert.strictEqual(snapshot().maxValue, 1504287, 'deep Grafana providers must still reach the committed root');
wrapPanel(300);
assert.strictEqual(snapshot().dataStatus, 'table_data_incomplete', 'excessive ancestry must remain bounded and explicit');
panel.return = reactRoot;
reactRoot.child = panel;
context.__dashbridgePanelToolsVisualMetadata = { responseTableRecords: [{ name: 'stale', value: 1 }] };
assert.strictEqual(snapshot().maxValue, 1504287, 'current renderer data must supersede stale transport metadata');
delete context.__dashbridgePanelToolsVisualMetadata;

const refreshed = { ...component, memoizedProps: { data: { ...frame, fields: [frame.fields[0],
    { ...frame.fields[1], values: nativeValues.map(() => 5) }] } } };
const newGrid = { ...grid, memoizedProps: { ...grid.memoizedProps,
    columns: refreshed.memoizedProps.data.fields.map(field => ({ field, name: field.name })) } };
const newHost = { ...host };
const newPanel = { ...panel };
const newRoot = { ...reactRoot };
component.alternate = refreshed; refreshed.alternate = component;
grid.alternate = newGrid; newGrid.alternate = grid;
host.alternate = newHost; newHost.alternate = host;
panel.alternate = newPanel; newPanel.alternate = panel;
reactRoot.alternate = newRoot; newRoot.alternate = reactRoot;
newRoot.child = newPanel; newPanel.child = refreshed; refreshed.child = newGrid; newGrid.child = newHost;
newHost.return = newGrid; newGrid.return = refreshed; refreshed.return = newPanel; newPanel.return = newRoot;
reactRoot.stateNode.current = newRoot;
assert.strictEqual(snapshot().maxValue, 5, 'DOM fiber alternate must resolve the committed refresh');
reactRoot.stateNode.current = reactRoot;

for (const bad of [null, '', undefined]) {
    nativeValues[99] = bad;
    assert.strictEqual(snapshot().state, 'configuration_error', 'native missing numeric value must not become zero');
}
nativeValues[99] = 1504287;
const originalData = component.memoizedProps.data;
component.memoizedProps.data = { ...frame, length: 101 };
assert.strictEqual(snapshot().dataStatus, 'table_data_incomplete', 'mismatched frame shape must not use partial DOM');
component.memoizedProps.data = originalData;
grid.memoizedProps.columns = [{ field: {} }, { field: {} }];
assert.strictEqual(snapshot().state, 'configuration_error', 'unrelated frame fields must not be accepted');
grid.memoizedProps.columns = frame.fields.map(field => ({ field, name: field.name }));
for (const [code, value, want, unit] of [['percentunit', 0.8, 80, '%'], ['ms', 84000, 84000, 'ms'], ['short', 1504287, 1504287, '']]) {
    frame.fields[1].config.unit = code;
    frame.fields[1].values = new Float64Array(100).fill(value);
    const result = snapshot();
    assert.strictEqual(result.maxValue, want, `${code} native scale must agree with report units`);
    assert.strictEqual(result.unit, unit);
}
frame.fields[1].config.unit = 'short';
frame.fields[1].values = { buffer: nativeValues, get(index) { return this.buffer[index]; } };
assert.strictEqual(snapshot().maxValue, 1504287, 'legacy Vector.get must support bounded numeric reads');
frame.fields[1].values = nativeValues;
const savedRows = grid.memoizedProps.rows;
grid.memoizedProps.rows = Array.from({ length: 5001 }, () => ({}));
component.memoizedProps.data = { length: 5001, fields: [
    { ...frame.fields[0], values: Array(5001).fill('large') },
    { ...frame.fields[1], values: Array(5001).fill(1) }
] };
grid.memoizedProps.columns = component.memoizedProps.data.fields.map(field => ({ field, name: field.name }));
assert.strictEqual(snapshot().dataStatus, 'table_data_incomplete', 'native row cap must never yield successful partial SLA');
assert.strictEqual(snapshot({ source: 'none' }).dataStatus, 'table_data_incomplete', 'numeric native cap stays explicit without SLA');
component.memoizedProps.data = frame;
grid.memoizedProps.rows = savedRows;
grid.memoizedProps.columns = frame.fields.map(field => ({ field, name: field.name }));
component.memoizedProps = { id: 99, data: { series: [frame] } };
panel.memoizedProps = { data: frame };
assert.strictEqual(snapshot().dataStatus, 'table_data_incomplete', 'nearest panel boundary must stop unrelated ancestor extraction');
component.memoizedProps = { data: frame };
panel.memoizedProps = { id: 31, data: { series: [frame] } };
Object.defineProperty(component.memoizedProps, 'data', { get() { throw new Error('must not execute getter'); }, configurable: true });
assert.strictEqual(snapshot().dataStatus, 'table_data_incomplete');
Object.defineProperty(component.memoizedProps, 'data', { value: frame, configurable: true });
assert.strictEqual(JSON.stringify(snapshot().table).includes('metric-99'), false, 'full native point arrays must not escape in table payload');
delete table.__reactFiber$test;
assert.strictEqual(snapshot().dataStatus, 'table_data_incomplete', 'virtualized DOM alone cannot prove whole-table SLA');
assert.strictEqual(snapshot({ source: 'none' }).state, 'configuration_error');
delete table.getAttribute;
console.log('PASS native complete/current table reports and explicit partial fallback');

// Exercise transport metadata through the real report factory, including the
// complete DOM fallback used by tables without a proven native DataFrame.
{
    const runtime = {};
    runtime.window = runtime;
    vm.createContext(runtime);
    for (const file of ['grafana-unit', 'grafana-table-report', 'grafana-panel-data-transforms', 'grafana-report-snapshot']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'content', `${file}.js`), 'utf8'), runtime);
    }
    const visibleRows = [];
    const plainTable = {
        querySelector: selector => selector === 'thead tr' ? header : null,
        querySelectorAll: selector => selector === 'tbody tr, [role="row"]' ? visibleRows : []
    };
    const plainRoot = {
        matches: () => false,
        querySelector: () => null,
        querySelectorAll: selector => selector === 'table, [role="table"], [role="grid"]' ? [plainTable]
            : selector === 'th, [role="columnheader"]' ? header.cells : []
    };
    const filterTools = { seriesQueryFilterEnabled: true, seriesQueryFilterValue: -1 };
    const transforms = runtime.DashBridgeGrafanaPanelDataTransforms.create({
        tools: filterTools, getTargetPanel: () => plainRoot
    });
    const api = runtime.DashBridgeGrafanaUnit;
    const tables = runtime.DashBridgeGrafanaTableReport;
    const collector = runtime.DashBridgeGrafanaReportSnapshot.create({
        mergeAxisAndPanelUnit: api.mergeAxisAndPanelUnit,
        inferUnitFromAxisTicks: api.inferUnitFromAxisTicks,
        getCachedPanelDefinition: () => ({ fieldConfig: { defaults: { unit: 'short' } } }),
        unitFromPanelDefinition: api.unitFromPanelDefinition,
        collectGrafanaTableData: tables.collectGrafanaTableData,
        collectGrafanaTableRecords: tables.collectGrafanaTableRecords,
        findUPlot: () => null, getUPlotYScaleKey: () => 'y', getUPlotUnitDetails: () => null
    });
    const response = (names, values) => ({ results: { A: { frames: [{
        schema: { fields: [{ name: 'Metric', type: 'string' }, { name: 'Value', type: 'number' }] },
        data: { values: [names, values] }
    }] } } });
    const responseSnapshot = (names, values) => {
        visibleRows.splice(0, visibleRows.length, ...names.map((name, index) => row([name, String(values[index] ?? '')])));
        runtime.__dashbridgePanelToolsVisualMetadata = {
            responseTableRecords: transforms.collectResponseTableRecords(response(names, values))
        };
        return collector.collectPanelReportSnapshot({ root: plainRoot, sla: { source: 'custom', value: 1 } });
    };
    const missing = responseSnapshot(['missing-null', 'missing-empty', 'zero'], [null, '', 0]);
    assert.strictEqual(missing.state, 'configuration_error', 'transport metadata must not turn missing cells into a successful SLA');
    assert.strictEqual(missing.dataStatus, 'table_numeric_incomplete');
    assert.strictEqual(missing.series.length, 0, 'invalid table metadata must not publish partial zero-valued series');
    for (const invalid of [undefined, ' ', 'bad', NaN, Infinity]) {
        assert.strictEqual(responseSnapshot(['zero', 'invalid'], [0, invalid]).dataStatus, 'table_numeric_incomplete');
    }
    assert.strictEqual(responseSnapshot(['zero', ''], [0, 1]).dataStatus, 'table_numeric_incomplete',
        'a missing response row name must abandon the complete response fallback');
    const zero = responseSnapshot(['zero'], [0]);
    assert.strictEqual(zero.state, 'ok');
    assert.strictEqual(zero.engine, 'table-response');
    assert.strictEqual(zero.aggregateValue, 0, 'a genuine zero remains valid response data');

    const filtered = transforms.filterSeriesByThreshold(response(
        ['missing-null', 'missing-empty', 'missing-space', 'missing-undefined', 'zero'], [null, '', ' ', undefined, 0]
    ));
    assert.deepStrictEqual(Array.from(filtered.data.results.A.frames[0].data.values[0]), ['zero'],
        'a negative threshold must not retain missing table rows as invented zeros');
    assert.strictEqual(filtered.metrics.thresholdMatchedSeries, 1);
    assert.strictEqual(filtered.metrics.removedSeries, 4);

    const reduced = values => ({ results: { A: { frames: [{
        schema: { name: 'reduced', fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
        data: { values: [values.map((_value, index) => index), values] }
    }] } } });
    assert.strictEqual(transforms.collectResponseTableRecords(reduced([null])).length, 0);
    const reducedZero = transforms.collectResponseTableRecords(reduced([null, '', ' ', 0]));
    assert.strictEqual(reducedZero.length, 1, 'missing samples must not suppress an available reduced value');
    assert.strictEqual(reducedZero[0].value, 0);
    console.log('PASS full-factory table metadata/filter validation preserves missing cells and genuine zero');
}
