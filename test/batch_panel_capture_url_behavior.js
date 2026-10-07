'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = { activated: new Set(), updated: new Set(), removed: new Set() };
const actualUrl = 'https://grafana.test/d/a?from=2026-08-28T12%3A11%3A29.256Z&to=2026-08-28T13%3A26%3A26.751Z&_t=123';
const expectedUrl = 'https://grafana.test/d/a?from=1787919089256&to=1787923586751';
let captureCalls = 0;
const context = {
    URL,
    chrome: {
        tabs: {
            get: async () => ({ id: 42, windowId: 7, url: actualUrl }),
            query: async () => [{ id: 42 }],
            captureVisibleTab: async () => { captureCalls++; return 'data:image/png;base64,source'; },
            onActivated: { addListener(fn) { listeners.activated.add(fn); }, removeListener(fn) { listeners.activated.delete(fn); } },
            onUpdated: { addListener(fn) { listeners.updated.add(fn); }, removeListener(fn) { listeners.updated.delete(fn); } },
            onRemoved: { addListener(fn) { listeners.removed.add(fn); }, removeListener(fn) { listeners.removed.delete(fn); } },
        },
    },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-panel-capture.js', 'utf8'), context);

(async () => {
    const source = await context.captureGrafanaVisibleTab(42, expectedUrl);
    assert.equal(source, 'data:image/png;base64,source', 'Grafana URL canonicalization must not reject capture');
    assert.equal(captureCalls, 1);
    assert.equal(listeners.activated.size, 0);
    assert.equal(listeners.updated.size, 0);
    assert.equal(listeners.removed.size, 0);
    console.log('PASS capture accepts Grafana canonicalized URL');
})().catch(error => { console.error(error); process.exitCode = 1; });
