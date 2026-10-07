'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = new Set();
let currentTabUrl = 'https://grafana.example/d/dashboard?viewPanel=7';
let canonicalizeNavigation = false;
let ordinaryDataReady = true;
let ordinaryInterceptorAvailable = true;
let filteredEmptyAllowed = false;
let canvasPainted = true;
let panelHasRenderer = true;
let panelText = '';
let earlyRuntimeCalls = 0;
const renderer = {
    width: 800, height: 300,
    getBoundingClientRect: () => ({ height: 300, width: 800 }),
    getContext: () => ({ getImageData: () => ({ data: canvasPainted ? [255, 0, 0, 255] : [255, 255, 255, 0] }) }),
};
const panel = {
    querySelector: selector => panelHasRenderer && selector.includes('canvas') ? renderer : null,
    querySelectorAll: selector => panelHasRenderer && selector.includes('canvas') ? [renderer] : [],
    get innerText() { return panelText; },
    get textContent() { return panelText; },
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 800, height: 400 }),
};
const documentRef = {
    documentElement: {},
    body: { appendChild() {} },
    head: { appendChild() {} },
    activeElement: { blur() {} },
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ id: '', setAttribute() {}, style: {}, textContent: '' }),
};

const context = {
    URL,
    Math,
    Date,
    document: documentRef,
    window: null,
    chrome: {
        runtime: { lastError: null },
        tabs: {
            onUpdated: {
                addListener(listener) { listeners.add(listener); },
                removeListener(listener) { listeners.delete(listener); },
            },
            get(_tabId, callback) {
                callback({ id: 7, status: 'complete', url: currentTabUrl });
            },
            update: async (_tabId, options) => {
                currentTabUrl = options.url;
                if (canonicalizeNavigation) {
                    const canonical = new URL(currentTabUrl);
                    if (canonical.searchParams.has('from')) canonical.searchParams.set('from', '2026-08-28T12:11:29.256Z');
                    if (canonical.searchParams.has('to')) canonical.searchParams.set('to', '2026-08-28T13:26:26.751Z');
                    canonical.searchParams.set('_t', '123');
                    currentTabUrl = canonical.toString();
                }
                return { id: 7, status: 'complete', url: currentTabUrl };
            },
        },
        scripting: {
            executeScript: async options => {
                if (options.files) return [{ result: undefined }];
                const fn = vm.runInContext(`(${options.func.toString()})`, context);
                return [{ result: await fn(...(options.args || [])) }];
            },
        },
    },
    ensureEarlyGrafanaRuntimeForUrl: async () => { earlyRuntimeCalls++; return { ok: true }; },
    applySharedGrafanaPanelTools: async tools => ({ ok: true, tools }),
    setTimeout(callback, delay) {
        if (delay === 30_000) return setTimeout(callback, 500);
        if (delay === 25_000) return setTimeout(callback, 50);
        return setTimeout(callback, delay);
    },
    clearTimeout,
    requestAnimationFrame(callback) { return setTimeout(callback, 0); },
    cancelAnimationFrame: clearTimeout,
    MutationObserver: class {
        observe() {}
        disconnect() {}
    },
    ResizeObserver: class {
        observe() {}
        disconnect() {}
    },
    getComputedStyle: () => ({ display: 'none', visibility: 'hidden', opacity: '0' }),
    get __dashbridgeDataInterceptorDiagnostic() {
        if (!ordinaryInterceptorAvailable) return null;
        return {
            get activeRequests() { return ordinaryDataReady ? 0 : 1; },
            get events() { return ordinaryDataReady ? [{ stage: 'request-complete' }] : []; },
        };
    },
    __dashbridgePanelToolsVisualMetadata: {
        get responseDataStatus() { return { kind: filteredEmptyAllowed ? 'filtered_empty' : 'success' }; },
        get responseFilterEmptyIsNormal() { return filteredEmptyAllowed; },
    },
};
context.window = context;
context.location = { get href() { return currentTabUrl; } };
context.DashBridgeGrafanaDom = {
    findPanelById: () => panel,
    findPanel: () => panel,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/batch/batch-panel-loader.js', 'utf8'), context);

(async () => {
    const logs = [];
    const loadPanel = context.createBatchPanelLoader({ log: value => logs.push(value) });
    const result = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );

    assert.deepEqual({ ...result }, { x: 10, y: 20, w: 800, h: 400, dpr: undefined });
    assert.equal(earlyRuntimeCalls, 1, 'ordinary Batch panels must install the MAIN runtime before navigation');
    assert.equal(logs[0], 'Загрузка панели 7…');
    assert.equal(listeners.size, 0, 'loader must remove its tab listener after readiness');

    canonicalizeNavigation = true;
    currentTabUrl = 'https://grafana.example/d/other';
    const canonicalizedResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?from=1787919089256&to=1787923586751&viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.deepEqual({ ...canonicalizedResult }, { x: 10, y: 20, w: 800, h: 400, dpr: undefined },
        'Grafana may canonicalize time parameters without cancelling panel readiness');
    canonicalizeNavigation = false;
    currentTabUrl = 'https://grafana.example/d/dashboard?viewPanel=7';

    ordinaryDataReady = false;
    const blankResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.equal(blankResult, null, 'ordinary data panels must not capture before their request settles');
    ordinaryDataReady = true;

    ordinaryInterceptorAvailable = false;
    canvasPainted = false;
    const noInterceptorResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.equal(noInterceptorResult, null,
        'data renderers must not capture without request and visual evidence');
    ordinaryInterceptorAvailable = true;
    canvasPainted = true;

    const originalFindPanelById = context.DashBridgeGrafanaDom.findPanelById;
    context.DashBridgeGrafanaDom.findPanelById = () => null;
    currentTabUrl = 'https://grafana.example/d/dashboard?viewPanel=panel-7';
    const normalizedPanelIdResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.deepEqual({ ...normalizedPanelIdResult }, { x: 10, y: 20, w: 800, h: 400, dpr: undefined },
        'single-panel fallback must normalize numeric and panel-N route IDs');
    context.DashBridgeGrafanaDom.findPanelById = originalFindPanelById;
    currentTabUrl = 'https://grafana.example/d/dashboard?viewPanel=7';

    const normalExecuteScript = context.chrome.scripting.executeScript;
    let frameRemovalCount = 0;
    context.chrome.scripting.executeScript = async options => {
        if (options.files && frameRemovalCount++ === 0) {
            throw new Error('Frame with ID 0 was removed.');
        }
        return normalExecuteScript(options);
    };
    const retriedResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.deepEqual({ ...retriedResult }, { x: 10, y: 20, w: 800, h: 400, dpr: undefined });
    assert.equal(frameRemovalCount, 2, 'a removed main frame must receive exactly one bounded retry');

    const alwaysFrameRemoval = async options => {
        if (options.files) throw new Error('Frame with ID 0 was removed.');
        return normalExecuteScript(options);
    };
    context.chrome.scripting.executeScript = alwaysFrameRemoval;
    const exhaustedRetryResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.equal(exhaustedRetryResult, null, 'a removed frame must fail after its only retry');
    assert.equal(listeners.size, 0, 'exhausted retry must clean up its tab listener');

    let nonTransientAttempts = 0;
    context.chrome.scripting.executeScript = async options => {
        if (options.files) {
            nonTransientAttempts++;
            throw new Error('Extension context invalidated');
        }
        return normalExecuteScript(options);
    };
    const nonTransientResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.equal(nonTransientResult, null, 'unrelated extension errors must not be retried');
    assert.equal(nonTransientAttempts, 1, 'only the detached-frame error is retried');

    context.chrome.scripting.executeScript = async options => {
        const result = await normalExecuteScript(options);
        if (options.files) currentTabUrl = 'https://grafana.example/d/dashboard?viewPanel=8';
        return result;
    };
    const staleResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.equal(staleResult, false, 'readiness from a replaced navigation must be discarded');
    assert.equal(listeners.size, 0, 'stale readiness must clean up its tab listener');

    currentTabUrl = 'https://grafana.example/d/dashboard?viewPanel=7';
    context.chrome.scripting.executeScript = normalExecuteScript;
    const strictResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, { invertIdle: true },
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.notDeepEqual(strictResult, { x: 10, y: 20, w: 800, h: 400, dpr: undefined },
        'data-transform panels must still wait for observed data and visual evidence');
    assert.equal(listeners.size, 0, 'every retry/timeout path must clean up its tab listener');
    canvasPainted = false;
    const filteredEmptyResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, { cpuCapacityFilterEnabled: true },
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    filteredEmptyAllowed = true;
    const filteredEmptyRetryResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, { cpuCapacityFilterEnabled: true },
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    filteredEmptyAllowed = false;
    assert.equal(filteredEmptyResult, null,
        'filtered-empty metadata must not allow an ordinary panel without an active filter');
    assert.deepEqual({ ...filteredEmptyRetryResult }, { x: 10, y: 20, w: 800, h: 400, dpr: undefined },
        'a completed CPU filter with no matching series must still produce a valid empty-state capture');
    assert.match(currentTabUrl, /dashbridgeCpuCapacityFilter=/,
        'Batch must bootstrap CPU filtering before the first datasource request');
    panelText = 'No data';
    panelHasRenderer = true;
    const noDataResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.deepEqual({ ...noDataResult }, { x: 10, y: 20, w: 800, h: 400, dpr: undefined },
        'visible No data state must be captured as a valid panel result');
    panelText = '';
    panelHasRenderer = false;
    const diagnosticEvents = [];
    const diagnosticTimeout = await loadPanel(
        7, 'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null, null, 'CPU', event => diagnosticEvents.push(event),
    );
    assert.equal(diagnosticTimeout, null, 'diagnostic timeout must not become a capture rectangle');
    const timeoutEvent = diagnosticEvents.find(event => event.stage === 'readiness' && event.event === 'timeout');
    assert.ok(timeoutEvent?.details.result.readinessHistory.length > 0, 'timeout must retain readiness evidence');
    assert.ok(timeoutEvent.details.result.readinessHistory.some(item =>
        ['panel-not-found', 'empty-renderer'].includes(item.reason)));
    panelText = '';
    panelHasRenderer = false;
    ordinaryInterceptorAvailable = false;
    const staticPanelResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, null,
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.equal(staticPanelResult, null,
        'a sized panel without renderer or No data must not produce a white capture');
    console.log('PASS Batch loader handles ordinary, transformed and transient-frame panels');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
