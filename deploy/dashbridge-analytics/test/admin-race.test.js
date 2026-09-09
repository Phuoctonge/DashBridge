'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('admin ignores stale responses and stale failures even when fetch ignores abort', async () => {
    const pending = [];
    const elements = new Map();
    const context = vm.createContext({ URLSearchParams, AbortController, Intl, Date,
        setTimeout: () => 1, clearTimeout() {},
        DashBridgeAnalyticsLabels: {},
        document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { value: '', addEventListener() {}, setAttribute() {} }); return elements.get(id); }, querySelectorAll: () => [] },
        fetch: (_url, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, options })) });
    vm.runInContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), context);
    vm.runInContext('globalThis.painted=[]; render=data=>painted.push(data);', context);
    const next = vm.runInContext('load()', context);
    assert(pending[0].options.signal.aborted);
    pending[1].resolve({ ok: true, json: async () => 'latest' });
    await next;
    pending[0].resolve({ ok: true, json: async () => 'stale' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(context.painted), ['latest']);
    const old = vm.runInContext('load()', context);
    const current = vm.runInContext('load()', context);
    pending[3].resolve({ ok: true, json: async () => 'newest' }); await current;
    elements.get('status').textContent = 'current';
    pending[2].reject(new Error('stale error')); await old;
    assert.equal(elements.get('status').textContent, 'current');
});
