'use strict';
// Removing frame identity checks must not turn iframe routes into tab navigation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture() {
    const state = { mode: 'recording', tabId: 7, steps: [], requests: new Map(), actionSequence: 0,
        ignoredRequests: new Set(), pageEvents: [], completeness: {}, sessionOptions: { disableCache: false } };
    const context = { URL, TextEncoder, setTimeout, console };
    context.globalThis = context; vm.createContext(context);
    for (const file of ['js/shared/dashflow-schema.js', 'pages/recorder/recorder-action-capture.js',
        'pages/recorder/recorder-network-capture.js', 'pages/recorder/recorder-session-transport.js']) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    }
    const action = context.DashBridgeRecorderActionCapture.create({
        state, schema: context.DashBridgeFlowSchema, setStatus() {}, scheduleRender() {},
    });
    const chromeRef = {
        runtime: { connect: () => ({ postMessage() {}, onDisconnect: { addListener() {} } }) },
        debugger: { attach: async () => {}, detach: async () => {}, sendCommand: async (target, method) => {
            assert.equal(target.tabId, 7);
            return method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'initial-main', url: 'about:blank' },
                childFrames: [{ frame: { id: 'child', parentId: 'initial-main', url: 'https://embedded.example/' } }] } } : {};
        } }, windows: { getAll: async () => [], create: async () => ({ id: 6, tabs: [{ id: 7 }] }) },
        scripting: { executeScript: async () => [] },
    };
    const transport = context.DashBridgeRecorderSessionTransport.create({ state, refreshIncognitoAccess: async () => true,
        cdpVersion: '1.3', maxBodyBytes: 100, maxRequestBodyBytes: 100, chromeRef, screenRef: {}, setIntervalRef() {} });
    const capture = context.DashBridgeRecorderNetworkCapture.create({ state, schema: context.DashBridgeFlowSchema,
        sendCdp: transport.sendCdp, sha256: async () => '', bodyBytes: () => new Uint8Array(),
        addNavigateStep: action.addNavigateStep, injectActionRecorder() {}, scheduleRender() {}, setStatus() {}, setTimeoutRef() {},
        limits: { maxBodyBytes: 100, maxRequestBodyBytes: 100, maxTotalRequestBodyBytes: 1000, maxTotalBodyBytes: 1000,
            maxRequests: 100, maxStreamEvents: 100, maxStreamPayloadBytes: 1000, maxPageEvents: 100 } });
    return { state, transport, event: (method, params) => capture.handleEvent({ tabId: 7 }, method, params) };
}
test('Initial about:blank frame tree identifies same-document main navigation before frameNavigated', async () => {
    const f = fixture(); await f.transport.attachNetwork(7);
    f.event('Page.navigatedWithinDocument', { frameId: 'child', url: 'https://embedded.example/#route' });
    assert.equal(f.state.steps.length, 0, 'child navigation must remain page evidence only');
    f.event('Page.navigatedWithinDocument', { frameId: 'initial-main', url: 'https://site.example/#route' });
    assert.equal(f.state.steps.length, 1);
    assert.equal(f.state.steps[0].url, 'https://site.example/#route');
    assert.equal(f.state.pageEvents.length, 2);
});
test('Root replacement refreshes identity even at about:blank; children never replace it', async () => {
    const f = fixture(); await f.transport.attachNetwork(7);
    f.event('Page.frameNavigated', { frame: { id: 'new-main', url: 'about:blank' } });
    f.event('Page.frameNavigated', { frame: { id: 'child', parentId: 'new-main', url: 'https://embedded.example/' } });
    f.event('Page.navigatedWithinDocument', { frameId: 'initial-main', url: 'https://stale.example/#x' });
    f.event('Page.navigatedWithinDocument', { frameId: 'child', url: 'https://embedded.example/#x' });
    assert.equal(f.state.steps.length, 0);
    f.event('Page.navigatedWithinDocument', { frameId: 'new-main', url: 'https://site.example/#x' });
    assert.equal(f.state.steps[0].url, 'https://site.example/#x');
});
test('Unknown same-document frame cannot become a top-level flow step', () => {
    const f = fixture();
    f.event('Page.navigatedWithinDocument', { frameId: 'unknown', url: 'https://embedded.example/#x' });
    assert.equal(f.state.steps.length, 0);
    assert.equal(f.state.pageEvents[0].frameId, 'unknown');
});
