'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function verifyFailure(stage) {
    const files = new Set(); const removed = []; let aborts = 0; let fail = true;
    const fileHandle = {
        async createWritable() {
            if (fail && stage === 'open') throw Error('fixture quota');
            return { async write() { if (fail && stage === 'write') throw Error('fixture write'); },
                async close() {}, async abort() { aborts++; } };
        },
        async getFile() { if (fail && stage === 'read') throw Error('fixture read'); return {}; },
    };
    const directory = {
        async getFileHandle(name) { files.add(name); return fileHandle; },
        async removeEntry(name) { removed.push(name); files.delete(name); },
    };
    const status = {}; const states = []; let downloads = 0;
    const context = vm.createContext({ console: { error() {} }, window: {}, Date, Intl,
        setTimeout: (callback, delay) => { if (!delay) callback(); },
        navigator: { storage: { getDirectory: async () => directory } },
        chrome: { runtime: { getManifest: () => ({ version: 'test' }) } },
        URL: { createObjectURL: () => 'blob:fixture' },
        document: { createElement: () => ({ click() { downloads++; } }) },
    });
    vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-export-controller.js', 'utf8'), context);
    const controller = context.DashBridgeTestExportController.create({
        getSnapshot: () => ({ results: [{}] }), getSpool: () => null,
        categoryLabel: String, formatDuration: String, localExportTimestamp: () => 'test', localIsoTimestamp: () => '',
        serializeSpoolArtifact: async (_snapshot, _spool, _metadata, write) => { await write('fixture'); return { characters: 7 }; },
        elStatusLine: status, onExportStateChange: value => states.push(value),
    });
    await controller.exportDiagnostics();
    assert.match(status.textContent, /Не удалось экспортировать/);
    assert.equal(downloads, 0, `${stage}: failed file must not be offered as a download`);
    assert.equal(files.size, 0, `${stage}: temporary file must be reclaimed on every failed stage`);
    assert.equal(removed.length, 1);
    assert.equal(controller.isExporting(), false);
    assert.deepEqual(states, [true, false]);
    assert.equal(aborts, stage === 'write' ? 1 : 0);
    fail = false;
    await controller.exportDiagnostics();
    assert.equal(downloads, 1, `${stage}: retry must still work`);
    assert.equal(files.size, 1, 'successful disk-backed download retains its source for the existing grace period');
    assert.equal(controller.isExporting(), false);
}
(async () => {
    for (const stage of ['open', 'write', 'read']) await verifyFailure(stage);
    console.log('PASS Runner export reclaims temporary OPFS files on open/write/read failure and permits retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
