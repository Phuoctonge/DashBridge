'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
async function run({ status = 'applied', scenario = 'success', tools = { convertMemToUsed: true } } = {}) {
    let ticks = 0, refreshes = 0, listener, cleared = 0;
    const diagnostic = { nextEventId: 5, activeRequests: 0, events: [] };
    const context = { URL, Math, Date: { now: () => ticks * 100 }, location: { origin: 'https://grafana.example' } };
    context.window = context;
    context.__dashbridgeDataInterceptorDiagnostic = diagnostic;
    context.addEventListener = (_, callback) => { listener = callback; };
    context.removeEventListener = () => { listener = null; cleared++; };
    context.setTimeout = (callback, delay) => {
        if (delay === 20000) return 1;
        queueMicrotask(() => { ticks++; callback(); }); return 2;
    };
    context.clearTimeout = () => {};
    context.postMessage = data => listener({ source: context, origin: context.location.origin,
        data: { action: 'panelToolsApplied', requestId: data.requestId, commandStatus: status, failureCode: 'visual_verification_failed' } });
    // vm wraps the global object; use its own window as MessageEvent.source.
    context.document = { querySelector: () => scenario === 'no-button' ? null : { click() {
        refreshes++;
        if (scenario === 'stale') return;
        diagnostic.nextEventId = 8;
        diagnostic.events = [
            { id: 6, stage: 'request-start', requestId: 'new' },
            { id: 7, stage: 'transform', requestId: scenario === 'unrelated' ? 'old' : 'new', invertIdle: true,
                convertMemToUsed: true, sourceFilterEnabled: scenario !== 'filter-missing',
                cpuCapacityFilterEnabled: tools.cpuCapacityFilterEnabled === true,
                memoryTransform: { applied: scenario !== 'memory-failed' } },
            { id: 8, stage: 'request-complete', requestId: 'new', outcome: scenario === 'http-error' ? 'http-error' : 'transformed' },
        ];
    } } };
    context.ensureGrafanaRuntime = async () => ({ ok: true });
    vm.createContext(context);
    vm.runInContext(`postMessage = data => listenerProxy(data, window)`, context);
    context.listenerProxy = (data, source) => listener({ source, origin: context.location.origin,
        data: { action: 'panelToolsApplied', requestId: data.requestId, commandStatus: status, failureCode: 'visual_verification_failed' } });
    context.chrome = { tabs: { get: async () => ({ id: 1, url: 'https://grafana.example/d/x' }) },
        scripting: { executeScript: async options => [{ result: await vm.runInContext('(' + options.func.toString() + ')', context)(...options.args) }] } };
    vm.runInContext(fs.readFileSync('js/shared/grafana-command.js', 'utf8'), context);
    const result = await context.runGrafanaCommand({ tabId: 1, command: 'applyPanelTools', payload: { tools }, refresh: true });
    assert.strictEqual(listener, null);
    assert.strictEqual(cleared, 1);
    return { result, refreshes };
}
(async () => {
    const failed = await run({ status: 'error' });
    assert.strictEqual(failed.result.ok, false); assert.strictEqual(failed.refreshes, 0);
    assert.strictEqual((await run()).result.ok, true);
    for (const [scenario, reason] of [['stale', 'transform-timeout'], ['unrelated', 'transform-timeout'],
        ['memory-failed', 'memory-transform-not-applied'], ['http-error', 'refresh-query-error'], ['no-button', 'refresh-unavailable']]) {
        assert.strictEqual((await run({ scenario })).result.reason, reason);
    }
    assert.strictEqual((await run({ tools: { removeFill: true } })).result.ok, true);
    assert.strictEqual((await run({ tools: { seriesQueryFilterEnabled: true } })).result.ok, true);
    assert.strictEqual((await run({ tools: { cpuCapacityFilterEnabled: true } })).result.ok, true);
    assert.strictEqual((await run({ tools: { seriesQueryFilterEnabled: true }, scenario: 'filter-missing' })).result.reason, 'transform-timeout');
    console.log('batch Grafana command behavior tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
