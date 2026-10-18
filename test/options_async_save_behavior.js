'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function createOptions() {
    const elements = new Map(), events = new Map(), writes = [];
    let ready;
    const get = id => {
        if (!elements.has(id)) {
            let value = '';
            elements.set(id, {
            get value() { return value; }, set value(next) { value = String(next); },
            checked: false, dataset: {}, style: {}, scrollHeight: 10,
            textContent: '', innerText: '', disabled: false,
            addEventListener(type, callback) { this[type] = callback; },
            matches: () => true, querySelectorAll: () => [], setAttribute() {},
            });
        }
        return elements.get(id);
    };
    const context = vm.createContext({ console, URL, setTimeout() {},
        document: { getElementById: get, querySelector: get, querySelectorAll: () => [],
            addEventListener(type, callback) { if (type === 'DOMContentLoaded') ready = callback; else events.set(type, callback); } },
        addEventListener: (type, callback) => events.set(type, callback),
        chrome: { storage: {
            sync: { get(_keys, callback) { callback({}); }, set(values, callback) { writes.push({ values, callback }); } },
            local: { async get() { return {}; } },
        }, runtime: {} },
        DashBridgeOptionsConfigTransfer: { create() {} },
    });
    for (const file of ['js/shared/url-validation.js', 'js/shared/grafana-settings.js', 'pages/options/options.js']) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    }
    ready();
    return { get, writes, context,
        edit(value) { get('settingGrafanaKeyword').value = value; events.get('input')({ target: get('settingGrafanaKeyword') }); },
        save: () => get('saveBtn').click(),
        dirty: () => get('.save-island').dataset.dirty,
        unloadPrevented() { let prevented = false; events.get('beforeunload')({ preventDefault() { prevented = true; } }); return prevented; },
    };
}

test('Options keeps edits made while an earlier save is awaiting acknowledgement', async () => {
    const page = createOptions();
    page.edit('first'); await page.save(); page.edit('second');
    page.writes[0].callback();
    assert.equal(page.writes[0].values.grafanaIdleKeyword, 'first');
    assert.equal(page.get('settingGrafanaKeyword').value, 'second');
    assert.equal(page.dirty(), 'true');
    assert.equal(page.unloadPrevented(), true);
    await page.save(); page.writes[1].callback();
    assert.equal(page.writes[1].values.grafanaIdleKeyword, 'second');
    assert.equal(page.dirty(), 'false');
    assert.equal(page.unloadPrevented(), false);
});

test('Options excludes overlapping saves and permits retry after storage failure', async () => {
    const page = createOptions();
    page.edit('draft'); await page.save(); await page.save();
    assert.equal(page.writes.length, 1);
    page.context.chrome.runtime.lastError = { message: 'Storage unavailable' };
    page.writes[0].callback(); delete page.context.chrome.runtime.lastError;
    assert.equal(page.dirty(), 'true');
    assert.equal(page.get('saveBtn').disabled, false);
    await page.save(); page.writes[1].callback();
    assert.equal(page.dirty(), 'false');
});
