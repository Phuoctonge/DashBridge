'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'js', 'background.js'), 'utf8');
const commitStart = background.indexOf('async function commitDashBridgeProfilePatch');
const commitEnd = background.indexOf('function normalizeSavedGrafanaPanelUrl', commitStart);
assert(commitStart >= 0 && commitEnd > commitStart, 'profile patch broker must remain testable');

const stored = {
    dashbridge_profiles: [
        { id: 'profile-a', name: 'A', panels: [] },
        { id: 'profile-b', name: 'B', panels: [] }
    ],
    dashbridge_activeProfileId: 'profile-a'
};
const context = {
    URL, console,
    crypto: { randomUUID: () => 'generated-profile' },
    chrome: { storage: { local: {
        async get() { return structuredClone(stored); },
        async set(values) { Object.assign(stored, structuredClone(values)); }
    } } },
    isTrustedExtensionPage: () => true,
    storageCommitQueue: Promise.resolve()
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'local-state-schema.js'), 'utf8'), context);
vm.runInContext(`${background.slice(commitStart, commitEnd)}
globalThis.commitProfilePatchForTest = commitDashBridgeProfilePatch;`, context);

(async () => {
    const commit = context.commitProfilePatchForTest;
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
    console.log('PASS profile patches preserve concurrent changes from separate DashBridge tabs');
})().catch(error => { console.error(error); process.exit(1); });
