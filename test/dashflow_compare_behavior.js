'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {}; context.globalThis = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'dashflow-compare.js'), 'utf8'), context);
const compare = context.DashBridgeFlowCompare;
const request = (url, overrides = {}) => ({
    method: 'GET', url, status: 200, mimeType: 'application/javascript', bodyBytes: 10,
    bodySha256: 'same', startedMonotonic: 0, finishedMonotonic: 0.1, ...overrides,
});

const result = compare.build([
    request('https://site.test/same.js', { bodyBytes: 99, finishedMonotonic: 0.9 }),
    request('https://site.test/changed.js'),
    request('https://site.test/removed.css', { mimeType: 'text/css' }),
    request('https://site.test/duplicate.js'), request('https://site.test/duplicate.js', { bodySha256: 'old-second' }),
], [
    request('https://site.test/same.js'),
    request('https://site.test/changed.js', { bodyBytes: 12, bodySha256: 'new', finishedMonotonic: 0.5 }),
    request('https://site.test/added.js'),
    request('https://site.test/duplicate.js'), request('https://site.test/duplicate.js', { bodySha256: 'new-second' }),
]);

assert.strictEqual(result.filter(item => item.status === 'unchanged').length, 2);
assert.strictEqual(result.filter(item => item.status === 'changed').length, 2);
assert.strictEqual(result.filter(item => item.status === 'added').length, 1);
assert.strictEqual(result.filter(item => item.status === 'removed').length, 1);
const changed = result.find(item => item.url.endsWith('/changed.js'));
assert.deepStrictEqual(Array.from(changed.differences), ['body hash']);
const sizeAndTimingOnly = result.find(item => item.url.endsWith('/same.js'));
assert.strictEqual(sizeAndTimingOnly.status, 'unchanged', 'size and response time must not mark traffic as changed');
assert.strictEqual(result[0].status, 'changed', 'differences must be displayed before unchanged traffic');

const missingReplayBody = compare.build(
    [request('https://site.test/capture.js', { bodySha256: 'baseline-hash', responseBodyCapture: { status: 'captured' } })],
    [request('https://site.test/capture.js', { bodySha256: null, responseBodyCapture: { status: 'failed', reason: 'cdp-error' } })]
)[0];
assert.strictEqual(missingReplayBody.status, 'changed', 'a missing replay body must not produce a false unchanged result');
assert.deepStrictEqual(Array.from(missingReplayBody.differences), ['body capture']);

const perStep = compare.build(
    [request('https://site.test/repeated', { stepId: 1 }), request('https://site.test/repeated', { stepId: 2 })],
    [request('https://site.test/repeated', { stepId: 1 })]
);
assert.deepStrictEqual(Array.from(perStep, item => [item.stepId, item.status]), [[2, 'removed'], [1, 'unchanged']],
    'the same URL in different steps must be compared independently');
console.log('PASS DashFlow comparison matches repeated requests and classifies traffic differences');
