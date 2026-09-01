'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const runModule = (parts, additions = {}) => {
    const context = { URL, ...additions };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(read(...parts), context);
    return context;
};

const dashbridgeHtml = read('pages', 'dashbridge', 'dashbridge.html');
const recorderHtml = read('pages', 'recorder', 'recorder.html');
const batchHtml = read('pages', 'batch', 'batch.html');
const before = (source, dependency, owner) => {
    assert(source.indexOf(dependency) >= 0, `${dependency} must be loaded`);
    assert(source.indexOf(owner) > source.indexOf(dependency), `${dependency} must load before ${owner}`);
};
before(dashbridgeHtml, 'dashbridge-frame-controller.js', 'dashbridge.js');
before(dashbridgeHtml, 'dashbridge-profile-controller.js', 'dashbridge.js');
before(dashbridgeHtml, 'dashbridge-time-state.js', 'dashbridge-time-controller.js');
before(dashbridgeHtml, 'dashbridge-time-controller.js', 'dashbridge.js');
before(dashbridgeHtml, 'dashbridge-panel-tools-controller.js', 'dashbridge.js');
before(dashbridgeHtml, 'dashbridge-drag-controller.js', 'dashbridge.js');
before(dashbridgeHtml, 'dashbridge-panel-transfer.js', 'dashbridge-panel-transfer-controller.js');
before(dashbridgeHtml, 'dashbridge-panel-transfer-controller.js', 'dashbridge.js');
before(dashbridgeHtml, 'dashbridge-panel-addition-controller.js', 'dashbridge.js');
before(dashbridgeHtml, 'dashbridge-panel-card-controller.js', 'dashbridge.js');
before(dashbridgeHtml, 'dashbridge-panel-actions-controller.js', 'dashbridge.js');
before(recorderHtml, 'recorder-replay.js', 'recorder.js');
before(batchHtml, 'batch-panel-rules-ui.js', 'batch.js');
before(batchHtml, 'batch-operation-controller.js', 'batch.js');

const frameContext = runModule(['pages', 'dashbridge', 'dashbridge-frame-controller.js']);
const frameController = frameContext.DashBridgeFrameController;
const sent = [];
const iframe = {
    isConnected: true,
    src: 'https://grafana.example/d-solo/uid/name',
    dataset: { dashbridgeLoaded: 'false', dashbridgeRendered: 'true' },
    contentWindow: { postMessage: (...args) => sent.push(args) },
};
assert.strictEqual(frameController.post(iframe, { type: 'probe' }), false, 'an unready iframe must reject messages');
iframe.dataset.dashbridgeLoaded = 'true';
iframe.dataset.dashbridgeOrigin = 'https://wrong.example';
assert.strictEqual(frameController.post(iframe, { type: 'probe' }), false, 'a mismatched ready origin must reject messages');
iframe.dataset.dashbridgeOrigin = 'https://grafana.example';
assert.strictEqual(frameController.post(iframe, { type: 'probe' }), true, 'a connected ready iframe may receive a message');
assert.deepStrictEqual(JSON.parse(JSON.stringify(sent)), [[{ type: 'probe' }, 'https://grafana.example']]);
iframe.isConnected = false;
assert.strictEqual(frameController.post(iframe, { type: 'detached' }), false, 'a detached iframe must reject messages');
iframe.isConnected = true;
frameController.navigate(iframe, 'https://grafana.example/d-solo/uid/next');
assert.strictEqual(iframe.dataset.dashbridgeLoaded, 'false');
assert.strictEqual(iframe.dataset.dashbridgeRendered, 'false');
assert.strictEqual(iframe.dataset.dashbridgeOrigin, undefined, 'navigation must clear the trusted ready origin');
assert.strictEqual(iframe.src, 'https://grafana.example/d-solo/uid/next');

const replayContext = runModule(['pages', 'recorder', 'recorder-replay.js']);
const replaySteps = [
    { type: 'change', value: 'one', _dashbridge: { at: 1_000, locator: { css: '#field' } } },
    { type: 'click', _dashbridge: { at: 1_500, locator: { css: '#field' } } },
    { type: 'change', value: 'one', _dashbridge: { at: 2_000, locator: { css: '#field' } } },
    { type: 'change', value: 'two', _dashbridge: { at: 2_500, locator: { css: '#field' } } },
];
const normalizedReplay = replayContext.DashBridgeRecorderReplay.normalizeReplaySteps(replaySteps);
assert.deepStrictEqual(normalizedReplay.map(step => step.value || step.type), ['one', 'click', 'two'],
    'replay must remove only the duplicate post-click change snapshot');

