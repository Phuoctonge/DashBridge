'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, URLSearchParams };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/dashbridge/dashbridge-iframe-message-controller.js', 'utf8'),
    context,
);

const calls = [];
const card = { dataset: { panelId: 'panel-1' } };
const frame = {
    contentWindow: { id: 'frame-window' },
    dataset: {},
    closest: selector => selector === '.panel-card' ? card : null,
};
const panel = { id: 'panel-1', title: 'Old' };
let messageListener = null;
const controller = context.DashBridgeIframeMessageController.create({
    getFrameOrigin: () => 'https://grafana.example',
    getPanelForIframe: () => panel,
    getPanels: () => [panel],
    acceptReportSnapshot: (...args) => calls.push(['report', ...args]),
    acceptPanelAnalysis: (...args) => calls.push(['analysis', ...args]),
    capturePanel: (...args) => calls.push(['capture', ...args]),
    setCapturePrepared: value => calls.push(['prepared', value]),
    savePanels: () => calls.push(['save']),
    syncPanelAnalysisAction: (...args) => calls.push(['syncAnalysis', ...args]),
    acceptTitleResponse: data => calls.push(['titleResponse', data]),
    postToDashboardFrame: (...args) => calls.push(['post', ...args]),
    getCrosshairMode: () => 'line',
    getCrosshairThickness: () => 3,
    sendTimeUpdate: target => calls.push(['time', target]),
    applyPanelTools: (...args) => calls.push(['tools', ...args]),
    retryPanelAnalysis: target => calls.push(['retry', target]),
    acceptLegendSeries: (...args) => calls.push(['legend', ...args]),
    acceptThresholdStatus: (...args) => calls.push(['threshold', ...args]),
    broadcastCrosshair: (...args) => calls.push(['crosshair', ...args]),
    hideCrosshair: () => calls.push(['hideCrosshair']),
    windowRef: { addEventListener: (type, listener) => { if (type === 'message') messageListener = listener; } },
    documentRef: { querySelectorAll: () => [frame] },
    locationRef: { search: '?guiCapture=1' },
    chromeRef: { runtime: { sendMessage: message => { calls.push(['runtime', message]); return Promise.resolve(); } } },
});

controller.setup();
assert.strictEqual(typeof messageListener, 'function');
const emit = (data, overrides = {}) => messageListener({
    data,
    source: frame.contentWindow,
    origin: 'https://grafana.example',
    ...overrides,
});

emit({ action: 'panelReportSnapshot', requestId: 'report-1', snapshot: { ok: true } });
assert(calls.some(call => call[0] === 'report' && call[1] === 'report-1' && call[2] === frame));
const guardedCount = calls.length;
emit({ action: 'panelReportSnapshot', requestId: 'bad' }, { origin: 'https://evil.example' });
emit({ action: 'panelReportSnapshot', requestId: 'bad' }, { source: {} });
assert.strictEqual(calls.length, guardedCount, 'wrong source or origin must be ignored');

emit({ action: 'dashbridgePanelAnalysisUpdate', requestId: 'analysis-1' });
emit({ action: 'dashbridgePanelCaptureRequest', requestId: 'capture-1', outputAction: 'copy' });
emit({ action: 'dashbridgePanelCaptureRequest', requestId: 'capture-2', outputAction: 'open' });
assert(calls.some(call => call[0] === 'analysis'));
assert.strictEqual(calls.filter(call => call[0] === 'capture').length, 1);

emit({ action: 'dashbridgeCapturePreparedChanged', enabled: true });
emit({ action: 'dashbridgePanelTitle', title: `  ${'A'.repeat(300)}  ` });
assert.strictEqual(panel.title.length, 240);
assert(calls.some(call => call[0] === 'save') && calls.some(call => call[0] === 'syncAnalysis'));
emit({ action: 'dashbridgePanelTitleResponse', requestId: 'title-1' });

emit({ action: 'dashbridgeIframeReady' });
assert.strictEqual(frame.dataset.dashbridgeOrigin, 'https://grafana.example');
assert.strictEqual(frame.dataset.dashbridgeLoaded, 'true');
assert(calls.some(call => call[0] === 'post' && call[2].action === 'setCrosshairMode'));
assert(calls.some(call => call[0] === 'time') && calls.some(call => call[0] === 'tools'));

emit({ action: 'dashbridgePanelRendered' });
assert.strictEqual(frame.dataset.dashbridgeRendered, 'true');
assert(calls.some(call => call[0] === 'runtime' && call[1].type === 'dashbridge-gui-capture-ready'));
emit({ action: 'panelLegendSeries', requestId: 'legend-1' });
emit({ action: 'panelThresholdStatus', status: {} });
emit({ action: 'broadcastCrosshair', percentX: 0, timestamp: 10 });
emit({ action: 'broadcastCrosshairHide' });
for (const action of ['legend', 'threshold', 'crosshair', 'hideCrosshair']) {
    assert(calls.some(call => call[0] === action || call === action), `${action} must be dispatched`);
}

assert.throws(
    () => context.DashBridgeIframeMessageController.create({
        documentRef: {}, windowRef: {}, locationRef: {}, chromeRef: {},
    }),
    /dependencies are incomplete/,
);
console.log('dashbridge iframe message controller behavior tests passed');
