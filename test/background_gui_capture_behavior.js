const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let messageListener;
const chrome = {
    tabs: {
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {}, removeListener() {} },
        captureVisibleTab: async () => 'data:image/png;base64,AA==',
        query: async () => [],
    },
    scripting: {
        getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
        unregisterContentScripts: async () => {}, executeScript: async options => {
            chrome.__lastScriptInjection = options; return [];
        },
    },
    windows: { create: async () => ({}), update: async () => {}, remove: async () => {} },
    downloads: { download: async () => 1 },
    storage: {
        sync: { get: async () => ({ grafanaIframeDomains: ['grafana.test', 'strict.test:8443'] }), onChanged: { addListener() {} } },
        session: { remove: async () => {} },
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        onChanged: { addListener() {} }
    },
    declarativeNetRequest: {
        getDynamicRules: async () => [], updateDynamicRules: async () => {},
        getSessionRules: async () => [], updateSessionRules: async () => {},
    },
    runtime: {
        id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path || ''}`,
        getManifest: () => ({ version: '2.4.2' }),
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(listener) { messageListener = listener; } }
    },
    action: {
        setIcon: async () => {}, setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {}, setTitle: async () => {},
    },
};
const context = {
    chrome, importScripts() {}, console, setTimeout, clearTimeout, URL, Date, Uint8Array,
    crypto: { randomUUID: () => 'generated-id' },
    fetch: async () => ({ blob: async () => ({ size: 1 }) }),
    DashBridgeGrafanaRuntimeManifest: { files: [], matchesForHostname: () => [] },
    DashBridgeDnrRules: { planSessionRules: () => ({
        rules: [], desiredRuleCount: 0, omittedRuleCount: 0, truncated: false, maxRules: 4000,
    }) },
    DashBridgeLocalStateSchema: { normalizeProfiles: items => ({
        items, skippedProfiles: 0, skippedPanels: 0,
    }) },
    DashBridgeGrafanaPanelIdentity: { normalizePanelId: value => value, fromUrl: value => value },
    JSZip: function JSZip() {},
    getGrafanaSettingsDefaults: () => ({ grafanaIframeDomains: [] }),
    normalizeHttpHost: value => String(value).toLowerCase(),
    parseHttpUrl: value => { try { return new URL(`https://${value}`); } catch { return null; } },
    btoa: value => Buffer.from(value, 'binary').toString('base64')
};
vm.runInNewContext(fs.readFileSync('js/background-grafana-infrastructure.js', 'utf8'), context,
    { filename: 'background-grafana-infrastructure.js' });
vm.runInNewContext(fs.readFileSync('js/background-profile-storage.js', 'utf8'), context,
    { filename: 'background-profile-storage.js' });
vm.runInNewContext(fs.readFileSync('js/background-gui-capture.js', 'utf8'), context, { filename: 'background-gui-capture.js' });
vm.runInNewContext(fs.readFileSync('js/background-update-indicator.js', 'utf8'), context,
    { filename: 'background-update-indicator.js' });
vm.runInNewContext(fs.readFileSync('js/background.js', 'utf8'), context, { filename: 'background.js' });

const guiCaptureController = vm.runInContext('guiCaptureController', context);
const waitForGuiCaptureReady = guiCaptureController.waitForReady;
const reserveGuiCaptureBytes = context.DashBridgeBackgroundGuiCapture.reserveBytes;
const assertGuiCaptureArchiveSize = context.DashBridgeBackgroundGuiCapture.assertArchiveSize;
const isTrustedExtensionPage = vm.runInContext('isTrustedExtensionPage', context);
const isTrustedGrafanaContentSender = vm.runInContext(
    'sender => grafanaInfrastructure.isTrustedContentSender(sender)', context
);
assert.strictEqual(typeof waitForGuiCaptureReady, 'function', 'background must expose a tab-scoped GUI-ready waiter');
assert.strictEqual(reserveGuiCaptureBytes(5, 4, 10), 9);
assert.throws(() => reserveGuiCaptureBytes(5, 6, 10), /безопасный лимит/);
assert.throws(() => assertGuiCaptureArchiveSize({ size: 11 }, 10), /ZIP GUI/);
assert.strictEqual(isTrustedExtensionPage({ id: 'extension-id', url: 'chrome-extension://extension-id/pages/popup/popup.html' }, 'pages/popup/popup.html'), true);
assert.strictEqual(isTrustedExtensionPage({ id: 'extension-id', url: 'https://example.test/pages/popup/popup.html' }, 'pages/popup/popup.html'), false);

const grafanaSender = (url, frameId = 0) => ({
    id: 'extension-id', frameId, url, tab: { id: 7, windowId: 3 }
});

(async () => {
    assert.strictEqual(await isTrustedGrafanaContentSender(grafanaSender('https://grafana.test/d/uid/name')), true);
    assert.strictEqual(await isTrustedGrafanaContentSender(grafanaSender('https://grafana.test/base/d-solo/uid/name')), true);
    assert.strictEqual(await isTrustedGrafanaContentSender(grafanaSender('https://grafana.test/public/page')), false,
        'configured hosts must not authorize non-dashboard routes');
    assert.strictEqual(await isTrustedGrafanaContentSender(grafanaSender('https://other.test/d/uid/name')), false);
    assert.strictEqual(await isTrustedGrafanaContentSender(grafanaSender('https://strict.test:8443/d/uid/name')), true);
    assert.strictEqual(await isTrustedGrafanaContentSender(grafanaSender('https://strict.test:9443/d/uid/name')), false,
        'an explicitly configured port must remain exact');
    assert.strictEqual(await isTrustedGrafanaContentSender(grafanaSender('https://grafana.test/d/uid/name', 1)), false,
        'privileged capture messages must come from the top-level content script');
    const ready = waitForGuiCaptureReady(42, 100);
    messageListener({ type: 'dashbridge-gui-capture-ready' }, { tab: { id: 42 } }, () => {});
    assert.strictEqual(await ready, true, 'matching tab render event must resolve the waiter');
    const captureResult = await new Promise(resolve => messageListener(
        { type: 'dashbridge-capture-visible-tab' },
        { ...grafanaSender('https://grafana.test/d/uid/name'), documentId: 'document-7' }, resolve
    ));
    assert.strictEqual(captureResult.ok, true);
    assert.strictEqual(JSON.stringify(chrome.__lastScriptInjection.target),
        JSON.stringify({ tabId: 7, documentIds: ['document-7'] }),
        'capture must restore the isolated image dependency in the requesting document');
    assert.strictEqual(JSON.stringify(chrome.__lastScriptInjection.files),
        JSON.stringify(['js/shared/grafana-capture-output.js']));
    console.log('PASS background GUI capture waiter resolves for the emitting tab');
})().catch(error => { console.error(error); process.exitCode = 1; });

const contentSource = fs.readFileSync('js/content/content.js', 'utf8');
assert(contentSource.includes('let grafanaMenuScopeAllowed = false')
    && contentSource.includes('grafanaMenuScopeAllowed = allowed')
    && contentSource.includes('!grafanaMenuScopeAllowed || !hasActiveUserGesture()'),
    'isolated Grafana authority must remain in closure state and require an active user gesture');
assert(!contentSource.includes("document.documentElement.dataset.dashbridgeGrafanaMenuEnabled !== 'true'"),
    'page-controlled datasets must not authorize isolated-world Chrome API bridges');
assert(contentSource.includes("typeof captureOutput?.crop !== 'function'"),
    'the isolated bridge must fail explicitly if the repaired capture dependency is still unavailable');
