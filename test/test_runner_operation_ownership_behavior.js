'use strict';
// Removing the synchronous Run/export ownership guards must make these fail.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness() {
    const storage = [], spools = [], runs = [], errors = [];
    let running = false;
    const c = vm.createContext({ console: { ...console, error: (...args) => errors.push(args) }, URL, Date, Intl, Blob, TextEncoder, setTimeout, clearTimeout,
        navigator: { userAgent: 'fixture', platform: 'fixture' }, document: { addEventListener() {} }, window: {},
        chrome: { runtime: { getManifest: () => ({ version: 'fixture' }) }, storage: { local: {
            set() { const pending = deferred(); storage.push(pending); return pending.promise; },
        } } },
        DiagnosticSpool: class {
            constructor() { this.id = spools.length; this.clears = 0; this.writes = []; spools.push(this); }
            async begin() { if (this.failure) throw Error('OPFS failure'); }
            async clear() { this.clears++; }
            async persistTest(test) { this.writes.push(test); return test; }
            async persistUrl(value) { return value; }
        },
        DashBridgeTestRunner: {
            getSnapshot: () => ({ running }), abort() { running = false; },
            async run(urls, hooks) {
                if (running) throw Error('already running');
                running = true;
                const pending = deferred(); runs.push({ hooks, pending });
                await pending.promise; running = false;
            },
        },
    });
    vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-ui.js', 'utf8'), c);
    vm.runInContext(`elUrlInput={value:'https://grafana.example/d/test'};elRunMode={value:'fast'};
        elRunBtn={disabled:false,querySelector:()=>null};elClearBtn={disabled:false};elAbortBtn={disabled:true};elSelectionSummary={};
        elStatusLine={};openOperationProgressWindow=()=>Promise.resolve();updateOperationProgressWindow=()=>{};
        finishOperationProgressWindow=()=>{};stopOperationProgressTimer=()=>{};`, c);
    return { c, storage, spools, runs, errors, eval: code => vm.runInContext(code, c) };
}
async function startup() {
    const h = harness();
    const first = h.eval('handleRun()');
    const duplicate = h.eval('handleRun()');
    assert.equal(h.storage.length, 1, 'double click must not start a second storage/PiP/spool operation');
    await duplicate;
    assert.equal(h.eval('elRunBtn.disabled'), true);
    h.eval('updateSelectionSummary(); handleClear()');
    assert.equal(h.eval('elRunBtn.disabled'), true, 'selection reload cannot unlock startup');
    h.storage[0].resolve(); await tick();
    assert.equal(h.runs.length, 1);
    await h.runs[0].hooks.onTestFinalized({ id: 'A1' }, { urlIndex: 0, testIndex: 0, url: 'a' });
    assert.equal(h.spools[0].writes[0].id, 'A1');
    h.eval('handleClear()');
    assert.equal(h.spools[0].clears, 0, 'Clear cannot destroy a running diagnostic source');
    h.runs[0].pending.resolve(); await first;
    const second = h.eval('handleRun()'); h.storage[1].resolve(); await tick();
    assert.equal(h.spools[0].clears, 1, 'next run releases the previous completed spool');
    h.runs[1].pending.resolve(); await second;
    assert.equal(h.eval('elRunBtn.disabled'), false);
}
async function cancelStartup() {
    const h = harness(); const run = h.eval('handleRun()');
    h.eval('handleAbort()'); h.storage[0].resolve(); await run;
    assert.equal(h.runs.length, 0, 'startup cancel cannot open a Grafana run after storage settles');
    assert.equal(h.eval('elRunBtn.disabled'), false);
    assert(h.spools.every(s => s.clears > 0), 'cancelled startup leaves no spool lease');
    const old = harness();
    old.eval('diagnosticSpool=new DiagnosticSpool();lastSnapshot={results:[{}]}');
    const pending = old.eval('handleRun()'); old.eval('handleAbort()');
    old.storage[0].resolve(); await pending;
    assert.equal(old.spools[0].clears, 0, 'cancel before startup preserves previous results');
    assert.equal(old.eval('diagnosticSpool.id'), 0);
}
async function failedStartup() {
    const h = harness();
    h.c.DiagnosticSpool.prototype.begin = async () => { throw Error('OPFS failure'); };
    const run = h.eval('handleRun()');h.storage[0].resolve();await run;
    assert.equal(h.eval('elRunBtn.disabled'), false);
    assert.equal(h.spools[0].clears, 1, 'failed begin releases partial OPFS resources');
    assert.equal(h.eval('diagnosticSpool'), null);
}
async function pagehideDuringStartup() {
    const h = harness();
    const source = fs.readFileSync('pages/test-runner/test-runner-ui.js', 'utf8');
    h.c.window.addEventListener = (name, listener) => { if (name === 'pagehide') h.hide = listener; };
    h.eval(source.match(/window.addEventListener\('pagehide',[\s\S]*?}, \{ once: true \}\);/)[0]);
    h.eval('diagnosticSpool=new DiagnosticSpool();lastSnapshot={results:[{}]}');
    const pending = h.eval('handleRun()'); h.hide(); h.storage[0].resolve(); await pending;
    assert.equal(h.spools[0].clears, 1, 'pagehide during startup releases previous completed spool');
    assert.equal(h.runs.length, 0);
}
async function exportOwnership({ cancel = false, fail = false } = {}) {
    const h = harness(), started = deferred(), release = deferred();
    let serializations = 0;
    vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-export-controller.js', 'utf8'), h.c);
    h.c.window.showSaveFilePicker = async () => {
        if (cancel) { const error = Error('cancel'); error.name = 'AbortError'; throw error; }
        return { createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) };
    };
    h.c.serializeFixture = async (snapshot, spool) => {
        serializations++; started.resolve(); await release.promise;
        assert.equal(spool.clears, 0, 'Clear cannot delete the source during streaming');
        if (fail) throw Error('disk full');
        return { characters: 1 };
    };
    h.eval(`diagnosticSpool=new DiagnosticSpool();lastSnapshot={results:[{}]};
        exportController=DashBridgeTestExportController.create({getSnapshot:()=>lastSnapshot,getSpool:()=>diagnosticSpool,
        categoryLabel:String,formatDuration:String,serializeSpoolArtifact:serializeFixture,
        localExportTimestamp:()=>'',localIsoTimestamp:()=>'',elStatusLine,
        onExportStateChange:()=>setButtonState(false)});`);
    const exporting = h.eval('exportController.exportDiagnostics()');
    if (!cancel) {
        await started.promise;
        h.eval('handleClear();updateSelectionSummary()');
        const refusedRun = h.eval('handleRun()');
        assert.equal(h.storage.length, 0, 'Run cannot replace source during export');
        await refusedRun;
        assert.equal(h.eval('elClearBtn.disabled'), true);
        assert.equal(h.eval('elRunBtn.disabled'), true);
        await h.eval('exportController.exportDiagnostics()');
        assert.equal(serializations, 1, 'only one export owns the diagnostic source');
        release.resolve();
    }
    await exporting;
    assert.equal(h.errors.length, fail ? 1 : 0);
    assert.equal(h.eval('elClearBtn.disabled'), false, 'success/error/cancel releases controls');
    h.eval('handleClear()'); assert.equal(h.spools[0].clears, 1);
}
const watchdog = setTimeout(() => { console.error('Unsettled Test Runner regression'); process.exit(1); }, 5000);
(async () => {
    if (process.argv.includes('--export-only')) { await exportOwnership(); return; }
    await startup(); await cancelStartup(); await failedStartup(); await pagehideDuringStartup();
    await exportOwnership(); await exportOwnership({ cancel: true }); await exportOwnership({ fail: true });
    console.log('PASS Test Runner startup and export retain exclusive diagnostic ownership');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
