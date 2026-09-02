'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/background-update-indicator.js', 'utf8'), context);

const calls = [];
let stored = { dashbridgeUpdateIndicator: { version: '2.4.3' } };
const actionApi = {
    setIcon: value => { calls.push(['icon', JSON.parse(JSON.stringify(value))]); return Promise.resolve(); },
    setBadgeText: value => { calls.push(['badge', value.text]); return Promise.resolve(); },
    setBadgeBackgroundColor: value => { calls.push(['color', value.color]); return Promise.resolve(); },
    setTitle: value => { calls.push(['title', value.title]); return Promise.resolve(); }
};
const storageArea = {
    get: async () => stored,
    remove: async key => { delete stored[key]; calls.push(['remove', key]); }
};
const runtimeApi = { getManifest: () => ({ version: '2.4.2' }) };
const controller = context.DashBridgeBackgroundUpdateIndicator.create({ actionApi, storageArea, runtimeApi });

(async () => {
    assert.strictEqual(await controller.restore(), true);
    assert(calls.some(([type, value]) => type === 'icon' && value.path[16] === 'icons/icon16-update.png'));
    assert(calls.some(([type, value]) => type === 'badge' && value === ''),
        'the full-height icon must not be obscured by a duplicate Chrome badge');
    assert(calls.some(([type, value]) => type === 'title' && value.includes('2.4.3')));

    calls.length = 0;
    stored = { dashbridgeUpdateIndicator: { version: '2.4.2' } };
    assert.strictEqual(await controller.restore(), false);
    assert(calls.some(([type, value]) => type === 'icon' && value.path[16] === 'icons/icon16.png'));
    assert(calls.some(([type, value]) => type === 'badge' && value === ''));
    assert(calls.some(([type]) => type === 'remove'));

    calls.length = 0;
    await controller.handleStorageChange({ dashbridgeUpdateIndicator: { newValue: { version: '2.5.0' } } }, 'local');
    assert(calls.some(([type, value]) => type === 'icon' && value.path[48] === 'icons/icon48-update.png'));
    assert.strictEqual(context.DashBridgeBackgroundUpdateIndicator.isNewerVersion('2.4.2', '2.4.2'), false);
    assert.strictEqual(context.DashBridgeBackgroundUpdateIndicator.isNewerVersion('invalid', '2.4.2'), false);
    console.log('PASS update availability persists as a service-worker-owned action indicator');
})().catch(error => { console.error(error); process.exitCode = 1; });
