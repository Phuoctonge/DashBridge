'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture() {
    const context = { TextEncoder, setTimeout }; context.globalThis = context; vm.createContext(context);
    vm.runInContext(fs.readFileSync('pages/recorder/recorder-network-capture.js', 'utf8'), context);
    const state = { tabId: 7, mode: 'recording', requests: new Map(), activeRequests: new Map(),
        redirectCounts: new Map(), requestChains: new Map(), requestExtraInfoIndexes: new Map(),
        responseExtraInfoIndexes: new Map(), ignoredRequests: new Set(), inFlight: new Set(),
        pendingBodyCaptures: new Set(), pendingRequestBodyCaptures: new Set(), completeness: {},
        totalBodyBytes: 0, totalRequestBodyBytes: 0, streams: [], pageEvents: [] };
    const controller = context.DashBridgeRecorderNetworkCapture.create({ state, schema: {}, sendCdp: async () => ({}),
        sha256: async () => '', bodyBytes() {}, addNavigateStep() {}, injectActionRecorder() {},
        scheduleRender() {}, setStatus() {}, limits: Object.fromEntries(['maxBodyBytes', 'maxRequestBodyBytes',
            'maxTotalRequestBodyBytes', 'maxTotalBodyBytes', 'maxRequests', 'maxStreamEvents',
            'maxStreamPayloadBytes', 'maxPageEvents'].map(key => [key, 20])) });
    const event = (method, params = {}) => controller.handleEvent({ tabId: 7 }, `Network.${method}`, { requestId: 'r', ...params });
    const begin = (url, extra = {}) => event('requestWillBeSent', { request: { url, method: 'GET', headers: { Original: url } }, ...extra });
    return { state, event, begin };
}

for (const early of [false, true]) test(`cached redirect skips absent ExtraInfo (early final info=${early})`, () => {
    const f = fixture();
    f.begin('https://site.example/redirect');
    if (early) {
        f.event('requestWillBeSentExtraInfo', { headers: { Cookie: 'final=1' }, associatedCookies: [] });
        f.event('responseReceivedExtraInfo', { statusCode: 200, headers: { 'Set-Cookie': 'final=1' } });
    }
    f.begin('https://site.example/final', { redirectHasExtraInfo: false,
        redirectResponse: { status: 302, headers: { Location: '/final' } } });
    f.event('responseReceived', { hasExtraInfo: true, response: { status: 200, headers: { Final: 'yes' } } });
    if (!early) {
        f.event('requestWillBeSentExtraInfo', { headers: { Cookie: 'final=1' }, associatedCookies: [] });
        f.event('responseReceivedExtraInfo', { statusCode: 200, headers: { 'Set-Cookie': 'final=1' } });
    }
    const first = f.state.requests.get('r'), final = f.state.requests.get('r:redirect-1');
    assert.equal(first.status, 302);
    assert.equal(first.responseHeaders.Location, '/final');
    assert.equal(first.requestHeaders.Cookie, undefined);
    assert.equal(final.status, 200);
    assert.equal(final.requestHeaders.Cookie, 'final=1');
    assert.equal(final.responseHeaders['Set-Cookie'], 'final=1');
});

test('early ExtraInfo retains order across two uncached redirect hops', () => {
    const f = fixture();
    f.event('responseReceivedExtraInfo', { statusCode: 301, headers: { Location: '/final', First: 'yes' } });
    f.begin('https://site.example/redirect');
    f.begin('https://site.example/final', { redirectHasExtraInfo: true,
        redirectResponse: { status: 301, headers: { Location: '/final' } } });
    f.event('responseReceivedExtraInfo', { statusCode: 200, headers: { Final: 'yes' } });
    f.event('responseReceived', { hasExtraInfo: true, response: { status: 200, headers: {} } });
    assert.equal(f.state.requests.get('r').responseHeaders.First, 'yes');
    assert.equal(f.state.requests.get('r:redirect-1').responseHeaders.Final, 'yes');
});

test('failed request without responseReceived retains its queued raw headers', () => {
    const f = fixture();
    f.begin('https://site.example/blocked');
    f.event('requestWillBeSentExtraInfo', { headers: { Cookie: 'blocked=1' }, associatedCookies: [] });
    f.event('responseReceivedExtraInfo', { statusCode: 403, headers: { Blocked: 'yes' } });
    f.event('loadingFailed', { errorText: 'net::ERR_FAILED' });
    const request = f.state.requests.get('r');
    assert.equal(request.failed, true);
    assert.equal(request.status, 403);
    assert.equal(request.requestHeaders.Cookie, 'blocked=1');
    assert.equal(request.responseHeaders.Blocked, 'yes');
});
