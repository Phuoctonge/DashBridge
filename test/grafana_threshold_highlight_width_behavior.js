'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-visual-engine.js'), 'utf8');
const start = source.indexOf('const THRESHOLD_HIGHLIGHT_WIDTH_INCREMENT');
const end = source.indexOf('    const buildThresholdHighlightSamples', start);
assert(start >= 0 && end > start, 'threshold width helpers must remain independently testable');

const created = [];
const context = {
    SVG_NAMESPACE: 'http://www.w3.org/2000/svg',
    document: {
        createElementNS(namespace, tagName) {
            const attributes = {};
            const element = {
                tagName,
                attributes,
                setAttribute(name, value) { attributes[name] = value; }
            };
            created.push(element);
            return element;
        }
    }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.getStrokeWidth = getThresholdHighlightStrokeWidth;
globalThis.appendRuns = appendThresholdHighlightRuns;`, context);

assert.strictEqual(context.getStrokeWidth(1), 3, 'default one-pixel series must gain two pixels');
assert.strictEqual(context.getStrokeWidth(2.5), 4.5, 'globally thickened series must keep the same increment');
assert.strictEqual(context.getStrokeWidth(undefined, 4), 6, 'the first valid rendered-width candidate must be used');

const svg = { children: [], appendChild(child) { this.children.push(child); } };
context.appendRuns(svg, [[0, 0], [1, 1]], '#123456', context.getStrokeWidth(4));
assert.strictEqual(svg.children[0].attributes['stroke-width'], '6', 'highlight polyline must use rendered width plus increment');

const pointSvg = { children: [], appendChild(child) { this.children.push(child); } };
context.appendRuns(pointSvg, [[0, 0]], '#123456', context.getStrokeWidth(4));
assert.strictEqual(pointSvg.children[0].attributes.r, '6', 'isolated highlight marker must scale with its line width');

assert(source.includes('series.lines?.lineWidth'), 'Flot must provide its rendered line width');
assert(source.includes('getThresholdHighlightStrokeWidth(series.width)'), 'uPlot must provide its rendered line width');
assert(!source.includes("polyline.setAttribute('stroke-width', '4')"), 'highlight width must not remain hardcoded');
assert(source.includes('const completeStyleApply = result =>'), 'every visual command must complete through a shared highlight refresh');
assert(source.includes('scheduleThresholdHighlightRender(root);'), 'style completion must schedule a threshold repaint');
assert(source.includes('return completeStyleApply(result);'), 'the local uPlot/Flot style path must refresh active highlights');
assert(source.match(/return completeStyleApply\(await applyPopupLegendAndVisuals/g)?.length >= 2,
    'legacy and legend style paths must refresh active highlights');

console.log('PASS threshold highlights remain thicker than the rendered series');
