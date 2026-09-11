'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the production message branch; only browser scheduling and renderer data are substituted.
const source = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
const start = source.indexOf("        if (event.data?.action === 'collectPanelReportSnapshot')");
const end = source.indexOf("        if (event.data?.action === 'dashbridgeCapturePreparedDefaultChanged'", start);
assert(start > 0 && end > start);
function harness() {
    let current = { state: 'no_data', series: [] }, sequence = 0, observer;
    const timers = new Map(), frames = new Map(), listeners = new Map(), messages = [];
    const document = { documentElement: {}, querySelectorAll: () => [] };
    const window = {
        __dashbridgePanelToolsVisualMetadata: { responseDataStatus: { kind: 'loading' } },
        DashBridgeGrafanaVisualEngine: { collectPanelReportSnapshot: () => current },
        parent: { postMessage: message => messages.push(message) },
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: name => listeners.delete(name)
    };
    const cancellers = new Map();
    const context = vm.createContext({ window, document, isDashboardIframe: true, extensionOrigin: 'chrome-extension://test',
        getTargetPanel: () => document, panelReportSnapshotCancellers: cancellers,
        attachCpuCapacityToReportSnapshot: snapshot => snapshot,
        requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: id => frames.delete(id),
        setTimeout: (callback, delay = 0) => { timers.set(++sequence, { callback, delay }); return sequence; },
        clearTimeout: id => timers.delete(id),
        MutationObserver: class { constructor(callback) { observer = this; this.callback = callback; } observe() {} disconnect() { this.disconnected = true; } }
    });
    vm.runInContext('globalThis.handle = async event => {' + source.slice(start, end) + '}', context);
    const runTimers = deadline => {
        for (const [id, timer] of [...timers]) if ((timer.delay >= 1000) === deadline) {
            timers.delete(id); timer.callback();
        }
    };
    return { messages, timers, frames, cancellers, listeners,
        start: () => context.handle({ data: { action: 'collectPanelReportSnapshot', requestId: 'test', timeoutMs: 5000 } }),
        ready() { current = { state: 'ok', series: [{ name: 'server', value: 42 }] }; window.__dashbridgePanelToolsVisualMetadata.responseDataStatus.kind = 'data'; },
        settled: () => listeners.get('dashbridgePanelDataSettled')?.(),
        mutate: () => observer.callback(), runTimers,
        assertClean() { assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(listeners.size, 0); assert.equal(cancellers.size, 0); assert(observer.disconnected); }
    };
}
(async () => {
    for (const trigger of ['settled', 'mutate']) {
        const h = harness(), pending = h.start();
        h.ready(); h[trigger](); h[trigger](); h.runTimers(false);
        await Promise.resolve(); await Promise.resolve();
        assert.equal(h.messages.length, 1, 'ready data must return without running any offscreen animation frame');
        await pending; assert.equal(h.messages[0].snapshot.series[0].value, 42); h.assertClean();
    }
    const cancelled = harness(), pending = cancelled.start();
    cancelled.settled(); cancelled.cancellers.get('test')(); cancelled.ready(); cancelled.runTimers(false);
    await pending; assert.equal(cancelled.messages.length, 0); cancelled.assertClean();
    const timed = harness(), timeout = timed.start();
    timed.mutate(); timed.runTimers(true); await timeout;
    assert.equal(timed.messages[0].snapshot.state, 'timeout'); timed.assertClean();
    console.log('PASS offscreen report settlement/remount without animation frames; cancel and deadline cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
