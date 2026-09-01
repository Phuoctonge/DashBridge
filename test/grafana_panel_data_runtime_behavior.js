'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
    window: {
        DashBridgeGrafanaTableReport: { getResponseTableFrameShape: () => null }
    },
    console
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/content/grafana-panel-data-transforms.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/content/grafana-panel-data-runtime.js', 'utf8'), context);

const tools = {
    invertIdle: false,
    convertMemToUsed: false,
    forceMemByteUnit: false,
    seriesQueryFilterEnabled: false,
    cpuCapacityFilterEnabled: false,
    legendMode: 'fast_complete_hide',
    legendFilter: []
};
const runtime = context.window.DashBridgeGrafanaPanelDataRuntime.create({
    tools,
    isDashboardIframe: false,
    visualMetadata: {},
    legendSelection: { isCompleteHideActive: () => false },
    getTargetPanel: () => null,
    pushBoundedDiagnosticEvent() {},
    capDiagnosticJournal() {},
    setRecentDiagnosticRecord() {},
    setPanelDataStatus() {},
    syncPanelDataStatusPresentation() {},
    responseSeriesFilterIsEnabled: () => false,
    syncResponseFilterPresentation() {},
    hasPersistentVisualWork: () => false,
    reapplyVisualStylesAfterDataTransform() {},
    consumeVisualStylesAfterQuery() {},
    registerRuntimeCleanup() {},
    isThresholdRestorePending: () => false
});

assert.equal(runtime.hasDataTransform(), false);
tools.invertIdle = true;
assert.equal(runtime.hasDataTransform(), true, 'runtime must read the current shared tools state, not a startup snapshot');
assert.equal(typeof runtime.installDataInterceptor, 'function');
assert.equal(typeof runtime.markCalculatedTitle, 'function');
assert.equal(typeof runtime.observeCalculatedTitle, 'function');
console.log('PASS Grafana panel data runtime exposes live transform and interceptor ownership');
