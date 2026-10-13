'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fixture(name) {
    const frames = new Map(); let frameId = 0;
    const resizeObservers = [];
    const element = () => {
        const styles = new Map(); const classes = new Set();
        return {
            isConnected: true, parentElement: null, className: '',
            classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key) },
            style: { getPropertyValue: key => styles.get(key) || '', setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) },
            getAttribute: () => null, setAttribute() {}, removeAttribute() {}, contains(item) { return item === this; },
            querySelector: () => null, querySelectorAll: () => [],
            getBoundingClientRect() { return this.bounds || { width: 0, height: 0 }; },
        };
    };
    const root = element(), flex = element(), branch = element(), chart = element(), legend = element();
    root.classList.add('react-grid-item');
    chart.parentElement = branch; branch.parentElement = flex; legend.parentElement = flex; flex.parentElement = root;
    branch.bounds = { width: 380, height: 280 };
    flex.style.setProperty('flex-direction', 'row');
    legend.closest = () => legend;
    flex.querySelector = selector => selector.includes('legend') ? legend : null;
    root.querySelector = selector => selector.includes('.uplot') ? chart : null;
    root.__dashBridgeLegendOriginalDirection = 'column';
    root.__dashBridgeLegendAppliedLayout = { chartHost: chart, flexContainer: flex, legendElement: legend, direction: 'row' };
    const calls = [];
    const plot = {
        width: 760, height: 280, series: [{}], scales: {}, axes: [{ _found: [60000] }],
        setData() {}, redraw() {},
        setSize(size) { this.width = size.width; this.height = size.height; calls.push({ ...size }); },
    };
    root.plot = plot;
    const document = { querySelector: () => root, querySelectorAll: () => [], getElementById: () => ({}), removeEventListener() {} };
    const window = { name, document, DashBridgeGrafanaDom: { outerPanel: () => root, legendItems: () => [legend] }, dispatchEvent() {} };
    window.parent = name ? {} : window;
    const context = {
        window, document, console, Event: class Event {},
        getComputedStyle: el => ({ display: el === flex ? 'flex' : 'block', flexDirection: el === flex ? 'row' : 'column' }),
        requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
        cancelAnimationFrame: id => frames.delete(id), setTimeout: () => 1, clearTimeout() {}, clearInterval() {},
        MutationObserver: class MutationObserver {
            constructor(callback) { this.callback = callback; } observe() {} disconnect() { this.disconnected = true; }
        },
        ResizeObserver: class ResizeObserver {
            constructor(callback) { this.callback = callback; resizeObservers.push(this); }
            observe(target) { this.target = target; } disconnect() { this.disconnected = true; }
        },
    };
    vm.createContext(context);
    for (const file of ['grafana-legend-visibility-adapters.js', 'grafana-legend-visuals.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'content', file), 'utf8'), context);
    }
    const flush = () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn()); };
    return { root, branch, plot, calls, resizeObservers, frames, flush, api: window.DashBridgeGrafanaLegendVisuals.create({ debugLog() {} }) };
}

(async () => {
    for (const name of ['', 'dashbridge-iframe']) {
        const f = fixture(name);
        await f.api.applyPopupLegendAndVisuals('137', null, 'fast_click_toggle', false, false, 1.5, true);
        assert.strictEqual(f.plot.width, 380, 'ON sizes the chart to the available branch');
        // Grafana View changes both the available branch and native renderer size.
        f.branch.bounds = { width: 779, height: 753 };
        f.plot.setSize({ width: 1555, height: 753 });
        f.root.__dashBridgeObserver.callback(); f.flush();
        assert.strictEqual(f.plot.width, 779, 'View must correct Grafana full-panel width after legend relocation');
        const count = f.calls.length;
        f.root.__dashBridgeObserver.callback(); f.flush();
        assert.strictEqual(f.calls.length, count, 'own renderer mutations must settle without another resize');
        const observer = f.resizeObservers.find(item => !item.disconnected);
        assert(observer, 'active layout must observe available branch dimensions');
        f.branch.bounds = { width: 380, height: 280 };
        observer.callback(); f.flush();
        assert.strictEqual(f.plot.width, 380, 'return to dashboard must resize even without a DOM mutation');
        // Compact capture owns a pinned renderer size until its finally restore.
        f.plot.__dashBridgeCompactSize = { width: 380, height: 280 };
        f.plot.setSize({ width: 600, height: 470 });
        const pinnedCalls = f.calls.length;
        observer.callback(); f.flush();
        assert.strictEqual(f.calls.length, pinnedCalls, 'legend guard must defer to compact capture size ownership');
        delete f.plot.__dashBridgeCompactSize;
        observer.callback(); f.flush();
        assert.strictEqual(f.plot.width, 380, 'legend sizing resumes after compact restore');
        f.root.__dashBridgeObserver.callback();
        f.api.stopLegacyVisualObservers(f.root); f.flush();
        assert(observer.disconnected, 'generation cleanup releases layout resize observation');
        const afterStop = f.calls.length;
        observer.callback(); f.flush();
        assert.strictEqual(f.calls.length, afterStop, 'late callbacks cannot resize after cleanup');

        await f.api.applyPopupLegendAndVisuals('137', null, 'fast_click_toggle', false, false, 1.5, true);
        const current = f.resizeObservers.find(item => !item.disconnected);
        await f.api.applyPopupLegendAndVisuals('137', null, 'fast_click_toggle', false, false, 1.5, true);
        assert(current.disconnected, 'reapply replaces its previous size observer');
        assert.strictEqual(f.resizeObservers.filter(item => !item.disconnected).length, 1);
        await f.api.applyPopupLegendAndVisuals('137', null, 'fast_click_toggle', false, false, 1.5, false);
        assert.strictEqual(f.resizeObservers.filter(item => !item.disconnected).length, 0, 'OFF releases size observation');
        f.plot.setSize({ width: 1200, height: 600 });
        f.root.__dashBridgeObserver.callback(); f.flush();
        assert.strictEqual(f.plot.width, 1200, 'OFF leaves subsequent native renderer sizing alone');
        f.api.stopLegacyVisualObservers(f.root);
    }
    console.log('PASS relocated legends follow View/dashboard sizes in direct Grafana and iframe');
})().catch(error => { console.error(error); process.exitCode = 1; });
