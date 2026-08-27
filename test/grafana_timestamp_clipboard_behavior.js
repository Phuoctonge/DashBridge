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

const html = fs.readFileSync('popup.html', 'utf8');
const source = fs.readFileSync('js/popup/popup-grafana-links.js', 'utf8');
assert(html.includes('id="grafanaTimestampReadBtn"')
    && html.includes('id="grafanaTimestampFrom"')
    && html.includes('id="grafanaTimestampTo"')
    && html.indexOf('js/shared/grafana-time.js') < html.indexOf('js/popup/popup-grafana-links.js'),
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
