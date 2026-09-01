'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let disconnected = 0;
class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() { disconnected += 1; }
}
const context = {
    window: {}, document: {}, MutationObserver,
    requestAnimationFrame: callback => { callback(); return 1; },
    cancelAnimationFrame() {},
};
context.window.window = context.window;
context.window.document = context.document;
vm.createContext(context);
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-series-styles.js'), 'utf8'
), context);

const series = { fill: () => '#123456', width: 1 };
let redraws = 0;
const uplot = {
    series: [{}, series], axes: [], data: [[], [1]], scales: {}, width: 200, height: 100,
    batch: callback => callback(), redraw: () => { redraws += 1; },
    setSize({ width, height }) { this.width = width; this.height = height; },
};
const styles = context.window.DashBridgeGrafanaSeriesStyles.create({
    findUPlot: () => uplot,
    getFlotPlot: () => null,
});
assert.strictEqual(styles.applyLocalSeriesStyles({ removeFill: true, thickenLines: true, thickenLinesValue: 2 }), 'uplot');
assert.strictEqual(series.fill(), 'rgba(0,0,0,0)');
assert.strictEqual(series.width, 3);
assert.strictEqual(redraws, 1);

const root = {};
styles.configureLocalSeriesStyleGuard({ root, removeFill: true });
assert(root.__dashBridgeLocalSeriesStyleGuard?.observer, 'active local styles must own one root-scoped observer');
styles.configureLocalSeriesStyleGuard({ root });
assert.strictEqual(disconnected, 1);
assert.strictEqual(root.__dashBridgeLocalSeriesStyleGuard, undefined);
assert.throws(() => context.window.DashBridgeGrafanaSeriesStyles.create({}), /dependencies are incomplete/);
console.log('PASS Grafana series styles preserve uPlot changes and root-scoped observer cleanup');
