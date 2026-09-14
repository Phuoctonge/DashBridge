'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-data-transforms-runtime.js'), 'utf8');
const context = { globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);
assert.strictEqual(typeof context.DashBridgeGrafanaPanelDataTransformsRuntime?.createWorkspace, 'function');
const original = { results: { A: { value: 1 }, Z: { value: 2 } } };
const workspace = context.DashBridgeGrafanaPanelDataTransformsRuntime.createWorkspace(original, new Set(['A']));
assert.deepStrictEqual(Object.keys(workspace.data.results), ['A']);
assert.strictEqual(workspace.isolated, true);
console.log('PASS panel data transform facade preserves scoped workspace behavior');
