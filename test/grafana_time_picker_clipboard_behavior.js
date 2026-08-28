'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/content/grafana-time-picker-clipboard.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const context = { globalThis: {}, URL, Date, Number, String };
vm.createContext(context);
vm.runInContext(source, context);
const clipboard = context.globalThis.DashBridgeGrafanaTimePickerClipboard;

assert.deepStrictEqual(JSON.parse(JSON.stringify(clipboard.parseRange(
    '{"from":"2026-08-27 02:56:00","to":"2026-08-27 03:46:00"}'
))), { from: '2026-08-27 02:56:00', to: '2026-08-27 03:46:00' });
const localIso = milliseconds => {
    const date = new Date(milliseconds);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
assert.deepStrictEqual(JSON.parse(JSON.stringify(clipboard.parseRange(
    '{"from":"2025-04-25T10:48:00.000Z","to":"2025-04-25T12:49:00.000Z"}'
))), {
    from: localIso(Date.parse('2025-04-25T10:48:00.000Z')),
    to: localIso(Date.parse('2025-04-25T12:49:00.000Z'))
}, 'Grafana 12 UTC clipboard values must become local values accepted by Grafana 10');
assert.deepStrictEqual(JSON.parse(JSON.stringify(clipboard.parseRange(
    '{"from":"1745578080000","to":"1745585340000"}'
))), {
    from: localIso(1745578080000), to: localIso(1745585340000)
}, 'Unix milliseconds must use the same cross-version local representation');
assert.deepStrictEqual(JSON.parse(JSON.stringify(clipboard.parseRange(
    'https://grafana.example/d/test?from=now-15m&to=now'
))), { from: 'now-15m', to: 'now' });
assert.strictEqual(clipboard.parseRange('{"from":"now-1h"}'), null);
assert.strictEqual(clipboard.serializeRange({ from: 'now-15m', to: 'now' }),
    '{"from":"now-15m","to":"now"}');
assert(manifest.permissions.includes('clipboardRead') && manifest.permissions.includes('clipboardWrite'),
    'old Grafana copy/paste controls need both clipboard permissions');
assert(manifest.content_scripts[0].js.includes('js/content/grafana-time-picker-clipboard.js'),
    'the clipboard adapter must load in the top-level Grafana document');
assert(source.includes("/^apply time range$/i")
    && source.includes("const nativeButtons = [...actions.children]")
    && source.includes("enhanceNativeClipboard(nativeButtons, applyButton, picker)")
    && source.includes("event.stopImmediatePropagation()")
    && source.includes("actions.insertBefore(createButton('copy', picker), applyButton)")
    && source.includes("actions.insertBefore(createButton('paste', picker), applyButton)")
    && source.includes("new MutationObserver(schedule)"),
    'the adapter must enhance only the old picker and survive Grafana popover remounts');

console.log('PASS old Grafana time picker receives compatible copy and paste controls');
