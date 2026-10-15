'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const context = {};
context.globalThis = context;
const revokedUrls = [];
context.URL = {
    createObjectURL: () => 'blob:archive',
    revokeObjectURL: url => revokedUrls.push(url),
};
context.chrome = { downloads: { download: async () => 7 } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'archive-budget.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'archive-download.js'), 'utf8'), context);
const budget = context.DashBridgeArchiveBudget.create(10);
assert.strictEqual(budget.reserve(6, 'a.png'), 6);
assert.throws(() => budget.reserve(5, 'b.png'), /Разделите сбор/);
assert.strictEqual(context.DashBridgeArchiveBudget.estimateBase64Bytes('AAAA'), 3);
(async () => {
    const downloadableZip = { generateAsync: async () => ({ size: 3 }) };
    assert.strictEqual(await context.downloadZipArchive(downloadableZip, 'ok.zip'), 7);
    assert.deepStrictEqual(revokedUrls, ['blob:archive'], 'successful downloads release their Blob URL');
    context.chrome.downloads.download = async () => { throw new Error('registration failed'); };
    await assert.rejects(() => context.downloadZipArchive(downloadableZip, 'failed.zip'), /registration failed/);
    assert.deepStrictEqual(revokedUrls, ['blob:archive', 'blob:archive'], 'failed downloads release their Blob URL');

    const downloads = [];
    const zipFactory = () => ({ files: [], file(name) { this.files.push(name); } });
    const download = async (zip, filename) => downloads.push({ filename, files: [...zip.files] });
    const single = context.createRollingZipArchive({ filename: 'small.zip', maxBytes: 10, zipFactory, download });
    await single.add('a.png', new Uint8Array(3), 3);
    await single.finalize();
    assert.deepStrictEqual(downloads[0], { filename: 'small.zip', files: ['a.png'] }, 'small exports keep the legacy filename');

    const split = context.createRollingZipArchive({ filename: 'large.zip', maxBytes: 5, zipFactory, download });
    await split.add('a.png', new Uint8Array(3), 3);
    await split.add('b.png', new Uint8Array(3), 3);
    await split.finalize();
    assert.deepStrictEqual(downloads.slice(1).map(item => item.filename), ['large_part-001.zip', 'large_part-002.zip']);
    assert.deepStrictEqual(downloads.slice(1).map(item => item.files), [['a.png'], ['b.png']]);
    await assert.rejects(() => context.createRollingZipArchive({ filename: 'x.zip', maxBytes: 2, zipFactory, download })
        .add('huge.png', new Uint8Array(3), 3), /превышает размер/);
    const failures = [];
    const check = async (name, action) => {
        try { await action(); console.log(`PASS ${name}`); }
        catch (error) { failures.push(error); console.error(`FAIL ${name}: ${error.message}`); }
    };
    await check('cancelled owner before generation cannot start ZIP work or download', async () => {
        let generated = 0;
        let registered = 0;
        context.chrome.downloads.download = async () => { registered++; return 8; };
        await context.downloadZipArchive({ generateAsync: async () => { generated++; return {}; } },
            'cancelled.zip', { isActive: () => false });
        assert.strictEqual(generated, 0);
        assert.strictEqual(registered, 0);
    });
    await check('cancel during generation prevents a late browser download', async () => {
        let registered = 0;
        let active = true;
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        context.chrome.downloads.download = async () => { registered++; return 8; };
        const pending = context.downloadZipArchive({ generateAsync: async () => { await gate; return {}; } },
            'cancelled.zip', { isActive: () => active });
        active = false;
        release();
        await pending;
        assert.strictEqual(registered, 0);
    });
    await check('rolling archive obeys owner cancellation on final flush', async () => {
        let active = true;
        let registered = 0;
        context.chrome.downloads.download = async () => { registered++; return 8; };
        const archive = context.createRollingZipArchive({ filename: 'cancel.zip', maxBytes: 10,
            isActive: () => active, zipFactory: () => ({ file() {}, generateAsync: async () => ({}) }) });
        await archive.add('a.png', new Uint8Array(3), 3);
        active = false;
        await archive.finalize();
        assert.strictEqual(registered, 0);
    });
    await check('rollover cancelled during generation never appends the next job or downloads', async () => {
        let active = true;
        let registered = 0;
        let release;
        let started;
        const gate = new Promise(resolve => { release = resolve; });
        const generating = new Promise(resolve => { started = resolve; });
        const appended = [];
        context.chrome.downloads.download = async () => { registered++; return 8; };
        const archive = context.createRollingZipArchive({ filename: 'cancel.zip', maxBytes: 5,
            isActive: () => active, zipFactory: () => ({ file(name) { appended.push(name); },
                generateAsync: async () => { started(); await gate; return {}; } }) });
        await archive.add('a.png', new Uint8Array(3), 3);
        const pending = archive.add('b.png', new Uint8Array(3), 3);
        await generating;
        active = false;
        release();
        await pending;
        assert.strictEqual(registered, 0);
        assert.deepStrictEqual(appended, ['a.png']);
    });
    if (failures.length) throw new Error(`${failures.length} cancellation regression(s) failed`);
    console.log('PASS archive budget rolls large collections into bounded ZIP parts and respects operation ownership');
})().catch(error => { console.error(error); process.exit(1); });
