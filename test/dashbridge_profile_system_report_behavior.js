'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const messages = [];
const stored = { dashbridge_profiles: [{ id: 'system', name: 'DashBridge', systemKey: 'dashbridge', isSystemDefault: true, panels: [{ id: 'panel', src: 'https://grafana.example/d-solo/u/n?panelId=1' }], report: { templates: { breached: 'old' } } }], dashbridge_activeProfileId: 'system' };
const context = {
    URL, console, Date, structuredClone,
    crypto: { randomUUID: () => 'generated' },
    fetch: async () => ({ ok: true, json: async () => ({ panels: [] }) }),
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
    const loaded = await store.load();
    loaded.profiles[0].report.templates.breached = 'custom {{aggregateValue}}';
    await store.save(loaded.profiles, loaded.activeProfileId);
    assert.equal(messages[0].upserts[0].report.templates.breached, 'custom {{aggregateValue}}');
    console.log('PASS system profile preserves user-owned report templates');
})().catch(error => { console.error(error); process.exitCode = 1; });
