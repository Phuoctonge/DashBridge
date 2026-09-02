'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashbridge', 'dashbridge-report-controller.js'), 'utf8');
const documentRef = {
    body: { appendChild() {} },
    querySelector: () => null,
    getElementById: id => id === 'timePickerLabel' ? { textContent: 'Последние 15 минут' } : null,
    createElement: () => ({ dataset: {}, setAttribute() {}, appendChild() {} }),
};
const context = {
    document: documentRef,
    navigator: { clipboard: { writeText: async () => undefined } },
    CSS: { escape: value => String(value) },
    setTimeout,
    AbortController,
    console,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'dashbridge-report-controller.js' });

const calls = [];
let transportOptions = null;
let liveCollector = null;
const snapshots = new Map([
    ['cpu', { state: 'ok', series: [{ name: 'host-1', value: 20 }] }],
    ['ram', { state: 'timeout', error: 'timeout', series: [] }],
]);
const transport = {
    throwIfAborted(signal) { if (signal?.aborted) throw new DOMException('aborted', 'AbortError'); },
    requestPanelSnapshot: async panel => { calls.push(panel.id); return snapshots.get(panel.id); },
};
const reportEngine = {
    normalizePanel: report => ({ enabled: report?.enabled !== false, key: report?.key || 'panel', sla: report?.sla || {} }),
    normalizeProfile: report => ({ context: report?.context || {}, panelOrder: report?.panelOrder || [] }),
    orderPanels: (items, order) => [...items].sort((left, right) => {
        const leftIndex = order.indexOf(left.id); const rightIndex = order.indexOf(right.id);
        return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
            - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    }),
    formatDuration: value => value ? `duration:${value}` : '',
    renderPanel: (panel, snapshot) => ({ text: `${panel.id}:${snapshot.state}` }),
    compose: (_profile, results, reportContext) => `${reportContext.period}|${results.map(item => item.text).join(',')}`,
};
const panels = [
    { id: 'cpu', title: 'CPU', report: { key: 'cpu', sla: { source: 'graph', evaluation: 'period_max', warningValue: 70 } },
        tools: { thresholdEnabled: true, thresholdValue: 80, thresholdRawValue: 80, thresholdUnit: '%' } },
    { id: 'ram', title: 'RAM', report: { key: 'ram', sla: { source: 'none' } }, tools: {} },
];
const profile = { name: 'Prod', report: {
    panelOrder: ['ram', 'cpu'], context: { testStartedAt: '2026-01-01' }
} };
const controller = context.DashBridgeReportController.create({
    reportEngine,
    transportFactory: { create(options) { transportOptions = options; return transport; } },
    testRunnerFactory: { create(options) { liveCollector = options.collect; return { open() {} }; } },
    auditEngine: {},
    forceLoadPanel: () => null,
    postToDashboardFrame: () => false,
    getPanels: () => panels,
    getActiveProfile: () => profile,
    getTimeContext: () => ({ from: 'now-15m', to: 'now' }),
    documentRef,
});

(async () => {
    assert.strictEqual(transportOptions.frameTimeoutMs, 90_000);
    assert.strictEqual(transportOptions.totalTimeoutMs, 125_000);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(controller.getEffectivePanelSla(panels[0]))), {
        source: 'graph', operator: 'gt', evaluation: 'period_max', value: 80,
        rawValue: 80, warningValue: 70, unit: '%',
    });
    const progress = [];
    const result = await controller.collect(null, message => progress.push(message));
    assert.deepStrictEqual(calls.sort(), ['cpu', 'ram'], 'all enabled panels must share one parallel collection pass');
    assert.strictEqual(result.output, 'Последние 15 минут|ram:timeout,cpu:ok',
        'the saved message order must control collection and composition without changing dashboard layout');
    assert.deepStrictEqual(result.problems.map(item => item.panel.id), ['ram']);
    assert.strictEqual(result.context.testDuration, 'duration:2026-01-01');
    assert(progress.includes('Получаем данные панелей: 2 из 2…'));
    calls.length = 0;
    await liveCollector(null, () => undefined);
    assert.deepStrictEqual(calls.sort(), ['cpu', 'ram'], 'Message Test Runner must reuse the same live collector');
    assert.throws(() => context.DashBridgeReportController.create({}), /dependencies are incomplete/);
    console.log('PASS DashBridge report controller preserves SLA, collection and test-runner contracts');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
