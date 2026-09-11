'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const stored = {
    dashbridge_profiles: [
        { id: 'profile-a', name: 'A', panels: [] },
        { id: 'profile-b', name: 'B', panels: [] }
    ],
    dashbridge_activeProfileId: 'profile-a'
};
const context = { navigator: { locks: { request: async (_name, callback) => callback() } },
    URL, console,
    crypto: { randomUUID: () => 'generated-profile' },
    chrome: {
        runtime: { id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path || ''}` },
        storage: { local: {
            async get() { return structuredClone(stored); },
            async set(values) {
                // Chromium storage can return nested object keys in sorted order.
                const reordered = JSON.parse(JSON.stringify(values, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
                    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
                Object.assign(stored, reordered);
            }
        } }
    },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'local-state-schema.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'background-profile-storage.js'), 'utf8'), context);
context.profileStorage = context.DashBridgeBackgroundProfileStorage.create({
    chromeRef: context.chrome,
    localStateSchema: context.DashBridgeLocalStateSchema,
    panelIdentity: { normalizePanelId: value => value, fromUrl: value => value },
    grafanaInfrastructure: { getHosts: async () => [] },
    isTrustedExtensionPage: () => true,
    cryptoRef: context.crypto,
});

(async () => {
    const expected = () => Object.fromEntries(context.DashBridgeLocalStateSchema.normalizeProfiles(
        stored.dashbridge_profiles, { mode: 'load' }).items.map(profile => [profile.id, JSON.stringify(profile)]));
    const commit = (message, sender) => context.profileStorage.queueProfilePatch({ expectedProfiles: expected(), ...message }, sender);
    const sender = {};
    await commit({
        upserts: [{ id: 'profile-a', name: 'A from tab 1', panels: [] }],
        deleteProfileIds: [], activeProfileId: 'profile-a'
    }, sender);
    await commit({
        upserts: [{ id: 'profile-b', name: 'B from tab 2', panels: [] }],
        deleteProfileIds: [], activeProfileId: 'profile-b'
    }, sender);
    assert.deepStrictEqual(stored.dashbridge_profiles.map(profile => profile.name),
        ['A from tab 1', 'B from tab 2'],
        'two stale tabs editing different profiles must not overwrite each other');

    await commit({ upserts: [], deleteProfileIds: ['profile-a'], activeProfileId: 'profile-b' }, sender);
    await commit({
        upserts: [{ id: 'profile-b', name: 'B after deletion', panels: [] }],
        deleteProfileIds: [], activeProfileId: 'profile-b'
    }, sender);
    assert.deepStrictEqual(stored.dashbridge_profiles.map(profile => profile.id), ['profile-b'],
        'a stale save of another profile must not resurrect a deleted profile');
    assert.strictEqual(stored.dashbridge_profiles[0].name, 'B after deletion');
    const baseline = expected();
    await commit({ upserts: [{ ...stored.dashbridge_profiles[0], name: 'new name' }], deleteProfileIds: [], activeProfileId: 'profile-b' }, sender);
    await assert.rejects(commit({ expectedProfiles: baseline,
        upserts: [{ id: 'profile-b', name: 'B after deletion', panels: [], report: { template: 'stale' } }],
        deleteProfileIds: [], activeProfileId: 'profile-b' }, sender), /другой вкладке/);
    assert.strictEqual(stored.dashbridge_profiles[0].name, 'new name');
    await assert.rejects(commit({ expectedProfiles: baseline, upserts: [], deleteProfileIds: ['profile-b'], activeProfileId: 'profile-b' }, sender), /другой вкладке/);
    console.log('PASS profile patches preserve concurrent changes and reject stale same-profile edits');
})().catch(error => { console.error(error); process.exit(1); });
