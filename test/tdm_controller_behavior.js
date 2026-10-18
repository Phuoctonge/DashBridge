'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function createPopup(stored = {}) {
    const elements = new Map(), listeners = new Set(), writes = [], exports = [], timers = new Map();
    let ready, nextId = 0, queried = 0;
    const get = id => {
        if (!elements.has(id)) elements.set(id, { value: '', checked: false, disabled: false, style: {},
            addEventListener(type, callback) { this[type] = callback; }, focus() {} });
        return elements.get(id);
    };
    const context = vm.createContext({ console, URL, Blob,
        crypto: { randomUUID: () => String(++nextId) },
        setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id),
        document: { getElementById: get, addEventListener(_type, callback) { ready = callback; } },
        DashBridgeSyncInputWriter: { bind() {} }, DashBridgeAnalytics: { track() {}, outcome() {} },
        _tdmExportScriptInternal() {},
        chrome: { runtime: { onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
            storage: { sync: {
                get(keys, callback) { const values = { ...(Array.isArray(keys) ? {} : keys), ...stored }; if (callback) callback(values); else return Promise.resolve(values); },
                set(values) { writes.push(values); Object.assign(stored, values); },
            } },
            tabs: { query(_query, callback) { queried++; const tabs = [{ id: 7, url: 'https://web.tdm.mos.ru/chat' }]; if (callback) callback(tabs); else return Promise.resolve(tabs); } },
            scripting: { executeScript(options, callback) { return new Promise(resolve => exports.push({ options, finish(result) { if (callback) callback([{ result }]); resolve([{ result }]); } })); } },
        },
    });
    vm.runInContext(fs.readFileSync('pages/popup/popup-tdm.js', 'utf8'), context);
    ready(); get('tdmExportPhotos').checked = false;
    return { context, get, writes, exports, listeners, timers, stored, queried: () => queried };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('TDM excludes repeated starts until the current exporter finishes and allows retry', async () => {
    const page = createPopup();
    const first = page.context.tdmExport();
    const duplicate = page.context.tdmExport(); await flush();
    assert.equal(page.queried(), 1); assert.equal(page.exports.length, 1);
    assert.equal(page.get('tdmExportBtn').disabled, true);
    page.exports[0].finish({ error: 'Чат не найден' }); await first; await duplicate; await flush();
    assert.equal(page.listeners.size, 0); assert.equal(page.get('tdmExportBtn').disabled, false);
    const retry = page.context.tdmExport(); await flush();
    assert.equal(page.exports.length, 2);
    page.exports[1].finish({ error: 'Нет сообщений' }); await retry; await flush();
    assert.equal(page.get('tdmExportBtn').disabled, false);
});

test('TDM date changes require an explicitly enabled remember setting', () => {
    for (const preference of [undefined, false, true]) {
        const page = createPopup(preference === undefined ? {} : { tdmRememberDate: preference });
        page.get('tdmExportStart').value = '2026-10-17T10:00'; page.get('tdmExportEnd').value = '2026-10-17T12:00';
        page.get('tdmExportStart').change();
        assert.equal(page.writes.length, preference === true ? 1 : 0);
        if (preference === true) assert.equal(page.writes[0].tdmLastStart, '2026-10-17T10:00');
    }
});
