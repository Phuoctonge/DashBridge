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
const uplot = {
    width: 1000,
    height: 300,
    axes: [{ _found: [300_000, 80], _incrs: nativeIncrements }],
    setSize(size) {
        this.width = size.width;
        this.height = size.height;
        incrementCalls.push(this.axes[0]._incrs());
    },
    redraw() {},
};
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
    getBoundingClientRect: () => ({ width: 1100, height: 400 }),
};
const context = {
    window: {},
    document: { querySelectorAll: () => [] },
    console,
};
vm.runInNewContext(source, context, { filename: 'grafana-compact-layout.js' });

const layout = context.window.DashBridgeGrafanaCompactLayout;
layout.rememberUPlotSize(root, root);
assert.strictEqual(uplot.__dashBridgeCompactSize.xAxisIncrement, 300_000,
    'the native time increment must be captured before compact resizing');

uplot.axes[0]._found = [60_000, 80];
layout.restoreUPlot([root]);
assert.deepStrictEqual(Array.from(incrementCalls.at(-1)), [300_000],
    'the restoration redraw must use the time increment from before resizing');
assert.strictEqual(uplot.axes[0]._incrs, nativeIncrements,
    'native automatic increment selection must resume immediately after restoration');
assert.strictEqual(uplot.__dashBridgeCompactSize, undefined,
    'temporary compact state must be released after restoration');

console.log('PASS compact uPlot restoration preserves the native time grid');
