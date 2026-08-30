'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-definition.js'), 'utf8');
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const createContext = ({ pathname = '/d/dashboard-uid/name', search = '?viewPanel=2&panelId=1', fetchImpl, now = 1000 } = {}) => {
    let clock = now;
    const context = {
        URLSearchParams,
        encodeURIComponent,
        location: { pathname, search },
        document: {},
        Date: { now: () => clock },
        fetch: fetchImpl || (async () => ({ ok: false, json: async () => null }))
    };
    context.window = context;
    context.globalThis = context;
    context.DashBridgeGrafanaDom = { panelKey: root => root?.panelKey || null };
    context.advance = value => { clock += value; };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context;
};

(async () => {
    let fetchCount = 0;
    const payload = {
        dashboard: {
            panels: [{ id: 1 }, { id: 9, panels: [{ id: 2, targets: [
                { expr: 'rate(x)', refId: 'A', datasource: { uid: 'prom', type: 'prometheus' } },
                { datasource: { type: 'prometheus', uid: 'prom' }, refId: 'A', expr: 'rate(x)' },
                { hidden: true }
            ] }] }]
        }
    };
    const context = createContext({
        fetchImpl: async url => {
            fetchCount += 1;
            assert.strictEqual(url, '/api/dashboards/uid/dashboard-uid');
            await Promise.resolve();
            return { ok: true, json: async () => payload };
        }
    });
    const api = context.DashBridgeGrafanaPanelDefinition;
    assert(api && Object.isFrozen(api), 'panel-definition API must be immutable');
    assert.deepStrictEqual(plain(api.getPanelLocation()), { uid: 'dashboard-uid', panelId: '2' },
        'viewPanel must win over a stale panelId');

    const firstPromise = api.getPanelDefinition();
    const secondPromise = api.getPanelDefinition();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.strictEqual(fetchCount, 1, 'parallel requests for one panel must share one fetch');
    assert.strictEqual(first.id, 2);
    assert.strictEqual(second, first);
    assert.strictEqual(api.getCachedPanelDefinition(), first, 'the synchronous path must reuse the fetched definition');

    const signatures = plain(await api.getPanelQuerySignaturesAsync());
    assert.deepStrictEqual(signatures, [
        '{"datasource":{"type":"prometheus","uid":"prom"},"expr":"rate(x)","refId":"A"}'
    ], 'query signatures must be stable, deduplicated and omit unknown-only targets');
    assert.strictEqual(api.getQueryScopeSignature({ refId: 'A', rawSql: 'select 1', expr: 'x' }),
        '{"expr":"x","refId":"A"}', 'scope signatures must omit runtime-substituted query bodies');

    context.advance(5 * 60 * 1000 + 1);
    assert.strictEqual(api.getCachedPanelDefinition(), null, 'expired definitions must not leak through the synchronous cache');
    await api.getPanelDefinition();
    assert.strictEqual(fetchCount, 2, 'an expired definition must be fetched again');

    const explicit = await api.getPanelDefinition({ root: { panelKey: 'panel-2' }, panelId: 'panel-2' });
    assert.strictEqual(explicit.id, 2, 'explicit normalized panel ids must remain supported');

    const solo = createContext({ pathname: '/d-solo/dashboard-uid/name', fetchImpl: async () => {
        throw new Error('d-solo must not fetch the dashboard API');
    } });
    assert.strictEqual(await solo.DashBridgeGrafanaPanelDefinition.getPanelDefinition(), null);

    let retryCount = 0;
    const retry = createContext({ fetchImpl: async () => {
        retryCount += 1;
        return retryCount === 1
            ? { ok: false, json: async () => null }
            : { ok: true, json: async () => ({ dashboard: { panels: [{ id: 2 }] } }) };
    } });
    assert.strictEqual(await retry.DashBridgeGrafanaPanelDefinition.getPanelDefinition(), null);
    assert.strictEqual((await retry.DashBridgeGrafanaPanelDefinition.getPanelDefinition()).id, 2);
    assert.strictEqual(retryCount, 2, 'a cached failed lookup must remain retryable');

    let lruFetchCount = 0;
    const lru = createContext({ search: '?panelId=1', fetchImpl: async () => {
        lruFetchCount += 1;
        return { ok: true, json: async () => ({ dashboard: { panels: Array.from({ length: 51 }, (_, index) => ({ id: index + 1 })) } }) };
    } });
    for (let panelId = 1; panelId <= 51; panelId++) {
        await lru.DashBridgeGrafanaPanelDefinition.getPanelDefinition({ panelId: String(panelId) });
    }
    await lru.DashBridgeGrafanaPanelDefinition.getPanelDefinition({ panelId: '1' });
    assert.strictEqual(lruFetchCount, 52, 'the 50-entry LRU cap must evict the oldest panel definition');

    vm.runInContext(source, context);
    assert.strictEqual(context.DashBridgeGrafanaPanelDefinition, api, 'reinstallation must preserve cache ownership');
    console.log('PASS Grafana panel definitions keep bounded independent cache and stable query signatures');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
