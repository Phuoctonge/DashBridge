'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const panelTools = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const cpuFilter = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-cpu-capacity-filter.js'), 'utf8');

assert(panelTools.includes("highlightKind: 'series-query-filter'"),
    'series-query threshold metadata must identify its owning filter');
assert(cpuFilter.includes("highlightKind: 'cpu-capacity-filter'"),
    'vCPU threshold metadata must identify its owning filter');
assert(panelTools.includes("const kind = marker.kind || 'legacy';"),
    'collected rules must preserve their owning filter');
assert(panelTools.includes('const getEnabledSeriesThresholdHighlightRules = (state = tools) => visualMetadata.seriesThresholdHighlightRules'),
    'stored rules and currently visible rules must be separate');
assert(panelTools.includes('enabled: rules.length > 0'),
    'the overlay must follow the filtered visible-rule set');
assert(!panelTools.includes('if (!isSeriesThresholdHighlightEnabled()) {\n            seriesThresholdHighlightRules = [];'),
    'turning the visual switch off must not destroy rules needed by the next on toggle');
assert(panelTools.includes("discardThresholdHighlightRules('series-query-filter')"),
    'series rules must be discarded only when their data filter is disabled');
assert(panelTools.includes("discardThresholdHighlightRules('cpu-capacity-filter')"),
    'vCPU rules must be discarded only when their data filter is disabled');

const helperStart = panelTools.indexOf('const visualMetadata = window.__dashbridgePanelToolsVisualMetadata');
const helperEnd = panelTools.indexOf('    let visualStyleReapplyFrame', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'highlight state helpers must remain independently testable');

const calls = [];
const scheduledFrames = [];
const locationState = { href: 'https://grafana.example/d/main' };
const eventListeners = new Map();
const dispatch = event => (eventListeners.get(event.type) || []).forEach(listener => listener(event));
const context = {
    URL,
    Event,
    location: locationState,
    history: {
        state: null,
        pushState(state, _title, url) { this.state = state; locationState.href = new URL(url, locationState.href).href; },
        replaceState(state, _title, url) { this.state = state; locationState.href = new URL(url, locationState.href).href; }
    },
    addEventListener(type, listener) {
        const listeners = eventListeners.get(type) || [];
        listeners.push(listener);
        eventListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
        eventListeners.set(type, (eventListeners.get(type) || []).filter(candidate => candidate !== listener));
    },
    dispatchEvent(event) { dispatch(event); return true; },
    document: {},
    registerRuntimeCleanup() {},
    requestAnimationFrame: callback => { scheduledFrames.push(callback); return scheduledFrames.length; },
    cancelAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} },
    tools: {
        seriesQueryFilterEnabled: true,
        seriesQueryFilterHighlightEnabled: true,
        cpuCapacityFilterEnabled: true,
        cpuCapacityFilterHighlightEnabled: false
    },
    DashBridgeGrafanaVisualEngine: {
        setSeriesThresholdHighlights(options) {
            calls.push(JSON.parse(JSON.stringify(options)));
            return options;
        }
    },
    DashBridgeGrafanaDom: {
        visiblePanels: () => [],
        panelKey: panel => panel?.id || null,
        outerPanel: panel => panel,
        findPanel: () => null
    }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${panelTools.slice(helperStart, helperEnd)}
