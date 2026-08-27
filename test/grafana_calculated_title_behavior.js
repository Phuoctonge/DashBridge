'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
const start = source.indexOf('    const calculatedTitleOriginalText =');
const end = source.indexOf('    const observeCalculatedTitle =', start);
assert(start >= 0 && end > start, 'calculated-title lifecycle must remain independently testable');

let title = { textContent: 'CPU Usage' };
const tools = { invertIdle: false, convertMemToUsed: false, cpuCapacityFilterEnabled: false };
const panel = { querySelector: () => title };
const context = { tools, getTargetPanel: () => panel, WeakMap };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nglobalThis.markCalculatedTitle = markCalculatedTitle;`, context);

tools.invertIdle = true;
context.markCalculatedTitle();
assert.strictEqual(title.textContent, 'CPU Usage calculated');
context.markCalculatedTitle();
assert.strictEqual(title.textContent, 'CPU Usage calculated', 'repeated CPU refreshes must not duplicate the suffix');

tools.invertIdle = false;
tools.convertMemToUsed = true;
context.markCalculatedTitle();
assert.strictEqual(title.textContent, 'CPU Usage calculated', 'RAM conversion keeps the shared calculated marker');

tools.convertMemToUsed = false;
context.markCalculatedTitle();
assert.strictEqual(title.textContent, 'CPU Usage', 'disabling the final calculated transform restores the native title');

title = { textContent: 'Load Average' };
tools.cpuCapacityFilterEnabled = true;
context.markCalculatedTitle();
assert.strictEqual(title.textContent, 'Load Average calculated');
tools.cpuCapacityFilterEnabled = false;
context.markCalculatedTitle();
assert.strictEqual(title.textContent, 'Load Average', 'disabling the vCPU filter restores the native Load Average title');

title = { textContent: 'Memory calculated' };
tools.convertMemToUsed = true;
context.markCalculatedTitle();
assert.strictEqual(title.textContent, 'Memory calculated', 'an already marked remount must not duplicate calculated');
tools.convertMemToUsed = false;
context.markCalculatedTitle();
assert.strictEqual(title.textContent, 'Memory', 'an already marked remount must restore its unsuffixed title');

console.log('PASS calculated titles cover CPU, RAM and Load Average and restore cleanly after OFF');
