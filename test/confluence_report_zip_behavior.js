'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const context = { globalThis: null }; context.globalThis = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-zip.js'), 'utf8'), context);
const api = context.DashBridgeConfluenceReportZip;
const fakeZip = { loadAsync: async () => ({ files: {
    'manifest.json': { dir: false, async: async () => JSON.stringify({ schemaVersion: 2, captures: [{ file: 'disk.png', testKey: 'test-01', metric: 'disk' }] }) },
    'disk.png': { dir: false, async: async type => type === 'blob' ? new Blob(['png'], { type: 'image/png' }) : new Uint8Array([1, 2]) },
} }) };
api.create({ JSZip: fakeZip, schema: { normalizeManifest: raw => raw } }).load({ name: 'batch.zip', size: 20 }, new AbortController().signal).then(snapshot => {
    assert.strictEqual(snapshot.manifest.captures[0].file, 'disk.png'); assert(snapshot.sources.has('disk.png')); console.log('PASS report ZIP import');
}).catch(error => { console.error(error); process.exitCode = 1; });
