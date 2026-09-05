'use strict';
/* global EventTarget, performance */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(file, 'utf8');

async function recorderBudgets() {
    const context = vm.createContext({ TextEncoder });
    vm.runInContext(read('pages/recorder/recorder-network-capture.js'), context);
    const make = () => {
        const state = { tabId: 7, mode: 'recording', activeStepId: 1,
            requests: new Map(), activeRequests: new Map(), redirectCounts: new Map(),
            requestChains: new Map(), requestExtraInfoIndexes: new Map(), responseExtraInfoIndexes: new Map(),
            ignoredRequests: new Set(), inFlight: new Set(), pendingBodyCaptures: new Set(), pendingRequestBodyCaptures: new Set(),
            streams: [], pageEvents: [], streamPayloadBytes: 0, totalBodyBytes: 0, totalRequestBodyBytes: 0,
            completeness: { droppedRequests: 0, responseBodiesCaptured: 0, responseBodiesSkipped: 0 } };
        const controller = context.DashBridgeRecorderNetworkCapture.create({
            state, schema: { classifyResponseBodyCapture: () => null },
            sendCdp: async () => ({ body: 'x'.repeat(1000), base64Encoded: false }),
            sha256: async () => 'fixture-hash', bodyBytes: request => new TextEncoder().encode(request.responseBody),
            addNavigateStep() {}, injectActionRecorder() {}, scheduleRender() {}, setStatus() {}, setTimeoutRef() {},
            limits: { maxBodyBytes: 1024, maxRequestBodyBytes: 1024, maxTotalRequestBodyBytes: 4096,
                maxTotalBodyBytes: 4096, maxRequests: 10, maxStreamEvents: 10, maxStreamPayloadBytes: 1024, maxPageEvents: 10 }
        });
        return { state, event: (method, params) => controller.handleEvent({ tabId: 7 }, `Network.${method}`, params) };
    };
    const early = make();
    for (let i = 0; i < 25; i++) {
        early.event('requestWillBeSentExtraInfo', { requestId: String(i), headers: {} });
        early.event('requestWillBeSent', { requestId: String(i), request: { url: `https://fixture.test/${i}`, method: 'GET' } });
        early.event('loadingFailed', { requestId: String(i) });
    }
    assert.equal(early.state.requests.size, 10, 'early ExtraInfo must share the request admission limit');
    assert(early.state.redirectCounts.size <= 10, 'dropped requests must not grow redirect indexes');
    const parallel = make();
    for (let i = 0; i < 8; i++) {
        parallel.event('requestWillBeSent', { requestId: String(i), request: { url: `https://fixture.test/${i}`, method: 'GET' } });
        parallel.event('loadingFinished', { requestId: String(i), encodedDataLength: 1000 });
    }
    await Promise.all([...parallel.state.pendingBodyCaptures]);
    assert.equal(parallel.state.totalBodyBytes, 4000, 'hashing must reserve bytes before yielding');
    assert.equal(parallel.state.completeness.responseBodiesCaptured, 4);
}

async function analyticsRate() {
    const context = vm.createContext({ setTimeout: () => 0 });
    vm.runInContext(read('js/shared/analytics-contract.js'), context);
    vm.runInContext(read('js/background-analytics.js'), context);
    let timestamp = Date.parse('2026-09-05T10:00:00Z');
    let calls = 0;
    const stored = {};
    const area = { get: async () => stored, set: async values => Object.assign(stored, values) };
    const analytics = context.DashBridgeBackgroundAnalytics.create({
        storageArea: area, syncStorageArea: area, runtimeApi: { getManifest: () => ({ version: '2.4.3' }) },
        randomUUID: () => '00000000-0000-4000-8000-000000000001', now: () => timestamp,
        fetchFn: async () => { calls++; return { ok: true }; },
        config: { endpoint: 'https://fixture.test', minimumSendIntervalMs: 3600000, batchSize: 100, queueLimit: 2000 }
    });
    await analytics.track({ featureId: 'popup.opened', signal: 'used', dimensions: {} });
    await analytics.send();
    const state = await analytics.loadState();
    for (let i = 0; i < 150; i++) state.aggregates.push({ eventId: String(i), periodStart: '2026-09-05T09:00:00Z',
        featureId: 'popup.opened', signal: 'used', dimensions: {}, count: 1, extensionVersion: '2.4.3' });
    timestamp += 1000;
    await analytics.send();
    assert.equal(calls, 1, 'offline backlog must not bypass the hourly interval');
    timestamp += 3600000;
    await analytics.send();
    assert.equal(calls, 2);
    assert.equal(state.aggregates.length, 50, 'only one batch is drained per due send');
}

