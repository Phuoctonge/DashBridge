'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/content/grafana-iframe.js', 'utf8');
const listeners = new Map(), sent = [];
const parent = { postMessage: (data, origin) => sent.push({ data, origin }) };
const window = { name: 'dashbridge-iframe', parent,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name) };
const location = { href: 'https://grafana.test/base/#private-settings', pathname: '/base/' };
class BrowserURL extends URL {
    get origin() { return this.protocol === 'chrome-extension:' ? `chrome-extension://${this.host}` : super.origin; }
}
vm.runInNewContext(source, { URL: BrowserURL, window, location,
    chrome: { runtime: { getURL: () => 'chrome-extension://fixture/' } },
    document: { readyState: 'complete', title: 'Home - Dashboards - Grafana', querySelector: () => null, querySelectorAll: () => [] } });
assert.equal(sent.length, 0, 'Home must not announce ready, title or start panel tools');
const message = { action: 'dashbridgeInspectLocation', requestId: 'generation-1' };
const send = (origin, source, data = message) => listeners.get('message')({ origin, source, data });
send('https://evil.test', parent); send('null', parent); send('chrome-extension://fixture', {});
assert.equal(sent.length, 0);
send('chrome-extension://fixture', parent);
assert.equal(sent.length, 1, 'only exact parent and extension origin accepted');
assert.equal(sent[0].data.url, 'https://grafana.test/base/');
assert.equal(sent[0].data.home, true); assert.equal(sent[0].data.ready, false);
assert.equal(sent[0].data.documentReady, false, 'Home is not a completed panel navigation');
assert.equal(sent[0].data.requestId, 'generation-1');
send('chrome-extension://fixture', parent, { ...message, requestId: 'x'.repeat(129) });
assert.equal(sent.length, 1, 'oversized request ID is ignored');
location.href = 'https://grafana.test/base/d-solo/uid/name?panelId=1';
send('chrome-extension://fixture', parent);
assert.equal(sent[1].data.documentReady, true, 'document readiness does not require chart DOM');
assert.equal(sent[1].data.ready, false, 'document readiness must not imply renderer readiness');
listeners.get('pagehide')(); assert.equal(listeners.has('message'), false);
window.name = 'ordinary-frame'; listeners.clear();
vm.runInNewContext(source, { window });
assert.equal(listeners.size, 0, 'ordinary frames receive no recovery bridge');
console.log('PASS location probe source/origin, payload bound, Home isolation and cleanup');
