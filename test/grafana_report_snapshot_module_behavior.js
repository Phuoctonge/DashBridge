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
    collectGrafanaTableRecords: () => [{ name: 'requests', visible: true, values: [1, 3, 2] }],
    findUPlot: () => null,
    getUPlotYScaleKey: () => 'y',
    getUPlotUnitDetails: () => ({ unit: '', factor: 1 }),
});
const snapshot = report.collectPanelReportSnapshot({ root: {}, sla: { source: 'none' } });
assert.strictEqual(snapshot.engine, 'table-dom');
assert.strictEqual(snapshot.state, 'no_threshold');
assert.deepStrictEqual(Array.from(snapshot.series, item => ({ name: item.name, value: item.value })), [
    { name: 'requests', value: 3 },
]);
assert.throws(() => factory.create({}), /dependencies are incomplete/);
console.log('PASS report snapshot module preserves bounded Table aggregation behind the visual facade');
