'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.value = '';
        this.hidden = false;
        this.innerHTML = '';
        this.dataset = {};
        this.children = [];
        this.listeners = {};
    }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    emit(type) { return this.listeners[type]?.(); }
    appendChild(child) { this.children.push(child); return child; }
}

const elements = {
    seriesDashUrl: new FakeElement('seriesDashUrl'),
    seriesLoaderStatus: new FakeElement('seriesLoaderStatus'),
    seriesPanelsContainer: new FakeElement('seriesPanelsContainer'),
    getSeriesPanelsBtn: new FakeElement('getSeriesPanelsBtn'),
    loadSelectedSeriesBtn: new FakeElement('loadSelectedSeriesBtn'),
};
elements.seriesDashUrl.value = 'https://grafana.example/d/uid/name';
const documentRef = {
    getElementById: id => elements[id],
    createElement: tag => new FakeElement(tag),
};
let currentCaptureUrl = '';
let nextTabId = 10;
let navigationComplete = false;
let finishNavigation = true;
const navigationListeners = new Set();
const startNavigation = (id, url) => {
    navigationComplete = false;
    if (finishNavigation) setTimeout(() => {
        currentCaptureUrl = url; navigationComplete = true;
        navigationListeners.forEach(listener => listener(id, { status: 'complete' }, { id, status: 'complete', url }));
    }, 5);
    return { id, status: 'loading', url: currentCaptureUrl };
};
const scriptCalls = [];
const chromeRef = {
    tabs: {
        create: async options => startNavigation(nextTabId++, options.url),
        update: async (tabId, options) => startNavigation(tabId, options.url),
        get: async id => ({ id, status: navigationComplete ? 'complete' : 'loading', url: currentCaptureUrl }),
        onUpdated: { addListener: fn => navigationListeners.add(fn), removeListener: fn => navigationListeners.delete(fn) },
    },
    scripting: {
        executeScript: async options => {
            assert(navigationComplete, 'capture waiter must execute in the committed new document');
            scriptCalls.push(options);
            const prefixed = currentCaptureUrl.includes('panelId=panel-2');
            return [{ result: prefixed
                ? { ok: false, capture: { debug: { requests: 1, matched: 0 } } }
                : { ok: true, names: ['cpu', 'load'] } }];
        },
    },
};
const notifications = [];
const logs = [];
const pickerCalls = [];
const context = { document: documentRef, chrome: chromeRef, URL, DOMException,
    setTimeout: (callback, delay) => setTimeout(callback, delay === 30_000 ? 25 : delay), clearTimeout };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/batch/batch-series-discovery-controller.js', 'utf8'),
    context,
);

const controller = context.BatchSeriesDiscoveryController.create({
    panelPicker: {
        open: options => pickerCalls.push(options),
        getSeriesSelectedPanelIds: () => ['2'],
    },
    getCaptureTheme: () => 'dark',
    showToast: (...args) => notifications.push(args),
    logMessage: (...args) => logs.push(args),
    escapeHtml: value => String(value).replace(/</g, '&lt;'),
    parseDashboardUrl: () => ({ baseUrl: 'https://grafana.example', orgId: '1', uid: 'uid' }),
    buildSoloPanelUrl: (url, panelId) => `https://grafana.example/d-solo/uid/name?panelId=${panelId}`,
    buildPanelUrl: (url, panelId) => `${url}?viewPanel=${panelId}`,
    ensureEarlyRuntime: async () => ({ ok: true }),
    fetchDashboardDefinition: async () => ({ payload: { dashboard: {} } }),
    findDashboardPanel: () => ({ title: 'CPU <prod>', targets: [{}] }),
    getPanelQuerySignatures: () => [{ refId: 'A' }],
    documentRef,
    chromeRef,
});

controller.setup();
elements.getSeriesPanelsBtn.emit('click');
assert.strictEqual(pickerCalls[0].context, 'series');

controller.loadSelectedPanels().then(async () => {
    assert.strictEqual(elements.seriesLoaderStatus.hidden, true);
    assert.strictEqual(elements.seriesPanelsContainer.children.length, 1);
    assert(elements.seriesPanelsContainer.children[0].innerHTML.includes('CPU &lt;prod>'));
    assert(notifications.some(call => call[0] === 'Подготовлено панелей: 1'));

    const tabUpdates = [];
    const result = await controller.discoverForSlice({
        dashboardUrl: elements.seriesDashUrl.value,
        panelId: '2',
        range: { from: 'now-1h', to: 'now' },
        signatures: [{ refId: 'A' }],
        onTabId: id => tabUpdates.push(id),
    });
    assert.deepStrictEqual(Array.from(result.names), ['cpu', 'load']);
    assert.strictEqual(scriptCalls.length, 2, 'prefixed ID must fall back to numeric ID');
    assert.strictEqual(tabUpdates.length, 2);
    assert.strictEqual(navigationListeners.size, 0, 'navigation listeners must be released after both attempts');

    finishNavigation = false;
    const abortController = new AbortController();
    const abortedTabs = [];
    const aborting = controller.discoverForSlice({
        dashboardUrl: elements.seriesDashUrl.value, panelId: '2', range: { from: 'now-1h', to: 'now' },
        signatures: [{ refId: 'A' }], signal: abortController.signal,
        onTabId: id => abortedTabs.push(id),
    });
    setTimeout(() => abortController.abort(), 5);
    await assert.rejects(aborting, error => error.name === 'AbortError');
    assert.strictEqual(navigationListeners.size, 0, 'abort releases the navigation listener');
    assert.strictEqual(scriptCalls.length, 2, 'aborted navigation cannot inject a capture waiter');
    assert.strictEqual(abortedTabs.length, 1, 'the run must own its new tab before cancellation so finally can close it');
    await assert.rejects(controller.discoverForSlice({
        dashboardUrl: elements.seriesDashUrl.value, panelId: '2', range: { from: 'now-1h', to: 'now' }, signatures: [{ refId: 'A' }],
    }), /Истёк срок загрузки/);
    assert.strictEqual(navigationListeners.size, 0, 'navigation deadline releases the listener');
    assert.strictEqual(scriptCalls.length, 2);

    assert.throws(
        () => context.BatchSeriesDiscoveryController.create({ documentRef, chromeRef }),
        /dependencies are incomplete/,
    );
    console.log('batch Series discovery controller behavior tests passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
