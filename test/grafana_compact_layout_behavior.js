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
