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
    const window = { CSS: { escape: value => value }, innerWidth: 1400, innerHeight: 900 };
    const context = { window, document, console: { error() {} },
        navigator: {}, requestAnimationFrame: cb => cb(), setTimeout: () => 0, clearTimeout() {},
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
    vm.createContext(context);
    for (const file of ['grafana-dom.js', 'grafana-panel-capture-runtime.js']) {
        vm.runInContext(fs.readFileSync(`js/content/${file}`, 'utf8'), context);
    }
    const runtime = window.DashBridgeGrafanaPanelCaptureRuntime.create({ isDashboardIframe: iframe,
        tools: { capturePrepared: prepared }, panelVisualState: new Map(),
        getPanelStateKey: () => 'arbitrary-panel', registerRuntimeCleanup() {}, syncThresholdHighlightState() {} });
    document.documentElement.dataset.dashbridgeCapturePrepared = String(prepared);
    return { window, panel, classes, runtime };
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
