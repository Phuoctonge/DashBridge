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
let uuidIndex = 0;
const alerts = [];
const identity = url => new URL(url).searchParams.get('panelId');
const controller = context.DashBridgePanelAdditionController.create({
    normalizePanelUrl: value => `${value}?normalized=1`,
    buildSoloPanelUrl: (value, panelId) => `${value}?panelId=${panelId}`,
    getPanelIdentity: identity,
    parsePanelIds: value => value.split(',').map(item => item.trim()).filter(Boolean),
    parseDashboardUrl: value => value.includes('/d/') ? {} : null,
    fetchDashboardPanels: async () => ({ panelList: [] }),
    normalizePanelMetadataText: value => String(value),
    showAlert: async message => { alerts.push(message); },
    currentProfileHasPanel: () => false,
    getCurrentProfilePanelIdentities: () => new Set(panels.map(panel => identity(panel.src))),
    getPanels: () => panels,
    savePanels: async () => { saves += 1; },
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

    elements.dashboardPanelPickerOverlay.style.display = 'flex';
    elements.dashboardPanelPickerUrl.value = 'https://grafana.example/d/uid/name';
    assert.strictEqual(controller.closeDashboardPickerIfOpen(), true);
    assert.strictEqual(elements.dashboardPanelPickerOverlay.style.display, 'none');
    assert.strictEqual(elements.dashboardPanelPickerUrl.value, '');
    assert.strictEqual(controller.closeDashboardPickerIfOpen(), false);

    assert.throws(
        () => context.DashBridgePanelAdditionController.create({ documentRef }),
        error => error?.name === 'TypeError'
    );
    console.log('PASS DashBridge panel addition controller preserves single, ID-list and picker lifecycle');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
