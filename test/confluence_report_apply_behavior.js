'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const context = { globalThis: null }; context.globalThis = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-storage.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-apply.js'), 'utf8'), context);
let uploads = 0; let saved = null; let verificationInput = null;
let saveAttempts = 0;
const apply = context.DashBridgeConfluenceReportApply.create({
    uploadAttachment: async input => { uploads += 1; return { title: input.filename, version: 2 }; },
    updatePage: async input => { saved = input; saveAttempts += 1; return { version: { number: input.page.pageIdentity.version + saveAttempts } }; },
    verifyPage: async input => { verificationInput = input; return true; },
});
apply.apply({ page: { pageIdentity: { pageId: '42', version: 3 }, storageHtml: '<ac:image><ri:attachment ri:filename="old.png" /></ac:image>', attachments: [] }, replacements: [{ oldFilename: 'old.png', newFilename: 'new.png' }, { oldFilename: 'old.png', newFilename: 'new.png' }], additions: [{ newFilename: 'add.png', caption: '<Radius>' }, { newFilename: 'add.png', caption: '<Radius>' }], sources: new Map([['new.png', { blob: new Blob(['png'], { type: 'image/png' }) }], ['add.png', { blob: new Blob(['png'], { type: 'image/png' }) }]]) }).then(() => { assert.strictEqual(uploads, 2); assert(saved.storageHtml.includes('new.png')); assert(saved.storageHtml.includes('100%')); assert(saved.storageHtml.includes('&lt;Radius&gt;')); assert.strictEqual(verificationInput.expectedVersion, 4); assert.strictEqual(verificationInput.filenames.length, 2); assert.strictEqual(verificationInput.filenames[0], 'new.png'); console.log('PASS Confluence report apply orchestration'); }).catch(error => { console.error(error); process.exitCode = 1; });
