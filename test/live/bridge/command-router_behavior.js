'use strict';
const assert = require('node:assert/strict');
const { createCommandRouter } = require('./command-router');

 (async () => { const router = createCommandRouter({ token: 'test-token', handlers: {
    'legend.completeHide': async command => ({ operation: command.operation }),
} });
assert.deepEqual(await router.dispatch({ token: 'test-token', commandId: '1', capability: 'legend.completeHide', operation: 'apply', args: {} }), { status: 'executed', commandId: '1', result: { operation: 'apply' } });
await assert.rejects(router.dispatch({ token: 'bad', commandId: '2', capability: 'legend.completeHide', operation: 'apply' }), /token/i);
await assert.rejects(router.dispatch({ token: 'test-token', commandId: '3', capability: 'unknown', operation: 'apply' }), /capability/i);
await assert.rejects(router.dispatch({ token: 'test-token', commandId: '1', capability: 'legend.completeHide', operation: 'apply' }), /duplicate/i);
console.log('PASS live command router is fixed-catalog and correlated'); })().catch(error => { console.error(error); process.exitCode = 1; });
