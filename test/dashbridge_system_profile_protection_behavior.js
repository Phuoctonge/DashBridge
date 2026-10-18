'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const system = { id: 'system', name: 'DashBridge', systemKey: 'dashbridge', isSystemDefault: true,
    panels: [{ id: 'p', src: 'https://grafana.example/d-solo/u/n?panelId=1&var-project=a&var-instance=one&var-dataSource=fixed', width: '50%', height: '350px' }],
    timeState: { from: 'now-1h', to: 'now', refresh: '' }, report: { template: 'fixed' } };
const stored = { dashbridge_profiles: [system, { id: 'custom', name: 'Custom', panels: [] }], dashbridge_activeProfileId: 'system' };
const context = { URL, console, structuredClone, navigator: { locks: { request: async (_name, fn) => fn() } },
    crypto: { randomUUID: () => 'new-panel' }, chrome: { runtime: { id: 'extension', getURL: p => `chrome-extension://extension/${p}` },
        storage: { local: { get: async () => structuredClone(stored), set: async values => Object.assign(stored, structuredClone(values)) } } } };
context.globalThis = context;
vm.createContext(context);
for (const file of ['js/shared/local-state-schema.js', 'js/background-profile-storage.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
const schema = context.DashBridgeLocalStateSchema;
const broker = context.DashBridgeBackgroundProfileStorage.create({ chromeRef: context.chrome, localStateSchema: schema,
    panelIdentity: { normalizePanelId: x => x, fromUrl: x => x }, grafanaInfrastructure: { getHosts: async () => ['grafana.example'] },
    isTrustedExtensionPage: () => true, cryptoRef: context.crypto });
const commit = profile => broker.queueProfilePatch({ upserts: [profile], deleteProfileIds: [], activeProfileId: 'system',
    expectedProfiles: Object.fromEntries(schema.normalizeProfiles(stored.dashbridge_profiles, { mode: 'load' }).items.map(p => [p.id, schema.profileFingerprint(p)])) }, {});
(async () => {
    await assert.rejects(broker.queuePanelSave({ panelId: '2', profileId: 'system' },
        { id: 'extension', tab: { id: 1 }, frameId: 0, url: 'https://grafana.example/d/u/n' }), /защищ|системн/i);
    for (const mutate of [p => { p.name = 'Changed'; }, p => { delete p.systemKey; delete p.isSystemDefault; },
        p => { p.panels = []; }, p => { p.panels.push({ ...p.panels[0], id: 'extra' }); },
        p => { p.panels[0].width = '100%'; }, p => { p.panels[0].paused = true; },
        p => { p.panels[0].report = { enabled: false }; }, p => { p.report.template = 'changed'; },
        p => { p.panels[0].src += '&var-dataSource=other'; }, p => { p.panels[0].src += '&panelId=99'; },
        p => { p.timeState.extra = 'forbidden'; }]) {
        const next = structuredClone(system); mutate(next);
        await assert.rejects(commit(next), /защищ|системн/i);
        assert.deepEqual(stored.dashbridge_profiles[0], system);
    }
    await assert.rejects(broker.queueProfilePatch({ upserts: [], deleteProfileIds: ['system'], activeProfileId: 'custom',
        expectedProfiles: { system: schema.profileFingerprint(system) } }, {}), /защищ|системн/i);
    await assert.rejects(broker.queueCommit({ dashbridge_profiles: [stored.dashbridge_profiles[1]] }), /защищ|системн/i);
    const allowed = structuredClone(system);
    allowed.panels[0].tools = { removeFill: true, thickenLines: true, thickenLinesValue: 3,
        thresholdEnabled: true, thresholdValue: 80, legendFilter: ['one'] };
    allowed.timeState = { from: 'now-6h', to: 'now', refresh: '30s' };
    allowed.panels[0].src = allowed.panels[0].src.replace('var-project=a', 'var-project=b').replace('var-instance=one', 'var-instance=two&var-instance=three');
    await commit(allowed);
    assert.deepEqual(stored.dashbridge_profiles[0], allowed);
    await broker.queuePanelSave({ panelId: '2', profileId: 'custom' },
        { id: 'extension', tab: { id: 1 }, frameId: 0, url: 'https://grafana.example/d/u/n' });
    assert.equal(stored.dashbridge_profiles[1].panels.length, 1);
    console.log('PASS system profile rejects structural edits; time/project/servers/graph settings remain editable');
})().catch(error => { console.error(error); process.exitCode = 1; });
