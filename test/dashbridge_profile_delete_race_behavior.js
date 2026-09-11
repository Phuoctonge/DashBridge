'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function run(scenario) {
  let profiles = [], active, panels = [], confirm;
  const storage = { dashbridge_profiles: [
    { id: 'a', name: 'Delete me', panels: [] }, { id: 'b', name: 'Keep me', panels: [] }
  ], dashbridge_activeProfileId: 'a' };
  if (scenario === 'switched' || scenario === 'removed') storage.dashbridge_profiles.push({ id: 'c', name: 'Third', panels: [] });
  const local = { get: async () => structuredClone(storage), set: async patch => Object.assign(storage, structuredClone(patch)) };
  const c = vm.createContext({ navigator: { locks: { request: async (_name, callback) => callback() } }, URL, structuredClone, crypto: { randomUUID: () => 'unused' }, console,
    document: { documentElement: { dataset: {} }, addEventListener() {} }, window: { addEventListener() {} },
    sessionStorage: { getItem() {}, setItem() {} }, chrome: { runtime: {}, storage: { local, onChanged: { addListener() {} } } } });
  for (const file of ['js/shared/local-state-schema.js', 'js/shared/storage-writer.js',
    'js/background-profile-storage.js', 'js/shared/dashbridge-profile-store.js', 'pages/dashbridge/dashbridge-profile-controller.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), c, { filename: file });
  }
  const broker = c.DashBridgeBackgroundProfileStorage.create({ chromeRef: c.chrome,
    localStateSchema: c.DashBridgeLocalStateSchema,
    panelIdentity: { normalizePanelId: v => v, fromUrl: v => v },
    grafanaInfrastructure: { getHosts: async () => [] }, isTrustedExtensionPage: () => true, cryptoRef: c.crypto });
  c.chrome.runtime.sendMessage = (message, callback) => broker.queueProfilePatch(message, {}).then(
    () => callback({ ok: true }), error => callback({ ok: false, error: error.message }));
  const api = c.DashBridgeProfileController.create({ profileStore: vm.runInContext('DashBridgeProfileStore', c),
    timeState: { normalize: v => v || {}, defaults: () => ({}) }, renderer: { renderProfileList() {} },
    getProfiles: () => profiles, setProfiles: v => { profiles = v; }, getActiveProfileId: () => active,
    setActiveProfileId: v => { active = v; }, getPanels: () => panels, setPanels: v => { panels = v; },
    showConfirm: () => new Promise(resolve => { confirm = resolve; }), showAlert: async () => {},
    loadActiveProfileTimeState() {}, syncTimeControlsFromState() {}, renderDashboard: async () => {},
    panelFrameSignature: () => '', adoptPanelState: (_p, p) => p, reconcileDashboardPanelCards() {}, invalidateActiveProfileRuntime() {} });
  await api.loadProfiles();
  const operation = api.deleteProfile('a');
  if (scenario === 'removed') storage.dashbridge_profiles = storage.dashbridge_profiles.filter(p => p.id !== 'a');
  if (scenario === 'last') storage.dashbridge_profiles = storage.dashbridge_profiles.filter(p => p.id === 'a');
  if (scenario === 'reload') storage.dashbridge_profiles[1].name = 'Renamed from other tab';
  await api.syncProfilesFromStorage();
  if (scenario === 'switched') { active = 'c'; panels = []; }
  confirm(true);
  await operation;
  assert.equal(profiles.some(p => p.id === 'a'), scenario === 'last');
  assert.equal(storage.dashbridge_profiles.some(p => p.id === 'a'), scenario === 'last');
  assert.equal(active, scenario === 'last' ? 'a' : scenario === 'switched' ? 'c' : 'b');
  if (scenario === 'removed') assert.equal(storage.dashbridge_profiles.length, 2, 'already deleted target must not splice the last profile');
  console.log('PASS deletion after cross-tab reload removes the current profile by ID:',
    JSON.stringify({ active, savedProfiles: storage.dashbridge_profiles.map(p => ({ id: p.id, name: p.name })) }));
}
(async () => { for (const scenario of ['reload', 'removed', 'last', 'switched']) await run(scenario); })()
  .catch(error => { console.error(error); process.exitCode = 1; });


