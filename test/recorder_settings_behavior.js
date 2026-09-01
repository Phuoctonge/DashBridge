'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const storedWrites = [];
const removed = [];
const timers = [];
const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/recorder/recorder-settings.js', 'utf8'), context);

const ui = {
    startUrl: { value: 'https://site.example/' },
    disableCache: { checked: true },
    disableCookies: { checked: false },
};
const storage = {
    async get() {
        return {
            dashbridgeRecorderSettings: { startUrl: 'https://old.example/', disableCache: false, disableCookies: false },
            dashbridgeRecorderDraft: { startUrl: 'https://draft.example/', disableCache: true, disableCookies: true },
        };
    },
    async set(value) { storedWrites.push(value); },
    async remove(key) { removed.push(key); },
};
const settings = context.DashBridgeRecorderSettings.create({
    ui,
    storage,
    setTimer: callback => { timers.push(callback); return timers.length; },
    clearTimer: () => undefined,
});

(async () => {
    settings.schedule();
    await timers.shift()();
    assert.strictEqual(storedWrites.at(-1).dashbridgeRecorderSettings.startUrl, 'https://site.example/');
    await settings.saveDraft();
    assert(storedWrites.at(-1).dashbridgeRecorderDraft);
    await settings.restore();
    assert.strictEqual(ui.startUrl.value, 'https://draft.example/');
    assert.strictEqual(ui.disableCookies.checked, true);
    assert.deepStrictEqual(removed, ['dashbridgeRecorderDraft']);
    settings.cancelScheduled();
    assert.throws(() => context.DashBridgeRecorderSettings.create({ ui: {}, storage }), /dependencies are incomplete/);
    console.log('PASS Recorder settings own persistence, debounce and draft restoration');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
