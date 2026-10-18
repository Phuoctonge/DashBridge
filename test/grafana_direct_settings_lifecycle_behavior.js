'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
    let modal; let connectedPanel;
    const location = { origin: 'https://grafana.test', pathname: '/d/original/main', search: '', href: 'https://grafana.test/d/original/main' };
    const makePanel = () => ({ isConnected: true, dataset: { vizPanelKey: 'panel-1' }, querySelector: () => null });
    const panel = connectedPanel = makePanel();
    const lifecycle = {};
    const overlay = { isConnected: true, querySelector: () => null, append() {} };
    const context = { window: { __dashbridgePanelToolsLifecycle: lifecycle, __dashbridgePanelToolsRuntimeGeneration: 1 },
        location, URL, URLSearchParams, Map, Set, console,
        document: { documentElement: { dataset: {} }, dispatchEvent() {}, createElement: () => ({}), querySelector: () => overlay },
        CustomEvent: function () {}, runtimeDisposed: false,
        normalizePanelLegendState: value => value || null, getPanelStateKey: value => value.dataset.vizPanelKey,
        getPanelAnalysisTitle: () => 'Test', readPanelAnalysisSettings: () => ({}), isDashboardIframe: false,
        legendSelection: { isCompleteHideActive: () => false }, getPanelLegendSeries: () => [],
        getThresholdUnitStatus: async () => ({}), enforceSingleResponseSeriesFilter() {},
        tools: {}, visualMetadata: {}, discardThresholdHighlightRules() {},
        installDataInterceptor() {}, markCalculatedTitle() {}, observeCalculatedTitle() {}, syncResponseFilterPresentation() {},
        hasVisualWork: () => false, startThresholdReporting: async () => {}, refreshSelectedPanelData() {},
        thresholdRestoreAfterNextQuery: false, syncThresholdHighlightState() {},
    };
    context.window.DashBridgeGrafanaDom = { outerPanel: value => value, panelKey: value => value?.dataset?.vizPanelKey, findPanel: () => connectedPanel };
    context.window.DashBridgePanelSettingsModal = { open: args => { modal = args; return overlay; }, transformFields: () => '', thresholdFields: () => '', legendFields: () => '' };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('js/content/grafana-panel-state.js', 'utf8'), context);
    context.panelVisualState = context.window.DashBridgeGrafanaPanelState;
    const source = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
    const start = source.indexOf('    const openPanelSettings = panel => {');
    const end = source.indexOf('    // The iframe URL is the only configuration source', start);
    vm.runInContext(`${source.slice(start, end)}\nglobalThis.openSettings = openPanelSettings;`, context);
    context.openSettings(panel);
    return { context, panel, lifecycle, modal, location, remount() { panel.isConnected = false; connectedPanel = makePanel(); return connectedPanel; } };
}
(async () => {
    const unchanged = fixture(); await unchanged.modal.onSave({ removeFill: true });
    assert.equal(unchanged.context.tools.removeFill, true, 'valid settings still apply');
    for (const invalidate of [h => { h.location.pathname = '/d/other/main'; h.location.href = 'https://grafana.test/d/other/main'; },
        h => { h.location.search = '?orgId=2'; h.location.href += '?orgId=2'; },
        h => { h.context.window.__dashbridgePanelToolsLifecycle = {}; },
        h => { h.context.runtimeDisposed = true; }]) {
        const h = fixture(); invalidate(h); const result = await h.modal.onSave({ removeFill: true });
        assert.equal(result, false, 'stale modal must remain open without applying');
        assert.equal(h.context.tools.removeFill, undefined);
        assert.equal(h.context.panelVisualState.states.size, 0);
    }
    const remount = fixture(); remount.remount(); await remount.modal.onSave({ removeFill: true });
    assert.equal(remount.context.tools.removeFill, true, 'same dashboard equivalent panel remount remains valid');
    const deferred = fixture(); let release;
    deferred.context.window.DashBridgeGrafanaVisualEngine = { getPanelQuerySignaturesAsync: () => new Promise(resolve => { release = resolve; }) };
    const saving = deferred.modal.onSave({ seriesQueryFilterEnabled: true });
    assert.equal(typeof release, 'function');
    deferred.location.pathname = '/d/late/main'; deferred.location.href = 'https://grafana.test/d/late/main'; release([]);
    assert.equal(await saving, false, 'navigation during signature lookup invalidates save');
    assert.equal(deferred.context.tools.seriesQueryFilterEnabled, undefined);
    console.log('PASS direct Grafana settings reject stale dashboard/org/generation/async saves and preserve equivalent remounts');
})().catch(error => { console.error(error); process.exitCode = 1; });
