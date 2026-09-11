'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createHarness() {
    const storage = { dashbridge_profiles: [{ id: 'a', name: 'Original', panels: [], timeState: {} }], dashbridge_activeProfileId: 'a' };
    let pendingRead = null, failWrite = false, profiles = [], active = null, panels = [];
    const alerts = [];
    const local = {
        get: async () => structuredClone(storage),
        set: async values => {
            if (failWrite) { failWrite = false; throw new Error('QUOTA_BYTES exceeded'); }
            Object.assign(storage, structuredClone(values));
        },
    };
    const context = vm.createContext({ navigator: { locks: { request: async (_name, callback) => callback() } },
        URL, structuredClone, crypto: { randomUUID: () => 'new-profile' },
        console: { error() {}, warn() {} },
        document: { documentElement: { dataset: {} }, addEventListener() {} },
        window: { addEventListener() {} }, sessionStorage: { getItem() {}, setItem() {} },
        chrome: { runtime: {}, storage: {
            onChanged: { addListener() {} },
            local: {
                ...local,
                get: async () => pendingRead ? pendingRead.promise : structuredClone(storage),
            },
        } },
    });
    for (const file of ['js/shared/local-state-schema.js', 'js/shared/storage-writer.js',
        'js/background-profile-storage.js', 'js/shared/dashbridge-profile-store.js',
        'pages/dashbridge/dashbridge-profile-controller.js']) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    }
    const broker = context.DashBridgeBackgroundProfileStorage.create({
        chromeRef: { runtime: {}, storage: { local } },
        localStateSchema: context.DashBridgeLocalStateSchema,
        panelIdentity: { normalizePanelId: value => value, fromUrl: value => value },
        grafanaInfrastructure: { getHosts: async () => [] },
        isTrustedExtensionPage: () => true, cryptoRef: context.crypto,
    });
    context.chrome.runtime.sendMessage = (message, callback) => {
        broker.queueProfilePatch(message, {}).then(() => callback({ ok: true }),
            error => callback({ ok: false, error: error.message }));
    };
    const controller = context.DashBridgeProfileController.create({
        profileStore: vm.runInContext('DashBridgeProfileStore', context),
        timeState: { normalize: value => value, defaults: () => ({}) }, renderer: { renderProfileList() {} },
        getProfiles: () => profiles, setProfiles: value => { profiles = value; },
        getActiveProfileId: () => active, setActiveProfileId: value => { active = value; },
        getPanels: () => panels, setPanels: value => { panels = value; },
        invalidateActiveProfileRuntime() {}, showAlert: text => alerts.push(text),
        renderDashboard: async () => {}, syncTimeControlsFromState() {}, loadActiveProfileTimeState() {},
        panelFrameSignature: () => '', adoptPanelState: (_old, current) => current, reconcileDashboardPanelCards() {},
    });
    return {
        controller, storage, alerts,
        failNextWrite() { failWrite = true; },
        async beginRead() {
            const snapshot = structuredClone(storage);
            let resolve;
            pendingRead = { promise: new Promise(done => { resolve = done; }) };
            const operation = controller.syncProfilesFromStorage();
            await new Promise(done => setImmediate(done));
            return async () => { pendingRead = null; resolve(snapshot); await operation; };
        },
    };
}

(async () => {
    const failures = [];
    async function scenario(name, run) {
        try { await run(); console.log('PASS ' + name); }
        catch (error) { failures.push(error); console.error('FAIL ' + name + ': ' + error.message); }
    }
    await scenario('pending reload preserves a quota-failed draft', async () => {
        const h = createHarness(); await h.controller.loadProfiles();
        const finishRead = await h.beginRead();
        h.controller.getActiveProfile().name = 'Local draft'; h.failNextWrite();
        assert.match((await h.controller.saveProfiles()).error, /QUOTA_BYTES/);
        await finishRead();
        assert.equal(h.controller.getActiveProfile().name, 'Local draft');
        assert.equal(h.alerts.length, 1);
        assert.equal((await h.controller.saveProfiles()).error, undefined, 'retry after transient failure succeeds');
        assert.equal(h.storage.dashbridge_profiles[0].name, 'Local draft');
    });
    await scenario('pending old read cannot roll back a successful commit or its CAS baseline', async () => {
        const h = createHarness(); await h.controller.loadProfiles();
        const finishRead = await h.beginRead();
        h.controller.getActiveProfile().name = 'First edit'; await h.controller.saveProfiles();
        await finishRead();
        assert.equal(h.controller.getActiveProfile().name, 'First edit');
        h.controller.getActiveProfile().name = 'Second edit';
        assert.equal((await h.controller.saveProfiles()).error, undefined);
        assert.equal(h.storage.dashbridge_profiles[0].name, 'Second edit');
    });
    await scenario('rejected remote snapshot cannot advance CAS and authorize overwrite on retry', async () => {
        const h = createHarness(); await h.controller.loadProfiles();
        h.storage.dashbridge_profiles[0].name = 'Remote edit';
        const finishRead = await h.beginRead();
        h.controller.getActiveProfile().name = 'Conflicting draft';
        assert.match((await h.controller.saveProfiles()).error, /другой вкладке/);
        await finishRead();
        assert.equal(h.controller.getActiveProfile().name, 'Conflicting draft');
        assert.match((await h.controller.saveProfiles()).error, /другой вкладке/);
        assert.equal(h.storage.dashbridge_profiles[0].name, 'Remote edit');
    });
    await scenario('accepted remote state advances baseline and remains editable', async () => {
        const h = createHarness(); await h.controller.loadProfiles();
        h.storage.dashbridge_profiles[0].name = 'Remote edit';
        await h.controller.syncProfilesFromStorage();
        assert.equal(h.controller.getActiveProfile().name, 'Remote edit');
        h.controller.getActiveProfile().name = 'Edit after reload';
        assert.equal((await h.controller.saveProfiles()).error, undefined);
        assert.equal(h.storage.dashbridge_profiles[0].name, 'Edit after reload');
    });
    assert.equal(failures.length, 0, `${failures.length} profile reload scenarios failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });

