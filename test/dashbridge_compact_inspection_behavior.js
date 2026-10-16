'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture({ post = true, autoLayout = true } = {}) {
    const listeners = new Set(), timers = new Map(), styles = new Map();
    let timerId = 0, captures = 0;
    const card = { style: {
        getPropertyValue: key => styles.get(key) || '', getPropertyPriority: () => '',
        setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key)
    }, classList: { add() {}, remove() {} } };
    const frame = { src: 'https://grafana.test/d-solo/test?panelId=arbitrary', isConnected: true,
        contentWindow: {}, closest: () => card, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 520 }) };
    const scope = { URL, Blob, console, document: {},
        setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => fn(),
        window: { scrollX: 0, scrollY: 0, innerWidth: 1200, innerHeight: 800, scrollTo() {},
            addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn),
            DashBridgeGrafanaCaptureOutput: { fitPreparedSize: () => ({ left: 0, top: 0, width: 1000, height: 520 }),
                crop: async () => ({ blob: new Blob(['png']) }) } },
        chrome: { storage: { sync: { set() {} } }, tabs: { getCurrent: async () => ({ windowId: 1 }) },
            runtime: { sendMessage: async () => { captures++; return { ok: true, dataUrl: 'png' }; } } } };
    vm.createContext(scope);
    vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-capture.js', 'utf8'), scope);
    const capture = scope.DashBridgeCapture.create({ getPanels: () => [], getDefaultCapturePrepared: () => true,
        setDefaultCapturePrepared() {}, getCompactCaptureDimensions: () => ({ width: 1000, height: 520 }),
        forceLoadPanel() {}, postToDashboardFrame: (_frame, message) => {
            if (message.action === 'dashbridgeCompactCaptureCheck') return post;
            if (message.action === 'dashbridgeCaptureLayoutCheck' && autoLayout) queueMicrotask(() => reply({
                data: { action: 'dashbridgeCaptureLayoutReady', requestId: message.requestId, error: '' }
            }));
            return true;
        } });
    const start = (options = {}) => capture.capturePanel(frame, {}, { prepared: true, requestId: 'check', outputAction: 'image', ...options });
    const reply = (overrides = {}) => { for (const fn of [...listeners]) fn({ source: frame.contentWindow,
        origin: 'https://grafana.test', data: { action: 'dashbridgeCompactCaptureSupport', requestId: 'check', error: '' }, ...overrides }); };
    const restored = () => { assert.equal(listeners.size, 0); assert.equal(timers.size, 0); assert.equal(styles.size, 0); };
    return { frame, start, reply, restored, timers, styles, get captures() { return captures; } };
}

test('card inspection ignores forged and unrelated replies, then captures after a valid reply', async () => {
    const f = fixture(), pending = f.start();
    f.reply({ source: {} }); f.reply({ origin: 'https://other.test' });
    f.reply({ data: { action: 'dashbridgeCompactCaptureSupport', requestId: 'other', error: '' } });
    f.reply({ data: { action: 'other', requestId: 'check', error: '' } });
    assert.equal(f.captures, 0); assert.equal(f.styles.size, 0); assert.equal(f.timers.size, 1);
    f.reply(); assert.equal((await pending).ok, true); assert.equal(f.captures, 1); f.restored();
});
test('compact screenshot waits for the matching iframe renderer acknowledgement', async () => {
    const f = fixture({ autoLayout: false }), pending = f.start();
    f.reply();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(f.captures, 0, 'stable parent bounds do not prove the iframe renderer has resized');
    const data = { action: 'dashbridgeCaptureLayoutReady', requestId: 'check', error: '' };
    f.reply({ source: {}, data }); f.reply({ origin: 'https://other.test', data });
    f.reply({ data: { ...data, requestId: 'old-capture' } });
    assert.equal(f.captures, 0);
    f.reply({ data });
    assert.equal((await pending).ok, true); assert.equal(f.captures, 1); f.restored();
});
test('renderer timeout or iframe navigation prevents capture and restores the card', async () => {
    for (const navigate of [false, true]) {
        const f = fixture({ autoLayout: false }), pending = f.start(); f.reply();
        for (let i = 0; i < 20; i++) await Promise.resolve();
        assert.equal(f.captures, 0);
        if (navigate) {
            f.frame.src += '&navigation=1';
            f.reply({ data: { action: 'dashbridgeCaptureLayoutReady', requestId: 'check', error: '' } });
        } else {
            const timer = [...f.timers.values()][0]; assert(timer); timer.fn();
        }
        assert.equal((await pending).ok, false); assert.equal(f.captures, 0); f.restored();
    }
});
test('renderer refusal and cancellation release the listener without downloading', async () => {
    for (const cancel of [false, true]) {
        const f = fixture({ autoLayout: false }), controller = new AbortController();
        const pending = f.start({ signal: controller.signal }); f.reply();
        for (let i = 0; i < 20; i++) await Promise.resolve();
        if (cancel) controller.abort();
        else f.reply({ data: { action: 'dashbridgeCaptureLayoutReady', requestId: 'check', error: 'renderer deadline' } });
        assert.equal((await pending).ok, false); assert.equal(f.captures, 0); f.restored();
        f.reply({ data: { action: 'dashbridgeCaptureLayoutReady', requestId: 'check', error: '' } });
        assert.equal(f.captures, 0);
    }
});
test('card inspection refusal produces no screenshot and releases its listener', async () => {
    const f = fixture(), pending = f.start();
    f.reply({ data: { action: 'dashbridgeCompactCaptureSupport', requestId: 'check', error: 'Stat: compact unsupported' } });
    const result = await pending;
    assert.equal(result.errorCode, 'compact-unsupported'); assert.equal(f.captures, 0); f.restored();
});
test('card inspection timeout and failed send restore state and allow retry', async () => {
    const f = fixture();
    for (let repeat = 0; repeat < 2; repeat++) {
        const pending = f.start();
        const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 5000); timer.fn();
        assert.match((await pending).error, /не ответила/); assert.equal(f.captures, 0); f.restored();
    }
    const unavailable = fixture({ post: false });
    assert.match((await unavailable.start()).error, /не загрузилась/); unavailable.restored();
});
test('card inspection rejects a navigated or removed iframe before applying layout', async () => {
    for (const change of [f => { f.frame.src += '&changed=1'; }, f => { f.frame.isConnected = false; }]) {
        const f = fixture(), pending = f.start(); change(f); f.reply();
        assert.match((await pending).error, /перезагружена/); assert.equal(f.captures, 0); f.restored();
    }
});