const operationListeners = {};
const operationCalls = { begin: 0, finish: 0, cancel: 0, release: 0, progressFinish: 0, progressCancel: 0 };
const activeTab = { dataset: { tab: 'tab-main' } };
const operationContext = runModule(['pages', 'batch', 'batch-operation-controller.js'], {
    document: { querySelector: () => activeTab, getElementById: () => null },
    window: { addEventListener: (type, listener) => { operationListeners[type] = listener; } },
});
const button = () => ({ hidden: false, disabled: false, style: {}, addEventListener(type, listener) { this[type] = listener; } });
const mainActionArea = { hidden: false };
const startButton = button();
const startSeriesButton = button();
const cancelButton = button();
const progress = {
    openPictureInPicture: async () => undefined,
    finish: () => { operationCalls.progressFinish += 1; },
    cancel: () => { operationCalls.progressCancel += 1; },
    release: async () => undefined,
};
let activeRun = null;
const operationController = operationContext.BatchOperationController.create({
    mainActionArea, startButton, startSeriesButton, cancelButton,
    showToast: () => undefined, logMessage: () => undefined,
    lifecycle: {
        begin: () => { operationCalls.begin += 1; activeRun = operationCalls.begin; return activeRun; },
        isActive: runId => runId === activeRun,
        finish: runId => { if (runId !== activeRun) return false; operationCalls.finish += 1; activeRun = null; return true; },
        cancel: () => { operationCalls.cancel += 1; activeRun = null; },
    },
    progressFactory: { create: () => progress },
    captureWindowRunner: {
        acquire: async () => ({ id: 1 }),
        release: async () => { operationCalls.release += 1; },
    },
    loadPanel: async () => undefined,
});

const profileListeners = { storage: null, visibility: null, pagehide: null };
const tabState = new Map();
const profileContext = runModule(['pages', 'dashbridge', 'dashbridge-profile-controller.js'], {
    sessionStorage: {
        getItem: key => tabState.get(key) || null,
        setItem: (key, value) => tabState.set(key, value),
        removeItem: key => tabState.delete(key),
    },
    chrome: { storage: { onChanged: { addListener: listener => { profileListeners.storage = listener; } } } },
    document: {
        documentElement: { dataset: {} }, visibilityState: 'visible',
        addEventListener: (type, listener) => { profileListeners[type] = listener; },
        getElementById: () => ({ style: {} }),
    },
    window: { addEventListener: (type, listener) => { profileListeners[type] = listener; } },
    console,
    crypto: { randomUUID: () => 'new-profile' },
});
let profiles = [];
let activeProfileId = null;
let panels = [];
const renders = [];
const storedProfiles = [
    { id: 'one', name: 'One', panels: [{ id: 'p1', src: 'https://grafana.example/?viewPanel=1' }], timeState: {} },
    { id: 'two', name: 'Two', panels: [{ id: 'p2', src: 'https://grafana.example/?viewPanel=2' }], timeState: {} },
];
const profileController = profileContext.DashBridgeProfileController.create({
    profileStore: {
        load: async () => ({ profiles: storedProfiles, activeProfileId: 'one' }),
        save: async () => ({ current: true }), flush: async () => undefined, checkpoint: async () => undefined,
    },
    timeState: { normalize: value => value || {}, defaults: () => ({}) },
    renderer: { renderProfileList: value => renders.push(value.activeProfileId) },
    getProfilePanelIdentity: value => value,
    showAlert: async () => undefined,
    showConfirm: async () => true,
    getProfiles: () => profiles,
    setProfiles: value => { profiles = value; },
    getActiveProfileId: () => activeProfileId,
    setActiveProfileId: value => { activeProfileId = value; },
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    loadActiveProfileTimeState: () => undefined,
    syncTimeControlsFromState: () => undefined,
    renderDashboard: async () => renders.push('dashboard'),
    panelFrameSignature: panel => panel.src,
    adoptPanelState: (_previous, next) => next,
    reconcileDashboardPanelCards: () => undefined,
});

(async () => {
    const runId = await operationController.begin({ title: 'Batch', phase: 'Start' });
    assert.strictEqual(operationController.processing, true);
    assert.strictEqual(operationController.isActive(runId), true);
    assert.strictEqual(startButton.disabled, true);
    assert.strictEqual(cancelButton.hidden, false);
    assert.strictEqual(await operationController.finish(runId), true);
    assert.strictEqual(operationController.processing, false);
    assert.strictEqual(startButton.disabled, false);
    assert.strictEqual(cancelButton.hidden, true);
    const cancelledRunId = await operationController.begin({ title: 'Batch', phase: 'Cancel' });
    assert.strictEqual(operationController.isActive(cancelledRunId), true);
    assert.strictEqual(await cancelButton.click(), true);
    assert.strictEqual(operationController.processing, false);
    assert.deepStrictEqual(operationCalls, {
        begin: 2, finish: 1, cancel: 1, release: 2, progressFinish: 1, progressCancel: 1,
    }, 'finish and cancel must each release the owned capture window exactly once');
    assert(operationListeners.pagehide, 'operation controller must retain pagehide cleanup');

    await profileController.loadProfiles();
    assert.strictEqual(activeProfileId, 'one');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(panels.map(panel => panel.id))), ['p1']);
    panels.push({ id: 'local', src: 'https://grafana.example/?viewPanel=3' });
    await profileController.switchProfile('two');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(storedProfiles[0].panels.map(panel => panel.id))), ['p1', 'local'],
        'switching profiles must preserve the outgoing panel state');
    assert.strictEqual(activeProfileId, 'two');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(panels.map(panel => panel.id))), ['p2']);
    assert.strictEqual(tabState.get('dashbridge_tab_activeProfileId'), 'two');
    assert(profileListeners.storage && profileListeners.visibilitychange && profileListeners.pagehide,
        'profile controller must retain storage and lifecycle cleanup listeners');
    console.log('PASS extracted controllers retain script order, trust, replay and profile-state contracts');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
