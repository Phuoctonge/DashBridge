'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const start = source.indexOf('const discoverIframeLegendColumns =');
const end = source.indexOf('const processPanelToolsMessage =', start);
assert(start >= 0 && end > start, 'iframe legend discovery helper must remain in panel-tools runtime');
const context = {};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}; globalThis.discover = discoverIframeLegendColumns;`, context);

const cell = (tagName, value, role = '') => ({ tagName, textContent: value, getAttribute: name => name === 'role' ? role : null });
const row = values => ({
    children: values,
    querySelector: () => null,
    querySelectorAll: () => []
});
const table = rows => ({
    querySelector: selector => /graph-legend-series|LegendLabel/.test(selector) ? {} : null,
    querySelectorAll: () => rows
});
const root = tables => ({
    matches: () => false,
    querySelectorAll: () => tables
});

assert.deepStrictEqual(Array.from(context.discover(root([table([
    row([cell('TH', ''), cell('TH', 'min'), cell('TH', 'max'), cell('TH', 'current')])
])]))), ['min', 'max', 'current'],
    'legacy Float th row with blank name cell must expose native columns');
assert.deepStrictEqual(Array.from(context.discover(root([table([
    row([cell('TD', 'Series'), cell('TD', 'p95'), cell('TD', 'rate')])
])]))), ['p95', 'rate'],
    'ordinary tr/td Name row must expose dynamic columns');
console.log('PASS DashBridge iframe legacy legend column discovery');
