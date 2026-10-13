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
const legendVisualsSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-legend-visuals.js'), 'utf8'
);
assert(
    !/if \(window\.name === 'dashbridge-iframe' && legendLayout\.legendElement\) \{[^}]*classList\.add\('dashbridge-legend-bottom'\)/s.test(legendVisualsSource),
    'iframe legend styling must not force bottom layout after the direction decision'
);
assert(
    legendVisualsSource.includes('const legendLayout = applyLegendLayout();'),
    'direct Grafana and DashBridge iframe must share the core legend layout application'
);
const legend = factory.create({ debugLog() {} });
assert.strictEqual(legend.resetFlotSeriesVisibility({ root: {} }), false);
assert.strictEqual(legend.findUPlotForThreshold({ querySelectorAll: () => [] }), null);
assert.throws(() => factory.create({}), /dependencies are incomplete/);
assert.strictEqual(typeof legend.stopLegacyVisualObservers, 'function');
console.log('PASS Grafana legend visuals preserve renderer lookup and controller cleanup ownership');

(async () => {
    for (const localFirst of [true, false]) {
        const frames = [];
        const root = {
            isConnected: true, classList: { contains: () => true },
            querySelector: () => null, querySelectorAll: () => [],
        };
        let series = { color: '#123456', label: 'CPU', lines: { fill: 0.2, lineWidth: 2 } };
        const plot = { getData: () => [series], setupGrid() {}, draw() {}, resize() {} };
        const style = { getPropertyValue: () => '', setProperty() {}, removeProperty() {} };
        const flex = { parentElement: root, querySelector: () => null, style, getAttribute: () => null, removeAttribute() {} };
        const chart = { parentElement: flex, style, getAttribute: () => null, removeAttribute() {} };
        root.querySelector = selector => selector === '.graph-panel__chart, .uplot' ? chart : null;
        const document = {
            body: {}, querySelector: () => root, querySelectorAll: () => [], getElementById: () => ({}),
        };
        const window = { document, dispatchEvent() {} };
        window.parent = window;
        window.jQuery = element => element === chart ? { data: () => plot } : {
            find() { return this; }, addBack() { return this; }, each(callback) { callback.call(chart); },
        };
        const ctx = {
            window, document, console, Event: class Event {}, getComputedStyle: () => ({ display: 'flex', flexDirection: 'row' }),
            MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
            requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
            cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {}, clearInterval() {},
        };
        vm.createContext(ctx);
        for (const file of ['grafana-legend-visibility-adapters.js', 'grafana-legend-visuals.js', 'grafana-series-styles.js']) {
            vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'content', file), 'utf8'), ctx);
        }
        const legacy = window.DashBridgeGrafanaLegendVisuals.create({ debugLog() {} });
        const local = window.DashBridgeGrafanaSeriesStyles.create({ findUPlot: () => null, getFlotPlot: () => plot });
        const applyLocal = enabled => local.applyLocalSeriesStyles({ root, removeFill: enabled, thickenLines: enabled, thickenLinesValue: 1.5 });
        const applyLegacy = enabled => legacy.applyPopupLegendAndVisuals('2', null, 'fast_click_toggle', enabled, enabled, 1.5, false);
        if (localFirst) applyLocal(true);
        await applyLegacy(true);
        applyLocal(true);
        assert.strictEqual(series.lines.lineWidth, 3.5, 'both painters must add thickness exactly once');
        assert.strictEqual(series.__dashbridgeOriginalLineWidth, 2);
        assert.strictEqual(series.__dashbridgeOriginalAreaFill, 0.2);
        root.__dashBridgeObserver.callback();
        frames.splice(0).forEach(callback => callback());
        assert.strictEqual(series.lines.lineWidth, 3.5, 'observer repaint must preserve the native baseline');
        await applyLegacy(false);
        applyLocal(false);
        assert.strictEqual(series.lines.lineWidth, 2);
        assert.strictEqual(series.lines.fill, 0.2, 'OFF restores native fill regardless of painter order');
        series = { color: '#654321', label: 'CPU', lines: { fill: 0.4, lineWidth: 3 } };
        applyLocal(true);
        await applyLegacy(true);
        assert.strictEqual(series.lines.lineWidth, 4.5, 'replacement series own a fresh native baseline');
        await applyLegacy(false);
        applyLocal(false);
        assert.strictEqual(series.lines.fill, 0.4);
        assert.strictEqual(series.lines.lineWidth, 3);
        legacy.stopLegacyVisualObservers(root);
    }
    console.log('PASS Flot painters share native fill/width baselines across reapply and replacement');
})().catch(error => { console.error(error); process.exitCode = 1; });
