'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(type, { iframe = false, prepared = true, headerOnly = false } = {}) {
    const classes = () => ({ add() {}, remove() {}, toggle() {} });
    const header = { querySelectorAll: () => [] };
    const panel = { closest() { return this; }, querySelector: selector => /header/i.test(selector) ? header : null,
        scrollIntoView() { throw new Error('native-layout-reached'); } };
    (headerOnly ? header : panel).__reactFiber$fixture = {
        memoizedProps: { panel: { type } }, return: null
    };
    const document = { documentElement: { dataset: {}, classList: classes() },
        addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
        querySelector: () => panel, querySelectorAll: () => [], getElementById: () => null };
    const listeners = new Map(), replies = [], cleanup = [];
    const window = { CSS: { escape: value => value }, innerWidth: 1400, innerHeight: 900,
        parent: { postMessage: message => replies.push(message) },
        addEventListener: (type, callback) => listeners.set(type, callback),
        removeEventListener: (type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); } };
    const context = { window, document, AbortController, Event, console: { error() {} },
        navigator: {}, location: { search: '?panelId=arbitrary-panel' }, URLSearchParams,
        requestAnimationFrame: cb => cb(), setTimeout: () => 0, clearTimeout() {},
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
    vm.createContext(context);
    for (const file of ['grafana-dom.js', 'grafana-panel-capture-runtime.js']) {
        vm.runInContext(fs.readFileSync(`js/content/${file}`, 'utf8'), context);
    }
    const runtime = window.DashBridgeGrafanaPanelCaptureRuntime.create({ isDashboardIframe: iframe,
        tools: { capturePrepared: prepared }, panelVisualState: new Map(),
        extensionOrigin: 'https://extension.test', getPanelStateKey: () => 'arbitrary-panel',
        registerRuntimeCleanup: fn => cleanup.push(fn), syncThresholdHighlightState() {} });
    document.documentElement.dataset.dashbridgeCapturePrepared = String(prepared);
    return { window, panel, classes, runtime, listeners, replies, cleanup };
}

for (const type of ['stat', 'michaeldmoore-multistat-panel']) {
    for (const iframe of [false, true]) test(`${type} compact capture refuses before layout in ${iframe ? 'iframe' : 'direct'} runtime`, async () => {
        const { window } = fixture(type, { iframe, headerOnly: iframe });
        for (let repeat = 0; repeat < 2; repeat++) {
            const result = await window.DashBridgeGrafanaBatchCapture.prepare({ panelId: 'arbitrary-panel', sessionId: `test-${repeat}` });
            assert.equal(result.ok, false);
            assert.match(result.reason, /Компактный снимок.*Stat.*не поддерживается/);
            assert.equal(await window.DashBridgeGrafanaBatchCapture.restore(`test-${repeat}`), false);
        }
    });
}
test('MAIN compact inspection only answers the extension parent and removes its listener on cleanup', () => {
    const { window, listeners, replies, cleanup } = fixture('stat', { iframe: true });
    const receive = listeners.get('message');
    const event = { source: window.parent, origin: 'https://extension.test',
        data: { action: 'dashbridgeCompactCaptureCheck', requestId: 'inspection' } };
    receive({ ...event, source: {} }); receive({ ...event, origin: 'https://other.test' });
    assert.equal(replies.length, 0);
    receive(event);
    assert.match(replies[0].error, /не поддерживается/);
    assert.equal(replies[0].requestId, 'inspection');
    cleanup.forEach(fn => fn()); assert.equal(listeners.size, 0);
});
test('iframe readiness redraws Flot between stable layout checks and acknowledges only after paint', async () => {
    const f = fixture('graph', { iframe: true }), stages = [];
    let finish;
    f.window.dispatchEvent = () => stages.push('resize');
    f.window.DashBridgeGrafanaCaptureOutput = { waitForStableLayout: async () => {
        stages.push('stable');
        if (stages.includes('redraw')) await new Promise(resolve => { finish = resolve; });
        return { status: 'stable' };
    } };
    f.window.DashBridgeGrafanaCompactLayout = { redrawFlot: (panel, ticks) => {
        assert.equal(panel, f.panel); assert.equal(ticks, false); stages.push('redraw');
    } };
    const event = { source: f.window.parent, origin: 'https://extension.test',
        data: { action: 'dashbridgeCaptureLayoutCheck', requestId: 'layout' } };
    const receive = f.listeners.get('message');
    await receive({ ...event, source: {} }); await receive({ ...event, origin: 'https://other.test' });
    assert.equal(stages.length, 0);
    const pending = receive(event);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.deepEqual(stages, ['resize', 'stable', 'redraw', 'stable']); assert.equal(f.replies.length, 0);
    await receive(event); assert.equal(stages.length, 4, 'one operation per runtime');
    finish(); await pending;
    assert.equal(f.replies[0].action, 'dashbridgeCaptureLayoutReady'); assert.equal(f.replies[0].error, '');
});
test('iframe readiness fails on deadline and suppresses replies after runtime cleanup', async () => {
    for (const clean of [false, true]) {
        const f = fixture('graph', { iframe: true }); let finish, signal;
        f.window.dispatchEvent = () => {};
        f.window.DashBridgeGrafanaCaptureOutput = { waitForStableLayout: (_panel, options) => {
            signal = options.signal; return new Promise(resolve => { finish = resolve; });
        } };
        const pending = f.listeners.get('message')({ source: f.window.parent, origin: 'https://extension.test',
            data: { action: 'dashbridgeCaptureLayoutCheck', requestId: 'layout' } });
        if (clean) { f.cleanup.forEach(fn => fn()); assert.equal(signal.aborted, true); }
        finish({ status: 'deadline' }); await pending;
        assert.equal(f.replies.length, clean ? 0 : 1);
        if (!clean) assert.match(f.replies[0].error, /не подтвердил/);
    }
});
for (const type of ['timeseries', 'graph', 'table', 'custom-plugin', '']) {
    test(`${type || 'unknown'} retains its existing compact layout path`, async () => {
        const { window } = fixture(type);
        const result = await window.DashBridgeGrafanaBatchCapture.prepare({ panelId: 'arbitrary-panel', sessionId: 'allowed' });
        assert.equal(result.reason, 'native-layout-reached');
    });
}
test('plugin identity uses bounded header fibers and does not depend on panel title or id', () => {
    const { window, panel } = fixture(' STAT ', { headerOnly: true });
    assert.equal(window.DashBridgeGrafanaDom.getPanelPluginId(panel), 'stat');
});
for (const type of ['stat', 'michaeldmoore-multistat-panel']) {
    test(`${type} ordinary capture still reaches the native layout path`, async () => {
        const { window, panel, classes, runtime } = fixture(type, { prepared: false });
        const button = { title: 'Save', classList: classes() };
        await runtime.runPanelCapture(panel, 'save', button, { classList: classes() });
        assert.equal(window.__dashbridgeLastPanelCaptureDiagnostic.error, 'native-layout-reached');
        assert.equal(window.__dashbridgeLastPanelCaptureDiagnostic.restored, true);
        assert.equal(button.disabled, false);
    });
}
