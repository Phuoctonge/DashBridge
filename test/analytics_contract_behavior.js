'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/analytics-contract.js', 'utf8'), context);
const contract = context.DashBridgeAnalyticsContract;

assert(contract.normalize({ featureId: 'grafana.panel.fill_removed', signal: 'changed',
    dimensions: { surface: 'dashbridge', state: 'enabled' } }));
assert(contract.normalize({ featureId: 'confluence.fix_activated', signal: 'effective',
    dimensions: { state: 'enabled' } }),
'the isolated Confluence bridge must be able to route and record effective evidence');
assert(contract.normalize({ featureId: 'extension.data_migration', signal: 'lifecycle', dimensions: {} }),
    'a successful data migration must pass the analytics contract');
assert.strictEqual(contract.normalize({ featureId: 'grafana.panel.fill_removed', signal: 'changed',
    dimensions: { url: 'https://secret.example' } }), null, 'arbitrary dimensions must be rejected');
assert.strictEqual(contract.normalize({ featureId: 'unknown.feature', signal: 'used', dimensions: {} }), null);
assert.strictEqual(contract.normalize({ featureId: 'popup.opened', signal: 'used', dimensions: {}, email: 'x@y.z' }), null);
assert.strictEqual(contract.bucket(1), '1');
assert.strictEqual(contract.bucket(5), '2_5');
assert.strictEqual(contract.bucket(9), '6_10');
assert.strictEqual(contract.bucket(100), '11_plus');
console.log('PASS analytics contract rejects unknown features and sensitive metadata');
