'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { Intl, Map, URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/recorder/recorder-dashflow-controller.js', 'utf8'),
    context,
);

const calls = [];
const statuses = [];
const state = {
    mode: 'idle', importing: false, title: 'Login / prod',
    startUrl: 'https://site.example/login', createdAt: '2026-01-01T00:00:00.000Z',
    captureFinishedAt: '2026-01-01T00:01:00.000Z',
    steps: [{ type: 'navigate', url: 'https://site.example/login', _dashbridge: {} }],
    requests: new Map([['a:b', {
        requestId: 'a:b', responseBody: 'hello', bodyBase64: false,
    }]]),
    totalBodyBytes: 5, totalRequestBodyBytes: 0,
    streamPayloadBytes: 0, streams: [], pageEvents: [],
    environment: null, completeness: { responseBodiesCaptured: 1 },
    sessionOptions: { disableCache: true, disableCookies: true },
    loadedManifest: null, baselineRequests: new Map(),
};
const ui = { save: { disabled: false }, file: { value: 'selected' }, startUrl: { value: '' } };
let readResult = null;
let readError = null;
let writePayload = null;
const io = {
    write: async payload => {
        writePayload = payload;
        calls.push(['write']);
        return { type: 'blob' };
    },
    read: async () => {
        calls.push(['read']);
        if (readError) throw readError;
        return readResult;
    },
};
const urlRef = {
    createObjectURL: blob => {
        calls.push(['createUrl', blob]);
        return 'blob:dashflow';
    },
    revokeObjectURL: url => calls.push(['revokeUrl', url]),
};
let stopCount = 0;
let resetCount = 0;
const controller = context.DashBridgeRecorderDashflowController.create({
    state,
    ui,
    schema: {
        createManifest: value => ({ format: 'dashbridge-flow', version: 2, ...value }),
        safeFilename: value => value.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, ''),
    },
    io,
    exporter: {
        buildNetwork: value => ({ version: 2, requestCount: [...value.requests].length }),
        buildHar: value => ({ log: { entries: [...value.requests] } }),
    },
    zipConstructor: function JSZip() {},
    sha256: async bytes => `sha-${bytes.byteLength}`,
    bodyBytes: request => new TextEncoder().encode(request.responseBody || ''),
    stopSession: async () => { stopCount += 1; calls.push(['stop']); },
    resetSession: () => {
        resetCount += 1;
        calls.push(['reset']);
        state.steps = [];
        state.requests = new Map();
    },
    saveSettings: async () => calls.push(['saveSettings']),
    setStatus: (...args) => statuses.push(args),
    updateControls: () => calls.push(['controls']),
    scheduleRender: () => calls.push(['render']),
    limits: {
        maxRequests: 50_000,
        maxRequestBodyBytes: 5 * 1024 * 1024,
        maxTotalRequestBodyBytes: 100 * 1024 * 1024,
        maxBodyBytes: 5 * 1024 * 1024,
        maxTotalBodyBytes: 100 * 1024 * 1024,
        maxStreamEvents: 50_000,
        maxStreamPayloadBytes: 20 * 1024 * 1024,
        maxPageEvents: 20_000,
        maxWorkingSetBytes: 256 * 1024 * 1024,
    },
    chromeRef: {
        runtime: { getManifest: () => ({ version: '2.4.1' }) },
        downloads: { download: async options => calls.push(['download', options]) },
    },
    navigatorRef: { userAgent: 'Test Chrome', language: 'ru' },
    urlRef,
    setTimeoutRef: callback => callback(),
});

(async () => {
    await controller.save();
    assert(writePayload);
    assert.strictEqual(writePayload.manifest.format, 'dashbridge-flow');
    assert.strictEqual(writePayload.bodies.length, 1);
    assert.strictEqual(writePayload.bodies[0].path, 'bodies/000001_a_b.bin');
    assert.strictEqual(state.requests.get('a:b').bodySha256, 'sha-5');
    assert(calls.some(call => call[0] === 'download'
        && call[1].filename.endsWith('.dashflow') && call[1].saveAs === true));
    assert(calls.some(call => call[0] === 'revokeUrl' && call[1] === 'blob:dashflow'));
    assert.strictEqual(state.loadedManifest, writePayload.manifest);

    const originalSteps = state.steps;
    readError = new Error('invalid archive');
    await controller.load({ name: 'bad.dashflow' });
    assert.strictEqual(stopCount, 0, 'rejected archive must not stop the current session');
    assert.strictEqual(resetCount, 0, 'rejected archive must not reset live state');
    assert.strictEqual(state.steps, originalSteps);
    assert.strictEqual(state.importing, false);
    assert.strictEqual(ui.file.value, '');

    readError = null;
    readResult = {
        manifest: {
            title: 'Imported', startUrl: 'https://imported.example/',
            createdAt: '2026-02-01T00:00:00.000Z',
            environment: { userAgent: 'Imported' },
            capture: { finishedAt: '2026-02-01T00:01:00.000Z', completeness: { ok: true } },
        },
        flow: { title: 'Imported', steps: [{ type: 'navigate', url: 'https://imported.example/' }] },
        network: { pageEvents: [{ type: 'load' }], finishedAt: 'fallback' },
        streams: { events: [{ type: 'webSocket' }] },
        requests: new Map([['imported', { requestId: 'imported', url: 'https://imported.example/api' }]]),
        totalRequestBodyBytes: 3,
        totalBodyBytes: 4,
        streamPayloadBytes: 5,
    };
    await controller.load({ name: 'good.dashflow' });
    assert.strictEqual(stopCount, 1);
    assert.strictEqual(resetCount, 1);
    assert.strictEqual(state.title, 'Imported');
    assert.strictEqual(state.requests.size, 1);
    assert.strictEqual(state.baselineRequests.size, 1);
    assert.notStrictEqual(
        state.baselineRequests.get('imported'),
        state.requests.get('imported'),
        'baseline request must be a separate snapshot object',
    );
    assert.strictEqual(ui.startUrl.value, 'https://imported.example/');
    assert(statuses.some(call => call[0].startsWith('Загружено: 1 шагов')));

    assert.throws(
        () => context.DashBridgeRecorderDashflowController.create({
            chromeRef: {}, navigatorRef: {}, urlRef: {}, setTimeoutRef: () => undefined,
        }),
        /dependencies are incomplete/,
    );
    console.log('recorder DashFlow controller behavior tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
