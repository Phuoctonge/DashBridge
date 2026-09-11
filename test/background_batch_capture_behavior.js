'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, fire(value) { this.listeners.forEach(fn => fn(value)); } });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 12; i++) await tick(); }
(async () => {
    const windows = new Map([[99, { id: 99, tabs: [] }]]);
    const session = { dashbridgeBatchCaptureWindows: [99] };
    let next = 100;
    let delayedCreate = null;
    const connect = event();
    const chromeRef = {
        runtime: { id: 'ext', getURL: path => `chrome-extension://ext/${path}`, onConnect: connect },
        storage: { session: { get: async () => structuredClone(session), set: async value => Object.assign(session, structuredClone(value)) } },
        windows: {
            get: async id => { if (!windows.has(id)) throw Error('gone'); return windows.get(id); },
            create: async () => {
                if (delayedCreate) await delayedCreate;
                const win = { id: next++, tabs: [] }; windows.set(win.id, win); return win;
            },
            remove: async id => { windows.delete(id); },
        },
        scripting: { executeScript: async () => {} },
    };
    const context = vm.createContext({ console });
    vm.runInContext(fs.readFileSync('js/background-batch-capture.js', 'utf8'), context);
    await context.DashBridgeBackgroundBatchCapture.create({ chromeRef }).ready;
    assert(!windows.has(99), 'worker restart removes the previous orphan lease');
    const port = (page = 'pages/batch/batch.html') => ({ name: 'dashbridge-batch-capture',
        sender: { id: 'ext', url: chromeRef.runtime.getURL(page) },
        onMessage: event(), onDisconnect: event(), replies: [], postMessage(value) { this.replies.push(value); } });
    const untrusted = port('pages/options/options.html'); connect.fire(untrusted);
    untrusted.onMessage.fire({ id: 1, type: 'acquire' }); await settle();
    assert.equal(windows.size, 0, 'other extension pages cannot create or bind a Batch window');
    const first = port(); connect.fire(first);
    first.onMessage.fire({ id: 1, type: 'acquire' }); await settle();
    const id = first.replies[0].window.id;
    assert(windows.has(id));
    const second = port(); connect.fire(second);
    second.onMessage.fire({ id: 1, type: 'acquire', windowId: id }); await settle();
    const secondId = second.replies[0].window.id;
    assert.notEqual(id, secondId, 'client-supplied window IDs never grant ownership');
    first.onDisconnect.fire(); await settle();
    assert(!windows.has(id)); assert(windows.has(secondId), 'disconnect cannot close another session');
    second.onMessage.fire({ id: 2, type: 'release' }); await settle();
    assert.equal(windows.size, 0);
    let resolveCreate;
    delayedCreate = new Promise(resolve => { resolveCreate = resolve; });
    const pending = port(); connect.fire(pending);
    pending.onMessage.fire({ id: 1, type: 'acquire' }); await tick();
    pending.onDisconnect.fire(); resolveCreate(); await settle();
    assert.equal(windows.size, 0, 'closing the owner during async create cleans the late window');
    assert.equal(session.dashbridgeBatchCaptureWindows.length, 0);
    console.log('PASS Batch worker leases: exact sender, independent sessions, disconnect, late create and restart cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
