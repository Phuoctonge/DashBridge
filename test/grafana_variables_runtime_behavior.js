'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const events = new Map();
const listeners = new Map();
const output = [];
let variables = [{ name: 'instances', label: 'Servers', type: 'query', multi: true,
    includeAll: true, options: [{ value: 'server-uid', text: '<server>' }], current: { value: ['server-uid'], text: ['<server>'] } }];
let clock = 0;
const context = vm.createContext({
    name: '', parent: {}, Date: { now: () => clock },
    System: { import: async () => ({ getTemplateSrv: () => ({ getVariables: () => variables }) }) },
    document: { querySelectorAll: () => [], addEventListener: (name, fn) => events.set(name, fn),
        removeEventListener: name => events.delete(name), dispatchEvent: event => output.push(event.detail) },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    CustomEvent: class { constructor(name, args) { this.detail = args.detail; } },
    setTimeout: fn => setTimeout(() => { clock += 200; fn(); }, 0), clearTimeout,
});
vm.runInContext(fs.readFileSync('js/content/grafana-variables-runtime.js', 'utf8'), context);
const request = args => events.get('dashbridgeVariablesRequest')({ detail: { operation: 'read', requestId: 'request', ...args } });
(async () => {
    await request();
    assert.equal(output.length, 0, 'unnamed iframe does not disclose variables');
    context.name = 'dashbridge-iframe';
    await request();
    assert.equal(output.length, 1);
    assert.equal(output[0].variables[0].options[0].value, '$__all');
    assert.equal(output[0].variables[0].options[1].text, '<server>');
    assert.equal(output[0].variables[0].multi, true);
    assert.equal(output[0].variables[0].values[0], 'server-uid');
    variables = [{ ...variables[0], skipUrlSync: true }];
    await request();
    assert.equal(output.at(-1).variables[0].supported, false);
    variables = [{ ...variables[0], options: Array(5001).fill({ value: 'v', text: 't' }) }];
    await request();
    assert.match(output.at(-1).error, /много вариантов/);
    variables = [{ ...variables[0], options: [], state: 'Loading' }];
    await request();
    assert.match(output.at(-1).error, /не подготовила/);
    context.DashBridgeGrafanaVariablesRuntime.stop();
    assert.equal(events.size, 0);
    assert.equal(listeners.size, 0);
    console.log('Grafana variables native projection, loading timeout, caps and cleanup: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
