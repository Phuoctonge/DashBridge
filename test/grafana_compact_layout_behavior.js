'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-compact-layout.js'),
    'utf8'
);

const nativeIncrements = () => [60_000, 300_000, 900_000];
const incrementCalls = [];
const inlineStyles = new Map();
const mutationObservers = [];
class FakeMutationObserver {
    constructor(callback) { this.callback = callback; mutationObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
}
const chartRoot = {
    style: {
        getPropertyValue: property => inlineStyles.get(property)?.value || '',
        getPropertyPriority: property => inlineStyles.get(property)?.priority || '',
        setProperty(property, value, priority = '') { inlineStyles.set(property, { value, priority }); },
        removeProperty(property) { inlineStyles.delete(property); },
    },
};
const uplot = {
    width: 1000,
    height: 300,
    throwOnRedraw: false,
    root: chartRoot,
    axes: [{ _found: [300_000, 80], _incrs: nativeIncrements }],
    setSize(size) {
        this.width = size.width;
        this.height = size.height;
        incrementCalls.push(this.axes[0]._incrs());
    },
    redraw() { if (this.throwOnRedraw) throw new Error('uPlot-redraw-failed'); },
};
const nativeSetSize = uplot.setSize;
const canvas = {
    classList: { contains: () => false },
    getBoundingClientRect: () => ({ width: 1000, height: 300 }),
};
const root = {
    __reactFiber$test: {
        memoizedState: { memoizedState: { current: uplot }, next: null },
        return: null,
    },
    querySelectorAll(selector) {
        return selector === 'canvas' ? [canvas] : [];
    },
    bounds: { width: 1100, height: 400 },
    getBoundingClientRect() { return this.bounds; },
};
const context = {
    window: {},
    MutationObserver: FakeMutationObserver,
    document: { querySelectorAll: () => [] },
    console,
};
vm.runInNewContext(source, context, { filename: 'grafana-compact-layout.js' });

const layout = context.window.DashBridgeGrafanaCompactLayout;
const rememberedUPlot = layout.rememberUPlotSize(root, root);
assert.strictEqual(rememberedUPlot, uplot,
    'compact layout must retain the exact uPlot instance before DOM reparenting');
assert.strictEqual(uplot.__dashBridgeCompactSize.xAxisIncrement, 300_000,
    'the native time increment must be captured before compact resizing');

delete root.__reactFiber$test;
root.bounds = { width: 600, height: 200 };
layout.resizeUPlot(root, root, rememberedUPlot);
assert.deepStrictEqual({ width: uplot.width, height: uplot.height }, { width: 500, height: 100 },
    'compact resize must use the retained uPlot when React fiber lookup is unavailable after reparenting');
assert.deepStrictEqual(inlineStyles.get('width'), { value: '500px', priority: 'important' },
    'compact uPlot width must stay pinned while Grafana observers settle');
assert.deepStrictEqual(inlineStyles.get('height'), { value: '100px', priority: 'important' },
    'compact uPlot height must stay pinned while Grafana observers settle');
assert.strictEqual(mutationObservers.length, 1,
    'compact resize must install a temporary observer for external renderer size writes');
uplot.setSize({ width: 900, height: 700 });
assert.deepStrictEqual({ width: uplot.width, height: uplot.height }, { width: 500, height: 100 },
    'external uPlot resize calls must stay pinned during compact capture');
inlineStyles.set('width', { value: '900px', priority: '' });
inlineStyles.set('height', { value: '700px', priority: '' });
mutationObservers[0].callback();
assert.deepStrictEqual(inlineStyles.get('width'), { value: '500px', priority: 'important' },
    'external renderer width writes must be restored during compact capture');
assert.deepStrictEqual(inlineStyles.get('height'), { value: '100px', priority: 'important' },
    'external renderer height writes must be restored during compact capture');

uplot.axes[0]._found = [60_000, 80];
layout.restoreUPlot([root], rememberedUPlot);
assert.deepStrictEqual(Array.from(incrementCalls.at(-1)), [300_000],
    'the restoration redraw must use the time increment from before resizing');
assert.strictEqual(uplot.axes[0]._incrs, nativeIncrements,
    'native automatic increment selection must resume immediately after restoration');
assert.strictEqual(uplot.__dashBridgeCompactSize, undefined,
    'temporary compact state must be released after restoration');
assert.strictEqual(inlineStyles.has('width'), false,
    'restoration must release the temporary uPlot width pin');
assert.strictEqual(inlineStyles.has('height'), false,
    'restoration must release the temporary uPlot height pin');
assert.strictEqual(mutationObservers[0].disconnected, true,
    'temporary renderer-size observer must be disconnected on restoration');
assert.strictEqual(uplot.setSize, nativeSetSize,
    'temporary uPlot resize guard must be removed on restoration');

root.__reactFiber$test = {
    memoizedState: { memoizedState: { current: uplot }, next: null },
    return: null,
};
const failingRememberedUPlot = layout.rememberUPlotSize(root, root);
root.bounds = { width: 600, height: 200 };
layout.resizeUPlot(root, root, failingRememberedUPlot);
uplot.throwOnRedraw = true;
assert.throws(() => layout.restoreUPlot([root], failingRememberedUPlot), /uPlot-redraw-failed/,
    'restore must propagate a renderer redraw failure');
assert.strictEqual(uplot.__dashBridgeCompactSizePin, undefined,
    'restore must disconnect the size observer after a renderer failure');
assert.strictEqual(uplot.__dashBridgeCompactInlineSize, undefined,
    'restore must release the inline-size snapshot after a renderer failure');
assert.strictEqual(uplot.__dashBridgeCompactSize, undefined,
    'restore must release compact state after a renderer failure');

console.log('PASS compact uPlot restoration preserves the native time grid');

const element = () => {
    const values = new Map();
    return {
        parentElement: null, children: [],
        style: {
            getPropertyValue: key => values.get(key)?.value || '',
            getPropertyPriority: key => values.get(key)?.priority || '',
            setProperty: (key, value, priority = '') => values.set(key, { value, priority }),
            removeProperty: key => values.delete(key),
        },
        querySelector: () => null, querySelectorAll: () => [],
    };
};
const tableRoot = element(), wrapper = element(), container = element(), grid = element();
grid.parentElement = container; container.parentElement = wrapper; wrapper.parentElement = tableRoot;
container.children = [grid]; wrapper.children = [container]; tableRoot.children = [wrapper];
grid.closest = selector => selector.includes('legend') ? null : container;
tableRoot.querySelectorAll = selector => selector.includes('[role="grid"]') ? [grid] : [];
tableRoot.contains = node => [tableRoot, wrapper, container, grid].includes(node);
wrapper.style.setProperty('width', '1588px');
container.style.setProperty('height', '803.25px');
tableRoot.style.setProperty('transform', 'translate(798px, 3686px)');
grid.style.setProperty('grid-template-columns', '780px 390px');
grid.matches = selector => selector === '[role="grid"]';
grid.getAttribute = name => name === 'aria-colcount' ? '2' : null;
context.window.DashBridgeGrafanaTableReport = {
    collectGrafanaTableData: () => ({ columns: ['Metric', 'Value'], rows: [['request', '100']] }),
};
// Dashboard ancestors can expose hooks for a different chart; native table
// evidence must take precedence over that broad legacy uPlot lookup.
tableRoot.__reactFiber$otherChart = { memoizedState: { memoizedState: { current: uplot }, next: null }, return: null };
const tableConstraints = layout.relaxInlineSizeConstraints(tableRoot);
assert(tableConstraints, 'native tables need a temporary compact layout controller');
assert.strictEqual(wrapper.style.getPropertyValue('width'), '100%');
assert.strictEqual(container.style.getPropertyValue('height'), '100%');
assert.strictEqual(tableRoot.style.getPropertyValue('transform'), 'none');
assert.strictEqual(grid.style.getPropertyValue('grid-template-columns'), 'minmax(0px, 780fr) minmax(0px, 390fr)',
    'compact native grids must fit both columns while preserving their width ratio');
const tableObserver = mutationObservers.at(-1);
wrapper.style.setProperty('width', '1588px');
tableRoot.style.setProperty('transform', 'translate(798px, 3686px)');
grid.style.setProperty('grid-template-columns', '780px 390px');
tableObserver.callback();
assert.strictEqual(wrapper.style.getPropertyValue('width'), '100%', 'native table resize cannot restore stale measured width');
assert.strictEqual(tableRoot.style.getPropertyValue('transform'), 'none', 'React grid writes cannot move the table outside the capture frame');
assert.strictEqual(grid.style.getPropertyValue('grid-template-columns'), 'minmax(0px, 780fr) minmax(0px, 390fr)');
const setGridStyle = grid.style.setProperty;
let redundantGridWrites = 0;
grid.style.setProperty = (...args) => { redundantGridWrites++; setGridStyle(...args); };
tableObserver.callback();
assert.strictEqual(redundantGridWrites, 0, 'normalized grid tracks must converge without an observer rewrite loop');
grid.style.setProperty = setGridStyle;
tableConstraints.restore();
assert.strictEqual(tableObserver.disconnected, true);
assert.strictEqual(wrapper.style.getPropertyValue('width'), '1588px');
assert.strictEqual(container.style.getPropertyValue('height'), '803.25px');
assert.strictEqual(tableRoot.style.getPropertyValue('transform'), 'translate(798px, 3686px)');
assert.strictEqual(grid.style.getPropertyValue('grid-template-columns'), '780px 390px');
for (const tracks of ['780px', 'minmax(100px, 1fr) 390px', '0px 390px']) {
    grid.style.setProperty('grid-template-columns', tracks);
    const untouchedTracks = layout.relaxInlineSizeConstraints(tableRoot);
    assert.strictEqual(grid.style.getPropertyValue('grid-template-columns'), tracks,
        'partial or non-positive/non-pixel grid tracks must not be guessed');
    untouchedTracks.restore();
    assert.strictEqual(grid.style.getPropertyValue('grid-template-columns'), tracks);
}
grid.matches = () => false;
const plainTableConstraints = layout.relaxInlineSizeConstraints(tableRoot);
assert(plainTableConstraints, 'non-grid native tables must still receive geometry control');
plainTableConstraints.restore();
assert.strictEqual(container.style.getPropertyValue('height'), '803.25px');
grid.closest = () => ({});
delete tableRoot.__reactFiber$otherChart;
assert.strictEqual(layout.relaxInlineSizeConstraints(tableRoot), null, 'legend tables must keep the chart path');
console.log('PASS compact native tables retain geometry and restore temporary constraints');

// KNS Grafana 12 legend tables use generated table classes; only their rows
// identify them as legends. Treating one as a data table leaves the 1100x800
// chart wrapper untouched inside a 1000x520 prepared capture.
const chartPanel = element(), measuredWrapper = element(), chart = element(), legend = element();
chart.parentElement = measuredWrapper; legend.parentElement = measuredWrapper;
measuredWrapper.parentElement = chartPanel;
measuredWrapper.children = [chart, legend]; chartPanel.children = [measuredWrapper];
chartPanel.contains = node => [chartPanel, measuredWrapper, chart, legend].includes(node);
measuredWrapper.contains = node => [measuredWrapper, chart, legend].includes(node);
chart.contains = node => node === chart;
measuredWrapper.style.setProperty('width', '1100px');
measuredWrapper.style.setProperty('height', '800px');
legend.closest = selector => selector.includes('legend') ? null : chartPanel;
legend.querySelector = selector => selector.includes('LegendRow') ? {} : null;
const legendRow = { closest: () => legend };
chartPanel.querySelectorAll = selector => selector.includes('[role="grid"]') ? [legend] : [];
chartPanel.querySelector = selector => selector === '.uplot' ? chart : legendRow;
chartPanel.__reactFiber$chart = { memoizedState: { memoizedState: { current: uplot }, next: null }, return: null };
const chartConstraints = layout.relaxInlineSizeConstraints(chartPanel);
assert(chartConstraints);
assert.strictEqual(measuredWrapper.style.getPropertyValue('height'), '100%',
    'a generated-class legend table must not bypass relaxation of its measured chart wrapper');
chartConstraints.restore();
assert.strictEqual(measuredWrapper.style.getPropertyValue('height'), '800px');
assert.strictEqual(measuredWrapper.style.getPropertyValue('width'), '1100px');

delete chartPanel.__reactFiber$chart;
const ownedPlot = { root: chart, setSize() {}, redraw() {} };
context.window.DashBridgeGrafanaVisualEngine = { findUPlot: () => ownedPlot };
assert.strictEqual(layout.findUPlot(chartPanel), ownedPlot,
    'compact capture must reuse the renderer lookup that finds the real Grafana 12 plot');
context.window.DashBridgeGrafanaVisualEngine.findUPlot = () => ({ ...ownedPlot, root: element() });
assert.strictEqual(layout.findUPlot(chartPanel), null,
    'an ancestor lookup must not resize a plot belonging to another panel');
console.log('PASS compact capture recognizes native legend tables and the owned visual-engine renderer');
