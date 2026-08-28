'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const bootstrapSource = fs.readFileSync('js/shared/grafana-panel-bootstrap.js', 'utf8');
const policySource = fs.readFileSync('js/content/grafana-refresh-policy.js', 'utf8');

const createContext = ({ name = 'dashbridge-iframe', marker = true } = {}) => {
    const requests = [];
    const pageUrl = new URL('https://grafana.example.test/d-solo/uid/dashboard?orgId=1');
    if (marker) pageUrl.hash = 'dashbridgeRefresh=off';
    const context = {
        URL, URLSearchParams, Request, Response, Headers,
        location: { href: pageUrl.toString(), origin: pageUrl.origin },
        requests,
        async fetch(input, init) {
            requests.push({ input: String(input), method: init?.method || 'GET' });
            const url = new URL(String(input), pageUrl);
            if (/\/api\/dashboards\/uid\//.test(url.pathname)) {
                return new Response(JSON.stringify({
                    dashboard: { uid: 'uid', title: 'Dashboard', refresh: '10s' },
                    meta: { canSave: false }
                }), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '123' } });
            }
            return new Response(JSON.stringify({ results: { A: { frames: [] } } }), {
                status: 200, headers: { 'content-type': 'application/json' }
            });
        }
    };
    context.window = context;
    context.window.name = name;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(bootstrapSource, context);
    const nativeFetch = context.fetch;
    vm.runInContext(policySource, context);
    return { context, nativeFetch };
};

(async () => {
    const { context, nativeFetch } = createContext();
    assert.notStrictEqual(context.fetch, nativeFetch, 'Off iframe must install its narrow document_start fetch policy');

    const saveResponse = await context.fetch('/api/dashboards/uid/uid', { method: 'POST' });
    assert.strictEqual((await saveResponse.json()).dashboard.refresh, '10s');
    assert.strictEqual(context.__dashbridgeRefreshPolicyDiagnostic.matched, 0,
        'dashboard writes must never be altered by the read-only Off bootstrap policy');

    const dashboardResponse = await context.fetch('/api/dashboards/uid/uid');
    const dashboardPayload = await dashboardResponse.json();
    assert.strictEqual(dashboardPayload.dashboard.refresh, '');
    assert.strictEqual(dashboardPayload.dashboard.title, 'Dashboard');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(dashboardPayload.meta)), { canSave: false });
    assert.strictEqual(dashboardResponse.headers.has('content-length'), false);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.__dashbridgeRefreshPolicyDiagnostic)), {
        policy: 'off', matched: 1, applied: 1, failed: 0
    });

    const datasourceResponse = await context.fetch('/api/ds/query', { method: 'POST' });
    assert.deepStrictEqual(await datasourceResponse.json(), { results: { A: { frames: [] } } });
    assert.strictEqual(context.__dashbridgeRefreshPolicyDiagnostic.matched, 1,
        'datasource requests must bypass the refresh policy completely');

    const ordinary = createContext({ name: '', marker: true });
    assert.strictEqual(ordinary.context.fetch, ordinary.nativeFetch,
        'an ordinary Grafana tab must never install the DashBridge Off response policy');
    const interval = createContext({ marker: false });
    assert.strictEqual(interval.context.fetch, interval.nativeFetch,
        'an iframe with an explicit interval must stay on native fetch');

    console.log('PASS Grafana Off clears only the saved dashboard interval at document_start');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
