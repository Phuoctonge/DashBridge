'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const persisted = [];
const backups = [];
const stored = {
    dashbridge_profiles: [
        {
            id: 'legacy-profile-1', name: 'Legacy', futureProfileField: 'keep', panels: [{
                id: 'legacy-panel-1', src: 'https://grafana.example/d-solo/u/n?panelId=1',
                width: '50%', height: '350px', futurePanelField: 'keep',
                tools: { futureToolField: 'keep', thresholdIncludeHidden: true }
            }]
        },
        { id: '"><svg>', name: 'Broken', panels: [] }
    ],
    dashbridge_activeProfileId: 'legacy-profile-1'
};
const context = {
    URL, console, Date,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    chrome: { storage: { local: {
        async get() { return stored; },
        async set(values) { backups.push(values); }
    } } },
    DashBridgeStorageWriter: { createLocal: () => ({
        async write(values) { persisted.push(values); return { current: true }; },
        async flush() {}, async checkpoint() {}
    }) }
};
context.globalThis = context;
vm.createContext(context);
for (const file of ['js/shared/local-state-schema.js', 'js/shared/dashbridge-profile-store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}

(async () => {
    const store = vm.runInContext('DashBridgeProfileStore', context);
    const loaded = await store.load();
    assert.strictEqual(loaded.profiles.length, 1);
    assert.strictEqual(loaded.profiles[0].id, 'legacy-profile-1');
    assert.strictEqual(loaded.profiles[0].futureProfileField, 'keep');
    assert.strictEqual(loaded.profiles[0].panels[0].futurePanelField, 'keep');
    assert.strictEqual(loaded.profiles[0].panels[0].tools.futureToolField, 'keep');
    assert.strictEqual(loaded.profiles[0].panels[0].tools.thresholdIncludeHidden, true, 'retired keys remain inert instead of triggering a storage migration');
    assert.strictEqual(backups.length, 1, 'rejected legacy state must be backed up once');
    await store.save(loaded.profiles, loaded.activeProfileId);
    assert.strictEqual(persisted[0].dashbridge_profiles, loaded.profiles, 'ordinary save must not deep-normalize all profiles');
    console.log('PASS profile store preserves legacy fields and backs up rejected state');
})().catch(error => { console.error(error); process.exit(1); });
