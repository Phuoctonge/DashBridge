'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-cpu-capacity-legend.js'), 'utf8');
const toolsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const source = `${moduleSource}\n${toolsSource}`;

const context = { window: null };
context.globalThis = context;
context.window = context;
vm.createContext(context);
vm.runInContext(moduleSource, context);
const visualMetadata = { seriesCpuCapacityEntries: [] };
const runtime = context.DashBridgeGrafanaCpuCapacityLegend.create({
    tools: {}, visualMetadata, getLegendLabel: value => value,
    syncThresholdHighlightState() {}
});
context.setEntries = entries => { visualMetadata.seriesCpuCapacityEntries = entries; };
context.attachCapacity = runtime.attachToReportSnapshot;

context.setEntries([
    { value: 4, sourceNames: ['Value', 'sc2-sc-etl01p.passport.local:9182'] },
    { value: 16, sourceNames: ['Value', 'sc2-suo-coordinator02p.passport.local:9182'] }
]);
assert.strictEqual(
    context.attachCapacity({ series: [{ name: 'sc2-sc-etl01p.passport.local:9182 Load 1m' }] }).series[0].cpuCapacity,
    4,
    'legend row must match capacity by instance embedded in the visible label'
);
assert.strictEqual(context.attachCapacity({ series: [{ name: 'Value' }] }).series[0].cpuCapacity, undefined,
    'generic Grafana field names must not assign the first capacity to every row');
const reportSnapshot = context.attachCapacity({ series: [
    { name: 'sc2-sc-etl01p.passport.local:9182 Load 1m', value: 29.72 },
    { name: 'unknown.passport.local:9182 Load 1m', value: 14.34 }
] });
assert.strictEqual(reportSnapshot.series[0].cpuCapacity, 4,
    'report snapshots must reuse the same per-instance vCPU metadata as the legend');
assert.strictEqual(reportSnapshot.series[1].cpuCapacity, undefined,
    'unknown capacity must remain fail-open and must not invent a report value');
const dynamicSnapshot = context.attachCapacity({ state: 'no_threshold', series: [
    { name: 'sc2-sc-etl01p.passport.local:9182 Load 1m', value: 5 },
    { name: 'sc2-suo-coordinator02p.passport.local:9182 Load 1m', value: 8 }
] }, { source: 'cpu_capacity', coefficient: 0.8 });
assert.strictEqual(dynamicSnapshot.state, 'critical');
assert.strictEqual(dynamicSnapshot.series[0].threshold, 3.2);
assert.strictEqual(dynamicSnapshot.series[1].threshold, 12.8);
assert.strictEqual(dynamicSnapshot.series[0].level, 'critical');
assert.strictEqual(dynamicSnapshot.series[1].level, 'normal');

assert(moduleSource.includes("insertCell(headerRow, headerAnchor, 'vCPU', true)"),
    'table legend must receive a vCPU header after the name column');
assert(moduleSource.includes('if (tableCell?.parentElement === row) tableCell.after(cell);'),
    'vCPU values must be inserted after the native series-name cell');
assert(moduleSource.includes('const nativeValueCell = tableCell?.nextElementSibling;')
    && moduleSource.includes("nativeValueCell.className.trim()"),
    'vCPU cells must inherit Grafana typography classes from the native min column');
assert(!moduleSource.includes('font-variant-numeric:tabular-nums'),
    'custom numeric typography must not override Grafana legend fonts');
assert(moduleSource.includes(": '—';") && moduleSource.includes("text === '—' ? 'Количество vCPU не определено'"),
    'missing helper capacity must retain the column and display an em dash');
assert(moduleSource.includes('new MutationObserver(controller.schedule)'),
    'vCPU column must survive Grafana legend remounts');
assert(moduleSource.includes('const stop = () =>')
    && moduleSource.includes('if (activeRoot) stopController(activeRoot);')
    && toolsSource.includes('registerRuntimeCleanup(cpuCapacityLegend.stop);'),
    'vCPU observers, listeners and RAF work must follow the panel-tools generation cleanup');
assert(toolsSource.includes('syncResponseFilterPresentation(thresholdRoot, state)'),
    'View remount must restore the complete vCPU presentation');
const presentationStart = toolsSource.indexOf('const syncResponseFilterPresentation');
const presentationEnd = toolsSource.indexOf('    let visualStyleReapplyFrame', presentationStart);
const presentation = toolsSource.slice(presentationStart, presentationEnd);
const capacityIndex = presentation.indexOf('syncCpuCapacityLegend(root, state)');
const filterIndex = presentation.indexOf('syncFlotResponseFilterState(root, state)');
const reflowIndex = presentation.indexOf('reflowChart?.({ root })');
const highlightIndex = presentation.indexOf('syncThresholdHighlightState(root, state)');
assert(capacityIndex >= 0 && capacityIndex < filterIndex && filterIndex < reflowIndex && reflowIndex < highlightIndex,
    'vCPU legend space and Flot filtering must commit before threshold highlights are projected');
