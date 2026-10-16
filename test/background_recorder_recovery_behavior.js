'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/background.js', 'utf8');
const key = 'dashbridgeRecorderOwners';
const pageUrl = 'chrome-extension://ext/pages/recorder/recorder.html';
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, fire(value) { this.listeners.forEach(fn => fn(value)); } });
const settle = async () => { for (let n = 0; n < 25; n++) await new Promise(resolve => setImmediate(resolve)); };

// The browser APIs are the boundary. Restarting this VM discards the worker's
// closures while keeping the actual session backing store and debugger set.
function worker(session, attached, { contexts = [], storageError = false, contextError = false, detachError = false } = {}) {
    const warnings = [], detached = [], connect = event();
    const chrome = {
        runtime: { id: 'ext', getURL: path => `chrome-extension://ext/${path}`,
            getContexts: async () => { if (contextError) throw Error('contexts unavailable'); return contexts; },
            onConnect: connect, onMessage: event(), onInstalled: event(), onStartup: event() },
        storage: { session: {
            get: async () => { if (storageError) throw Error('storage unavailable'); return structuredClone(session); },
            set: async value => { if (storageError) throw Error('storage unavailable'); Object.assign(session, structuredClone(value)); },
            remove: async () => {},
        }, onChanged: event() },
        tabs: { onRemoved: event(), onUpdated: event(), onReplaced: event() },
        debugger: { detach: async ({ tabId }) => {
            if (detachError) throw Error('detach failed');
            detached.push(tabId); attached.delete(tabId);
        } },
    };
    const context = vm.createContext({ chrome, URL, console: { warn: (...args) => warnings.push(args), error: console.error },
        importScripts() {}, JSZip: function () {},
        DashBridgeBackgroundGrafanaInfrastructure: { create: () => ({}) },
        DashBridgeBackgroundProfileStorage: { create: () => ({}) },
        DashBridgeBackgroundUpdateIndicator: { create: () => ({ restore: async () => {} }) },
        DashBridgeBackgroundGuiCapture: { create: () => ({}) },
    });
    vm.runInContext(source, context);
    const port = (documentId = 'doc-1', sender = {}) => {
        const result = { name: 'dashbridge-recorder-lifecycle',
            sender: { id: 'ext', url: pageUrl, documentId, ...sender }, onMessage: event(), onDisconnect: event() };
        connect.fire(result); return result;
    };
    return { port, detached, warnings };
}

(async () => {
    const session = {}, attached = new Set([10, 11, 999]);
    let w = worker(session, attached);
    await settle();
    w.port('orphan').onMessage.fire({ type: 'bind', tabId: 10 });
    w.port('alive').onMessage.fire({ type: 'bind', tabId: 11 });
    await settle();
    w = worker(session, attached, { contexts: [{ documentId: 'alive', documentUrl: pageUrl }] });
    await settle();
    assert(!attached.has(10), 'worker restart detaches the orphan recorded by its predecessor');
    assert(attached.has(11), 'worker restart preserves an existing Recorder document');
    assert(attached.has(999), 'unregistered debugger attachments are never touched');
    assert.deepEqual(w.detached, [10]);

    // A fresh port has no closure tabId after worker restart; unbind still owns
    // the previous persisted binding through its browser-provided documentId.
    w.port('alive').onMessage.fire({ type: 'unbind' });
    await settle();
    worker(session, attached); await settle();
    assert(attached.has(11), 'unbind is not resurrected by a subsequent worker');

    for (const sender of [{ id: 'foreign' }, { url: pageUrl + '?foreign=1' }, { url: 'https://example.test/' }]) {
        const p = w.port('foreign', sender);
        p.onMessage.fire({ type: 'bind', tabId: 999 }); p.onDisconnect.fire();
    }
    await settle();
    worker(session, attached); await settle();
    assert(attached.has(999), 'foreign sender cannot persist or detach a target');

    const registry = { [key]: [{ documentId: 'unconfirmed', tabId: 12 }] };
    for (const options of [{ contextError: true }, { storageError: true }, { detachError: true }]) {
        const state = structuredClone(registry), targets = new Set([12]);
        const failed = worker(state, targets, options); await settle();
        assert(targets.has(12), 'failure must not pretend cleanup succeeded');
        assert.deepEqual(state, registry, 'failed cleanup keeps recovery ownership');
        assert(failed.warnings.length > 0, 'recovery failure must be observable');
    }
    const failedStore = worker({}, attached, { storageError: true }); await settle();
    const p = failedStore.port(); p.onMessage.fire({ type: 'bind', tabId: 999 });
    p.onDisconnect.fire(); await settle();
    assert(!attached.has(999), 'storage failure must not disable the existing disconnect fallback');

    const parallel = {}, targets = new Set([20, 21]);
    const concurrent = worker(parallel, targets); await settle();
    const a = concurrent.port('a'), b = concurrent.port('b');
    a.onMessage.fire({ type: 'bind', tabId: 20 });
    b.onMessage.fire({ type: 'bind', tabId: 21 });
    a.onMessage.fire({ type: 'unbind' });
    a.onDisconnect.fire(); await settle();
    worker(parallel, targets); await settle();
    assert(targets.has(20), 'unbind precedes disconnect and cancels its fallback');
    assert(!targets.has(21), 'concurrent registry writes do not overwrite another owner');
    console.log('PASS Recorder worker recovery: orphan, live owner, scope, unbind, failures and concurrent writes');
})().catch(error => { console.error(error); process.exitCode = 1; });
