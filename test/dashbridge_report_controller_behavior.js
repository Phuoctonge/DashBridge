'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashbridge', 'dashbridge-report-controller.js'), 'utf8');
let panelStatus = null;
const wrapper = {
    querySelector: () => panelStatus,
    appendChild(node) { panelStatus = node; node.remove = () => { panelStatus = null; }; },
};
const documentRef = {
    body: { appendChild() {} },
    querySelector: () => ({ querySelector: () => wrapper }),
    getElementById: id => id === 'timePickerLabel' ? { textContent: 'Последние 15 минут' } : null,
    createElement: () => ({ dataset: {}, setAttribute() {}, appendChild() {} }),
};
const context = {
    document: documentRef,
    navigator: { clipboard: { writeText: async () => undefined } },
    CSS: { escape: value => String(value) },
    setTimeout,
    clearTimeout,
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
    assert.strictEqual(result.context.profileName, 'Prod', 'panel rendering receives the active profile name');
    assert(progress.includes('Получаем данные панелей: 2 из 2…'));
    profile.report.panelOrder = [];
    panels.forEach(panel => { panel.report.enabled = false; });
    const imageOnly = await controller.collect(null, () => undefined, { requirePanels: false });
    assert.deepStrictEqual(imageOnly.reportPanels, [], 'image-only combined reports may proceed when forced attachments are configured without text panels');
    panels.forEach(panel => { panel.report.enabled = true; });
    profile.report.panelOrder = ['ram', 'cpu'];
    calls.length = 0;
    await liveCollector(null, () => undefined);
    assert.deepStrictEqual(calls.sort(), ['cpu', 'ram'], 'Message Test Runner must reuse the same live collector');
    const panelBefore = JSON.stringify(panels[0]);
    const disabledSla = controller.getEffectivePanelSla({ ...panels[0], tools: { thresholdEnabled: false } });
    assert(disabledSla.error.includes('Для сообщения выбран порог графика, но он выключен.'));
    assert(disabledSla.error.includes('«Собственный SLA»') && disabledSla.error.includes('«Без SLA - информационная фраза»'),
        'the disabled graph threshold warning must explain how to configure the report');
    const configurationError = { state: 'configuration_error', dataStatus: 'configuration_error',
        error: 'Порог на графике выключен.', series: [] };
    snapshots.set('cpu', configurationError);
    controller.setPanelDataStatus(panels[0], { dataStatus: 'timeout', error: 'Timeout' });
    assert.strictEqual(panelStatus.textContent, 'Timeout', 'transport errors must remain visible on the card');
    controller.setPanelDataStatus(panels[0], configurationError);
    assert.strictEqual(panelStatus, null, 'an SLA configuration error alone must clear an old loading overlay');
    const configurationResult = await liveCollector(null, () => undefined);
    assert.strictEqual(panelStatus, null, 'report configuration errors must clear stale overlays without covering a healthy graph');
    assert(configurationResult.problems.some(item => item.panel.id === 'cpu'),
        'configuration errors must remain report problems, never successful SLA');
    const warningBox = { textContent: '', hidden: true };
    await controller.generate({ value: '' }, { isConnected: true }, warningBox);
    assert.strictEqual(warningBox.hidden, false);
    assert(warningBox.textContent.includes('Настройки сообщения — CPU: Порог на графике выключен.'),
        'preview warning must identify the configuration and affected panel');
    assert.strictEqual(JSON.stringify(panels[0]), panelBefore, 'checking reports must not change panel settings');
    for (const kind of ['timeout', 'iframe_unavailable', 'request_error']) {
        controller.setPanelDataStatus(panels[0], { dataStatus: kind, error: kind });
        assert.strictEqual(panelStatus.textContent, kind, 'real loading errors must retain their card overlay');
    }
    controller.setPanelDataStatus(panels[0], null);
    assert.strictEqual(panelStatus, null, 'a new collection clears stale loading errors');
    assert.throws(() => context.DashBridgeReportController.create({}), /dependencies are incomplete/);
    const originalRequest = transport.requestPanelSnapshot;
    let finishSlowPanel;
    transport.requestPanelSnapshot = panel => panel.id === 'ram'
        ? new Promise(resolve => { finishSlowPanel = resolve; })
        : Promise.resolve(configurationError);
    const updates = [];
    let collectionFinished = false;
    const pendingCollection = liveCollector(null, (_message, update) => updates.push(update));
    pendingCollection.then(() => { collectionFinished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(collectionFinished, false, 'the slow panel must still be loading');
    assert(updates[0]?.panels.length === 2 && updates[0].completed === 0,
        'the runner needs the full pending panel list before responses arrive');
    assert(updates.some(update => update?.panel?.id === 'cpu' && update.snapshot.state === 'configuration_error'
        && update.completed === 1 && update.total === 2), 'a known configuration error must be published before another panel loads');
    finishSlowPanel({ state: 'ok', series: [] });
    await pendingCollection;
    assert.strictEqual(updates.at(-1).completed, 2);
    const cancellation = new AbortController();
    const cancelledUpdates = [];
    const cancelledCollection = liveCollector(cancellation.signal, (_message, update) => cancelledUpdates.push(update));
    await new Promise(resolve => setImmediate(resolve));
    cancellation.abort();
    const updatesAtClose = cancelledUpdates.length;
    finishSlowPanel({ state: 'ok', series: [] });
    await assert.rejects(cancelledCollection, error => error.name === 'AbortError');
    assert.strictEqual(cancelledUpdates.length, updatesAtClose, 'late panel completion after closing must not publish progress');
    transport.requestPanelSnapshot = originalRequest;
    const request = transport.requestPanelSnapshot;
    transport.requestPanelSnapshot = async panel => {
        const result = await request(panel);
        profile.name = 'Changed during collection';
        return result;
    };
    await assert.rejects(controller.collect(), /изменились во время сбора/,
        'a report must not combine old snapshots with newly changed dashboard context');
    console.log('PASS DashBridge report controller preserves SLA, collection and test-runner contracts');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
