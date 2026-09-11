'use strict';
// Real module fixture for a queued observer rebind crossing synchronous reset.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const microtasks = [], observers = [];
const full = [{ label: 'keep' }, { label: 'hidden' }];
let data = full;
const nativeSetData = function (next) { data = next; };
const plot = { getData: () => data, setData: nativeSetData, setupGrid() {}, draw() {} };
const host = {};
const root = { querySelectorAll: () => [] };
const context = vm.createContext({
  document: { body: {}, querySelectorAll: () => [] },
  MutationObserver: class {
    constructor(fn) { this.fn = fn; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  },
  queueMicrotask: fn => microtasks.push(fn),
});
context.window = context;
context.$ = value => ({ find: () => ({ toArray: () => [host] }), data: () => value === host ? plot : null });
vm.runInContext(fs.readFileSync('js/content/grafana-legend-visibility-adapters.js', 'utf8'), context);
const api = context.DashBridgeGrafanaLegendVisibilityAdapters.create({
  debugLog() {}, getSeriesConfigState: (config, name) => config[name], findUPlotForThreshold: () => null
});
api.installFlotVisibilityController({ root, seriesConfig: { hidden: false }, mode: 'fast_complete_hide' });
assert.deepEqual(data.map(row => row.label), ['keep']);
// A DOM mutation observer has enqueued rebind. Another synchronous lifecycle owner resets it.
observers[0].fn([{ addedNodes: [] }]);
assert.equal(microtasks.length, 1);
api.resetFlotSeriesVisibility({ root });
assert.equal(plot.setData, nativeSetData, 'reset initially restores native method');
assert.deepEqual(data, full);
microtasks.shift()();
// The queued callback now sees the same plot so it does not rewrap or reapply.
assert.equal(plot.setData, nativeSetData, 'same-plot control remains native');
// Repeat with the renderer replacement which the observer was meant to bind.
api.installFlotVisibilityController({ root, seriesConfig: { hidden: false }, mode: 'fast_complete_hide' });
observers[1].fn([{ addedNodes: [] }]);
api.resetFlotSeriesVisibility({ root });
const replacement = { ...plot, getData: () => full, setData: nativeSetData };
context.$ = value => ({ find: () => ({ toArray: () => [host] }), data: () => value === host ? replacement : null });
microtasks.shift()();
assert.equal(replacement.setData, nativeSetData, 'disposed controller must not wrap replacement renderer');
assert.deepEqual(data, full, 'disabled filter preserves full data');
assert.equal(api.resetFlotSeriesVisibility({ root }), false, 'reset remains idempotent');
api.installFlotVisibilityController({ root, seriesConfig: { hidden: false }, mode: 'fast_complete_hide' });
observers[2].fn([{ addedNodes: [] }]);
api.resetSeriesVisibility({ root });
const newest = { ...plot, getData: () => full, setData: nativeSetData };
context.$ = value => ({ find: () => ({ toArray: () => [host] }), data: () => value === host ? newest : null });
api.installFlotVisibilityController({ root, seriesConfig: { keep: false }, mode: 'fast_complete_hide' });
const currentWrapper = newest.setData;
microtasks.shift()();
assert.equal(newest.setData, currentWrapper, 'late old callback must not replace the current controller');
assert.deepEqual(data.map(row => row.label), ['hidden'], 'only the new selection is applied');
assert.equal(api.resetSeriesVisibility({ root }), true);
assert.equal(newest.setData, nativeSetData);
assert.deepEqual(data, full);
console.log('PASS queued Flot rebind cannot outlive reset or alter a replacement renderer');
