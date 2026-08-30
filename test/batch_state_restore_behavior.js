'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const radios = {
    captureThemeMain: [{ value: 'current', checked: false }, { value: 'dark', checked: false }],
    captureThemeSeries: [{ value: 'light', checked: false }],
};
const fields = {
    compactCaptureMain: { type: 'checkbox', checked: false, dispatchEvent() {} },
    compactCaptureSeries: { type: 'checkbox', checked: true, dispatchEvent() {} },
};
const context = {
    chrome: { storage: { local: { get: async () => ({ batchState: {
        radio_captureThemeMain: 'dark', radio_captureThemeSeries: '"]',
        compactCaptureMain: true, compactCaptureSeries: false,
    } }) } } },
    DashBridgeLocalStateSchema: null,
    DashBridgeStorageWriter: { createLocal: () => ({ write: async () => {}, flush: async () => {}, checkpoint: async () => {} }) },
    document: {
        visibilityState: 'visible', addEventListener() {}, getElementById: id => fields[id] || null,
        querySelectorAll(selector) {
            const match = /input\[name="([^"]+)"\]/.exec(selector);
            return match ? radios[match[1]] || [] : [];
        },
        querySelector: () => null,
    },
    window: { addEventListener() {} }, Event: class Event {}, setTimeout, clearTimeout,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/local-state-schema.js', 'utf8'), context);
context.DashBridgeLocalStateSchema = context.globalThis.DashBridgeLocalStateSchema;
vm.runInContext(fs.readFileSync('pages/batch/batch-state.js', 'utf8'), context);

(async () => {
    const state = vm.runInContext('BatchPageState', context);
    await state.restore();
    assert.strictEqual(radios.captureThemeMain[1].checked, true, 'valid stored theme must be restored');
    assert.strictEqual(radios.captureThemeSeries[0].checked, false, 'invalid imported theme must be ignored safely');
    assert.strictEqual(fields.compactCaptureMain.checked, true, 'main compact capture preference must be restored');
    assert.strictEqual(fields.compactCaptureSeries.checked, false, 'Series compact capture preference must be restored');
    console.log('PASS Batch state safely restores validated radio values');
})().catch(error => { console.error(error); process.exitCode = 1; });
