'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync('pages/dashbridge/dashbridge-panel-transfer-controller.js', 'utf8'), context);

const elements = new Map();
const makeElement = id => ({
    id, value: '', files: [], listeners: {}, clicked: false,
    addEventListener(type, listener) { this.listeners[type] = listener; },
    click() { this.clicked = true; this.listeners.click?.({ target: this, currentTarget: this }); }
});
['exportPanelsBtn', 'importPanelsBtn', 'importPanelsInput'].forEach(id => elements.set(id, makeElement(id)));
const anchors = [];
const documentRef = {
    body: {
        appendChild(node) { anchors.push(node); },
        removeChild(node) { node.removed = true; }
    },
    getElementById: id => elements.get(id),
    createElement(tag) {
        assert.strictEqual(tag, 'a');
        return { clicked: false, click() { this.clicked = true; } };
    }
};

let panels = [];
const profiles = [{ id: 'current', name: 'Current', panels: [] }];
let activeProfile = profiles[0];
let confirmChoice = true;
let nextText = '';
let readComplete = Promise.resolve();
let savePanelsCount = 0;
let saveProfilesCount = 0;
let renderCount = 0;
let switcherCount = 0;
let loadTimeCount = 0;
let syncTimeCount = 0;
let selectedProfileId = null;
const alerts = [];
const revoked = [];
const transfer = {
    INVALID_PANELS_CODE: 'INVALID_PANELS',
    createPanelExportPayload: ({ profile, panels: value, exportedAt }) => ({ profile: profile.name, panels: value, exportedAt }),
    buildPanelExportFileName: name => `${name}.json`,
    parsePanelImportText(text, { fallbackProfileName, randomUUID }) {
        if (text === 'invalid') {
            const error = new Error('Некорректный JSON');
            error.code = 'INVALID_PANELS';
            throw error;
        }
        if (text === 'empty') return { profileName: fallbackProfileName, panels: [], warnings: [] };
        return {
            profileName: text === 'create' ? 'Imported' : 'Replacement',
            timeState: { from: 'now-2h', to: 'now', refresh: '' },
            report: { template: 'report' },
            panels: [{ id: randomUUID(), src: 'https://grafana.example/d-solo/x/y?panelId=1' }],
            warnings: [], hasTimeState: true, hasReport: true
        };
    }
};
const controller = context.DashBridgePanelTransferController.create({
    transfer,
    showAlert: async message => { alerts.push(message); },
    showConfirm: async () => confirmChoice,
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    getProfiles: () => profiles,
    getActiveProfile: () => activeProfile,
    setTabActiveProfileId: id => { selectedProfileId = id; activeProfile = profiles.find(profile => profile.id === id) || activeProfile; },
    savePanels: () => { savePanelsCount += 1; activeProfile.panels = panels; },
    saveProfiles: async () => { saveProfilesCount += 1; },
    loadActiveProfileTimeState: () => { loadTimeCount += 1; },
    syncTimeControlsFromState: () => { syncTimeCount += 1; },
    renderProfileSwitcher: () => { switcherCount += 1; },
    renderDashboard: () => { renderCount += 1; },
    documentRef,
    fileReaderFactory: () => ({
        onload: null,
        readAsText() { readComplete = Promise.resolve(this.onload({ target: { result: nextText } })); }
    }),
    blobFactory: parts => ({ text: parts[0] }),
    urlApi: {
        createObjectURL: () => 'blob:dashbridge-export',
        revokeObjectURL: url => revoked.push(url)
    },
    randomUUID: (() => { let id = 0; return () => `uuid-${++id}`; })(),
    now: () => new Date('2026-09-01T10:00:00.000Z')
});

(async () => {
    controller.setup();
    assert(elements.get('exportPanelsBtn').listeners.click);
    elements.get('importPanelsBtn').click();
    assert.strictEqual(elements.get('importPanelsInput').clicked, true);

    await controller.exportPanels();
    assert.strictEqual(alerts.pop(), 'Нет панелей для экспорта.');

    panels = [{ id: 'existing', src: 'https://grafana.example/d-solo/x/y?panelId=2' }];
    activeProfile.panels = panels;
    await controller.exportPanels();
    assert.strictEqual(anchors.at(-1).download, 'Current.json');
    assert.strictEqual(anchors.at(-1).clicked, true);
    assert.strictEqual(anchors.at(-1).removed, true);
    assert.strictEqual(revoked.at(-1), 'blob:dashbridge-export');

    nextText = 'replace';
    confirmChoice = true;
    await controller.importPanels({ name: 'replace.json' });
    await readComplete;
    assert.strictEqual(panels[0].id, 'uuid-1');
    assert.strictEqual(activeProfile.timeState.from, 'now-2h');
    assert.strictEqual(activeProfile.report.template, 'report');
    assert.strictEqual(savePanelsCount, 1);
    assert.strictEqual(renderCount, 1);

    const previousPanels = panels;
    nextText = 'create';
    confirmChoice = false;
    await controller.importPanels({ name: 'create.json' });
    await readComplete;
    assert.strictEqual(profiles.length, 2);
    assert.strictEqual(profiles[0].panels, previousPanels);
    assert.strictEqual(selectedProfileId, 'uuid-3');
    assert.strictEqual(activeProfile.name, 'Imported');
    assert.strictEqual(saveProfilesCount, 1);
    assert.strictEqual(switcherCount, 1);

    nextText = 'empty';
    await controller.importPanels({ name: 'empty.json' });
    await readComplete;
    assert.strictEqual(alerts.pop(), 'В файле нет панелей с корректными настройками и URL.');

    nextText = 'invalid';
    await controller.importPanels({ name: 'invalid.json' });
    await readComplete;
    assert.strictEqual(alerts.pop(), 'Некорректный JSON');
    assert(loadTimeCount >= 2 && syncTimeCount >= 2, 'profile time controls must follow replace and create flows');
    console.log('PASS DashBridge panel transfer controller preserves export and profile import lifecycle');
})().catch(error => { console.error(error); process.exitCode = 1; });
