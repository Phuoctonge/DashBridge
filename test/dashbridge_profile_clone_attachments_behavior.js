'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
    let sequence = 0, saved;
    const source = { id: 'original', name: 'Original', report: { panelOrder: ['b', 'a'], attachments: {
        selectedIds: ['a'], forcedIds: ['b', 'deleted'], panelOrder: ['b', 'a'], slaOnly: true, layout: 'auto'
    } }, panels: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] };
    let profiles = [source], active = source.id, panels = source.panels;
    const context = vm.createContext({ structuredClone, console,
        document: { documentElement: { dataset: {} }, addEventListener() {} }, sessionStorage: { setItem() {} },
        chrome: { storage: { onChanged: { addListener() {} } } }, window: { addEventListener() {} },
        crypto: { randomUUID: () => `clone-${++sequence}` } });
    vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-profile-controller.js', 'utf8'), context);
    const controller = context.DashBridgeProfileController.create({
        profileStore: { load: async () => ({}), save: async value => { saved = structuredClone(value); return { current: true }; } },
        timeState: { normalize: value => value }, renderer: { renderProfileList() {} },
        getProfiles: () => profiles, setProfiles: value => { profiles = value; },
        getActiveProfileId: () => active, setActiveProfileId: value => { active = value; },
        getPanels: () => panels, setPanels: value => { panels = value; }, invalidateActiveProfileRuntime() {},
        loadActiveProfileTimeState() {}, syncTimeControlsFromState() {}, renderDashboard: async () => {},
        showAlert: message => { throw Error(message); }
    });
    await controller.cloneProfile('Copy');
    assert.equal(active, 'clone-1');
    assert.deepEqual(saved[1].report.attachments.forcedIds, ['clone-3']);
    assert.deepEqual(saved[1].report.attachments.selectedIds, ['clone-2']);
    assert.deepEqual(saved[1].report.attachments.panelOrder, ['clone-3', 'clone-2']);
    assert.deepEqual(source.report.attachments.forcedIds, ['b', 'deleted']);
    panels[0].title = 'Changed copy';
    assert.equal(source.panels[0].title, 'A');
    console.log('PASS profile cloning remaps attachment IDs, drops deleted references and isolates the original');
})().catch(error => { console.error(error); process.exitCode = 1; });
