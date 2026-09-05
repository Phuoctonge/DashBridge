'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = new Map();
const events = new Map();
const output = [];
const dispatched = [];
const parent = { postMessage: (data, origin) => output.push({ data, origin }) };
const timers = new Map();
let sequence = 0;
const context = vm.createContext({
    URL, chrome: { runtime: { getURL: () => 'chrome-extension://trusted/' } },
    window: { name: 'dashbridge-iframe', parent, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    document: { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name), dispatchEvent: event => dispatched.push(event) },
    CustomEvent: class { constructor(type, args) { this.type = type; this.detail = args.detail; } },
    setTimeout: fn => { timers.set(++sequence, fn); return sequence; }, clearTimeout: id => timers.delete(id),
});
vm.runInContext(fs.readFileSync('js/content/grafana-variables-bridge.js', 'utf8'), context);
const request = { action: 'dashbridgeVariablesRequest', operation: 'read', requestId: '1' };
const send = (origin, source, data = request) => listeners.get('message')({ origin, source, data });
send('https://untrusted.test', parent);
send('chrome-extension://trusted', {});
send('chrome-extension://trusted', parent, { ...request, operation: 'execute' });
assert.equal(dispatched.length, 0);
// Node URL reports opaque custom schemes as null; use the same exact origin
// as the browser URL implementation for the positive fixture.
const trusted = new URL('chrome-extension://trusted/').origin;
send(trusted, parent);
assert.equal(dispatched.length, 1);
send(trusted, parent);
assert.equal(dispatched.length, 1, 'single inflight request');
events.get('dashbridgeVariablesResponse')({ detail: { requestId: 'wrong', variables: [] } });
assert.equal(output.length, 0);
events.get('dashbridgeVariablesResponse')({ detail: { requestId: '1', variables: [] } });
assert.equal(output.length, 1);
assert.equal(output[0].origin, trusted);
assert.equal(timers.size, 0);
send(trusted, parent);
listeners.get('pagehide')();
assert.equal(timers.size, 0);
assert.equal(events.size, 0);
assert.equal(listeners.has('message'), false);
console.log('Grafana variables isolated bridge origin/source, correlation, inflight and cleanup: PASS');
