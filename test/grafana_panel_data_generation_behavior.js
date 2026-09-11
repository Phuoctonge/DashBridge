'use strict';
/* global EventTarget, performance */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const query = { refId: 'A', expr: 'up', datasource: { uid: 'prom' } };
function harness(iframe) {
    const pending = [], calls = [];
    class XHR extends EventTarget {
        open() { this.readyState = 1; }
        send() {}
        finish() {
            this.status = 200; this.readyState = 4;
            this.responseText = '{"results":{"A":{"frames":[]}}}';
            this.response = this.responseText;
            this.dispatchEvent(new Event('readystatechange'));
        }
    }
    const context = vm.createContext({ URL, URLSearchParams, Response, Request, Headers, performance, Event,
        XMLHttpRequest: XHR, document: {}, location: { href: 'https://grafana.test/d/a/b', pathname: '/d/a/b' } });
    context.window = context;
    context.fetch = async () => new Promise(resolve => pending.push(resolve));
    context.dispatchEvent = () => {};
    for (const file of ['js/shared/grafana-legend-selection.js', 'js/content/grafana-panel-definition.js',
        'js/content/grafana-network.js', 'js/content/grafana-panel-data-transforms.js', 'js/content/grafana-panel-data-runtime.js']) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    }
    context.DashBridgeGrafanaTableReport = { getResponseTableFrameShape: () => null };
    context.DashBridgeGrafanaVisualEngine = context.DashBridgeGrafanaPanelDefinition;
    const tools = { targetQuerySignatures: [JSON.stringify(query)] }, visualMetadata = {};
    function generation(name) {
        const cleanups = [];
        let threshold = false, legend = false;
        const record = action => calls.push(`${name}:${action}`);
        const runtime = context.DashBridgeGrafanaPanelDataRuntime.create({ tools, isDashboardIframe: iframe, visualMetadata,
            legendSelection: context.DashBridgeGrafanaLegendSelection, getTargetPanel: () => null,
            pushBoundedDiagnosticEvent() {}, capDiagnosticJournal() {}, setRecentDiagnosticRecord() {},
            setPanelDataStatus: () => record('status'), syncPanelDataStatusPresentation() {},
            responseSeriesFilterIsEnabled: () => false, syncResponseFilterPresentation() {},
            hasPersistentVisualWork: () => legend, isThresholdRestorePending: () => threshold,
            reapplyVisualStylesAfterDataTransform: () => record('reapply'),
            consumeVisualStylesAfterQuery: () => record('consume'),
            registerRuntimeCleanup: fn => cleanups.push(fn)
        });
        runtime.installDataInterceptor();
        return { defer(kind) { if (kind === 'threshold') threshold = true; else legend = true; },
            cleanup() { cleanups.forEach(fn => fn()); }, install: runtime.installDataInterceptor };
    }
    async function start(transport) {
        if (transport === 'xhr') {
            const xhr = new context.XMLHttpRequest(); xhr.responseType = 'text';
            xhr.open('POST', '/api/ds/query'); xhr.send(JSON.stringify({ queries: [query] }));
            return async () => xhr.finish();
        }
        const request = context.fetch('/api/ds/query', { method: 'POST', body: JSON.stringify({ queries: [query] }) });
        await new Promise(resolve => setImmediate(resolve));
        const resolve = pending.shift();
        return async () => { resolve(new Response('{"results":{"A":{"frames":[]}}}')); await request; };
    }
    return { context, calls, generation, start };
}
(async () => {
    for (const iframe of [false, true]) for (const transport of ['fetch', 'xhr']) {
        for (const kind of ['threshold', 'legend']) {
            const h = harness(iframe), previous = h.generation('previous');
            const wrapper = h.context.fetch, send = h.context.XMLHttpRequest.prototype.send;
            previous.cleanup();
            const current = h.generation('current'); current.defer(kind);
            previous.cleanup(); // Late cleanup must not clear the current owner.
            previous.install(); // A resumed old command must not reclaim it either.
            assert.equal(h.context.fetch, wrapper);
            assert.equal(h.context.XMLHttpRequest.prototype.send, send);
            await (await h.start(transport))();
            assert(h.calls.includes('current:consume'), `${iframe}/${transport}/${kind}: current restore receives response`);
            assert(!h.calls.some(call => call.startsWith('previous:')), 'disposed callbacks must not run');
        }
        const h = harness(iframe), previous = h.generation('previous'); previous.defer('legend');
        const finish = await h.start(transport);
        previous.cleanup();
        const current = h.generation('current'); current.defer('threshold');
        h.calls.length = 0;
        await finish();
        assert(h.calls.includes('current:consume'), 'in-flight completion reaches current owner');
        assert(!h.calls.some(call => call.startsWith('previous:')), 'in-flight completion cannot resurrect old callbacks');
        const finishDetached = await h.start(transport);
        current.cleanup(); h.calls.length = 0;
        await finishDetached();
        assert.deepEqual(h.calls, [], 'no callbacks after final owner cleanup');
    }
    console.log('PASS direct/iframe fetch/XHR generation binding, in-flight completion and late cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
