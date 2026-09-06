'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
const baseTime = Date.parse('2026-09-06T10:10:00Z');
let timestamp = baseTime;
let version = '2.4.3';
let serial = 0;
let code = 400;
const requests = [];
const valid = { eventId: '00000000-0000-4000-8000-000000000001', periodStart: '2026-09-06T10:00:00.000Z',
    featureId: 'popup.opened', signal: 'used', dimensions: {}, count: 2, extensionVersion: '2.4.2' };
let stored = { dashbridgeAnalyticsState: { schemaVersion: 1, aggregates: [valid,
    { ...valid, eventId: 'bad' }, { ...valid, periodStart: '2026-02-31T10:00:00.000Z' }],
inflight: [], nextRetryAt: Infinity, retryCount: -1, droppedAggregates: 0, dailyEvidence: {} } };
const area = { get: async keys => Object.fromEntries(keys.map(key => [key, stored[key]])),
    set: async values => { stored = { ...stored, ...clone(values) }; } };
const context = vm.createContext({ console, AbortController, setTimeout: () => 1, clearTimeout() {},
    chrome: { storage: { local: area, sync: { get: async () => ({}) } }, runtime: { getManifest: () => ({ version }) } },
    crypto: { randomUUID: () => `00000000-0000-4000-9000-${String(++serial).padStart(12, '0')}` } });
for (const file of ['js/shared/analytics-contract.js', 'js/background-analytics.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
(async () => {
    const owner = context.DashBridgeBackgroundAnalytics.create({ config: { endpoint: 'http://127.0.0.1/events', minimumSendIntervalMs: 3600000 },
        now: () => timestamp, fetchFn: async (_url, options) => {
            requests.push(JSON.parse(options.body));
            return { ok: code === 200, status: code, headers: { get: () => code === 429 ? '7200' : null } };
        } });
    const initial = await owner.loadState();
    assert.equal(initial.aggregates.length, 1);
    assert.equal(initial.droppedAggregates, 2);
    assert.equal(initial.nextRetryAt, 0);
    await owner.track({ featureId: 'popup.opened', signal: 'used', dimensions: {} });
    assert.equal((await owner.loadState()).aggregates.filter(e => e.featureId === 'popup.opened').length, 2);
    await owner.send();
    let state = await owner.loadState();
    assert.equal(state.inflight.length, 0);
    assert.equal(state.lastError, 'http_400');
    assert(state.quarantine.length > 0 && state.quarantine.length <= 100);
    assert(state.droppedAggregates >= state.quarantine.length + 2);
    version = '2.4.4';
    await owner.track({ featureId: 'popup.opened', signal: 'used', dimensions: {} });
    timestamp += 3600000; code = 429;
    await owner.send();
    assert.equal(state.nextRetryAt, timestamp + 7200000);
    const retry = JSON.stringify(requests.at(-1).events);
    timestamp += 3600000; await owner.send();
    assert.equal(requests.length, 2);
    timestamp += 3600000; code = 200;
    await owner.send();
    assert.equal(JSON.stringify(requests.at(-1).events), retry);
    assert.equal(state.lastSuccessAt, timestamp);
    assert.equal(state.lastError, '');
    const serverContract = require('../deploy/dashbridge-analytics/analytics-contract.js');
    assert(requests.every(serverContract.validateBatch), 'restored and new events must match collector schema');
    console.log('PASS analytics rejects poison state, separates versions, quarantines 400 and respects immutable 429 retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
