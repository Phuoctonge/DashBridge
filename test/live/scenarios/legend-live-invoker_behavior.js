'use strict';
const assert = require('node:assert/strict');
const { createLegendLiveInvoker } = require('./legend-live-invoker');

(async () => {
    const calls = [];
    const page = { evaluate: async (fn, args) => { calls.push(args); return { ok: true }; } };
    const invoker = createLegendLiveInvoker(page);
    await invoker.apply({ panelId: '12', labels: ['CPU user', 'CPU idle'], hidden: ['CPU idle'] });
    await invoker.reset({ panelId: '12' });
    assert.deepEqual(calls[0], { operation: 'apply', panelId: '12', labels: ['CPU user', 'CPU idle'], hidden: ['CPU idle'] });
    assert.deepEqual(calls[1], { operation: 'reset', panelId: '12' });
    console.log('PASS live legend invoker uses bounded operations');
})().catch(error => { console.error(error); process.exitCode = 1; });
