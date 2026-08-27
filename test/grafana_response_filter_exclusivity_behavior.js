'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const start = source.indexOf('const enforceSingleResponseSeriesFilter');
const end = source.indexOf('    enforceSingleResponseSeriesFilter(tools);', start);
assert(start >= 0 && end > start, 'response-filter exclusivity helper must remain independently testable');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.enforce = enforceSingleResponseSeriesFilter;`, context);

const genericOnly = { seriesQueryFilterEnabled: true, cpuCapacityFilterEnabled: false };
context.enforce(genericOnly);
assert.strictEqual(genericOnly.seriesQueryFilterEnabled, true,
    'the displayed-series threshold remains active by itself');

const cpuOnly = { seriesQueryFilterEnabled: false, cpuCapacityFilterEnabled: true };
context.enforce(cpuOnly);
assert.strictEqual(cpuOnly.cpuCapacityFilterEnabled, true,
    'the dynamic vCPU filter remains active by itself');

const conflicting = { seriesQueryFilterEnabled: true, cpuCapacityFilterEnabled: true };
context.enforce(conflicting);
assert.deepStrictEqual(conflicting, {
    seriesQueryFilterEnabled: false,
    cpuCapacityFilterEnabled: true
}, 'direct/bootstrap state cannot run both response filters over the same Grafana response');

assert(source.includes('enforceSingleResponseSeriesFilter(tools);')
    && source.includes('enforceSingleResponseSeriesFilter(nextState);'),
    'both command and native-panel paths must enforce the same invariant');

console.log('PASS displayed-series and vCPU response filters cannot block each other');
