'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
let local = { dashbridge_profiles: [{ id: 'p1', name: 'secret', panels: [
    { id: 'panel-secret', src: 'https://grafana.secret/d/x', tools: { removeFill: true, thresholdEnabled: true } },
    { id: 'panel-two', src: 'https://grafana.secret/d/y', tools: { removeFill: true } }
] }] };
const sync = { module_grafana: true, module_jira: false, confluenceScrollFixEnabled: true,
    grafanaCompactScreenshot: true };
const localArea = {
    async get(keys) {
        if (keys === null) return clone(local);
        return { dashbridgeAnalyticsState: clone(local.dashbridgeAnalyticsState) };
    },
    async set(values) { local = { ...local, ...clone(values) }; }
};
const syncArea = { async get() { return clone(sync); } };
const requests = [];
let timestamp = Date.parse('2026-09-03T10:23:00Z');
let sequence = 0;
const context = {
    globalThis: null,
    chrome: { storage: { local: localArea, sync: syncArea }, runtime: { getManifest: () => ({ version: '2.4.2' }) } },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    fetch: async (...args) => { requests.push(args); return { ok: true, status: 200 }; },
    setTimeout,
};
context.globalThis = context;
vm.createContext(context);
['js/shared/analytics-contract.js', 'js/shared/analytics-config.js', 'js/background-analytics.js']
    .forEach(file => vm.runInContext(fs.readFileSync(file, 'utf8'), context));
const config = { endpoint: 'https://analytics.invalid/v1/events/batch', batchSize: 100,
    queueLimit: 2000, minimumSendIntervalMs: 0 };
const analytics = context.DashBridgeBackgroundAnalytics.create({
    contract: context.DashBridgeAnalyticsContract, config, storageArea: localArea,
    syncStorageArea: syncArea, runtimeApi: context.chrome.runtime,
    fetchFn: context.fetch, randomUUID: context.crypto.randomUUID, now: () => timestamp
});

(async () => {
    await analytics.track({ featureId: 'popup.opened', signal: 'used', dimensions: {} });
    await analytics.track({ featureId: 'popup.opened', signal: 'used', dimensions: {} });
    let state = await analytics.loadState();
    const popup = state.aggregates.find(item => item.featureId === 'popup.opened');
    assert.strictEqual(popup.count, 2, 'equal events in one hour must aggregate');
    assert.strictEqual(popup.periodStart, '2026-09-03T10:00:00.000Z');
    const fill = state.aggregates.find(item => item.featureId === 'grafana.panel.fill_removed' && item.signal === 'configured');
    assert.strictEqual(fill.dimensions.countBucket, '2_5');
    assert(state.aggregates.some(item => item.featureId === 'grafana.panel.threshold_notification'
        && item.signal === 'configured'), 'enabled thresholds use the notification default');
    assert(state.aggregates.some(item => item.featureId === 'tdm.photos_changed'
        && item.signal === 'configured'), 'the TDM photo default is represented even before first save');
    assert(state.aggregates.some(item => item.featureId === 'grafana.panel.compact_capture'
        && item.signal === 'configured'), 'the shared prepared-capture setting must remain visible without repeated clicks');
    assert(!state.aggregates.some(item => item.featureId === 'grafana.panel.series_highlight'
        && item.signal === 'configured'), 'child settings must not count without their parent feature');
    const serialized = JSON.stringify(state);
    assert(!serialized.includes('grafana.secret') && !serialized.includes('panel-secret') && !serialized.includes('secret'),
        'snapshot must never persist profile, panel or URL values');
    await analytics.send();
    assert.strictEqual(requests.length, 1);
    const body = JSON.parse(requests[0][1].body);
    assert.match(body.installationId, /^[a-zA-Z0-9-]{16,80}$/);
    assert.strictEqual(body.droppedAggregates, 0);
    assert(body.events.every(event => Object.keys(event.dimensions).every(key => !['url', 'title', 'name'].includes(key))));
    const rejected = await analytics.track({ featureId: 'popup.opened', signal: 'used', dimensions: { email: 'x@y.z' } });
    assert.strictEqual(rejected.ok, false);
    await analytics.track({ featureId: 'grafana.panel.fill_removed', signal: 'effective',
        dimensions: { surface: 'dashbridge', state: 'enabled' } });
    await analytics.track({ featureId: 'grafana.panel.fill_removed', signal: 'effective',
        dimensions: { surface: 'dashbridge', state: 'enabled' } });
    state = await analytics.loadState();
    const effective = state.aggregates.filter(item => item.featureId === 'grafana.panel.fill_removed'
        && item.signal === 'effective');
    assert.strictEqual(effective.length, 1);
    assert.strictEqual(effective[0].count, 1, 'effective evidence is deduplicated per day');
    timestamp += 3_600_000;
    await analytics.track({ featureId: 'popup.opened', signal: 'used', dimensions: {} });
    state = await analytics.loadState();
    assert(state.aggregates.some(event => event.periodStart === '2026-09-03T11:00:00.000Z'));

    const concurrentLocal = {};
    let releaseInitialRead;
    const initialRead = new Promise(resolve => { releaseInitialRead = resolve; });
    const concurrentArea = {
        async get(keys) {
            if (keys === null) return clone(concurrentLocal);
            await initialRead;
            return { dashbridgeAnalyticsState: clone(concurrentLocal.dashbridgeAnalyticsState) };
        },
        async set(values) { Object.assign(concurrentLocal, clone(values)); }
    };
    const concurrentAnalytics = context.DashBridgeBackgroundAnalytics.create({
        contract: context.DashBridgeAnalyticsContract, config: { ...config, minimumSendIntervalMs: 0 },
        storageArea: concurrentArea, syncStorageArea: syncArea, runtimeApi: context.chrome.runtime,
        fetchFn: context.fetch, randomUUID: context.crypto.randomUUID, now: () => timestamp
    });
    const tracked = concurrentAnalytics.track({ featureId: 'popup.opened', signal: 'used', dimensions: {} });
    const sent = concurrentAnalytics.send();
    releaseInitialRead();
    await Promise.all([tracked, sent]);
    const concurrentState = await concurrentAnalytics.loadState();
    assert.equal(concurrentState.inflight.length, 0, 'an alarm must not race the first storage load');
    assert.equal(concurrentState.aggregates.length, 0, 'the serialized alarm must send the newly tracked aggregate');
    console.log('PASS background analytics aggregates, snapshots, validates and batches anonymously');
})().catch(error => { console.error(error); process.exit(1); });
