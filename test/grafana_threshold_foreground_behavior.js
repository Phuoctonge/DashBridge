'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/content/grafana-threshold-visuals.js', 'utf8');
const line = { style: {}, getBoundingClientRect: () => ({ left: 120, top: 240, width: 400 }),
    cloneNode() { return { style: {}, removeAttribute(name) { this.removed = name; } }; } };
const overlay = { children: [], getBoundingClientRect: () => ({ left: 100, top: 200 }),
    appendChild(node) { this.children.push(node); } };
const host = { querySelector: () => line };
const context = { SVG_NAMESPACE: 'http://www.w3.org/2000/svg',
    document: { createElementNS(ns, name) { return { ns, name, attributes: {}, children: [],
        setAttribute(key, value) { this.attributes[key] = value; }, appendChild(child) { this.children.push(child); } }; } },
    removeThresholdHighlightOverlays: () => { overlay.children = []; }, isThresholdHighlightRootActive: () => true,
    renderFlotThresholdHighlights: () => ({ overlay, host }), renderUPlotThresholdHighlights: () => null };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('        const renderThresholdHighlights ='),
    source.indexOf('        const scheduleThresholdHighlightRender =')) + '\nglobalThis.render = renderThresholdHighlights;', context);
context.render({}, [{}], {});
const foreground = overlay.children.at(-1);
assert(foreground, 'threshold must be painted after highlighted series');
assert.equal(foreground.name, 'foreignObject');
assert.equal(foreground.attributes['aria-hidden'], 'true', 'visual duplicate must not repeat accessible text');
const copy = foreground.children[0];
assert.equal(copy.removed, 'data-dashbridge-threshold-line', 'original threshold remains the only semantic marker');
assert.equal(copy.style.left, '20px'); assert.equal(copy.style.top, '40px'); assert.equal(copy.style.width, '400px');
context.render({}, [{}], {});
assert.equal(overlay.children.length, 1, 'repaint replaces the old foreground with its overlay');
assert.deepEqual(line.style, {}, 'original line is never moved or restyled');
console.log('PASS threshold foreground projects above highlights without changing original line or adding lifecycle resources');
