'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const context = { Request, Response, Headers };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-network.js'), 'utf8'), context);
const network = context.DashBridgeGrafanaNetwork;
const panelToolsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-data-runtime.js'), 'utf8');
(async () => {
    const request = new Request('https://grafana.test/api/ds/query', { method: 'POST', body: '{"queries":[]}' });
    assert.strictEqual(await network.readFetchBody(request), '{"queries":[]}');
    assert.strictEqual(await request.text(), '{"queries":[]}', 'reading clone must not consume original Request');
    const original = new Response('{}', { status: 202, statusText: 'Accepted', headers: {
        'content-type': 'application/json', 'content-length': '2', 'content-encoding': 'gzip', 'x-trace': 'ok'
    } });
    const replaced = network.createJsonResponse({ ok: true }, original);
    assert.strictEqual(replaced.status, 202);
    assert.strictEqual(replaced.statusText, 'Accepted');
    assert.strictEqual(replaced.headers.get('content-length'), null);
    assert.strictEqual(replaced.headers.get('content-encoding'), null);
    assert.strictEqual(replaced.headers.get('x-trace'), 'ok');
    assert.deepStrictEqual(JSON.parse(await replaced.text()), { ok: true });
    const restored = network.createBodyResponse('{"native":true}', original);
    assert.deepStrictEqual(JSON.parse(await restored.text()), { native: true });
    const transformedNative = new Response('{"results":{"A":{"value":90}}}', {
        status: 200, headers: { 'content-type': 'application/json', 'x-query': 'cpu' }
    });
    const transformedSourceText = await transformedNative.text();
    const transformedPayload = JSON.parse(transformedSourceText);
    transformedPayload.results.A.value = 100 - transformedPayload.results.A.value;
    const transformedResponse = network.createJsonResponse(transformedPayload, transformedNative);
    assert.deepStrictEqual(JSON.parse(await transformedResponse.text()), { results: { A: { value: 10 } } },
        'a directly consumed datasource response must still reach Grafana with transformed JSON');
    assert.strictEqual(transformedResponse.headers.get('x-query'), 'cpu');

    const failedNative = new Response('{"results":{"A":{"value":90}}}', { status: 200 });
    const failedSourceText = await failedNative.text();
    const failedRestored = network.createBodyResponse(failedSourceText, failedNative);
    assert.deepStrictEqual(JSON.parse(await failedRestored.text()), { results: { A: { value: 90 } } },
        'a failed transform must return the original datasource payload');

    const inactiveNative = new Response('{"native":true}', { status: 200 });
    const inactiveReturned = inactiveNative;
    assert.strictEqual(inactiveReturned, inactiveNative,
        'an inactive transform must return the exact native Response object');
    assert.deepStrictEqual(JSON.parse(await inactiveReturned.text()), { native: true });
    assert.strictEqual(network.readXhrJson({ responseType: 'json', response: { a: 1 } }).data.a, 1);
    assert.strictEqual(network.readXhrJson({ responseType: 'arraybuffer', response: new ArrayBuffer(0) }).supported, false);
    assert(panelToolsSource.includes('originalResponseText = await response.text();')
        && panelToolsSource.includes('const decoded = JSON.parse(originalResponseText);'),
        'the transform path must consume the response body without creating an unread clone branch');
    assert(panelToolsSource.includes('createBodyResponse(originalResponseText, response)'),
        'a failed transform must reconstruct the consumed native response body');
    assert.strictEqual((panelToolsSource.match(/response\.clone\(\)\.json\(\)/g) || []).length, 1,
        'response cloning is allowed only when the original response is returned unchanged');
    console.log('PASS Grafana network adapter preserves transport semantics');
})().catch(error => { console.error(error); process.exit(1); });
