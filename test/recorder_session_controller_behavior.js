'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/recorder/recorder-session-controller.js', 'utf8'),
    context,
);

const calls = [];
const statuses = [];
const progress = {
    openPictureInPicture: async options => calls.push(['pipOpen', options]),
    cancel: () => calls.push(['pipCancel']),
    finish: options => calls.push(['pipFinish', options]),
};
const state = {
    mode: 'idle', attached: false, tabId: null, windowId: null,
    steps: [], requests: new Map(), pendingBodyCaptures: new Set(),
    pendingRequestBodyCaptures: new Set(), inFlight: new Set(),
    completeness: { pendingCapturesAtStop: 0, requestBodiesFailed: 0 },
    sessionOptions: { disableCache: true, disableCookies: false },
};
const ui = {
    startUrl: { value: 'site.example/path' },
    disableCache: { checked: false },
    disableCookies: { checked: true },
};
const transport = {
    ensureDebuggerPermission: async () => calls.push(['permission']),
    buildWindowLayout: () => ({ controlled: { width: 1200 } }),
    createControlledTab: async layout => {
        calls.push(['createTab', layout]);
        state.windowId = 30;
        return 31;
    },
    attachNetwork: async tabId => {
        calls.push(['attach', tabId]);
        state.tabId = tabId;
        state.attached = true;
    },
    detachNetwork: async () => {
        calls.push(['detach']);
        state.attached = false;
    },
    postLifecycle: message => calls.push(['lifecycle', message]),
};
const networkCapture = {
    setResponseBodyStatus: (request, status, reason) => {
        request.responseBodyCapture = { status, reason };
        calls.push(['bodyStatus', status, reason]);
    },
};
const chromeRef = {
    tabs: { update: async (...args) => calls.push(['navigateTab', ...args]) },
    windows: { remove: async id => calls.push(['removeWindow', id]) },
};
let resetCount = 0;
const controller = context.DashBridgeRecorderSessionController.create({
    state,
    ui,
    schema: {
        normalizeHttpUrl: value => value === 'bad' ? null : `https://${value.replace(/^https?:\/\//, '')}`,
    },
    transport,
    networkCapture,
    delay: async ms => calls.push(['delay', ms]),
    resetSession: () => {
        resetCount += 1;
        state.steps = [];
        state.requests = new Map();
        state.pendingBodyCaptures = new Set();
        state.pendingRequestBodyCaptures = new Set();
        state.inFlight = new Set();
        state.completeness = { pendingCapturesAtStop: 0, requestBodiesFailed: 0 };
    },
    addNavigateStep: url => {
        state.steps.push({ type: 'navigate', url });
        calls.push(['step', url]);
    },
    saveSettings: async () => calls.push(['saveSettings']),
    setStatus: (...args) => statuses.push(args),
    updateControls: () => calls.push(['controls']),
    updateRecordingProgress: () => calls.push(['recordingProgress']),
    scheduleRender: () => calls.push(['render']),
    getProgressController: () => progress,
    chromeRef,
});

(async () => {
    await controller.start();
    assert.strictEqual(resetCount, 1);
    assert.strictEqual(ui.startUrl.value, 'https://site.example/path');
    assert.strictEqual(state.mode, 'recording');
    assert.strictEqual(state.tabId, 31);
    assert.strictEqual(state.sessionOptions.disableCache, false);
    assert.strictEqual(state.sessionOptions.disableCookies, true);
    assert.strictEqual(state.title, 'site.example');
    assert(calls.some(call => call[0] === 'pipOpen'));
    assert(calls.some(call => call[0] === 'navigateTab' && call[1] === 31));
    assert(statuses.some(call => call[0].startsWith('Запись активна')));

    const pendingRequest = {
        responseBodyCapture: { status: 'pending' },
        requestBodyCapture: { status: 'pending' },
    };
    state.requests.set('r1', pendingRequest);
    await controller.stop(true);
    assert.strictEqual(state.mode, 'idle');
    assert.strictEqual(state.tabId, null);
    assert.strictEqual(pendingRequest.responseBodyCapture.reason, 'capture-stopped');
    assert.strictEqual(pendingRequest.requestBodyCapture.reason, 'capture-stopped');
    assert.strictEqual(state.completeness.requestBodiesFailed, 1);
    assert(calls.some(call => call[0] === 'removeWindow' && call[1] === 30));
    assert(calls.some(call => call[0] === 'pipCancel'));

    state.mode = 'replaying';
    state.attached = true;
    state.tabId = 41;
    state.windowId = 40;
    state.sessionStartedAt = Date.now();
    state.sessionOptions.disableCookies = true;
    state.requests = new Map([['r2', {
        responseBodyCapture: { status: 'pending' },
        requestBodyCapture: { status: 'pending' },
    }]]);
    state.inFlight = new Set(['r2']);
    await controller.finalizeUnexpected('Debugger detached', { debuggerDetached: true });
    assert.strictEqual(state.mode, 'idle');
    assert.strictEqual(state.detachedUnexpectedly, true);
    assert.strictEqual(state.completeness.unexpectedDebuggerDetach, true);
    assert.strictEqual(state.inFlight.size, 0);
    assert(calls.some(call => call[0] === 'lifecycle' && call[1].type === 'unbind'));
    assert(calls.some(call => call[0] === 'pipFinish'
        && call[1].status === 'error'));
    assert(calls.some(call => call[0] === 'removeWindow' && call[1] === 40));

    ui.startUrl.value = 'bad';
    await controller.start();
    assert(statuses.some(call => call[0].startsWith('Введите корректный адрес') && call[1] === true));
    assert.throws(
        () => context.DashBridgeRecorderSessionController.create({ chromeRef: {} }),
        /dependencies are incomplete/,
    );
    console.log('recorder session controller behavior tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
