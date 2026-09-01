'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-threshold-visuals.js'), 'utf8');
const start = source.indexOf('const buildThresholdHighlightSamples');
const end = source.indexOf('    const renderFlotThresholdHighlights', start);
assert(start >= 0 && end > start, 'interpolation helper must remain independently testable');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nglobalThis.buildSamples = buildThresholdHighlightSamples;`, context);

const samples = context.buildSamples(
    [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }],
    10,
    (x, y) => [x, y]
);
assert.deepStrictEqual(JSON.parse(JSON.stringify(samples)), [
    [5, 10], [10, 20], [15, 10], null
], 'highlight must start and end at the interpolated threshold crossings');

const withGap = context.buildSamples(
    [{ x: 0, y: 20 }, null, { x: 10, y: 20 }],
    10,
    (x, y) => [x, y]
);
assert.deepStrictEqual(JSON.parse(JSON.stringify(withGap)), [
    [0, 20], null, [10, 20], null
], 'missing source samples must keep highlight runs disconnected');

console.log('PASS threshold highlights interpolate crossings between source samples');
