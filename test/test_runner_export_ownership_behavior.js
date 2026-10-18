'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
    let now = Date.now(); const activeLocks = new Set(); const timers = [];
    const files = new Map(); const removed = [];
    const prefix = 'dashbridge-e2e-export-';
    const old = `${prefix}${now - 2_000_000}-old.json`;
    const recent = `${prefix}${now - 10}-recent.json`;
    const busy = `${prefix}${now - 2_000_000}-busy.json`;
    const longWrite = `${prefix}${now - 4_000_000}-long.json`;
    for (const name of [old, recent, busy]) files.set(name, { lastModified: Number(name.split('-')[3]) || 0 });
    files.set(longWrite, { lastModified: now });
    files.set('unrelated.json', { lastModified: 0 });
    activeLocks.add(`dashbridge-export:${busy}`);
    const locks = { async request(name, options, callback) {
        if (activeLocks.has(name)) return callback(null);
        activeLocks.add(name);
        try { return await callback({ name }); } finally { activeLocks.delete(name); }
    } };
    const base = { async *entries() {}, async removeEntry() {} };
    const directory = {
        async *entries() { for (const name of files.keys()) yield [name, { kind: 'file' }]; },
        async getDirectoryHandle() { return base; },
        async getFileHandle(name, options) {
            if (options?.create) files.set(name, { lastModified: now });
            return { async getFile() { return files.get(name); }, async createWritable() { return { async write() {}, async close() {}, async abort() {} }; } };
        },
        async removeEntry(name) { files.delete(name); removed.push(name); },
    };
    class Clock extends Date { static now() { return now; } }
    const context = vm.createContext({ console, Date: Clock, Intl, window: {},
        navigator: { locks, storage: { getDirectory: async () => directory } },
        setTimeout: (callback, delay) => { if (!delay) callback(); else timers.push(callback); },
        chrome: { runtime: { getManifest: () => ({}) } },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        document: { createElement: () => ({ click() {} }) },
    });
    vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-spool.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-export-controller.js', 'utf8'), context);
    await vm.runInContext('DiagnosticSpool.clearStaleSessions()', context);
    assert.equal(files.has(old), false, 'startup reclaims abandoned export after grace');
    for (const name of [recent, busy, longWrite, 'unrelated.json']) assert(files.has(name), `${name} must survive cleanup`);
    const controller = context.DashBridgeTestExportController.create({
        getSnapshot: () => ({ results: [{}] }), getSpool: () => null, categoryLabel: String, formatDuration: String,
        localExportTimestamp: () => '', localIsoTimestamp: () => '',
        serializeSpoolArtifact: async () => {
            const writing = [...activeLocks].find(name => name.startsWith('dashbridge-export:') && name !== `dashbridge-export:${busy}`);
            assert(writing, 'temporary file acquires its lease before writing');
            now += 2_000_000;
            await vm.runInContext('DiagnosticSpool.clearStaleSessions()', context);
            assert(files.has(writing.slice('dashbridge-export:'.length)), 'active export survives another-tab cleanup');
            return { characters: 1 };
        },
    });
    await controller.exportDiagnostics();
    const live = [...files.keys()].find(name => activeLocks.has(`dashbridge-export:${name}`) && name !== busy);
    assert(live, 'successful fallback holds lease through download grace');
    await vm.runInContext('DiagnosticSpool.clearStaleSessions()', context);
    assert(files.has(live), 'lease protects delayed download from another tab');
    await timers.at(-1)();
    await new Promise(resolve => setImmediate(resolve));
    assert(!files.has(live)); assert(!activeLocks.has(`dashbridge-export:${live}`));
    activeLocks.delete(`dashbridge-export:${busy}`);
    await vm.runInContext('DiagnosticSpool.clearStaleSessions()', context);
    assert(!files.has(busy), 'closed document lease releases orphan to next cleanup');
    console.log('PASS Runner root export cleanup preserves recent files, active writers/downloads, unrelated data and reclaims expired orphans');
})().catch(error => { console.error(error); process.exitCode = 1; });