const controllerStart = moduleSource.indexOf('controller.schedule = () =>');
const controllerEnd = moduleSource.indexOf('controller.observer = new MutationObserver', controllerStart);
const controllerSchedule = moduleSource.slice(controllerStart, controllerEnd);
assert(controllerSchedule.includes('renderColumn(panelRoot, controller.state)')
    && controllerSchedule.includes('if (changes > 0)')
    && controllerSchedule.includes('controller.observer?.takeRecords?.()')
    && controllerSchedule.includes('reflowChart?.({ root: panelRoot })')
    && !controllerSchedule.includes('syncResponseFilterPresentation'),
    'legend remount guard must reflow only a changed vCPU column without re-arming the Flot response filter');
const visualEngine = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-legend-visibility-adapters.js'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-legend-visuals.js'), 'utf8');
assert(visualEngine.includes('.dashbridge-legend-bottom tr > .dashbridge-vcpu-legend-cell')
    && visualEngine.includes('flex:0 0 48px !important'),
    'bottom legends must keep the vCPU header and values on one fixed column grid');
assert(visualEngine.includes('.dashbridge-legend-bottom tr > :not(:first-child)')
    && visualEngine.includes('text-align:right !important')
    && !visualEngine.includes('min-width:max-content !important'),
    'live bottom legends must keep vCPU/min/max/current in equal fixed-width columns');
assert(moduleSource.includes("sortDirection === null")
    && moduleSource.includes("sortDirection === 'desc' ? 'asc' : null")
    && moduleSource.includes('restoreOriginal: sortDirection === null'),
    'vCPU header must cycle through descending, ascending and unsorted states');
assert(moduleSource.includes('controller.nativeSortListener = event =>')
    && moduleSource.includes('sortDirection = null;'),
    'native legend sorting must clear the independent vCPU sorting state');
assert(moduleSource.includes('if (!direction) return left.originalOrder - right.originalOrder;'),
    'third vCPU header click must restore the original legend order');
assert(moduleSource.includes("if (left.value === null) return 1;")
    && moduleSource.includes("if (right.value === null) return -1;"),
    'unknown vCPU values must stay below finite values in both directions');
assert(moduleSource.includes("difference || left.index - right.index"),
    'equal vCPU values must preserve their current stable order');

const sortStart = moduleSource.indexOf('const sortRows');
const sortEnd = moduleSource.indexOf('        const renderColumn', sortStart);
const sortContext = {};
sortContext.globalThis = sortContext;
vm.createContext(sortContext);
vm.runInContext(`let sortDirection = null;
const originalOrders = new WeakMap();
${moduleSource.slice(sortStart, sortEnd)}
globalThis.setDirection = value => { sortDirection = value; };
globalThis.setOriginalOrder = (parent, rows) => {
    const orders = new WeakMap();
    rows.forEach((row, index) => orders.set(row, index));
    originalOrders.set(parent, { orders, next: rows.length });
};
globalThis.sortRows = sortRows;`, sortContext);

const parent = {
    rows: [],
    appendChild(row) {
        this.rows = this.rows.filter(candidate => candidate !== row);
        this.rows.push(row);
    }
};
const makeRow = (id, value) => {
    const row = { id, parentElement: parent, querySelector: () => cell };
    const cell = {
        dataset: { dashbridgeVcpuValue: value === null ? '' : String(value) },
        closest: () => row,
        parentElement: row
    };
    return { row, cell };
};
const entries = [makeRow('20', 20), makeRow('unknown', null), makeRow('4a', 4), makeRow('4b', 4)];
parent.rows = entries.map(entry => entry.row);
sortContext.setOriginalOrder(parent, parent.rows);
const header = { dataset: {}, setAttribute() {} };
const root = {
    querySelectorAll(selector) {
        return selector === '.dashbridge-vcpu-legend-header'
            ? [header]
            : parent.rows.map(row => entries.find(entry => entry.row === row).cell);
    }
};
sortContext.setDirection('asc');
sortContext.sortRows(root);
assert.deepStrictEqual(parent.rows.map(row => row.id), ['4a', '4b', '20', 'unknown']);
sortContext.setDirection('desc');
sortContext.sortRows(root);
assert.deepStrictEqual(parent.rows.map(row => row.id), ['20', '4a', '4b', 'unknown']);
sortContext.setDirection(null);
sortContext.sortRows(root, { restoreOriginal: true });
assert.deepStrictEqual(parent.rows.map(row => row.id), ['20', 'unknown', '4a', '4b']);

console.log('PASS vCPU capacity is rendered as an independent legend column');
