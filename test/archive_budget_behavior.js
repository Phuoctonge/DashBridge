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
    console.log('PASS archive budget rolls large collections into bounded ZIP parts');
})().catch(error => { console.error(error); process.exit(1); });
