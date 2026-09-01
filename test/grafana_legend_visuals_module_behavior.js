'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
    window: {}, document: { querySelectorAll: () => [] },
    MutationObserver: class MutationObserver { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
};
context.window.window = context.window;
context.window.document = context.document;
vm.createContext(context);
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-legend-visibility-adapters.js'), 'utf8'
), context);
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-legend-visuals.js'), 'utf8'
), context);

const factory = context.window.DashBridgeGrafanaLegendVisuals;
assert(factory && Object.isFrozen(factory), 'legend visuals factory must expose one immutable MAIN dependency');
const legend = factory.create({ debugLog() {} });
assert.strictEqual(legend.resetFlotSeriesVisibility({ root: {} }), false);
assert.strictEqual(legend.findUPlotForThreshold({ querySelectorAll: () => [] }), null);
assert.throws(() => factory.create({}), /dependencies are incomplete/);
assert.strictEqual(typeof legend.stopLegacyVisualObservers, 'function');
console.log('PASS Grafana legend visuals preserve renderer lookup and controller cleanup ownership');