globalThis.setRules = rules => { visualMetadata.seriesThresholdHighlightRules = rules; };
globalThis.sync = (root = { id: 'panel' }, state = tools) => syncThresholdHighlightState(root, state);
globalThis.rebindAfterViewClose = rebindThresholdHighlightsAfterViewClose;`, context);

context.setRules([
    { threshold: 50, sourceNames: ['Value'], kind: 'series-query-filter' },
    { threshold: 2, sourceNames: ['load1'], kind: 'cpu-capacity-filter' }
]);
context.sync();
assert.strictEqual(calls.at(-1).enabled, true);
assert.deepStrictEqual(calls.at(-1).rules.map(rule => rule.kind), ['series-query-filter'],
    'the disabled vCPU visual switch must not leak its rule into the series-filter overlay');

context.tools.seriesQueryFilterHighlightEnabled = false;
context.sync();
assert.strictEqual(calls.at(-1).enabled, false, 'off must remove the overlay');
assert.deepStrictEqual(calls.at(-1).rules, [], 'off must expose no active visual rules');

context.tools.seriesQueryFilterHighlightEnabled = true;
context.sync();
assert.strictEqual(calls.at(-1).enabled, true, 'on must restore the overlay without a new data response');
assert.deepStrictEqual(calls.at(-1).rules.map(rule => rule.kind), ['series-query-filter'],
    'on must reuse the preserved series-filter rule');

context.setRules([{ threshold: 2, sourceNames: ['load1'], kind: 'cpu-capacity-filter' }]);
const dashboardRoot = { id: 'dashboard-panel' };
const viewRoot = { id: 'view-panel' };
const cpuState = {
    seriesQueryFilterEnabled: false,
    seriesQueryFilterHighlightEnabled: false,
    cpuCapacityFilterEnabled: true,
    cpuCapacityFilterHighlightEnabled: true
};
context.sync(dashboardRoot, cpuState);
context.sync(viewRoot, cpuState);
assert.strictEqual(calls.at(-2).root.id, 'dashboard-panel');
assert.strictEqual(calls.at(-2).enabled, false, 'opening View must detach the controller from the old panel root');
assert.strictEqual(calls.at(-1).root.id, 'view-panel');
assert.strictEqual(calls.at(-1).enabled, true, 'opening View must attach preserved vCPU rules to the new root');
assert.deepStrictEqual(calls.at(-1).rules.map(rule => rule.kind), ['cpu-capacity-filter']);

const cpuDashboardRoot = {
    id: 'panel-cpu', isConnected: true, getClientRects: () => [{}]
};
const loadDashboardRoot = {
    id: 'panel-load', isConnected: true, getClientRects: () => [{}]
};
const loadViewRoot = {
    id: 'panel-load-view', isConnected: true, getClientRects: () => [{}]
};
const viewCloseState = {
    seriesQueryFilterEnabled: true,
    seriesQueryFilterHighlightEnabled: true,
    cpuCapacityFilterEnabled: false,
    cpuCapacityFilterHighlightEnabled: false
};
context.setRules([{ threshold: 5, sourceNames: ['load1'], kind: 'series-query-filter' }]);
Object.assign(context.tools, viewCloseState);
context.tools.targetPanelId = 'panel-load';
context.DashBridgeGrafanaDom.visiblePanels = () => [cpuDashboardRoot, loadDashboardRoot];
context.sync(loadDashboardRoot, viewCloseState);
context.history.pushState(null, '', 'https://grafana.example/d/main?viewPanel=load');
context.sync(loadViewRoot, viewCloseState);
loadViewRoot.isConnected = false;
const callsBeforeViewClose = calls.length;
context.history.replaceState(null, '', 'https://grafana.example/d/main');
let executedSettlingFrames = 0;
while (scheduledFrames.length) {
    assert(executedSettlingFrames < 30, 'View-close settling must remain bounded');
    scheduledFrames.shift()();
    executedSettlingFrames += 1;
}
assert.strictEqual(calls.at(-1).root.id, 'panel-load',
    'closing View must restore the saved Load panel root instead of the first visible CPU panel');
assert.strictEqual(executedSettlingFrames, 24,
    'View close must execute the complete bounded geometry-settling window');
const viewCloseCalls = calls.slice(callsBeforeViewClose);
assert.strictEqual(viewCloseCalls.filter(call => call.enabled && call.root.id === 'panel-load').length, 24,
    'every settling frame must project the active overlay against the original Load panel');
assert(viewCloseCalls.every(call => call.root.id !== 'panel-cpu'),
    'View-close restoration must never use the first visible CPU panel');
assert.strictEqual(scheduledFrames.length, 0,
    'the settling repaint must leave no animation frame scheduled');
assert(calls.slice(-3).every(call => call.root.id === 'panel-load'),
    'settling frames must keep reprojecting against the original Load panel root');

console.log('PASS threshold highlight switches, View restoration and bounded settling remain independent');
