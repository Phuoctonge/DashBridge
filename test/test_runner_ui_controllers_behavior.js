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

console.log('PASS test runner UI controllers preserve report and viewer contracts');
