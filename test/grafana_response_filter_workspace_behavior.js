'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-data-runtime.js'), 'utf8');
const start = source.indexOf('const createResponseFilterWorkspace');
const end = source.indexOf('    const prepareCpuCapacityRequestBody', start);
assert(start >= 0 && end > start, 'response-filter workspace helpers must remain independently testable');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.createWorkspace = createResponseFilterWorkspace;
globalThis.commitWorkspace = commitResponseFilterWorkspace;`, context);

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

const cpuIndex = source.indexOf('capacityFilter?.filterResponse?.(scopedData');
const seriesIndex = source.indexOf('sourceFilter = filterSeriesByThreshold(scopedData).metrics;');
assert(cpuIndex >= 0 && seriesIndex > cpuIndex,
    'vCPU calculation must finish before the generic threshold evaluates the scoped series');
assert(!source.includes('filterResponse?.(data, requestBody'),
    'the vCPU filter must never mutate the unscoped dashboard response');

console.log('PASS response filters are isolated to the selected Grafana panel');
