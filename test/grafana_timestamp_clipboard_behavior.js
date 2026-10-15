'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { URL, Date, Number, String, RegExp };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-time.js', 'utf8'), context);

const range = context.parseGrafanaUrlTimeRange(
    'https://grafanakns.mos.ru/d/example/dashboard?from=2026-08-26T20%3A00%3A00.000Z&to=2026-08-26T20%3A48%3A00.000Z'
);
assert.deepStrictEqual(JSON.parse(JSON.stringify(range)), {
    from: 1787774400000,
    to: 1787777280000
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.parseGrafanaUrlTimeRange(
    'https://grafana.example/d/test?from=1787774400000&to=1787777280000'
))), { from: 1787774400000, to: 1787777280000 });
assert.strictEqual(context.parseGrafanaUrlTimeRange(
    'https://grafana.example/d/test?from=now-1h&to=now'
), null, 'relative ranges must not become unstable Django timestamps');
assert.strictEqual(context.parseGrafanaUrlTimeRange(
    'https://grafana.example/d/test?from=1787777280000&to=1787774400000'
), null, 'reversed ranges must be rejected');

const html = fs.readFileSync('pages/popup/popup.html', 'utf8');
const source = fs.readFileSync('pages/popup/popup-grafana-links.js', 'utf8');
assert(html.includes('id="grafanaTimestampReadBtn"')
    && html.includes('id="grafanaTimestampFrom"')
    && html.includes('id="grafanaTimestampTo"')
    && html.indexOf('js/shared/grafana-time.js') < html.indexOf('popup-grafana-links.js'),
    'the popup must load the time parser before the Django timestamp controls');
assert(source.includes("chrome.tabs.query({ active: true, currentWindow: true })")
    && source.includes("navigator.clipboard.writeText(output.textContent)")
    && source.includes("chrome.storage.session || chrome.storage.local")
    && source.includes("const storageTtlMs = 3 * 60 * 1000")
    && source.includes("timestampStorage.set({ [storageKey]: { ...range, savedAt: Date.now() } })")
    && source.includes("timestampStorage.get([storageKey]")
    && source.includes("timestampStorage.remove(storageKey)"),
    'the tool must read the active tab, retain the range for three minutes, and copy each endpoint independently');

console.log('PASS Grafana URL time converts to copyable Django millisecond timestamps');
for (const value of ['2026-02-30T12:00:00Z', '2026-02-29T12:00:00+03:00', '2026-04-31 12:00:00']) {
    assert.strictEqual(context.parseGrafanaAbsoluteTime(value), null, 'impossible calendar date is not an instant');
}
assert.strictEqual(context.parseGrafanaAbsoluteTime('2024-02-29T12:00:00.123+03:00'), Date.parse('2024-02-29T12:00:00.123+03:00'));
assert.strictEqual(context.parseGrafanaAbsoluteTime('2026-08-26'), Date.parse('2026-08-26'), 'URL date-only semantics remain UTC');
assert.strictEqual(context.parseGrafanaAbsoluteTime('2026-08-26 22:57:39'), new Date(2026,7,26,22,57,39).getTime());
for (const value of ['2026-01-01T24:00:00Z', '2026-01-01T12:60:00Z', '2026-01-01T12:00:00+24:00']) {
    assert.strictEqual(context.parseGrafanaAbsoluteTime(value),null);
}
for (const value of ['2026-02-30T12:00:00+0300', '2026-02-30 12:00:00 GMT+0300']) {
    assert.strictEqual(context.parseGrafanaAbsoluteTime(value),null,'native timezone fallback must not bypass calendar validation');
}
for (const value of ['2024-02-29T12:00:00+0300', '2024-02-29 12:00:00 GMT+0300']) {
    assert.strictEqual(context.parseGrafanaAbsoluteTime(value), Date.parse(value));
}

async function popupRegression() {
    const elements = new Map();
    for (const id of ['grafanaTimestampReadBtn', 'grafanaTimestampResult', 'grafanaTimestampFrom',
        'grafanaTimestampTo', 'grafanaTimestampStatus']) {
        elements.set(id, { textContent: '', hidden: true, handlers: {},
            style: { display: '', removeProperty(name) { delete this[name]; } },
            classList: { toggle() {} }, addEventListener(name, handler) { this.handlers[name] = handler; } });
    }
    const activeUrl = 'https://grafana.example/d/source?from=1787774400000&to=1787777280000'
        + '&var-instance=one&var-instance=two&timezone=Europe%2FMoscow&secret=private';
    const opened = [];
    const popup = { URL, Date, Number, String, RegExp, console, DashBridgeAnalytics: undefined,
        document: { addEventListener() {}, getElementById: id => elements.get(id) },
        window: { close() {} },
        chrome: { runtime: {}, tabs: {
            query(options, callback) {
                assert.deepStrictEqual(JSON.parse(JSON.stringify(options)), { active: true, currentWindow: true });
                const tabs = [{ id: 42, url: activeUrl }];
                if (callback) callback(tabs);
                else return Promise.resolve(tabs);
            },
            update(id, options) { assert.strictEqual(id, 42); opened.push(new URL(options.url)); }
        }, storage: {
            sync: { get(keys, callback) { callback({ grafanaKeepParams: 'from, to, var-instance, timezone' }); } },
            session: { get(keys, callback) { callback({}); }, set() {}, remove() {} }
        } }
    };
    vm.createContext(popup);
    vm.runInContext(fs.readFileSync('js/shared/grafana-time.js', 'utf8'), popup);
    vm.runInContext(source, popup);
    popup.setupGrafanaTimestampTool();
    const status = elements.get('grafanaTimestampStatus');
    // Reproduce popup-core's tab-change cleanup before the next user action.
    status.style.display = 'none';
    await elements.get('grafanaTimestampReadBtn').handlers.click();
    assert(status.textContent.includes('Готово.'), 'a fresh result must be produced');
    assert.notStrictEqual(status.style.display, 'none', 'a fresh status must be visible after tab switching');
    popup.openGrafana('https://grafana.example/d/target?var-instance=old&orgId=7&refresh=10s');
    assert.deepStrictEqual(opened[0].searchParams.getAll('var-instance'), ['one', 'two'],
        'all selected instances must replace the target default in source order');
    assert.strictEqual(opened[0].searchParams.get('from'), '1787774400000');
    assert.strictEqual(opened[0].searchParams.get('to'), '1787777280000');
    assert.strictEqual(opened[0].searchParams.get('timezone'), 'Europe/Moscow');
    assert.strictEqual(opened[0].searchParams.get('orgId'), '7');
    assert.strictEqual(opened[0].searchParams.get('refresh'), '10s');
    assert.strictEqual(opened[0].searchParams.has('secret'), false, 'unlisted parameters must not leak');
    console.log('PASS Popup tab-switch status and multi-value Grafana link transfer');
}
popupRegression().catch(error => { console.error(error); process.exitCode = 1; });
