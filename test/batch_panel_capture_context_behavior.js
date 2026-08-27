'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const calls = [];
let outputCanvas = null;
let runtimeAvailable = true;
let ensureRuntimeCalls = 0;
function FakeImage() {
    this.naturalWidth = 1400;
    this.naturalHeight = 900;
}
Object.defineProperty(FakeImage.prototype, 'src', {
    set() { queueMicrotask(() => this.onload?.()); }
});
const context = {
    chrome: {
        scripting: {
            executeScript: async options => {
                calls.push(options);
                if (options.files) return [{}];
                if (options.world === 'MAIN' && !options.args?.length) {
                    return [{ result: runtimeAvailable }];
                }
                if (options.args?.length === 4) {
                    return [{ result: { ok: true, rect: { x: 10, y: 20, width: 800, height: 400, dpr: 1 } } }];
                }
                return [{ result: true }];
            }
        },
        tabs: { captureVisibleTab: async () => 'data:image/png;base64,source' }
    },
    ensureGrafanaRuntime: async () => {
        ensureRuntimeCalls++;
        return { ok: true };
    },
    Image: FakeImage,
    document: {
        createElement(tag) {
            assert.strictEqual(tag, 'canvas');
            outputCanvas = {
                width: 0, height: 0,
                getContext: () => ({ drawImage() {} }),
                toDataURL: () => 'data:image/png;base64,result'
            };
            return outputCanvas;
        }
    },
    setTimeout
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-panel-capture.js', 'utf8'), context);

(async () => {
    const found = await context.scrollGrafanaPanelIntoView({ tabId: 42, panelId: '2' });
    assert.strictEqual(found, true);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].world, 'MAIN', 'the shared Grafana DOM helper must be installed in MAIN');
    assert.strictEqual(calls[1].world, 'MAIN',
        'panel lookup and scrolling must run in the same world as the shared Grafana DOM helper');
    assert.deepStrictEqual(Array.from(calls[1].args), ['2', '', 'active']);
    calls.length = 0;
    const capture = await context.captureGrafanaPanelImage({
        tabId: 42, windowId: 7, panelId: '2', settleMs: 0,
        prepared: true, outputWidth: 1280, outputHeight: 720
    });
    assert.strictEqual(capture.dataUrl, 'data:image/png;base64,result');
    assert.deepStrictEqual([outputCanvas.width, outputCanvas.height], [1280, 720],
        'Batch compact capture must emit the configured PNG dimensions');
    assert(calls.some(call => call.args?.length === 4), 'Batch must prepare the exact Grafana panel');
    assert(calls.some(call => call.args?.length === 1), 'Batch must restore the prepared panel after capture');
    assert.strictEqual(ensureRuntimeCalls, 0,
        'Batch must reuse an already installed capture runtime instead of reinjecting it');

    calls.length = 0;
    runtimeAvailable = false;
    const fallbackCapture = await context.captureGrafanaPanelImage({
        tabId: 42, windowId: 7, panelId: '2', settleMs: 0,
        prepared: true, outputWidth: 1000, outputHeight: 520
    });
    assert(fallbackCapture, 'Batch compact capture must still work when runtime backfill is required');
    assert.strictEqual(ensureRuntimeCalls, 1,
        'Batch must install the capture runtime when the probe reports it missing');
    console.log('PASS Batch panel lookup and scrolling share the Grafana MAIN world');
})().catch(error => { console.error(error); process.exit(1); });
