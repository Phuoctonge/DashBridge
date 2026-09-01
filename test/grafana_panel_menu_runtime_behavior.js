'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = new Map();
const removed = [];
const context = {
    window: {
        DashBridgeGrafanaPanelAnalysis: {
            analysisThreshold: () => 0,
            formatPanelAnalysisCopy: () => ''
        }
    },
    document: {
        documentElement: { dataset: {} },
        querySelectorAll: () => [],
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) { removed.push([type, listener]); }
    },
    cancelAnimationFrame() {},
    console
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/content/grafana-panel-menu-runtime.js', 'utf8'), context);

const cleanup = [];
const runtime = context.window.DashBridgeGrafanaPanelMenuRuntime.create({
    isDashboardIframe: false,
    extensionOrigin: 'https://extension.test',
    isPanelMenuDomainAllowed: () => false,
    registerRuntimeCleanup: callback => cleanup.push(callback),
    getPanelStateKey: () => '',
    restorePanelVisualState() {},
    refreshSelectedPanelData() {},
    openPanelSettings() {},
    readPanelCaptureState: () => ({}),
    syncPanelCaptureToggle() {},
    setPanelCapturePrepared() {},
    getPanelCaptureTitle: () => '',
    runPanelCapture() {}
});

assert.equal(typeof runtime.startEmbeddedPanelAnalysis, 'function');
assert(listeners.has('dashbridgeGrafanaMenuScopeChanged'));
assert(listeners.has('dashbridgeGrafanaAnalysisSettingsChanged'));
assert.equal(cleanup.length, 2, 'factory must register cleanup for both document-level settings listeners');
cleanup.forEach(callback => callback());
assert(removed.some(([type, listener]) => type === 'dashbridgeGrafanaMenuScopeChanged'
    && listener === listeners.get(type)));
assert(removed.some(([type, listener]) => type === 'dashbridgeGrafanaAnalysisSettingsChanged'
    && listener === listeners.get(type)));
console.log('PASS Grafana panel menu runtime owns settings listeners and cleanup');
