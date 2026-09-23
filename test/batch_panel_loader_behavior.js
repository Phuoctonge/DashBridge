'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = new Set();
let currentTabUrl = 'https://grafana.example/d/dashboard?viewPanel=7';
const renderer = { getBoundingClientRect: () => ({ height: 300 }) };
const panel = {
    querySelector: selector => selector.includes('canvas') ? renderer : null,
    querySelectorAll: () => [],
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
    ensureEarlyGrafanaRuntimeForUrl: async () => ({ ok: true }),
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
    __dashbridgeDataInterceptorDiagnostic: { activeRequests: 0, events: [{ stage: 'request-complete' }] },
    __dashbridgePanelToolsVisualMetadata: { responseDataStatus: { kind: 'filtered_empty' }, responseFilterEmptyIsNormal: true },
};
context.window = context;
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
    assert.equal(logs[0], 'Загрузка панели 7…');
    assert.equal(listeners.size, 0, 'loader must remove its tab listener after readiness');

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
    const filteredEmptyResult = await loadPanel(
        7,
        'https://grafana.example/d/dashboard?viewPanel=7',
        '7', null, null, { cpuCapacityFilterEnabled: true },
        { aborted: false, addEventListener() {}, removeEventListener() {} },
    );
    assert.deepEqual({ ...filteredEmptyResult }, { x: 10, y: 20, w: 800, h: 400, dpr: undefined },
        'a completed CPU filter with no matching series must still produce a valid empty-state capture');
    assert.match(currentTabUrl, /dashbridgeCpuCapacityFilter=/,
        'Batch must bootstrap CPU filtering before the first datasource request');
    console.log('PASS Batch loader handles ordinary, transformed and transient-frame panels');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
