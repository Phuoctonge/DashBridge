'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
    const document = { documentElement: { dataset: {} }, addEventListener() {} };
    const outcomes = [], alerts = [];
    let fail = true, loads = 0;
    const context = vm.createContext({ console: { error() {} }, document,
        sessionStorage: { getItem() {}, setItem() {} }, window: { addEventListener() {} },
        chrome: { storage: { onChanged: { addListener() {} } } }, crypto: { randomUUID: () => 'new' },
        DashBridgeAnalytics: { outcome: (...args) => outcomes.push(args) } });
    vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-profile-controller.js', 'utf8'), context);
    let profiles = [{ id: 'a', name: 'A', panels: [] }], active = 'a', panels = [];
    const controller = context.DashBridgeProfileController.create({
        profileStore: {
            load: async () => { loads++; return { profiles, activeProfileId: active }; },
            save: async () => { if (fail) throw Error('QUOTA_BYTES exceeded'); return { current: true }; },
            flush: async () => {},
        },
        timeState: { normalize: x => x, defaults: () => ({}) }, renderer: { renderProfileList() {} },
        getProfiles: () => profiles, setProfiles: x => { profiles = x; },
        getActiveProfileId: () => active, setActiveProfileId: x => { active = x; },
        getPanels: () => panels, setPanels: x => { panels = x; }, invalidateActiveProfileRuntime() {},
        showAlert: value => { alerts.push(value); }, renderDashboard: async () => {},
        syncTimeControlsFromState() {}, loadActiveProfileTimeState() {},
    });
    await controller.loadProfiles();
    await controller.createProfile('Unsaved draft');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /QUOTA/);
    assert.equal(outcomes.length, 0, 'failed creation must not report success');
    await controller.syncProfilesFromStorage();
    assert.equal(loads, 1, 'external storage sync cannot discard failed local draft');
    assert.equal(controller.getActiveProfile().name, 'Unsaved draft');
    fail = false;
    assert.equal((await controller.savePanels()).current, true);
    assert.equal(document.documentElement.dataset.dashbridgeStorageDirty, 'false');
    console.log('PASS profile save errors are visible, preserve drafts across sync and allow retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
