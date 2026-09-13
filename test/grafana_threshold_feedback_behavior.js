'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the production DOM owners without starting unrelated network/runtime lifecycles.
const nodes = [];
const makeNode = () => ({
    dataset: {}, style: {}, children: [],
    setAttribute(name, value) { this[name] = value; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); nodes.push(child); },
    addEventListener(type, fn) { this[type] = fn; },
    remove() { this.removed = true; }
});
const document = {
    createElement: makeNode,
    getElementById: id => nodes.find(n => n.id === id && !n.removed),
    body: makeNode(), documentElement: makeNode()
};
const context = { document, tools: {}, isDashboardIframe: false,
    getPanelStateKey: p => p.id, getComputedStyle: () => ({ position: 'relative' }) };
vm.createContext(context);
const toolsSource = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
vm.runInContext(toolsSource.slice(toolsSource.indexOf('    const nativeThresholdAlerts ='),
    toolsSource.indexOf('    const getLegendItems =')) + '\nglobalThis.feedback = renderNativeThresholdFeedback;', context);
const emit = (key, exceeded, extra = {}) => context.feedback({ targetPanel: { id: key }, title: key,
    status: { enabled: true, exceeded, threshold: 3.9999999999999996, unit: 's', ...extra } });
const toast = () => document.getElementById('dashbridge-threshold-toast');
emit('cpu', true);
assert.equal(toast().children[2].textContent, 'Порог 4 s превышен', 'native threshold text must suppress binary precision noise');
emit('cpu', false);
assert.equal(toast(), undefined, 'native recovery must clear the current panel toast');
emit('cpu', true);
const first = toast();
emit('cpu', true);
assert.equal(toast(), first, 'repeated status must not duplicate the toast');
emit('ram', true);
const second = toast();
emit('cpu', false);
assert.equal(toast(), second, 'another panel recovery must not clear the active toast');
emit('cpu', false, { enabled: false });
assert.equal(toast(), second, 'another panel disable must preserve the active toast');
emit('cpu', false, { thresholdNotifyEnabled: false });
assert.equal(toast(), second, 'another panel mute must preserve the active toast');
emit('ram', false, { enabled: false });
assert.equal(toast(), undefined, 'threshold disable must clear its toast');
emit('ram', true);
emit('ram', true, { thresholdNotifyEnabled: false });
assert.equal(toast(), undefined, 'notification disable must clear its toast');
emit('ram', true);
toast().children[1].click();
emit('ram', true);
assert.equal(toast(), undefined, 'manual close must suppress repeated breach');
emit('ram', false);
emit('ram', true);
assert(toast(), 'new breach after recovery must notify again');

const visualSource = fs.readFileSync('js/content/grafana-threshold-visuals.js', 'utf8');
vm.runInContext(visualSource.slice(visualSource.indexOf('        const drawThresholdLine ='),
    visualSource.indexOf('        const watchThresholdDataChanges =')) + '\nglobalThis.draw = drawThresholdLine;', context);
const root = { ...makeNode(), querySelectorAll: () => [], querySelector: () => null };
for (const [value, unit, expected] of [
    [3.9999999999999996, 's', '4 s'], [0.08333333333333333, 'mins', '5 s'], [0.30000000000000004, 'min', '0.3 min'],
    [999.9999999999999, 'ms', '1000 ms'], [0.000000123456, 's', '1.23456e-7 s'],
    [90, '%', '90 %'], [1.23456789, 'GiB', '1.23456789 GiB'], [0, '', '0']
]) {
    context.draw(root, value, 0, 1000, unit);
    const line = root.children.at(-1);
    assert.equal(line.title, `Порог: ${expected}`);
    assert.equal(line.children[0].textContent, `Порог: ${expected}`);
}
console.log('PASS threshold labels and native feedback preserve precision, recovery and panel ownership');
