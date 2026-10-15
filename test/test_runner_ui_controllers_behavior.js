'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-export-controller.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-diagnostic-viewer.js', 'utf8'), context);

const snapshot = {
    planned: 2,
    started: 2,
    completed: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    abortedNotRun: 0,
    results: [{
        url: 'https://grafana.example/d/test',
        engine: 'uPlot',
        grafanaVersion: '12.2.1',
        tests: [
            { id: 'A1', category: 'A', name: 'Успех', pass: true, details: 'ok', durationMs: 10 },
            { id: 'A2', category: 'A', name: 'Ошибка', pass: false, details: 'failed', durationMs: 20 },
        ],
    }],
};
const exportController = context.DashBridgeTestExportController.create({
    getSnapshot: () => snapshot,
    getSpool: () => null,
    categoryLabel: value => value,
    formatDuration: value => `${value}ms`,
    serializeSpoolArtifact: async () => ({ characters: 0 }),
    localExportTimestamp: () => 'timestamp',
    localIsoTimestamp: () => 'iso',
});
assert(Object.isFrozen(exportController));
assert(exportController.buildTextReport(snapshot).includes('[A2]') === false,
    'full report must retain the existing table format');
assert(exportController.buildTextReport(snapshot).includes('Ошибка'));
assert(exportController.buildFailureReport(snapshot).includes('[A2] Ошибка'));
assert(!exportController.buildFailureReport(snapshot).includes('[A1] Успех'));

const viewer = context.DashBridgeTestDiagnosticViewer.create({
    report: { buildVisualAudit: () => ({ transitions: [], issues: [], complete: true }) },
    createChunkedJsonBlob: async () => ({}),
    copyTextToClipboard: async () => undefined,
    setStatus: () => undefined,
    esc: value => String(value),
    formatDuration: value => `${value}ms`,
});
assert(Object.isFrozen(viewer));
assert.equal(typeof viewer.showDiagnostic, 'function');
assert.equal(typeof viewer.showTestDescription, 'function');

(async () => {
    for (const mode of ['native', 'fallback', 'refused', 'throws', 'stale']) {
        let appended = 0;
        let removed = 0;
        let fallbackCalls = 0;
        const labels = [];
        const button = { set textContent(value) { labels.push(value); }, get textContent() { return 'Копировать'; } };
        const status = { textContent: '', className: '' };
        context.setTimeout = callback => callback();
        context.navigator = { clipboard: { async writeText() {
            if (mode === 'stale') status.textContent = `New operation ${fallbackCalls}`;
            if (mode !== 'native') throw new Error('denied');
        } } };
        context.document = {
            createElement: () => ({ style: {}, select() {} }),
            body: { appendChild() { appended++; }, removeChild() { removed++; } },
            execCommand() {
                fallbackCalls++;
                if (mode === 'throws') throw new Error('fallback denied');
                return mode === 'fallback';
            },
        };
        const controller = context.DashBridgeTestExportController.create({
            getSnapshot: () => snapshot, getSpool: () => null,
            elCopyBtn: button, elCopyFailBtn: button, elStatusLine: status,
            categoryLabel: value => value, formatDuration: String,
            serializeSpoolArtifact: async () => ({}), localExportTimestamp: () => '', localIsoTimestamp: () => '',
        });
        for (const [index, copy] of [controller.copyReport, controller.copyFailureReport,
            () => controller.copyTextToClipboard('diagnostic notice', null)].entries()) {
            labels.length = 0;
            await copy();
            const failed = mode === 'refused' || mode === 'throws' || mode === 'stale';
            assert.equal(labels.some(label => label.includes('Скопировано')), !failed && index < 2,
                `${mode}: unsuccessful clipboard must not show copied`);
            if (mode === 'stale') {
                assert.match(status.textContent, /^New operation/, 'delayed failure must preserve newer progress');
            } else if (failed) {
                assert.match(status.textContent, /Не удалось скопировать/);
                assert.match(status.className, /tr-status-fail/);
            }
            assert.equal(removed, appended, 'fallback textarea must be removed after success or error');
        }
        assert.equal(fallbackCalls, mode === 'native' ? 0 : 3);
    }
    for (const [copied, newerStatus] of [[false, false], [true, false], [true, true]]) {
        const statuses = [];
        const status = { textContent: 'Completed', className: 'tr-status' };
        context.document.getElementById = () => status;
        let finishCopy;
        context.window = { open: () => null };
        const blockedViewer = context.DashBridgeTestDiagnosticViewer.create({
            report: { buildVisualAudit: () => ({}) }, createChunkedJsonBlob: async () => ({}),
            copyTextToClipboard: () => new Promise(resolve => { finishCopy = resolve; }),
            setStatus: (...args) => statuses.push(args), esc: String, formatDuration: String,
        });
        blockedViewer.showDiagnostic(snapshot.results[0].tests[0], snapshot.results[0]);
        assert.equal(statuses.length, 0, 'blocked viewer must await confirmed clipboard completion');
        if (newerStatus) status.textContent = 'A new operation is running';
        finishCopy(copied);
        await Promise.resolve();
        assert.equal(statuses.length, copied && !newerStatus ? 1 : 0,
            'blocked viewer must not announce a refused copy or overwrite a newer operation');
    }
    console.log('PASS test runner UI controllers preserve report, clipboard and viewer contracts');
})().catch(error => { console.error(error); process.exitCode = 1; });