async function xhrReuseAndScope() {
    const context = vm.createContext({ Event, EventTarget, URL, URLSearchParams, performance, Request, Response, Headers,
        location: { href: 'https://fixture.test/d/demo', pathname: '/d/demo', search: '' }, document: {} });
    vm.runInContext(`class XHR extends EventTarget {
        open() { this.readyState = 1; this.status = 0; }
        send() { this.readyState = 4; this.status = 200; this.dispatchEvent(new Event('readystatechange')); }
        getAllResponseHeaders() { return ''; }
    }
    const XMLHttpRequest = XHR;
    const window = new EventTarget();
    window.fetch = async () => new Response('{}');
    window.DashBridgeGrafanaPanelDataTransforms = { create: () => ({ hasDataTransform: () => false }) };
    const tools = {};
    `, context);
    vm.runInContext(read('js/content/grafana-network.js'), context);
    vm.runInContext('window.DashBridgeGrafanaNetwork = globalThis.DashBridgeGrafanaNetwork', context);
    vm.runInContext(read('js/content/grafana-panel-definition.js'), context);
    vm.runInContext(`window.DashBridgeGrafanaPanelDefinition = globalThis.DashBridgeGrafanaPanelDefinition;
        window.DashBridgeGrafanaVisualEngine = globalThis.DashBridgeGrafanaPanelDefinition;`, context);
    vm.runInContext(read('js/content/grafana-panel-data-runtime.js'), context);
    vm.runInContext(`window.DashBridgeGrafanaPanelDataRuntime.create({
        tools, isDashboardIframe: false, visualMetadata: {}, legendSelection: {}, getTargetPanel: () => null,
        pushBoundedDiagnosticEvent: (d,e) => d.events.push(e), capDiagnosticJournal() {},
        setRecentDiagnosticRecord: (records,key,value) => (records[key] = value),
        setPanelDataStatus() {}, syncPanelDataStatusPresentation() {}, responseSeriesFilterIsEnabled: () => false,
        syncResponseFilterPresentation() {}, hasPersistentVisualWork: () => true, reapplyVisualStylesAfterDataTransform() {},
        consumeVisualStylesAfterQuery() {}, registerRuntimeCleanup() {}, isThresholdRestorePending: () => false
    }).installDataInterceptor();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/ds/query'); xhr.send();
    xhr.open('GET', '/api/ds/query'); xhr.send();`, context);
    assert.equal(vm.runInContext('window.__dashbridgeDataInterceptorDiagnostic.activeRequests', context), 0);
    assert.equal(vm.runInContext(`window.__dashbridgeDataInterceptorDiagnostic.events.filter(e => e.stage === 'request-complete').length`, context), 2);
    vm.runInContext(`window.__dashbridgeE2EDiagnostics = { installed: true };
        tools.targetQuerySignatures = [JSON.stringify({refId:'A',datasource:{uid:'sql'},rawSql:'SELECT cpu FROM metrics_\${project}'})];`, context);
    for (const [sql, expected] of [['SELECT ram FROM metrics_prod', 0], ['SELECT cpu FROM metrics_prod', 1]]) {
        context.queryBody = JSON.stringify({ queries: [{ refId: 'A', datasource: { uid: 'sql' }, rawSql: sql }] });
        await vm.runInContext(`window.fetch('/api/ds/query',{method:'POST',body:queryBody})`, context);
        const actual = vm.runInContext(`window.__dashbridgeDataInterceptorDiagnostic.events.filter(e => e.stage === 'transform-skipped').at(-1).targetRefIds.length`, context);
        assert.equal(actual, expected, `selected query matching: ${sql}`);
    }
}

(async () => {
    await recorderBudgets();
    await analyticsRate();
    await xhrReuseAndScope();
    console.log('PASS audit regressions: Recorder budgets, analytics rate, XHR reuse and query isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
