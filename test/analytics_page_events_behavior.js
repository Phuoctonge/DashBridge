'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = {};
const events = [];
vm.runInNewContext(fs.readFileSync('js/shared/analytics-page-events.js', 'utf8'), {
    DashBridgeAnalytics: { track() {}, opened: id => events.push(id) },
    location: { pathname: '/pages/dashbridge/dashbridge.html' },
    document: { addEventListener: (type, callback) => { listeners[type] = callback; } }
});
events.length = 0;
const click = (id, selector = '') => listeners.click({ isTrusted: true,
    target: { closest: () => ({ id, dataset: {}, matches: value => value === selector }) } });
click('applyAbsoluteTime');
click('', '.btn-fullscreen');
click('', '.btn-report-settings');
assert.deepEqual(events, [], 'owned state transitions and editor opening must not emit duplicate or premature events');
click('forceRefreshBtn');
assert.deepEqual(events, ['dashbridge.force_refresh'], 'ordinary explicit invocations remain tracked');
console.log('PASS delegated analytics excludes transitions owned by feature controllers');
