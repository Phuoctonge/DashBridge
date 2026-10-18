'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
(async () => {
    for (const malformed of [false, true]) {
        let clones = 0; let decodes = 0; const snapshots = [];
        const observe = response => {
            const clone = response.clone.bind(response); const json = response.json.bind(response);
            response.clone = () => { clones++; return observe(clone()); };
            response.json = () => { decodes++; return json(); };
            return response;
        };
        const payload = JSON.stringify({ results: { A: { frames: [{ schema: { fields: [
            { name: 'Time', type: 'time' },
            { name: 'vm Used % (calc)', type: 'number', labels: { instance: 'vm' } },
        ] }, data: { values: [[1000, 2000], [20, 30]] } }] } } });
        const native = observe(new Response(malformed ? 'not json' : payload));
        const query = { refId: 'A', expr: 'memory_used', datasource: { uid: 'prom' } };
        const context = vm.createContext({ URL, URLSearchParams, Response, Request, Headers, performance, Event,
            XMLHttpRequest: class { open() {} send() {} }, document: {},
            location: { href: 'https://grafana.test/d/test/main', pathname: '/d/test/main' } });
        context.window = context; context.dispatchEvent = () => {};
        context.fetch = async () => native;
        for (const file of ['js/shared/grafana-legend-selection.js', 'js/shared/grafana-panel-analysis.js',
            'js/content/grafana-panel-definition.js', 'js/content/grafana-network.js',
            'js/content/grafana-panel-data-transforms.js', 'js/content/grafana-panel-data-runtime.js']) {
            vm.runInContext(fs.readFileSync(file, 'utf8'), context);
        }
        context.DashBridgeGrafanaTableReport = { getResponseTableFrameShape: () => null };
        context.DashBridgeGrafanaVisualEngine = context.DashBridgeGrafanaPanelDefinition;
        context.__dashbridgePanelAnalysisCaptureSession = { type: 'ram', signatures: [JSON.stringify(query)],
            acceptAfter: 0, settings: {}, cancelled: false, onSnapshot: snapshot => snapshots.push(snapshot) };
        const runtime = context.DashBridgeGrafanaPanelDataRuntime.create({
            tools: { targetQuerySignatures: [JSON.stringify(query)] }, isDashboardIframe: false, visualMetadata: {},
            legendSelection: context.DashBridgeGrafanaLegendSelection, getTargetPanel: () => null,
            pushBoundedDiagnosticEvent() {}, capDiagnosticJournal() {}, setRecentDiagnosticRecord() {},
            setPanelDataStatus() {}, syncPanelDataStatusPresentation() {}, responseSeriesFilterIsEnabled: () => false,
            syncResponseFilterPresentation() {}, hasPersistentVisualWork: () => true,
            reapplyVisualStylesAfterDataTransform() {}, consumeVisualStylesAfterQuery() {},
            registerRuntimeCleanup() {}, isThresholdRestorePending: () => false,
        });
        runtime.installDataInterceptor();
        const returned = await context.fetch('/api/ds/query', { method: 'POST', body: JSON.stringify({ queries: [query] }) });
        assert.equal(returned, native, 'visual-only fetch preserves native response identity');
        assert.equal(await returned.text(), malformed ? 'not json' : payload, 'observers never consume native response');
        assert.equal(decodes, 1, 'analysis and legend share one JSON decoding, including failure');
        assert.equal(clones, 1, 'one observed branch needs only one tee');
        if (!malformed) {
            assert.equal(snapshots.length, 1); assert.equal(snapshots[0].latest[0].value, 30);
            assert.equal(context.__dashbridgeRawLegendSeries[0].values[0], 30);
        } else assert.equal(snapshots.length, 0);
    }
    console.log('PASS visual-only RAM analysis and legend share decode and preserve native/fail-open response');
})().catch(error => { console.error(error); process.exitCode = 1; });
