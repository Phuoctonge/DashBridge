'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { TextEncoder, setTimeout };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/recorder/recorder-network-capture.js', 'utf8'),
    context,
);

const completeness = {
    droppedRequests: 0,
    responseBodiesCaptured: 0,
    responseBodiesEmpty: 0,
    responseBodiesSkipped: 0,
    responseBodiesFailed: 0,
    responseBodiesUnavailable: 0,
    requestBodiesPartial: 0,
    requestBodiesSkipped: 0,
    requestBodiesFailed: 0,
    streamEventsDropped: 0,
    streamPayloadBytesDropped: 0,
    pageEventsDropped: 0,
};
const state = {
    mode: 'recording',
    tabId: 7,
    activeStepId: 3,
    requests: new Map(),
    activeRequests: new Map(),
    redirectCounts: new Map(),
    requestChains: new Map(),
    requestExtraInfoIndexes: new Map(),
    responseExtraInfoIndexes: new Map(),
    ignoredRequests: new Set(),
    inFlight: new Set(),
    pendingBodyCaptures: new Set(),
    pendingRequestBodyCaptures: new Set(),
    streams: [],
    streamPayloadBytes: 0,
    pageEvents: [],
    totalBodyBytes: 0,
    totalRequestBodyBytes: 0,
    lastNetworkAt: 0,
    completeness,
};
const calls = [];
const sendCdp = async (method, params) => {
    calls.push(['cdp', method, params]);
    if (method === 'Network.getRequestPostData') return { postData: 'name=value' };
    if (method === 'Network.getResponseBody') return { body: 'response', base64Encoded: false };
    throw new Error(`Unexpected CDP method: ${method}`);
};
const schema = {
    classifyResponseBodyCapture: () => null,
    base64DecodedByteLength: value => Buffer.from(value, 'base64').byteLength,
};
const controller = context.DashBridgeRecorderNetworkCapture.create({
    state,
    schema,
    sendCdp,
    sha256: async bytes => `sha-${bytes.byteLength}`,
    bodyBytes: request => new TextEncoder().encode(request.responseBody || ''),
    addNavigateStep: (...args) => calls.push(['navigate', ...args]),
    injectActionRecorder: () => calls.push(['inject']),
    scheduleRender: () => calls.push(['render']),
    setStatus: (...args) => calls.push(['status', ...args]),
    limits: {
        maxBodyBytes: 1024,
        maxRequestBodyBytes: 1024,
        maxTotalRequestBodyBytes: 4096,
        maxTotalBodyBytes: 4096,
        maxRequests: 10,
        maxStreamEvents: 1,
        maxStreamPayloadBytes: 20,
        maxPageEvents: 2,
    },
    setTimeoutRef: callback => callback(),
});

