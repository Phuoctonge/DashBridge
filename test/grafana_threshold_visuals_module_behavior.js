'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
    window: { devicePixelRatio: 1 },
    document: {
        querySelectorAll: () => [],
        documentElement: { querySelectorAll: () => [] },
    },
    Node: { ELEMENT_NODE: 1 },
    Event: class Event {},
    MutationObserver: class MutationObserver { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    queueMicrotask,
    getComputedStyle: () => ({ position: 'relative' }),
};
context.window.window = context.window;
context.window.document = context.document;
context.window.addEventListener = () => {};
context.window.removeEventListener = () => {};
context.window.dispatchEvent = () => {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-threshold-visuals.js'), 'utf8'
), context);

const factory = context.window.DashBridgeGrafanaThresholdVisuals;
assert(factory && Object.isFrozen(factory), 'threshold visuals factory must expose one immutable MAIN dependency');
const threshold = factory.create({
    parseAxisUnitLabel: () => ({ unit: '', factor: 1 }),
    inferUnitFromAxisLabels: () => ({ unit: '', factor: 1 }),
    inferUnitFromAxisTicks: () => ({ unit: '', factor: 1 }),
    unitFromPanelDefinition: () => ({ unit: '', factor: 1 }),
    mergeAxisAndPanelUnit: value => value,
    getCachedPanelDefinition: () => null,
    getPanelDefinition: async () => null,
    findUPlot: () => null,
    getUPlotLegendRuntime: () => null,
    getFlotRowLabel: () => '',
});
const root = { querySelectorAll: () => [], removeAttribute() {} };
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(threshold.setThreshold({ root, enabled: false }))),
    { enabled: false, exceeded: false, unit: '' }
);
assert.throws(() => factory.create({}), /dependencies are incomplete/);
console.log('PASS Grafana threshold visuals preserve disabled-state cleanup behind the visual facade');
