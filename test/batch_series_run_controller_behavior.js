'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { URL, URLSearchParams };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/batch/batch-series-run-controller.js', 'utf8'),
    context,
);

function createHarness({ mode = 'group', matches = [{ name: 'cpu', key: 'cpu\u00000' }],
    discoveryImpl, cardCount = 1 } = {}) {
    const calls = [];
    const notifications = [];
    const progress = [];
    const startButton = {
        addEventListener(type, listener) { this[type] = listener; },
    };
    const elements = {
        seriesCaptureMode: { value: mode },
        seriesIncludeFilter: { value: 'cpu' },
        seriesIgnoreFilter: { value: 'idle' },
        seriesDashUrl: { value: 'https://grafana.example/d/uid/name' },
    };
    const card = {
        dataset: { querySignatures: '[{"refId":"A"}]' },
        querySelector: selector => {
            assert.strictEqual(selector, '.series-panel-url');
            return { value: 'https://grafana.example/d/uid/name?viewPanel=2' };
        },
    };
    const documentRef = {
        getElementById: id => elements[id],
        querySelectorAll: selector => {
            assert.strictEqual(selector, '#seriesPanelsContainer .batch-series-card');
            return cardCount ? [card] : [];
        },
    };
    const archive = { finalize: async () => calls.push('finalize') };
    const operation = {
        processing: false,
        progress: { update: value => calls.push(['pipProgress', value]) },
        begin: async value => { calls.push(['begin', value]); return 17; },
        finish: async runId => calls.push(['finish', runId]),
        isActive: runId => runId === 17,
        loadPanel: async (...args) => {
            calls.push(['load', ...args]);
            return { w: 100, h: 50 };
        },
        capturePanelToZip: async (...args) => {
            calls.push(['capture', ...args]);
            return true;
        },
        getCaptureOptions: async id => {
            calls.push(['captureOptions', id]);
            return { prepared: true };
        },
        addArchiveReport: async (...args) => calls.push(['report', ...args]),
        acquireWindow: async () => ({ id: 3, tabs: [{ id: 4 }] }),
        releaseWindow: async () => calls.push('release'),
    };
    const chromeRef = {
        tabs: {
            getCurrent: async () => ({ id: 1, windowId: 2 }),
            remove: async tabId => calls.push(['remove', tabId]),
        },
    };
    const discovery = {
        discoverForSlice: discoveryImpl || (async options => {
            calls.push(['discover', options]);
            options.onTabId(9);
            return { tabId: 9, names: matches.map(item => item.name) };
        }),
    };
    const controller = context.BatchSeriesRunController.create({
        startButton,
        operation,
        lifecycle: { signal: runId => ({ runId }) },
        discovery,
        seriesSelection: {
            resolvePatterns: (names, include, ignore) => {
                calls.push(['selection', names, include, ignore]);
                return { matches };
            },
        },
        panelRules: {
            load: async () => ({ 2: { removeFill: true } }),
            forPanel: (rules, panelId) => rules[panelId],
        },
        captureUtils: {
            createFilenameFactory: () => input => `${input.label}-${input.occurrence ?? 'group'}.png`,
            buildArchivePath: input => `range/${input.filename}`,
        },
        normalizeRangesField: () => ({
            ranges: [{ from: 'now-1h', to: 'now' }], errors: [],
        }),
        getCaptureTheme: () => 'light',
        updateProgress: value => progress.push(value),
        showToast: (...args) => notifications.push(args),
        logMessage: (...args) => calls.push(['log', ...args]),
        parseUrl: () => ({ uid: 'uid' }),
        buildPanelUrl: (...args) => {
            calls.push(['url', ...args]);
            return 'https://grafana.example/d-solo/uid/name?panelId=2';
        },
        applyCompleteHideSelection: (...args) => {
            calls.push(['completeHide', ...args]);
            return `${args[0]}#filtered`;
        },
        setLegendVisibility: async options => {
            calls.push(['legend', options]);
            return { ok: true };
        },
        createArchive: options => {
            calls.push(['archive', options]);
            return archive;
        },
        documentRef,
        chromeRef,
    });
    return { calls, notifications, progress, startButton, operation, controller };
}

(async () => {
    const group = createHarness();
    group.controller.setup();
    assert.strictEqual(group.startButton.click, group.controller.run);
    await group.controller.run();
    assert(group.calls.some(call => Array.isArray(call) && call[0] === 'completeHide'));
    assert(group.calls.some(call => Array.isArray(call) && call[0] === 'load'
        && call[2].endsWith('#filtered') && call[5] === null));
    assert(group.calls.some(call => Array.isArray(call) && call[0] === 'capture'));
    assert(group.calls.some(call => Array.isArray(call) && call[0] === 'report'
        && call[2].kind === 'series' && call[2].successfulJobs === 1));
    assert(group.calls.includes('finalize'));
    assert(group.calls.some(call => Array.isArray(call) && call[0] === 'remove' && call[1] === 9));
    assert(group.calls.some(call => Array.isArray(call) && call[0] === 'finish' && call[1] === 17));
    assert(group.notifications.some(call => call[0] === 'Архив скачан!' && call[1] === 'success'));
    assert(group.progress.some(item => item.done === 1 && item.success === 1));

    const standaloneMatches = [
        { name: 'cpu', key: 'cpu\u00000' },
        { name: 'cpu', key: 'cpu\u00001' },
    ];
    const standalone = createHarness({ mode: 'standalone', matches: standaloneMatches });
    await standalone.controller.run();
    const legendCalls = standalone.calls.filter(call => Array.isArray(call) && call[0] === 'legend');
    assert.deepStrictEqual(
        legendCalls.map(call => Array.from(call[1].selectedKeys)),
        [['cpu\u00000'], ['cpu\u00001']],
    );
    const loadCalls = standalone.calls.filter(call => Array.isArray(call) && call[0] === 'load');
    assert.strictEqual(loadCalls.length, 2);
    assert.strictEqual(loadCalls[0][5], null);
    assert.strictEqual(loadCalls[1][5], 'cpu');

    let failureHarness;
    failureHarness = createHarness({
        discoveryImpl: async options => {
            options.onTabId(22);
            throw new Error('discovery failed');
        },
    });
    await failureHarness.controller.run();
    assert(failureHarness.calls.some(call => Array.isArray(call)
        && call[0] === 'remove' && call[1] === 22));
    assert(failureHarness.calls.some(call => Array.isArray(call)
        && call[0] === 'finish' && call[1] === 17));
    assert(failureHarness.notifications.some(call => call[0] === 'Не удалось сохранить ни одной Series'));

    const noCards = createHarness();
    const empty = createHarness({ cardCount: 0 });
    await empty.controller.run();
    assert(empty.notifications.some(call => call[0] === 'Нет панелей для сбора'));
    assert(!empty.calls.some(call => Array.isArray(call) && call[0] === 'begin'));
    assert(noCards.controller);
    assert.throws(
        () => context.BatchSeriesRunController.create({ documentRef: {}, chromeRef: {} }),
        /dependencies are incomplete/,
    );

    console.log('batch Series run controller behavior tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