(async () => {
    controller.handleEvent({ tabId: 99 }, 'Network.requestWillBeSent', {
        requestId: 'ignored', request: { url: 'https://wrong.example', method: 'GET' },
    });
    assert.strictEqual(state.requests.size, 0, 'events from another tab must be ignored');

    controller.handleEvent({ tabId: 7 }, 'Network.requestWillBeSentExtraInfo', {
        requestId: 'r1',
        headers: { Authorization: 'Bearer token' },
        associatedCookies: [{ cookie: { name: 'session' } }],
    });
    controller.handleEvent({ tabId: 7 }, 'Network.requestWillBeSent', {
        requestId: 'r1', timestamp: 1, wallTime: 2, type: 'Fetch',
        request: {
            url: 'https://site.example/api', method: 'POST',
            headers: { Basic: 'must-not-overwrite-extra-info' },
            postData: 'inline=1', hasPostData: true,
        },
    });
    const request = state.requests.get('r1');
    assert.strictEqual(request.requestHeaders.Authorization, 'Bearer token');
    assert.strictEqual(request.requestHeaders.Basic, undefined);
    assert.strictEqual(request.requestBodyCapture.status, 'captured');
    assert.strictEqual(state.inFlight.has('r1'), true);

    controller.handleEvent({ tabId: 7 }, 'Network.responseReceivedExtraInfo', {
        requestId: 'r1', statusCode: 201,
        headers: { 'Set-Cookie': 'session=next' }, blockedCookies: [],
    });
    controller.handleEvent({ tabId: 7 }, 'Network.responseReceived', {
        requestId: 'r1', type: 'Fetch',
        response: { status: 200, headers: { Basic: 'must-not-overwrite-extra-info' }, mimeType: 'text/plain' },
    });
    assert.strictEqual(request.status, 200);
    assert.strictEqual(request.responseHeaders['Set-Cookie'], 'session=next');
    assert.strictEqual(request.responseHeaders.Basic, undefined);

    controller.handleEvent({ tabId: 7 }, 'Network.dataReceived', {
        requestId: 'r1', dataLength: 8, encodedDataLength: 6,
    });
    controller.handleEvent({ tabId: 7 }, 'Network.requestServedFromCache', { requestId: 'r1' });
    controller.handleEvent({ tabId: 7 }, 'Network.resourceChangedPriority', {
        requestId: 'r1', newPriority: 'High', timestamp: 3,
    });
    controller.handleEvent({ tabId: 7 }, 'Network.loadingFinished', {
        requestId: 'r1', timestamp: 4, encodedDataLength: 8,
    });
    await Promise.all([...state.pendingBodyCaptures]);
    assert.strictEqual(request.responseBody, 'response');
    assert.strictEqual(request.bodySha256, 'sha-8');
    assert.strictEqual(request.responseBodyCapture.status, 'captured');
    assert.strictEqual(request.decodedDataLength, 8);
    assert.strictEqual(request.servedFromCache, true);
    assert.strictEqual(request.priorityChanges[0].priority, 'High');
    assert.strictEqual(state.inFlight.has('r1'), false);

    controller.handleEvent({ tabId: 7 }, 'Network.requestWillBeSent', {
        requestId: 'r2', timestamp: 5, wallTime: 6, type: 'Fetch',
        request: { url: 'https://site.example/form', method: 'POST', hasPostData: true },
    });
    await Promise.all([...state.pendingRequestBodyCaptures]);
    assert.strictEqual(state.requests.get('r2').postData, 'name=value');
    assert.strictEqual(state.requests.get('r2').requestBodyCapture.source, 'cdp');

    controller.handleEvent({ tabId: 7 }, 'Network.loadingFailed', {
        requestId: 'r2', timestamp: 7, errorText: 'blocked', canceled: false,
    });
    assert.strictEqual(state.requests.get('r2').responseBodyCapture.status, 'unavailable');
    assert.strictEqual(state.requests.get('r2').responseBodyCapture.reason, 'loading-failed');

    controller.handleEvent({ tabId: 7 }, 'Network.webSocketFrameReceived', {
        requestId: 'r1', timestamp: 8, response: { payloadData: 'one' },
    });
    controller.handleEvent({ tabId: 7 }, 'Network.webSocketFrameReceived', {
        requestId: 'r1', timestamp: 9, response: { payloadData: 'two' },
    });
    assert.strictEqual(state.streams.length, 1);
    assert.strictEqual(completeness.streamEventsDropped, 1);

    controller.handleEvent({ tabId: 7 }, 'Page.frameNavigated', {
        frame: { url: 'https://site.example/next' },
    });
    controller.handleEvent({ tabId: 7 }, 'Page.navigatedWithinDocument', {
        frameId: 'main', url: 'https://site.example/next#hash',
    });
    controller.handleEvent({ tabId: 7 }, 'Page.lifecycleEvent', {
        name: 'networkIdle', frameId: 'main', loaderId: 'loader', timestamp: 10,
    });
    assert(calls.some(call => call[0] === 'inject'));
    assert.strictEqual(calls.filter(call => call[0] === 'navigate').length, 2);
    assert.strictEqual(state.pageEvents.length, 2);

    controller.setResponseBodyStatus(request, 'failed', 'late-change');
    assert.strictEqual(request.responseBodyCapture.status, 'captured',
        'terminal completeness state must not be overwritten');
    assert.throws(
        () => context.DashBridgeRecorderNetworkCapture.create({}),
        /dependencies are incomplete/,
    );
    console.log('recorder network capture behavior tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
