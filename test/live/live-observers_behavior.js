'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachPageObserver } = require('./observers/page-observer');
const { attachNetworkObserver } = require('./observers/network-observer');
const { attachWorkerObserver } = require('./observers/worker-observer');

const page = new EventEmitter();
const observer = attachPageObserver(page, { maxEntries: 2 });
page.emit('console', { type: () => 'warning', text: () => 'one' });
page.emit('console', { type: () => 'error', text: () => 'two' });
page.emit('console', { type: () => 'log', text: () => 'three' });
page.emit('pageerror', new Error('boom'));
assert.equal(observer.snapshot().console.length, 2);
assert.equal(observer.snapshot().console[0].text, 'two');
assert.equal(observer.snapshot().pageErrors[0].message, 'boom');
observer.detach();
page.emit('console', { type: () => 'error', text: () => 'ignored' });
assert.equal(observer.snapshot().console.length, 2);
console.log('PASS live page observer is bounded and detachable');

const network = attachNetworkObserver(page, { maxEntries: 1 });
page.emit('requestfailed', { method: () => 'GET', resourceType: () => 'fetch', url: () => 'https://example.test/api?token=secret', failure: () => ({ errorText: 'ERR_FAILED' }) });
assert.equal(network.snapshot()[0].method, 'GET');
assert.equal(JSON.stringify(network.snapshot()).includes('secret'), false);
network.detach();
assert.equal(page.listenerCount('requestfailed'), 0);
console.log('PASS live network observer omits URLs and bodies');

const context = new EventEmitter();
const worker = new EventEmitter();
context.serviceWorkers = () => [worker];
const workerObserver = attachWorkerObserver(context, { maxEntries: 2 });
worker.emit('console', { type: () => 'error', text: () => 'worker error' });
assert.equal(workerObserver.snapshot().length, 1);
workerObserver.detach();
worker.emit('console', { type: () => 'error', text: () => 'ignored' });
assert.equal(workerObserver.snapshot().length, 1);
console.log('PASS live worker observer is bounded and detachable');
