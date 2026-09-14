'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-data-transforms-runtime.js'), 'utf8');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);
context.createWorkspace = context.DashBridgeGrafanaPanelDataTransformsRuntime.createWorkspace;
context.commitWorkspace = context.DashBridgeGrafanaPanelDataTransformsRuntime.commitWorkspace;

const original = { results: {
    A: { value: 'target' },
    DB_CPU_CAPACITY_1: { value: 'private helper' },
    Z: { value: 'neighbour' }
} };
const workspace = context.createWorkspace(original, new Set(['A']), new Set(['DB_CPU_CAPACITY_1']));
assert.deepStrictEqual(Object.keys(workspace.data.results), ['A', 'DB_CPU_CAPACITY_1']);
assert.strictEqual(workspace.data.results.A, original.results.A, 'target frames remain available to both filters');
assert.strictEqual(workspace.data.results.Z, undefined, 'neighbouring panel frames never enter the pipeline');

workspace.data.results.A = { value: 'filtered target' };
delete workspace.data.results.DB_CPU_CAPACITY_1;
context.commitWorkspace(original, workspace);
assert.deepStrictEqual(JSON.parse(JSON.stringify(original)), { results: {
    A: { value: 'filtered target' },
    Z: { value: 'neighbour' }
} }, 'commit changes only the target and removes only the private helper');

const iframeData = { results: { A: { value: 1 } } };
const iframeWorkspace = context.createWorkspace(iframeData, null, new Set());
assert.strictEqual(iframeWorkspace.data, iframeData, 'single-panel iframe keeps the zero-copy fast path');

const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-data-runtime.js'), 'utf8');
const cpuIndex = runtimeSource.indexOf('capacityFilter?.filterResponse?.(scopedData');
const seriesIndex = runtimeSource.indexOf('sourceFilter = filterSeriesByThreshold(scopedData).metrics;');
assert(cpuIndex >= 0 && seriesIndex > cpuIndex,
    'vCPU calculation must finish before the generic threshold evaluates the scoped series');
const scopeMismatchStart = runtimeSource.indexOf('if (targetRefIds !== null && !targetRefIds.size)');
const scopeMismatchEnd = runtimeSource.indexOf("if (scope === 'query-signature')", scopeMismatchStart);
const cleanupOnlyCall = 'window.DashBridgeGrafanaCpuCapacityFilter?.filterResponse?.(data, requestBody);';
assert(scopeMismatchStart >= 0 && scopeMismatchEnd > scopeMismatchStart
    && runtimeSource.slice(scopeMismatchStart, scopeMismatchEnd).includes(cleanupOnlyCall),
    'unscoped cleanup must omit filter options so filtering and domain trimming stay disabled');
assert(!runtimeSource.replace(cleanupOnlyCall, '').includes('filterResponse?.(data, requestBody'),
    'only disabled helper cleanup may receive the unscoped dashboard response');

console.log('PASS response filters are isolated to the selected Grafana panel');
