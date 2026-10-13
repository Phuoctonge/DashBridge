'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const elements = {
    dashUrl: { value: 'https://grafana.example/d/uid/name' },
    timestamps: { value: 'now-1h, now' },
    panelsMode: { value: 'all' },
    userPanels: { value: '' },
};
const documentRef = { getElementById: id => elements[id] };
const context = { document: documentRef };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/batch/batch-main-run-controller.js', 'utf8'), context);

const calls = [];
const archive = {
    finalize: async () => calls.push('finalize'),
};
const startButton = {
    addEventListener(type, listener) { this[type] = listener; },
};
const operation = {
    processing: false,
    progress: { update: value => calls.push(['pipProgress', value]) },
    begin: async value => { calls.push(['begin', value]); return 7; },
    finish: async runId => calls.push(['finish', runId]),
    isActive: runId => runId === 7,
    loadPanel: async (...args) => { calls.push(['load', ...args]); return { w: 100, h: 50 }; },
    capturePanelToZip: async (...args) => { calls.push(['capture', ...args]); return true; },
    getCaptureOptions: async id => { calls.push(['captureOptions', id]); return { prepared: false }; },
    addArchiveReport: async (...args) => calls.push(['report', ...args]),
    acquireWindow: async () => ({ id: 1, tabs: [{ id: 2 }] }),
    releaseWindow: async () => calls.push('release'),
};
const notifications = [];
const progress = [];
const controller = context.BatchMainRunController.create({
    startButton,
    operation,
    lifecycle: { signal: runId => ({ runId }) },
    panelPicker: {
        getDashboardPanelsWithRecovery: async () => ({
            panels: { 2: 'CPU' },
            panelList: [{ id: 2, title: 'CPU' }],
        }),
    },
    panelRules: {
        load: async () => ({ 2: { removeFill: true } }),
        forPanel: (rules, panelId) => rules[panelId],
    },
    captureUtils: {
        createFilenameFactory: () => input => `${input.panelId}.png`,
        buildArchivePath: input => `range/${input.filename}`,
    },
    parseUrl: () => ({ uid: 'uid' }),
    normalizeRangesField: () => ({ ranges: [{ from: 'now-1h', to: 'now' }], errors: [] }),
    getCaptureTheme: () => 'light',
    updateProgress: value => progress.push(value),
    showToast: (...args) => notifications.push(args),
    logMessage: (...args) => calls.push(['log', ...args]),
    buildPanelUrl: (...args) => { calls.push(['url', ...args]); return 'https://grafana.example/d-solo/uid/name?panelId=2'; },
    createArchive: options => { calls.push(['archive', options]); return archive; },
    documentRef,
});

controller.setup();
assert.strictEqual(startButton.click, controller.run);

controller.run().then(() => {
    assert(calls.some(call => Array.isArray(call) && call[0] === 'begin'));
    assert(calls.some(call => Array.isArray(call) && call[0] === 'load' && call[3] === '2'));
    assert(calls.some(call => Array.isArray(call) && call[0] === 'capture'));
    const capturedMetadata = calls.find(call => call[0] === 'capture')[8];
    assert.strictEqual(capturedMetadata.from, 'now-1h');
    assert.strictEqual(capturedMetadata.rangeIndex, 0);
    assert(capturedMetadata.panelTitle);
    assert(calls.some(call => Array.isArray(call) && call[0] === 'report' && call[2].kind === 'panels'));
    assert(calls.includes('finalize'));
    assert(calls.some(call => Array.isArray(call) && call[0] === 'finish' && call[1] === 7));
    assert(notifications.some(call => call[0] === 'Архив скачан!' && call[1] === 'success'));
    assert(progress.some(item => item.done === 1 && item.success === 1));

    elements.dashUrl.value = '';
    return controller.run();
}).then(async () => {
    assert(notifications.some(call => call[0] === 'Заполните URL и диапазоны дат'));
    elements.dashUrl.value = 'https://grafana.example/d/uid/name';
    operation.begin = async () => { operation.processing = true; return 7; };
    let releaseOptions;
    operation.getCaptureOptions = () => new Promise(resolve => { releaseOptions = resolve; });
    const first = controller.run();
    await Promise.resolve();
    await controller.run();
    assert(notifications.some(call => call[0] === 'Процесс уже запущен!'));
    releaseOptions({ prepared: false });
    await first;
    operation.processing = false;
    const finishes = calls.filter(call => Array.isArray(call) && call[0] === 'finish').length;
    operation.getCaptureOptions = async () => { throw new Error('storage unavailable'); };
    await controller.run();
    assert.strictEqual(calls.filter(call => Array.isArray(call) && call[0] === 'finish').length, finishes + 1);

    // Cancellation while the renderer is still loading must not produce a
    // capture, failure accounting, archive finalization, or completion UI.
    calls.length = 0;
    progress.length = 0;
    notifications.length = 0;
    operation.processing = false;
    let active = true;
    operation.begin = async () => 7;
    operation.isActive = runId => active && runId === 7;
    operation.getCaptureOptions = async () => ({ prepared: false });
    operation.loadPanel = async (...args) => {
        calls.push(['load', ...args]);
        active = false;
        return { w: 100, h: 50 };
    };
    operation.capturePanelToZip = async (...args) => {
        calls.push(['capture', ...args]);
        return true;
    };
    await controller.run();
    assert(calls.some(call => Array.isArray(call) && call[0] === 'load'));
    assert(!calls.some(call => Array.isArray(call) && call[0] === 'capture'));
    assert(!calls.some(call => Array.isArray(call) && call[0] === 'report'));
    assert(!calls.includes('finalize'));
    assert(!calls.some(call => Array.isArray(call) && call[0] === 'log' && /❌|заверш/.test(call[1])));
    assert(!progress.some(item => item.done === 1));

    assert.throws(
        () => context.BatchMainRunController.create({ documentRef }),
        /dependencies are incomplete/,
    );
    console.log('batch main run controller behavior tests passed');
});
