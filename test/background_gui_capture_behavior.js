const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let messageListener;
const chrome = {
    tabs: { onRemoved: { addListener() {} } },
    storage: {
        sync: { get: async () => ({}), onChanged: { addListener() {} } },
        session: { remove: async () => {} },
        local: { set: async () => {} },
        onChanged: { addListener() {} }
    },
    declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
    runtime: {
        id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path || ''}`,
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(listener) { messageListener = listener; } }
    }
};
const context = {
    chrome, importScripts() {}, console, setTimeout, clearTimeout, URL, Date, Uint8Array,
    DashBridgeGrafanaRuntimeManifest: { files: [], matchesForHostname: () => [] },
    btoa: value => Buffer.from(value, 'binary').toString('base64')
};
vm.runInNewContext(fs.readFileSync('js/background.js', 'utf8'), context, { filename: 'background.js' });

const waitForGuiCaptureReady = vm.runInContext('waitForGuiCaptureReady', context);
const reserveGuiCaptureBytes = vm.runInContext('reserveGuiCaptureBytes', context);
const assertGuiCaptureArchiveSize = vm.runInContext('assertGuiCaptureArchiveSize', context);
const isTrustedExtensionPage = vm.runInContext('isTrustedExtensionPage', context);
assert.strictEqual(typeof waitForGuiCaptureReady, 'function', 'background must expose a tab-scoped GUI-ready waiter');
assert.strictEqual(reserveGuiCaptureBytes(5, 4, 10), 9);
assert.throws(() => reserveGuiCaptureBytes(5, 6, 10), /безопасный лимит/);
assert.throws(() => assertGuiCaptureArchiveSize({ size: 11 }, 10), /ZIP GUI/);
assert.strictEqual(isTrustedExtensionPage({ id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' }, 'popup.html'), true);
assert.strictEqual(isTrustedExtensionPage({ id: 'extension-id', url: 'https://example.test/popup.html' }, 'popup.html'), false);

(async () => {
    const ready = waitForGuiCaptureReady(42, 100);
    messageListener({ type: 'dashbridge-gui-capture-ready' }, { tab: { id: 42 } }, () => {});
    assert.strictEqual(await ready, true, 'matching tab render event must resolve the waiter');
    console.log('PASS background GUI capture waiter resolves for the emitting tab');
})().catch(error => { console.error(error); process.exitCode = 1; });
