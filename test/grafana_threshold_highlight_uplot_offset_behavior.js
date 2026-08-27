'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-visual-engine.js'), 'utf8');
const start = source.indexOf('const getUPlotThresholdPlotOffset');
const end = source.indexOf('    const renderUPlotThresholdHighlights', start);
assert(start >= 0 && end > start, 'uPlot plot-area offset helper must remain independently testable');

const context = { window: { devicePixelRatio: 2 } };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.getOffset = getUPlotThresholdPlotOffset;`, context);

const domOffset = context.getOffset({
    root: { getBoundingClientRect: () => ({ left: 325, top: 306 }) },
    over: { getBoundingClientRect: () => ({ left: 383, top: 318, width: 940, height: 500 }) }
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(domOffset)), { left: 58, top: 12 },
    'SVG points must include the CSS offset of uPlot plot-area inside its root');

const dprOffset = context.getOffset({
    root: { querySelector: () => null },
    bbox: { left: 116, top: 24 },
    ctx: {
        canvas: {
            width: 2044,
            height: 1132,
            getBoundingClientRect: () => ({ width: 1022, height: 566 })
        }
    }
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(dprOffset)), { left: 58, top: 12 },
    'bbox fallback must convert uPlot device pixels to CSS pixels');

assert(source.includes('plotOffset.left + uplot.valToPos(time, xScaleKey, false)'),
    'uPlot X projection must include the left-axis offset');
assert(source.includes('plotOffset.top + uplot.valToPos(value, yScaleKey, false)'),
    'uPlot Y projection must include the top plot-area offset');

console.log('PASS uPlot threshold highlights align with the native plot area');
