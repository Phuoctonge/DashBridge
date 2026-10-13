'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { URL, console, crypto: { randomUUID: () => 'generated-id' } };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/dashbridge/dashbridge-panel-addition-controller.js', 'utf8'),
    context
);

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.style = {};
        this.dataset = {};
        this.value = '';
        this.textContent = '';
        this.disabled = false;
        this.hidden = false;
        this.children = [];
        this.listeners = {};
    }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    async emit(type, event = {}) {
        return this.listeners[type]?.({ target: this, currentTarget: this, ...event });
    }
    focus() { this.focused = true; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    querySelectorAll(selector) {
        const inputs = this.children.flatMap(item => item.children || [])
            .filter(item => item.type === 'checkbox');
        if (selector.includes(':checked')) return inputs.filter(input => input.checked);
        if (selector.includes(':not(:disabled)')) return inputs.filter(input => !input.disabled);
        return inputs;
    }
}

const ids = [
    'modalOverlay', 'newPanelUrl', 'newPanelWidth', 'addPanelBtn', 'closeModalBtn', 'savePanelBtn',
    'quickAddModalOverlay', 'quickAddDashboardUrl', 'quickAddPanelIds', 'quickAddPanelWidth',
    'quickAddPanelsBtn', 'closeQuickAddModalBtn', 'saveQuickPanelsBtn',
    'dashboardPanelPickerOverlay', 'dashboardPanelPickerUrl', 'dashboardPanelPickerStatus',
    'dashboardPanelPickerSelection', 'dashboardPanelPickerList', 'addSelectedDashboardPanelsBtn',
    'loadDashboardPanelsBtn', 'dashboardPanelPickerWidth', 'discoverDashboardPanelsBtn',
    'closeDashboardPanelPickerBtn', 'cancelDashboardPanelPickerBtn',
    'selectAllDashboardPanelsBtn', 'clearDashboardPanelsBtn',
];
const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
const documentRef = {
    getElementById: id => elements[id],
    createElement: () => new FakeElement(),
};
const panels = [];
const appended = [];
let saves = 0;
let saveResult = { current: true };
let saveHook = null;
let discoveredPanels = [];
const analytics = [];
context.DashBridgeAnalytics = { outcome: (...args) => analytics.push(args), bucket: value => String(value) };
let uuidIndex = 0;
const alerts = [];
const connections = [];
const confirmations = [];
let configured = true;
let confirmResult = true;
let connectionError = false;
let confirmHook = () => {};
const identity = url => new URL(url).searchParams.get('panelId');
const controller = context.DashBridgePanelAdditionController.create({
    normalizePanelUrl: value => `${value}?normalized=1`,
    buildSoloPanelUrl: (value, panelId) => `${value}?panelId=${panelId}`,
    getPanelIdentity: identity,
    parsePanelIds: value => value.split(',').map(item => item.trim()).filter(Boolean),
    parseDashboardUrl: value => value.includes('/d/') ? {} : null,
    fetchDashboardPanels: async () => ({ panelList: discoveredPanels }),
    normalizePanelMetadataText: value => String(value),
    showAlert: async message => { alerts.push(message); },
    showConfirm: async message => { confirmations.push(message); confirmHook(); return confirmResult; },
    configureConnection: async (url, add) => {
        connections.push({ url, add });
        if (connectionError) throw new Error('storage unavailable');
        return { configured: configured || add, host: new URL(url).host };
    },
    currentProfileHasPanel: () => false,
    getCurrentProfilePanelIdentities: () => new Set(panels.map(panel => identity(panel.src))),
    getPanels: () => panels,
    savePanels: async () => { saves += 1; return saveHook ? saveHook() : saveResult; },
    appendPanelCards: value => appended.push(...value),
    documentRef,
    randomUUID: () => `panel-${++uuidIndex}`,
});

assert(Object.isFrozen(context.DashBridgePanelAdditionController));
controller.setup();

