'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const styles = new Map([['width', { value: '33%', priority: '' }]]);
const classes = new Set();
const card = { style: {
    getPropertyValue: name => styles.get(name)?.value || '',
    getPropertyPriority: name => styles.get(name)?.priority || '',
    setProperty: (name, value, priority) => styles.set(name, { value, priority }),
    removeProperty: name => styles.delete(name)
}, classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
const frame = { src: 'https://grafana.test/d-solo/a', isConnected: true, dataset: { dashbridgeRendered: 'true' },
    closest: () => card, getBoundingClientRect: () => ({ left: 1, top: 1, width: 1000, height: 520 }) };
const panels = ['a', 'b'].map(id => ({ id, title: id }));
let onCapture = async () => ({ ok: true, dataUrl: 'png' });
let downloads = 0;
let copies = 0;
let compactError = '';
let compactError = '';
let controlDisabled = false;
const control = { get disabled() { return controlDisabled; }, set disabled(value) { controlDisabled = value; } };
const scope = {
    Blob, DOMException, setTimeout: callback => setTimeout(callback, 0), clearTimeout,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    document: { body: {}, querySelectorAll: selector => selector.includes('header') ? [control] : [] },
    chrome: { storage: { sync: { set() {} } }, tabs: { getCurrent: async () => ({ windowId: 1 }) },
        runtime: { sendMessage: () => onCapture() }, downloads: { download: async () => { downloads++; } } },
    console,
    MutationObserver: class { observe() {} disconnect() {} },
    window: { scrollX: 0, scrollY: 0, innerWidth: 1280, innerHeight: 900, devicePixelRatio: 1, scrollTo() {},
        DashBridgeGrafanaCaptureOutput: {
            fitPreparedSize: () => ({ left: 10, top: 10, width: 1000, height: 520 }),
            crop: async () => ({ blob: new Blob(['png'], { type: 'image/png' }), dataUrl: 'png', width: 1000, height: 520 }),
            copy: async () => { copies++; }, filename: () => 'panel.png'
        }
    }
};
vm.createContext(scope);
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-capture.js', 'utf8'), scope);
const capture = scope.DashBridgeCapture.create({ getPanels: () => panels,
    getDefaultCapturePrepared: () => true,
    setDefaultCapturePrepared() {}, getCompactCaptureDimensions: () => ({ width: 1000, height: 520 }),
    forceLoadPanel: () => frame, postToDashboardFrame() {},
    inspectCompactCapture: async () => compactError,
    inspectCompactCapture: async () => compactError,
    documentRef: scope.document
});
const restored = () => {
    assert.equal(styles.get('width').value, '33%');
    assert.equal(styles.size, 1);
    assert.equal(classes.size, 0);
};
(async () => {
    compactError = 'Компактный снимок Stat/Multistat не поддерживается.';
    const denied = await capture.capturePanel(frame, panels[0], { requestId: 'denied', prepared: true });
    assert.equal(denied.ok, false, 'card capture must reject unsupported compact renderers before changing layout or downloading');
    assert.equal(denied.errorCode, 'compact-unsupported');
    assert.equal(downloads, 0); restored();
    compactError = '';
    compactError = 'Компактный снимок Stat/Multistat не поддерживается.';
    const denied = await capture.capturePanel(frame, panels[0], { requestId: 'denied', prepared: true });
    assert.equal(denied.ok, false, 'card capture must reject unsupported compact renderers before changing layout or downloading');
    assert.equal(denied.errorCode, 'compact-unsupported');
    assert.equal(downloads, 0); restored();
    compactError = '';
    frame.dataset.dashbridgeRendered = 'false';
    const offscreen = await capture.captureSelection([panels[0]], { allowUnrendered: true });
    assert.equal(offscreen.images.length, 1, 'prepared report capture may move an unrendered offscreen iframe into the viewport first');
    frame.dataset.dashbridgeRendered = 'true'; restored();
    let dataReady = false;
    onCapture = async () => { assert(dataReady, 'PNG must wait for selected panel data'); return { ok: true, dataUrl: 'png' }; };
    const ready = await capture.captureSelection([panels[0]], { allowUnrendered: true, waitForData: async panel => {
        assert.equal(panel.id, 'a'); assert.equal(styles.get('position').value, 'fixed');
        await new Promise(resolve => setTimeout(resolve, 5)); dataReady = true;
    } });
    assert.equal(ready.images.length, 1); restored();
    onCapture = async () => { throw new Error('must not capture a panel whose data timed out'); };
    const timeout = await capture.captureSelection([panels[0]], { waitForData: async () => { throw new Error('data timeout'); } });
    assert.equal(timeout.images.length, 0); assert.match(timeout.errors[0].error, /data timeout/); restored();
    const waitingAbort = new AbortController();
    await assert.rejects(capture.captureSelection([panels[0]], { signal: waitingAbort.signal,
        waitForData: async (_panel, signal) => {
            assert.equal(signal, waitingAbort.signal); waitingAbort.abort();
            throw new DOMException('cancelled', 'AbortError');
        }
    }), { name: 'AbortError' }); restored();
    onCapture = async () => ({ ok: true, dataUrl: 'png' });
    const visibility = [];
    const result = await capture.captureSelection(panels, { onCaptureVisibility: value => visibility.push(value) });
    assert.equal(result.images.length, 2);
    assert.deepEqual(visibility, [true, false, true, false]);
    assert.equal(downloads, 0); restored();
    let release;
    onCapture = () => new Promise(resolve => { release = resolve; });
    const pending = capture.captureSelection(panels);
    while (!release) await new Promise(resolve => setTimeout(resolve, 2));
    await assert.rejects(capture.captureSelection(panels), /захват/);
    assert.equal((await capture.capturePanel(frame, panels[0], { requestId: 'foreign', outputAction: 'copy' })).error, 'capture-in-progress');
    onCapture = async () => ({ ok: true, dataUrl: 'png' });
    release({ ok: true, dataUrl: 'png' }); await pending; restored();
    const abort = new AbortController();
    onCapture = async () => { abort.abort(); return { ok: true, dataUrl: 'png' }; };
    await assert.rejects(capture.captureSelection(panels, { signal: abort.signal }), { name: 'AbortError' });
    restored();
    onCapture = async () => ({ ok: false, error: 'capture-target-changed' });
    const failed = await capture.captureSelection(panels);
    assert.equal(failed.errors.length, 2); assert.equal(failed.images.length, 0); restored();
    onCapture = async () => ({ ok: true, dataUrl: 'png' });
    assert.equal((await capture.capturePanel(frame, panels[0], { requestId: 'copy', outputAction: 'copy', prepared: true })).ok, true);
    assert.equal(copies, 1); restored();
    assert.equal((await capture.capturePanel(frame, panels[0], { requestId: 'save', outputAction: 'save', prepared: true })).ok, true);
    assert.equal(downloads, 1); restored();
    assert.equal(controlDisabled, false); restored();
    console.log('PASS selection order, mutual exclusion, cancellation, failure restore and existing copy/save');
})().catch(error => { console.error(error); process.exitCode = 1; });
