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
async function verifyTargetedApply() {
    const block = '<ac:image><ri:attachment ri:filename="old.png" /></ac:image>';
    const storageHtml = block.repeat(3);
    let targetedUploads = 0; let savedHtml = null;
    const targeted = context.DashBridgeConfluenceReportApply.create({
        uploadAttachment: async () => { targetedUploads += 1; return {}; },
        updatePage: async input => { savedHtml = input.storageHtml; return { version: { number: 4 } }; },
        verifyPage: async input => {
            assert.strictEqual(input.replacements.length, 2);
            assert.strictEqual(input.expectedStorageHtml, savedHtml);
            assert(context.DashBridgeConfluenceReportStorage.verifyPlan(savedHtml, { expectedStorageHtml: input.expectedStorageHtml }));
            const wrongTarget = savedHtml.replace('ri:filename="old.png"', 'ri:filename="new.png"');
            assert.strictEqual(context.DashBridgeConfluenceReportStorage.verifyPlan(wrongTarget, { expectedStorageHtml: input.expectedStorageHtml }), false);
            return true;
        },
    });
    const replacement = sourceOffset => ({ oldFilename: 'old.png', newFilename: 'new.png', sourceOffset });
    await targeted.apply({ page: { pageIdentity: { pageId: '42', version: 3 }, storageHtml, attachments: [] }, replacements: [replacement(0), replacement(block.length), replacement(0)], sources: new Map([['new.png', { blob: new Blob(['png'], { type: 'image/png' }) }]]) });
    assert.strictEqual(targetedUploads, 1);
    assert.deepStrictEqual([...savedHtml.matchAll(/ri:filename="([^"]+)"/g)].map(match => match[1]), ['new.png', 'new.png', 'old.png']);
    let invalidUploads = 0; let invalidSaves = 0;
    const invalid = context.DashBridgeConfluenceReportApply.create({ uploadAttachment: async () => { invalidUploads += 1; return {}; }, updatePage: async () => { invalidSaves += 1; return { version: { number: 4 } }; }, verifyPage: async () => true });
    await assert.rejects(invalid.apply({ page: { pageIdentity: { pageId: '42', version: 3 }, storageHtml, attachments: [] }, replacements: [replacement(1)], sources: new Map([['new.png', { blob: new Blob(['png'], { type: 'image/png' }) }]]) }), /Replacement target/);
    assert.strictEqual(invalidUploads, 0);
    assert.strictEqual(invalidSaves, 0);
    const failingVerification = context.DashBridgeConfluenceReportApply.create({ uploadAttachment: async () => ({}), updatePage: async () => ({ version: { number: 4 } }), verifyPage: async () => false });
    await assert.rejects(failingVerification.apply({ page: { pageIdentity: { pageId: '42', version: 3 }, storageHtml, attachments: [] }, replacements: [replacement(0)], sources: new Map([['new.png', { blob: new Blob(['png'], { type: 'image/png' }) }]]) }), /post-save verification failed/);
    console.log('PASS Confluence report targeted apply and post-save verification');
}
verifyTargetedApply().catch(error => { console.error(error); process.exitCode = 1; });

async function verifyCancellation() {
    for (const stage of ['before-start', 'upload', 'save', 'verify']) {
        const controller = new AbortController(); const calls = []; const uploaded = new Map();
        const stop = () => controller.abort();
        const runner = context.DashBridgeConfluenceReportApply.create({
            uploadAttachment: async () => { calls.push('upload'); if (stage === 'upload') stop(); return {}; },
            updatePage: async () => { calls.push('save'); if (stage === 'save') stop(); return { version: 4 }; },
            verifyPage: async () => { calls.push('verify'); if (stage === 'verify') stop(); return true; },
        });
        if (stage === 'before-start') stop();
        await assert.rejects(runner.apply({ page: { pageIdentity: { pageId: '42', version: 3 }, storageHtml: '<h3>T1</h3>' },
            additions: [{ newFilename: 'a.png', caption: 'A' }, { newFilename: 'b.png', caption: 'B' }],
            sources: new Map(['a.png', 'b.png'].map(name => [name, { blob: new Blob(['png']) }])),
            signal: controller.signal, uploaded }), error => error.name === 'AbortError');
        assert.deepStrictEqual(calls, stage === 'before-start' ? [] : stage === 'upload' ? ['upload']
            : stage === 'save' ? ['upload', 'upload', 'save'] : ['upload', 'upload', 'save', 'verify']);
        if (stage === 'upload') assert.strictEqual(uploaded.size, 0, 'late upload must not populate a reusable cache');
    }
    console.log('PASS Confluence cancellation prevents later upload/save/verify and false success');
}
verifyCancellation().catch(error => { console.error(error); process.exitCode = 1; });