(async () => {
    elements.newPanelUrl.value = 'https://grafana.example/d-solo/uid/name';
    elements.newPanelWidth.value = '50%';
    await elements.savePanelBtn.emit('click');
    assert.strictEqual(panels.length, 1);
    assert.strictEqual(panels[0].src.endsWith('?normalized=1'), true);
    assert.strictEqual(elements.modalOverlay.style.display, 'none');

    elements.quickAddDashboardUrl.value = 'https://grafana.example/d/uid/name';
    elements.quickAddPanelIds.value = '2, 3';
    elements.quickAddPanelWidth.value = '33%';
    await elements.saveQuickPanelsBtn.emit('click');
    assert.deepStrictEqual(panels.map(panel => panel.id), ['panel-1', 'panel-2', 'panel-3']);
    assert.strictEqual(appended.length, 3);
    assert.strictEqual(saves, 2);
    assert.deepStrictEqual(alerts, []);

    configured = false;
    confirmResult = false;
    elements.newPanelUrl.value = 'https://new.example/d-solo/uid/name';
    await elements.savePanelBtn.emit('click');
    assert.strictEqual(panels.length, 3, 'declining the connection must not add a panel');
    assert(confirmations[0].includes('new.example'));
    assert(!connections.some(item => item.add));
    confirmResult = true;
    await elements.savePanelBtn.emit('click');
    assert.strictEqual(panels.length, 4);
    assert(connections.at(-1).add, 'accepted host is registered before rendering');

    elements.newPanelUrl.value = 'https://stale.example/d-solo/uid/name';
    confirmHook = () => { elements.newPanelUrl.value = ''; };
    const writes = connections.filter(item => item.add).length;
    await elements.savePanelBtn.emit('click');
    assert.strictEqual(panels.length, 4, 'closing or changing input cancels pending addition');
    assert.strictEqual(connections.filter(item => item.add).length, writes);
    confirmHook = () => {};
    connectionError = true;
    elements.newPanelUrl.value = 'https://error.example/d-solo/uid/name';
    await elements.savePanelBtn.emit('click');
    assert.strictEqual(panels.length, 4);
    assert(alerts.at(-1).includes('storage unavailable'));
    connectionError = false;

    elements.quickAddDashboardUrl.value = 'https://quick.example/d/uid/name';
    elements.quickAddPanelIds.value = '10,11';
    confirmResult = false;
    await elements.saveQuickPanelsBtn.emit('click');
    assert.strictEqual(panels.length, 4, 'ID-list addition also requires host confirmation');
    assert(confirmations.at(-1).includes('quick.example'));

    elements.dashboardPanelPickerUrl.value = 'https://picker.example/d/uid/name';
    await elements.loadDashboardPanelsBtn.emit('click');
    assert(confirmations.at(-1).includes('picker.example'));
    assert.strictEqual(elements.loadDashboardPanelsBtn.disabled, false);

    elements.dashboardPanelPickerOverlay.style.display = 'flex';
    elements.dashboardPanelPickerUrl.value = 'https://grafana.example/d/uid/name';
    assert.strictEqual(controller.closeDashboardPickerIfOpen(), true);
    assert.strictEqual(elements.dashboardPanelPickerOverlay.style.display, 'none');
    assert.strictEqual(elements.addSelectedDashboardPanelsBtn.disabled, true, 'closed picker must reset its selection action');
    assert.strictEqual(elements.dashboardPanelPickerUrl.value, '');
    assert.strictEqual(controller.closeDashboardPickerIfOpen(), false);

    configured = true;
    confirmResult = true;
    await elements.addPanelBtn.emit('click');
    elements.newPanelUrl.value = 'https://grafana.example/d-solo/retry/single';
    saveResult = { current: false, error: 'storage unavailable' };
    const beforeFailure = panels.length;
    const eventsBeforeFailure = analytics.length;
    await elements.savePanelBtn.emit('click');
    assert.strictEqual(elements.modalOverlay.style.display, 'flex', 'failed commit must preserve the form');
    assert.strictEqual(elements.newPanelUrl.value, 'https://grafana.example/d-solo/retry/single');
    assert.strictEqual(panels.length, beforeFailure + 1, 'failed addition remains a dirty profile draft');
    assert.strictEqual(analytics.length, eventsBeforeFailure, 'failure must not publish success');
    saveResult = { current: true };
    await elements.savePanelBtn.emit('click');
    assert.strictEqual(panels.length, beforeFailure + 1, 'retry must not duplicate the draft panel');
    assert.strictEqual(elements.modalOverlay.style.display, 'none');

    await elements.quickAddPanelsBtn.emit('click');
    elements.quickAddDashboardUrl.value = 'https://grafana.example/d/retry/quick';
    elements.quickAddPanelIds.value = '60,61';
    saveResult = { current: false, error: 'storage unavailable' };
    const beforeQuickFailure = panels.length;
    await elements.saveQuickPanelsBtn.emit('click');
    assert.strictEqual(elements.quickAddModalOverlay.style.display, 'flex');
    assert.strictEqual(elements.quickAddPanelIds.value, '60,61');
    saveResult = { current: true };
    await elements.saveQuickPanelsBtn.emit('click');
    assert.strictEqual(panels.length, beforeQuickFailure + 2);
    assert.strictEqual(elements.quickAddModalOverlay.style.display, 'none');

    discoveredPanels = [{ id: '70', title: 'Retry discovery', type: 'timeseries' }];
    await elements.discoverDashboardPanelsBtn.emit('click');
    elements.dashboardPanelPickerUrl.value = 'https://grafana.example/d/retry/discovery';
    await elements.loadDashboardPanelsBtn.emit('click');
    const beforePickerFailure = panels.length;
    saveResult = { current: false, error: 'storage unavailable' };
    await elements.addSelectedDashboardPanelsBtn.emit('click');
    assert.strictEqual(elements.dashboardPanelPickerOverlay.style.display, 'flex');
    assert.strictEqual(elements.dashboardPanelPickerList.querySelectorAll('input[type="checkbox"]:checked').length, 1);
    saveResult = { current: true };
    await elements.addSelectedDashboardPanelsBtn.emit('click');
    assert.strictEqual(panels.length, beforePickerFailure + 1);
    assert.strictEqual(elements.dashboardPanelPickerOverlay.style.display, 'none');
    assert.strictEqual(elements.addSelectedDashboardPanelsBtn.disabled, true, 'successful picker reset must keep empty selection disabled');

    discoveredPanels = [{ id: '71', title: 'Selection during save', type: 'timeseries' }];
    await elements.discoverDashboardPanelsBtn.emit('click');
    elements.dashboardPanelPickerUrl.value = 'https://grafana.example/d/retry/selection';
    await elements.loadDashboardPanelsBtn.emit('click');
    let releasePickerSave;
    saveHook = () => new Promise(resolve => { releasePickerSave = resolve; });
    const pickerSave = elements.addSelectedDashboardPanelsBtn.emit('click');
    while (!releasePickerSave) await Promise.resolve();
    await elements.clearDashboardPanelsBtn.emit('click');
    releasePickerSave({ current: true });
    await pickerSave;
    assert.strictEqual(elements.addSelectedDashboardPanelsBtn.disabled, true, 'late save must respect current empty selection');
    saveHook = null;
    await elements.closeDashboardPanelPickerBtn.emit('click');

    await elements.addPanelBtn.emit('click');
    elements.newPanelUrl.value = 'https://grafana.example/d-solo/retry/slow';
    let releaseSave;
    saveHook = () => new Promise(resolve => { releaseSave = resolve; });
    const inFlight = elements.savePanelBtn.emit('click');
    while (!releaseSave) await Promise.resolve();
    const duringSave = panels.length;
    await elements.savePanelBtn.emit('click');
    assert.strictEqual(panels.length, duringSave, 'double click must not stage a second panel');
    assert.strictEqual(elements.savePanelBtn.disabled, true);
    await elements.closeModalBtn.emit('click');
    const afterCloseEvents = analytics.length;
    releaseSave({ current: true });
    await inFlight;
    assert.strictEqual(analytics.length, afterCloseEvents, 'late commit must not complete a closed form');
    assert.strictEqual(elements.savePanelBtn.disabled, false);
    saveHook = null;

    assert.throws(
        () => context.DashBridgePanelAdditionController.create({ documentRef }),
        error => error?.name === 'TypeError'
    );
    console.log('PASS DashBridge panel addition controller preserves single, ID-list and picker lifecycle');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
