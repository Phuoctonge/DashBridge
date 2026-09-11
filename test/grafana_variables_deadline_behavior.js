'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/content/grafana-variables-runtime.js', 'utf8');
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness() {
    let now = 0, sequence = 0;
    const events = new Map(), output = [], timers = new Map(), imports = [], refreshes = [], changes = [];
    let importImpl, refreshImpl;
    const variable = { state: { name: 'server', type: 'query', options: [], value: 'a' },
        changeValueTo: value => changes.push(value), refreshOptions: () => refreshImpl() };
    const element = { __reactFiberAudit: { memoizedProps: { scene: {
        state: { $variables: { state: { variables: [variable] } } }
    } } } };
    const context = vm.createContext({ name: 'dashbridge-iframe', parent: {}, Date: { now: () => now },
        System: { import: () => { imports.push(now); return importImpl(); } },
        document: { querySelectorAll: () => [element], addEventListener: (name, fn) => events.set(name, fn),
            removeEventListener: name => events.delete(name), dispatchEvent: event => output.push(event.detail) },
        addEventListener() {}, removeEventListener() {},
        CustomEvent: class { constructor(name, args) { this.detail = args.detail; } },
        setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimeout: id => timers.delete(id) });
    const healthy = () => Promise.resolve({});
    importImpl = healthy; refreshImpl = healthy;
    const start = () => vm.runInContext(source, context);
    start();
    return { output, timers, imports, refreshes, changes, start, stop: () => context.DashBridgeGrafanaVariablesRuntime.stop(),
        setImport: fn => { importImpl = fn; }, setRefresh: fn => { refreshImpl = fn; },
        request: (id, operation = 'read') => events.get('dashbridgeVariablesRequest')({ detail: {
            requestId: id, operation, name: 'server', values: ['b'] } }),
        async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) {
            timers.delete(id); timer.fn();
        } await flush(); }
    };
}
(async () => {
    for (const mode of ['import', 'refresh']) {
        const h = harness(), hung = deferred();
        if (mode === 'import') h.setImport(() => hung.promise); else h.setRefresh(() => hung.promise);
        let settled = false;
        void h.request('old', mode === 'refresh' ? 'refresh' : 'set').then(() => { settled = true; });
        await flush(); await h.advance(20001);
        assert.equal(settled, true, `${mode} must settle by the MAIN deadline`);
        assert.equal(h.output.length, 1); assert.equal(h.output[0].requestId, 'old'); assert(h.output[0].error);
        const next = deferred(); h.setImport(() => next.promise);
        const retry = h.request('current'); await flush();
        hung.resolve({}); await flush();
        assert.deepEqual(h.changes, [], 'late import may not perform the timed-out set');
        const before = h.imports.length;
        await h.request('duplicate');
        assert.equal(h.imports.length, before, 'late old completion may not unlock the current request');
        next.resolve({}); await retry;
        assert.deepEqual(h.output.map(item => item.requestId), ['old', 'current']);
        assert.equal(h.timers.size, 0, 'success and deadline release timers');
    }
    const h = harness(), hung = deferred(); h.setImport(() => hung.promise);
    let settled = false; void h.request('stopped', 'set').then(() => { settled = true; }); await flush();
    h.stop(); await flush(); assert.equal(settled, true, 'stop settles a hung adapter');
    assert.equal(h.timers.size, 0); assert.deepEqual(h.output, []);
    h.setImport(() => Promise.resolve({})); h.start(); await h.request('new-generation');
    hung.resolve({}); await flush();
    assert.deepEqual(h.output.map(item => item.requestId), ['new-generation']);
    assert.deepEqual(h.changes, [], 'late old generation cannot mutate variables');
    console.log('PASS variables import/refresh deadline, retry, stop, late result and generation ownership');
})().catch(error => { console.error(error); process.exitCode = 1; });
