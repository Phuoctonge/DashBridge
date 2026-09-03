'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const contract = require('../analytics-contract');
const labels = require('../public/labels');

test('every analytics feature has a Russian admin label', () => {
    const missing = contract.featureIds.filter(featureId => !labels.features[featureId]);
    assert.deepEqual(missing, []);
    assert.equal(labels.features['grafana.panel.fill_removed'], 'Убрана заливка графика');
});

test('every categorical dimension is rendered with a human-readable label', () => {
    const values = [
        'popup', 'direct_grafana', 'dashbridge', 'batch', 'worklog', 'recorder', 'tdm', 'options', 'confluence',
        'success', 'partial', 'cancelled', 'invalid_input', 'unsupported_page', 'permission_denied',
        'auth_required', 'timeout', 'no_data', 'busy', 'error', 'enabled', 'disabled', 'period', 'latest',
        'max', 'last', 'copy', 'move', 'grouped', 'standalone', 'single_url', 'manual_ids', 'dashboard_discovery',
        'grafana', 'grafana_links', 'grafana_batch', 'grafana_debug', 'jira', 'html', 'json', 'both', 'png',
        'zip', 'dashflow', 'xlsx', 'auto', 'current', 'light', 'dark', 'all', 'whitelist', 'blacklist',
        'main', 'series', 'true', 'false', '1', '2_5', '6_10', '11_plus', 'uplot', 'flot', 'unknown',
        '8', '9', '10', '11', '12', '13', 'none', 'graph', 'custom', 'cpu_capacity', 'dom', 'response',
    ];
    const missing = values.filter(value => !labels.values[value] && !/^\d+$/.test(value));
    assert.deepEqual(missing, []);
    assert.equal(labels.values.manual_ids, 'Список ID');
    assert.equal(labels.values.cpu_capacity, 'Количество CPU');
});
