'use strict';
// Regressions: missing startup ownership allows duplicate windows, cross-mode
// resets, or a cancelled pending startup to attach/navigate after Stop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ pause = 'pip', rejectAttach = false } = {}) {
    const gate = deferred(), calls = [], statuses = [];
    const state = {
        mode: 'idle', attached: false, tabId: null, windowId: null, importing: false,
        steps: [{ type: 'navigate', url: 'https://site.example/' }], requests: new Map(), baselineRequests: new Map(),
        pendingBodyCaptures: new Set(), pendingRequestBodyCaptures: new Set(), inFlight: new Set(),
        completeness: { requestBodiesFailed: 0 }, sessionOptions: { disableCookies: true }, lastNetworkAt: 0,
    };
    const ui = { startUrl: { value: 'https://site.example/' }, disableCache: { checked: true }, disableCookies: { checked: true },
        save: {}, file: { value: 'selected' } };
    const chrome = {
        tabs: { update: async (id, options) => calls.push(['navigate', id, options.url]),
            get: async () => ({ status: 'complete' }), onUpdated: { addListener() {}, removeListener() {} } },
        windows: { remove: async id => calls.push(['remove', id]) },
        runtime: { getManifest: () => ({ version: '2.4.3' }) }, downloads: { download: async () => {} },
    };
    const context = { URL, chrome, console, Date, Intl, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval };
    context.globalThis = context; vm.createContext(context);
    for (const name of ['session-controller', 'replay', 'dashflow-controller']) {
        vm.runInContext(fs.readFileSync(`pages/recorder/recorder-${name}.js`, 'utf8'), context);
    }
    const progress = { openPictureInPicture: async () => { calls.push(['pip']); if (pause === 'pip') await gate.promise; },
        cancel() {}, update() {}, finish() {} };
    const transport = {
        ensureDebuggerPermission: async () => {}, buildWindowLayout: () => null,
        createControlledTab: async () => { calls.push(['create']); if (pause === 'create') await gate.promise; state.windowId = 20; return 21; },
        attachNetwork: async id => { state.tabId = id; state.attached = true; calls.push(['attach', id]);
            if (pause === 'attach') await gate.promise; if (rejectAttach) throw new Error('fixture attach failure'); },
        detachNetwork: async () => { calls.push(['detach', state.tabId]); state.attached = false; }, postLifecycle() {},
    };
    const resetSession = () => { calls.push(['reset']); state.stopRequested = false; state.requests = new Map(); };
    const controls = () => calls.push(['controls', Boolean(state.starting || state.importing || ['recording', 'replaying'].includes(state.mode))]);
    const session = context.DashBridgeRecorderSessionController.create({ state, ui, schema: { normalizeHttpUrl: value => value },
        transport, networkCapture: { setResponseBodyStatus() {} }, delay: async () => {}, resetSession,
        addNavigateStep() {}, saveSettings: async () => {}, setStatus: message => statuses.push(message), updateControls: controls,
        updateRecordingProgress() {}, scheduleRender() {}, getProgressController: () => progress, chromeRef: chrome });
    const replay = context.DashBridgeRecorderReplay.create({ state, ui, delay: async () => {}, networkIdleMs: 0, networkIdleTimeoutMs: 1,
        ensureDebuggerPermission: transport.ensureDebuggerPermission, stopActiveSession: session.stop, resetSession,
        buildRecorderWindowLayout: transport.buildWindowLayout, createControlledTab: transport.createControlledTab,
        attachNetwork: transport.attachNetwork, buildComparison: () => calls.push(['compare']), scheduleRender() {},
        setStatus: message => statuses.push(message), updateControls: controls, stepLabel: () => '', getOperationProgressController: () => progress });
    const importer = context.DashBridgeRecorderDashflowController.create({ state, ui, schema: {},
        io: { write: async () => {}, read: async () => { calls.push(['import']); throw new Error('fixture import'); } },
        exporter: { buildNetwork() {}, buildHar() {} }, zipConstructor() {}, sha256: async () => '', bodyBytes() {},
        stopSession: session.stop, resetSession, saveSettings: async () => {}, setStatus() {}, updateControls: controls, scheduleRender() {},
        limits: Object.fromEntries(['maxRequests','maxRequestBodyBytes','maxTotalRequestBodyBytes','maxBodyBytes','maxTotalBodyBytes',
            'maxStreamEvents','maxStreamPayloadBytes','maxPageEvents','maxWorkingSetBytes'].map(key => [key, 1000])),
        chromeRef: chrome, navigatorRef: {}, urlRef: { createObjectURL() {}, revokeObjectURL() {} } });
    return { state, calls, statuses, gate, session, replay, importer };
}

test('Replay claims startup before PiP and excludes Replay, Record and Import', async () => {
    const f = fixture(); const first = f.replay.start();
    await tick();
    const second = f.replay.start(), record = f.session.start(), load = f.importer.load({});
    await tick(); f.gate.resolve(); await Promise.all([first, second, record, load]);
    assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'import').length, 0);
    assert.equal(f.calls[0][0], 'controls');
    assert.equal(f.calls[0][1], true);
    assert.equal(f.state.starting, false);
});
test('Record startup and pending import exclude Replay', async () => {
    const f = fixture(); const record = f.session.start(); await tick();
    const replay = f.replay.start(); await tick(); f.gate.resolve(); await Promise.all([record, replay]);
    assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
    await f.session.stop(); f.calls.length = 0; f.state.importing = true;
    await f.replay.start(); assert.equal(f.calls.length, 0);
});
for (const pause of ['pip', 'create', 'attach']) test(`Stop cancels Replay waiting for ${pause} and releases any attached tab`, async () => {
    const f = fixture({ pause }); const run = f.replay.start(); await tick();
    await f.session.stop(); f.gate.resolve(); await run;
    assert.equal(f.calls.filter(call => call[0] === 'navigate').length, 0);
    assert.equal(f.calls.filter(call => call[0] === 'compare').length, 0);
    assert.equal(f.state.mode, 'idle'); assert.equal(f.state.attached, false); assert.equal(f.state.starting, false);
    if (pause !== 'pip') assert(f.calls.some(call => call[0] === 'remove' && call[1] === 20));
});
test('Replay failure releases startup so a later Replay can run', async () => {
    const f = fixture({ pause: null, rejectAttach: true }); await f.replay.start(); await f.replay.start();
    assert.equal(f.calls.filter(call => call[0] === 'create').length, 2);
    assert.equal(f.calls.filter(call => call[0] === 'remove').length, 2);
    assert.equal(f.state.attached, false); assert.equal(f.state.starting, false);
});
test('Cancelling before Replay starts preserves imported baseline without manufacturing a comparison', async () => {
    const f = fixture();
    const original = new Map([['baseline', { url: 'https://site.example/' }]]);
    f.state.requests = original; f.state.baselineRequests = new Map(original);
    const run = f.replay.start(); await tick(); await f.session.stop(); f.gate.resolve(); await run;
    assert.equal(f.calls.filter(call => call[0] === 'compare').length, 0);
    assert.equal(f.state.requests, original);
    assert.equal(f.calls.filter(call => call[0] === 'reset').length, 0);
});
