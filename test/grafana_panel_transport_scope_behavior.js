'use strict';
/* global EventTarget, performance */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const query = { refId: 'A', expr: 'node_load1{instance="vm1"}', datasource: { uid: 'prom' } };
const frame = value => ({ schema: { fields: [
    { name: 'Time', type: 'time' }, { name: 'Value', type: 'number', labels: { instance: 'vm1' } }
] }, data: { values: [[1000], [value]] } });

function createHarness({ iframe = true, capacity = false, visual = false } = {}) {
    const pending = [];
    const statuses = [];
    const events = [];
    class XHR extends EventTarget {
        open() { this.readyState = 1; this.status = 0; }
        send(body) { this.body = body; }
        getAllResponseHeaders() { return ''; }
        finish(payload, status = 200) {
            this.status = status;
            this.readyState = 4;
            this.responseText = JSON.stringify(payload);
            this.response = this.responseType === 'json' ? payload : this.responseText;
            this.dispatchEvent(new Event('readystatechange'));
        }
    }
    const context = vm.createContext({ Request, Response, Headers, URL, URLSearchParams,
        Event, performance, XMLHttpRequest: XHR, document: {},
        location: { href: 'https://grafana.test/d/uid/name', pathname: '/d/uid/name', search: '' } });
    context.window = context;
    context.fetch = (_url, init) => new Promise(resolve => pending.push({ body: init.body, resolve }));
    context.dispatchEvent = () => {};
    for (const file of ['js/shared/grafana-legend-selection.js', 'js/content/grafana-panel-definition.js',
        'js/content/grafana-network.js', 'js/content/grafana-cpu-capacity-filter.js',
        'js/content/grafana-panel-data-transforms.js', 'js/content/grafana-panel-data-runtime.js']) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    }
    context.DashBridgeGrafanaVisualEngine = context.DashBridgeGrafanaPanelDefinition;
    context.DashBridgeGrafanaTableReport = { getResponseTableFrameShape: () => null };
    const tools = { cpuCapacityFilterEnabled: capacity, removeFill: visual,
        targetQuerySignatures: [JSON.stringify(query)] };
    context.DashBridgeGrafanaPanelDataRuntime.create({
        tools, isDashboardIframe: iframe, visualMetadata: {},
        legendSelection: context.DashBridgeGrafanaLegendSelection,
        getTargetPanel: () => null, pushBoundedDiagnosticEvent: (_journal, event) => events.push(event),
        capDiagnosticJournal() {}, setRecentDiagnosticRecord() {},
        setPanelDataStatus: status => statuses.push(status), syncPanelDataStatusPresentation() {},
        responseSeriesFilterIsEnabled: () => false, syncResponseFilterPresentation() {},
        hasPersistentVisualWork: () => visual, reapplyVisualStylesAfterDataTransform() {},
        consumeVisualStylesAfterQuery() {}, registerRuntimeCleanup() {}, isThresholdRestorePending: () => false
    }).installDataInterceptor();
    return { context, tools, statuses, events,
        async start(transport, queries) {
            const body = JSON.stringify({ queries });
            if (transport === 'fetch') {
                const promise = context.fetch('/api/ds/query', { method: 'POST', body });
                await new Promise(resolve => setImmediate(resolve));
                const request = pending.shift();
                return { body: request.body, async finish(payload, status = 200) {
                    const native = new Response(JSON.stringify(payload), { status });
                    request.resolve(native);
                    const result = await promise;
                    return { payload: await result.json(), native: result === native };
                } };
            }
            const xhr = new context.XMLHttpRequest();
            xhr.responseType = transport === 'xhr-json' ? 'json' : 'text';
            xhr.open('POST', '/api/ds/query');
            xhr.send(body);
            return { body: xhr.body, async finish(payload, status = 200) {
                xhr.finish(payload, status);
                return { payload: plain(xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText)) };
            } };
        }
    };
}

