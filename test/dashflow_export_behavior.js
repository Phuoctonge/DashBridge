'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({ Date, TextEncoder, URL });
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'shared', 'dashflow-schema.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'pages', 'recorder', 'recorder-dashflow-export.js'), 'utf8'), context);

assert.throws(
    () => context.DashBridgeDashflowExport.create({}),
    /requires schema, duration and step-label adapters/,
    'the export boundary must reject incomplete integration'
);

const builder = context.DashBridgeDashflowExport.create({
    schema: context.DashBridgeFlowSchema,
    requestDuration: request => request.duration,
    stepLabel: step => step.label
});
const createdAt = '2026-08-30T12:00:00.000Z';
const request = {
    requestId: 'request-1',
    method: 'POST',
    url: 'https://example.test/api?q=one&q=two',
    protocol: 'h2',
    status: 201,
    statusText: 'Created',
    requestHeaders: {
        Cookie: 'sid=abc; flag',
        'Content-Type': 'application/json'
    },
    responseHeaders: [{
        name: 'Set-Cookie',
        value: 'sid=next; Path=/; HttpOnly\npref=dark; Secure; SameSite=Lax'
    }],
    requestHeadersText: 'Cookie: sid=abc\r\n',
    responseHeadersText: 'HTTP/2 201\r\n',
    postData: 'тест',
    duration: 125.5,
    wallTime: Date.parse(createdAt) / 1000,
    stepId: 1,
    mimeType: 'application/json',
    bodyBytes: 5,
    bodyPath: 'bodies/000001_request-1.bin',
    bodySha256: 'a'.repeat(64),
    responseBody: 'must-not-enter-network-json',
    bodyCaptured: true,
    responseBodyCapture: { status: 'captured' },
    requestBodyCapture: { status: 'captured' },
    dataEncodedLength: 80,
    encodedDataLength: 100,
    remoteIPAddress: '203.0.113.7',
    connectionId: 42,
    resourceType: 'Fetch',
    fromDiskCache: true,
    fromServiceWorker: false,
    initiator: { type: 'script' },
    securityState: 'secure',
    securityDetails: { protocol: 'TLS 1.3' },
    responseTiming: { requestTime: 1 },
    failed: true,
    errorText: 'fixture failure'
};
const requests = [request, { requestId: 'ignored', url: 'https://example.test/no-method' }];

const network = builder.buildNetwork({
    requests,
    createdAt,
    finishedAt: '2026-08-30T12:01:00.000Z',
    pageEvents: [{ type: 'load' }]
});
assert.strictEqual(network.version, 2);
assert.strictEqual(network.source, 'Chrome DevTools Protocol');
assert.strictEqual(network.requests.length, 1);
assert.strictEqual(network.requests[0].responseBody, undefined);
assert.strictEqual(network.requests[0].bodyCaptured, undefined);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(network.requests[0].requestHeaders)),
    [{ name: 'Cookie', value: 'sid=abc; flag' }, { name: 'Content-Type', value: 'application/json' }]
);
assert.strictEqual(request.responseBody, 'must-not-enter-network-json', 'building network.json must not mutate live state');

const step = { type: 'navigate', label: 'https://example.test/', _dashbridge: { at: Date.parse(createdAt) } };
const har = builder.buildHar({ requests, steps: [step], createdAt, extensionVersion: '2.4.1' });
assert.strictEqual(har.log.version, '1.2');
assert.strictEqual(har.log.creator.version, '2.4.1');
assert.strictEqual(har.log.entries.length, 1);
assert.strictEqual(har.log.pages[0].title, '1. navigate https://example.test/');
const entry = har.log.entries[0];
assert.strictEqual(entry.time, 125.5);
assert.strictEqual(entry.pageref, 'step-1');
assert.deepStrictEqual(JSON.parse(JSON.stringify(entry.request.queryString)), [
    { name: 'q', value: 'one' }, { name: 'q', value: 'two' }
]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(entry.request.cookies)), [
    { name: 'sid', value: 'abc' }, { name: 'flag', value: '' }
]);
assert.strictEqual(entry.request.bodySize, new TextEncoder().encode('тест').byteLength);
assert.deepStrictEqual(JSON.parse(JSON.stringify(entry.request.postData)), {
    mimeType: 'application/json', text: 'тест'
});
assert.strictEqual(entry.response.cookies[0].httpOnly, true);
assert.strictEqual(entry.response.cookies[0].path, '/');
assert.strictEqual(entry.response.cookies[1].secure, true);
assert.strictEqual(entry.response.cookies[1].sameSite, 'Lax');
assert.strictEqual(entry.response.content._dashbridgeBodyPath, request.bodyPath);
assert.strictEqual(entry.response.content._dashbridgeSha256, request.bodySha256);
assert.strictEqual(entry.response.content._dashbridgeBodyCapture.status, 'captured');
assert.strictEqual(entry.response.bodySize, 80);
assert.strictEqual(entry.serverIPAddress, '203.0.113.7');
assert.strictEqual(entry.connection, '42');
assert.strictEqual(entry._dashbridgeFromDiskCache, true);
assert.strictEqual(entry._dashbridgeRequestBodyCapture.status, 'captured');
assert.strictEqual(entry._dashbridgeError, 'fixture failure');

const invalidUrlHar = builder.buildHar({
    requests: [{ method: 'GET', url: 'not a URL', duration: 0 }],
    createdAt,
    extensionVersion: '2.4.1'
});
assert.strictEqual(invalidUrlHar.log.entries[0].request.queryString.length, 0);

console.log('PASS DashFlow network and HAR builders preserve canonical metadata without live-state mutation');
