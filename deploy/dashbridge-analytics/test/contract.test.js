'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const serverContract = require('../analytics-contract');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(repositoryRoot, 'js/shared/analytics-contract.js'), 'utf8'), context);

test('server and extension expose the same feature catalog', () => {
    assert.deepEqual([...serverContract.featureIds].sort(), [...context.DashBridgeAnalyticsContract.featureIds].sort());
});

test('server and extension accept exactly the same signals and dimensions', () => {
    const signals = ['used', 'changed', 'configured', 'effective', 'outcome', 'lifecycle'];
    const dimensionValues = {
        surface: ['popup', 'direct_grafana', 'dashbridge', 'batch', 'worklog', 'recorder', 'tdm', 'options', 'confluence'],
        outcome: ['success', 'partial', 'cancelled', 'invalid_input', 'unsupported_page', 'permission_denied', 'auth_required', 'timeout', 'no_data', 'busy', 'error'],
        state: ['enabled', 'disabled'], mode: ['period', 'latest', 'max', 'last', 'copy', 'move', 'grouped', 'standalone'],
        method: ['single_url', 'manual_ids', 'dashboard_discovery'],
        module: ['grafana', 'grafana_links', 'grafana_batch', 'grafana_debug', 'recorder', 'jira', 'tdm', 'confluence'],
        format: ['html', 'json', 'both', 'png', 'zip', 'dashflow', 'xlsx'], theme: ['auto', 'current', 'light', 'dark'],
        selectionMode: ['all', 'whitelist', 'blacklist'], workflow: ['main', 'series'], prepared: [true, false],
        countBucket: ['1', '2_5', '6_10', '11_plus'], renderer: ['uplot', 'flot', 'unknown'],
        grafanaMajor: ['unknown', '8', '9', '10', '11', '12', '13'],
        source: ['none', 'graph', 'custom', 'cpu_capacity', 'dom', 'response'],
    };
    const acceptedByServer = (featureId, signal, dimensions) => serverContract.validateBatch({
        schemaVersion: 1, installationId: '00000000-0000-4000-8000-000000000002', droppedAggregates: 0,
        events: [{ eventId: '00000000-0000-4000-8000-000000000001',
            periodStart: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString(),
            featureId, signal, dimensions, count: 1, extensionVersion: '2.4.3' }],
    });
    for (const featureId of serverContract.featureIds) {
        for (const signal of signals) {
            const samples = [{}, ...Object.entries(dimensionValues)
                .flatMap(([key, values]) => values.map(value => ({ [key]: value })))];
            for (const dimensions of samples) {
                const clientAccepted = !!context.DashBridgeAnalyticsContract.normalize({ featureId, signal, dimensions });
                assert.equal(acceptedByServer(featureId, signal, dimensions), clientAccepted,
                    `${featureId}/${signal}/${JSON.stringify(dimensions)} differs between contracts`);
            }
        }
    }
});

test('server accepts the exact aggregate envelope and rejects extra or sensitive data', () => {
    const event = {
        eventId: '00000000-0000-4000-8000-000000000001',
        periodStart: '2026-09-03T10:00:00.000Z',
        featureId: 'grafana.panel.fill_removed', signal: 'effective',
        dimensions: { surface: 'dashbridge', state: 'enabled' }, count: 1,
        extensionVersion: '2.4.2',
    };
    const payload = { schemaVersion: 1, installationId: '00000000-0000-4000-8000-000000000002',
        droppedAggregates: 0, events: [event] };
    assert.equal(serverContract.validateBatch(payload), true);
    assert.equal(serverContract.validateBatch({ ...payload, email: 'person@example.test' }), false);
    assert.equal(serverContract.validateBatch({ ...payload, events: [{ ...event, dimensions: { url: 'https://secret.test' } }] }), false);
    assert.equal(serverContract.validateBatch({ ...payload, events: [{ ...event, error: 'private text' }] }), false);
    assert.equal(serverContract.validateBatch({ ...payload, events: [{ ...event, periodStart: '2026-99-03T10:00:00.000Z' }] }), false);
});
