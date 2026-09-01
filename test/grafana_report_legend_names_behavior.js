'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const domSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-dom.js'), 'utf8');
const visualSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-report-snapshot.js'), 'utf8');
const toolsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const row = name => ({ querySelector: () => ({ textContent: name }) });
const rows = [row('Name'), row('GET /login'), row('POST /payment'), row('GET /login')];
const panel = { closest: () => null, querySelectorAll: () => rows };
const context = { window: {}, document: { querySelectorAll: () => [] } };
context.window.window = context.window;
context.window.document = context.document;
vm.createContext(context);
vm.runInContext(domSource, context);

assert.deepStrictEqual(
    Array.from(context.window.DashBridgeGrafanaDom.legendSeriesNames(panel)),
    ['GET /login', 'POST /payment'],
    'the shared legend contract must remove table headers and deduplicate names for the series picker'
);
context.window.__dashbridgePanelToolsVisualMetadata = {
    responseSeriesNames: ['GET /orders', 'POST /checkout']
};
const genericRows = [row('Name'), row('Value'), row('Value')];
const genericPanel = { closest: () => null, querySelectorAll: () => genericRows };
assert.deepStrictEqual(
    Array.from(context.window.DashBridgeGrafanaDom.legendSeriesNames(genericPanel)),
    ['GET /orders', 'POST /checkout'],
    'the same shared contract must replace technical Value rows with ordered datasource metadata'
);
assert(visualSource.includes('legendSeriesNames?.(root, { unique: false })')
    && visualSource.includes('names.length === expectedCount')
    && visualSource.includes('reportSeriesName(item.label, legendNames[offset], offset)'),
    'uPlot report snapshots must reuse the shared legend-series contract');
assert(visualSource.includes('reportSeriesName(item.label, legendNames[index], index)'),
    'Flot report snapshots must reuse the shared legend-series contract');
assert(visualSource.includes('const isGenericSeriesName = value =>')
    && visualSource.includes('? (legend || native || `Серия ${index + 1}`)')
    && visualSource.includes(': native;'),
    'Grafana technical labels such as Value must yield to the already resolved legend-series name');
assert(visualSource.includes('positional legend names must never replace native series labels'),
    'real native series names must still remain protected from sorted legend rows');
assert(visualSource.includes('const legendMaxByName = () =>')
    && visualSource.includes('legendMaximums.get(reportSeriesName(item.label, legendNames[offset], offset))'),
    'period Max values must be matched by the final resolved series name');
assert(toolsSource.includes('legendSeriesNames?.(getTargetPanel())')
    && toolsSource.includes('legendSeriesNames?.(panel)')
    && toolsSource.includes('visualMetadata.responseSeriesNames = collectResponseSeriesNames(scopedData);')
    && !toolsSource.includes('otherNameCount'),
    'the series picker and report collector must share one legend-name contract');
console.log('PASS report snapshots reuse Flot/uPlot legend series names');
