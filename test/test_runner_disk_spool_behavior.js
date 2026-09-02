// Behavioral contract for per-test OPFS compaction and cross-test deduplication.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const reportSource = [
    'test-runner-visual-audit.js',
    'test-runner-report-analysis.js',
    'test-runner-report.js',
].map(file => fs.readFileSync(path.join(__dirname, '..', 'pages', 'test-runner', file), 'utf8')).join('\n');
const uiSource = ['test-runner-artifact-serialization.js', 'test-runner-spool.js', 'test-runner-ui.js']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'pages', 'test-runner', name), 'utf8'))
    .join('\n');
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'test-runner', 'test-runner-core.js'), 'utf8');
const classStart = uiSource.indexOf('class DiagnosticSpool');
const classEnd = uiSource.indexOf('// --- Утилиты ---', classStart);
const serializerStart = uiSource.indexOf('async function serializeJsonInChunks(');
const serializerEnd = uiSource.indexOf('async function createChunkedJsonBlob(', serializerStart);
const spoolSerializerStart = uiSource.indexOf('async function serializeSpoolArtifact(');
const spoolSerializerEnd = uiSource.indexOf('function localExportTimestamp(', spoolSerializerStart);
assert(classStart >= 0 && classEnd > classStart && serializerStart >= 0 && serializerEnd > serializerStart);
const persistHookPosition = coreSource.indexOf('const retained = await onTestFinalized(testResult, {');
const publishResultPosition = coreSource.indexOf('urlResult.tests.push(retainedTestResult);');
assert(persistHookPosition >= 0 && publishResultPosition > persistHookPosition,
    'raw diagnostics must be persisted and compacted before becoming visible through getSnapshot');
assert(!coreSource.includes('urlResult.tests.push(testResult);'),
    'the public runner state must never expose an unspooled matrix diagnostic');

class MemoryFileHandle {
    constructor() { this.blob = new Blob([]); }
    async createWritable() {
        const chunks = [];
        return {
            write: async chunk => { chunks.push(chunk); },
            close: async () => { this.blob = new Blob(chunks); },
            abort: async () => {},
        };
    }
    async getFile() { return this.blob; }
}

class MemoryDirectory {
    constructor() { this.files = new Map(); }
    async getFileHandle(name, options = {}) {
        if (!this.files.has(name)) {
            if (!options.create) throw new Error(`missing ${name}`);
            this.files.set(name, new MemoryFileHandle());
        }
        return this.files.get(name);
    }
}

const context = vm.createContext({ console, Date, Blob, TextEncoder, setTimeout, navigator: {} });
vm.runInContext(`${reportSource}\nthis.DashBridgeTestReport = DashBridgeTestReport;`, context);
vm.runInContext(`${uiSource.slice(serializerStart, serializerEnd)}\n${uiSource.slice(classStart, classEnd)}\n${uiSource.slice(spoolSerializerStart, spoolSerializerEnd)}\nthis.DiagnosticSpool = DiagnosticSpool; this.serializeSpoolArtifact = serializeSpoolArtifact;`, context);

(async () => {
    const spool = new context.DiagnosticSpool();
    spool.directory = new MemoryDirectory();
    const dataUrl = `data:image/png;base64,${'A'.repeat(4096)}`;
    const makeTest = id => ({
        id, category: 'H', name: id, pass: true, skip: false, details: 'ok', durationMs: 1,
        diagnostic: {
            before: { panelImage: { hash: 'same', dataUrl } },
            after: { panelImage: { hash: 'same', dataUrl } },
        },
    });
    const first = await spool.persistTest(makeTest('A'), 0, 0);
    const second = await spool.persistTest(makeTest('B'), 0, 1);
    assert(first.diagnosticRef && second.diagnosticRef, 'UI summaries must retain only disk references');
    assert(first.diagnosticRef.bytes > 0 && second.diagnosticRef.bytes > 0,
        'each compact reference must expose its persisted OPFS byte size');
    assert.strictEqual(first.diagnostic, undefined);
    assert.strictEqual(spool.assetsByCategory.images.size, 1,
        'identical images from multiple tests must have one physical asset');
    assert.strictEqual(spool.entries[0].testFiles.length, 2);

    const compacted = await spool.readCompactedTest(first.diagnosticRef);
    assert.strictEqual(compacted.diagnostic.before.panelImage.dataUrl, undefined,
        'automatic readers must keep image assets as compact references');
    assert(compacted.diagnostic.before.panelImage.imageRef,
        'the compact test must retain a resolvable image reference');
    const hydrated = await spool.readTest(first.diagnosticRef);
    assert.strictEqual(hydrated.diagnostic.before.panelImage.dataUrl, dataUrl,
        'diagnostic viewer must hydrate a selected test on demand');

    const chunks = [];
    await spool.streamAssets(chunk => { chunks.push(chunk); });
    const assets = JSON.parse(await new Blob(chunks).text());
    assert.strictEqual(assets.retainedImages, 1);
    assert.strictEqual(Object.keys(assets.images).length, 1);
    assert.strictEqual(assets.images[Object.keys(assets.images)[0]].dataUrl, dataUrl);

    const compactUrl = await spool.persistUrl({
        url: 'https://grafana.example/d/two-tests', planned: 2, completed: 2,
        startedAt: 1000, finishedAt: 2000, tests: [first, second],
        diagnostic: { opened: { panelImage: { hash: 'same', dataUrl } } },
    }, 0);
    const snapshot = {
        runId: 'disk-run', startedAt: 1000, finishedAt: 2000,
        total: 2, planned: 2, scheduled: 2, started: 2, completed: 2,
        passed: 2, failed: 0, skipped: 0, abortedNotRun: 0,
        results: [compactUrl],
    };
    const reportChunks = [];
    await context.serializeSpoolArtifact(snapshot, spool, { extensionVersion: 'test' },
        async chunk => { reportChunks.push(chunk); });
    const report = JSON.parse(await new Blob(reportChunks).text());
    assert.strictEqual(report.schema, 'dashbridge-e2e-diagnostics/v4');
    assert.strictEqual(report.analysis.verdict, 'passed');
    assert.strictEqual(report.aiIndex.verdict, 'passed');
    assert.strictEqual(report.assets.retainedImages, 1,
        'the complete streamed v4 artifact must keep cross-test deduplication');
    assert.strictEqual(report.results[0].tests.length, 2);
    assert(!JSON.stringify(report.results).includes(dataUrl),
        'streamed compact results must reference rather than duplicate image payloads');
    console.log('PASS test runner disk spool deduplicates and lazily hydrates evidence');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