const cases = [];
const test = (name, run) => cases.push({ name, run });
for (const transport of ['fetch', 'xhr-text', 'xhr-json']) {
    for (const status of [200, 503]) test(`${transport}: visual-only variable ${status} leaves panel lifecycle unchanged`, async () => {
        const harness = createHarness({ visual: true });
        const request = await harness.start(transport, [{ refId: 'metricFindQuery' }]);
        const result = await request.finish({ results: { metricFindQuery: { frames: [] } } }, status);
        assert.deepEqual(harness.statuses, []);
        assert.equal(harness.events.some(event => event.stage === 'request-start'), false);
        if (transport === 'fetch') assert.equal(result.native, true, 'variable response stays native');
    });
    test(`${transport}: visual-only panel query is still observed`, async () => {
        const harness = createHarness({ visual: true });
        const request = await harness.start(transport, [query]);
        await request.finish({ results: { A: { frames: [frame(1)] } } });
        assert.deepEqual(harness.statuses, ['loading', 'unknown']);
        assert.equal(harness.events.filter(event => event.stage === 'request-complete').length, 1);
    });
    test(`${transport}: mixed variable and panel request still settles panel data`, async () => {
        const harness = createHarness({ visual: true });
        const request = await harness.start(transport, [query, { refId: 'metricFindQuery' }]);
        await request.finish({ results: { A: { frames: [frame(1)] }, metricFindQuery: { frames: [] } } });
        assert.deepEqual(harness.statuses, ['loading', 'unknown']);
    });
    test(`${transport}: iframe helper is stripped after disabling an in-flight filter`, async () => {
        const harness = createHarness({ capacity: true });
        const request = await harness.start(transport, [query]);
        assert.deepEqual(JSON.parse(request.body).queries.map(item => item.refId), ['A', 'DB_CPU_CAPACITY_1']);
        harness.tools.cpuCapacityFilterEnabled = false;
        const result = await request.finish({ results: { A: { frames: [frame(1)] }, DB_CPU_CAPACITY_1: { frames: [frame(2)] } } });
        assert.deepEqual(result.payload, { results: { A: { frames: [frame(1)] } } });
    });
    for (const transition of ['enabled', 'disabled', 'target-changed']) {
        test(`${transport}: ${transition} removes only the request-owned capacity helper`, async () => {
            const harness = createHarness({ iframe: false, capacity: true });
            const otherQuery = { refId: 'B', expr: 'node_load1{instance="other"}', datasource: { uid: 'prom' } };
            const request = await harness.start(transport, [query, otherQuery, { refId: 'DB_CPU_CAPACITY_1', expr: 'up' }]);
            const sent = JSON.parse(request.body).queries;
            assert.deepEqual(sent.map(item => item.refId), ['A', 'B', 'DB_CPU_CAPACITY_1', 'DB_CPU_CAPACITY_2']);
            assert.deepEqual(sent[3].__dashbridgeCpuCapacityHelper.loadRefIds, ['A']);
            if (transition === 'disabled') harness.tools.cpuCapacityFilterEnabled = false;
            if (transition === 'target-changed') harness.tools.targetQuerySignatures = [JSON.stringify({ ...query, expr: 'unrelated' })];
            const otherResult = { frames: [frame(0.1)] };
            const input = { results: { A: { frames: [frame(1)] }, B: otherResult,
                DB_CPU_CAPACITY_1: { frames: [frame(17)] }, DB_CPU_CAPACITY_2: { frames: [frame(2)] } } };
            const { payload } = await request.finish(input);
            assert.deepEqual(Object.keys(payload.results), ['A', 'B', 'DB_CPU_CAPACITY_1']);
            assert.deepEqual(payload.results.B, otherResult, 'other panel data must remain native');
            assert.deepEqual(payload.results.DB_CPU_CAPACITY_1, { frames: [frame(17)] }, 'user ref sharing helper prefix survives');
            assert.equal(payload.results.A.frames.length, transition === 'enabled' ? 0 : 1,
                'enabled filter removes quiet target; disabling/changing target preserves original data');
            if (transition !== 'enabled') assert.deepEqual(payload.results.A, { frames: [frame(1)] },
                'cleanup alone must preserve every original target field and value');
            assert.equal(harness.events.some(event => event.stage === 'decode-error'), false);
        });
    }
    test(`${transport}: disabled filter adds no helper and leaves response unchanged`, async () => {
        const harness = createHarness();
        const request = await harness.start(transport, [query]);
        assert.deepEqual(JSON.parse(request.body), { queries: [query] });
        const payload = { results: { A: { frames: [frame(1)] } } };
        assert.deepEqual((await request.finish(payload)).payload, payload);
    });
}

(async () => {
    let failures = 0;
    for (const item of cases) {
        try { await item.run(); console.log(`PASS ${item.name}`); }
        catch (error) { failures++; console.error(`FAIL ${item.name}: ${error.message}`); }
    }
    assert.equal(failures, 0, `${failures}/${cases.length} transport scope cases failed`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
