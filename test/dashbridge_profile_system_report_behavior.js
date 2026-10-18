'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const messages = [];
const stored = { dashbridge_profiles: [{ id: 'system', name: 'DashBridge', systemKey: 'dashbridge', isSystemDefault: true, panels: [{ id: 'panel', src: 'https://grafana.example/d-solo/u/n?panelId=1' }], report: { templates: { breached: 'old' } } }], dashbridge_activeProfileId: 'system' };
const seed = structuredClone(stored.dashbridge_profiles[0]);
const context = {
    URL, console, Date, structuredClone,
    navigator: { locks: { request: async (_name, callback) => callback() } },
    crypto: { randomUUID: () => 'generated' },
    fetch: async () => ({ ok: true, json: async () => structuredClone(seed) }),
    chrome: { runtime: { lastError: null, sendMessage(message, callback) { messages.push(message); callback({ ok: true }); } }, storage: { local: {
        async get() { return stored; }, async set() {}
    } } },
    DashBridgeStorageWriter: { create: (_area, options) => ({ write(values) { return options.durableWrite(structuredClone(values), 1); }, flush() {}, checkpoint() {} }) }
};
context.globalThis = context;
vm.createContext(context);
for (const file of ['js/shared/local-state-schema.js', 'js/shared/dashbridge-profile-store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}

(async () => {
    const store = vm.runInContext('DashBridgeProfileStore', context);
    stored.dashbridge_profiles[0].panels.push({ id: 'intruder', src: 'https://other.example/d-solo/u/n?panelId=9' });
    stored.dashbridge_profiles[0].report.templates.breached = 'corrupted';
    const loaded = await store.load();
    assert.equal(loaded.profiles[0].panels.length, 1, 'reload restores the packaged panel composition');
    assert.equal(loaded.profiles[0].report.templates.breached, 'old', 'reload restores packaged report templates');
    loaded.profiles[0].report.templates.breached = 'custom {{aggregateValue}}';
    loaded.profiles[0].panels[0].src += '&var-project=new&var-instance=one&var-instance=two';
    loaded.profiles[0].panels[0].tools = { removeFill: true, thickenLinesValue: 3 };
    loaded.profiles[0].timeState = { from: 'now-6h', to: 'now', refresh: '' };
    await store.save(loaded.profiles, loaded.activeProfileId);
    assert.equal(messages[0].upserts[0].report.templates.breached, 'old');
    assert.equal(messages[0].upserts[0].timeState.from, 'now-6h');
    assert.equal(new URL(messages[0].upserts[0].panels[0].src).searchParams.get('var-project'), 'new');
    assert.deepEqual(new URL(messages[0].upserts[0].panels[0].src).searchParams.getAll('var-instance'), ['one', 'two']);
    assert.equal(messages[0].upserts[0].panels[0].tools.thickenLinesValue, 3);
    for (const corrupt of [panel => { panel.tools = { thresholdEnabled: 'true' }; },
        panel => { panel.src = 'invalid URL'; }]) {
        const damaged = structuredClone(seed);
        corrupt(damaged.panels[0]);
        stored.dashbridge_profiles = [damaged, { id: 'custom', name: 'Custom', panels: [] }];
        const repaired = await store.load();
        const system = repaired.profiles.find(profile => profile.systemKey === 'dashbridge');
        assert.ok(system, 'malformed customization cannot remove the packaged profile');
        assert.equal(system.panels[0].src, seed.panels[0].src);
        assert.equal(system.panels.length, seed.panels.length);
    }
    delete context.navigator.locks;
    await assert.rejects(store.load(), /Web Locks/, 'reconciliation must not write without a lock');
    console.log('PASS system profile freezes report templates while preserving time');
})().catch(error => { console.error(error); process.exitCode = 1; });
