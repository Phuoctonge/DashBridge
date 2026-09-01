'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-threshold-visuals.js'), 'utf8');
const start = source.indexOf('const projectFlotThresholdPoint');
const end = source.indexOf('    const renderFlotThresholdHighlights', start);
assert(start >= 0 && end > start, 'Flot projection helper must remain independently testable');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.projectPoint = projectFlotThresholdPoint;`, context);

let received = null;
const plot = {
    pointOffset(point) {
        received = { ...point };
        // Flot returns top-origin coordinates relative to the plot host.
        return { left: 150, top: 420 };
    }
};
const projected = context.projectPoint(plot, { xaxis: { n: 2 }, yaxis: { n: 3 } }, 1000, 3.8);
assert.deepStrictEqual(JSON.parse(JSON.stringify(projected)), [150, 420]);
assert.deepStrictEqual(received, { x: 1000, y: 3.8, xaxis: 2, yaxis: 3 },
    'projection must use Flot pointOffset with the series own axes');
assert.strictEqual(context.projectPoint({}, {}, 1, 2), null,
    'missing native Flot projection must fail closed instead of drawing mirrored highlights');
assert(!source.includes('offset.top + yAxis.p2c(y)'),
    'Flot Y coordinates must not use the bottom-origin p2c value as a top coordinate');

console.log('PASS Flot threshold highlights use native top-origin coordinates');
