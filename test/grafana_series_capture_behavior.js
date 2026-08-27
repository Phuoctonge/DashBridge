'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const signatures = [JSON.stringify({ refId: 'A', alias: '' }), JSON.stringify({ refId: 'B', alias: '' })];
const params = new URLSearchParams({
    dashbridgeSeriesCapture: 'test-token',
    dashbridgeSeriesTargets: JSON.stringify(signatures)
});
const responses = [];
class FakeRequest {}
class FakeXhr {}
FakeXhr.prototype.open = function () {};
FakeXhr.prototype.send = function () {};
FakeXhr.prototype.addEventListener = function () {};
const context = {
    URLSearchParams,
    Request: FakeRequest,
    XMLHttpRequest: FakeXhr,
    location: { search: `?${params}` },
    fetch: async () => {
        const data = responses.shift();
        return { clone: () => ({ json: async () => data }) };
    }
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/content/grafana-series-capture.js'), 'utf8'), context);

const frame = names => ({ frames: [{ schema: { fields: [{ name: 'Time', type: 'time' }, ...names.map(name => ({ name, type: 'number' }))] } }] });
(async () => {
    responses.push({ results: { A: frame(['same', 'same']) } });
    await context.fetch('/api/ds/query', { body: JSON.stringify({ queries: [{ refId: 'A', datasource: { uid: 'prom-a' } }] }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    responses.push({ results: { B: frame(['other']) } });
    await context.fetch('/api/ds/query', { body: JSON.stringify({ queries: [{ refId: 'B', datasource: { uid: 'prom-b' } }] }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.__dashBridgeSeriesCapture.names)), ['same', 'same', 'other']);
    assert.strictEqual(context.__dashBridgeSeriesCapture.debug.matched, 2);
    console.log('[OK] Grafana Series capture aggregates responses and preserves duplicates');
})().catch(error => { console.error(error); process.exit(1); });
