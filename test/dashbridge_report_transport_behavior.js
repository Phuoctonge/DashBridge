'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'dashbridge', 'dashbridge-report-transport.js'),
    'utf8'
);
const context = { DOMException, setTimeout, clearTimeout };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'dashbridge-report-transport.js' });

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const iframe = (loaded = true) => ({
    isConnected: true,
    dataset: { dashbridgeLoaded: loaded ? 'true' : 'false' },
    parentElement: {},
    closest: () => null
});

function createHarness({
    frame = iframe(),
    sla = { source: 'graph', value: 80 },
    postResult = true,
    frameTimeoutMs = 100,
    totalTimeoutMs = 100
} = {}) {
    const messages = [];
    const observers = [];
    const transport = context.DashBridgeReportTransport.create({
        forceLoadPanel: () => frame,
        getEffectivePanelSla: () => sla,
        postToDashboardFrame: (target, message) => {
            messages.push({ target, message });
            return postResult;
        },
        frameTimeoutMs,
        totalTimeoutMs,
        createObserver: callback => {
            const observer = {
                callback,
                disconnected: false,
                observe() {},
                disconnect() { this.disconnected = true; }
            };
            observers.push(observer);
            return observer;
        }
    });
    return { transport, frame, messages, observers };
}

(async () => {
    assert.throws(
        () => context.DashBridgeReportTransport.create({}),
        /requires panel, SLA and frame adapters/,
        'the transport must reject an incomplete integration boundary'
    );

    {
        const { transport } = createHarness();
        const result = await transport.requestPanelSnapshot({ id: 'paused', paused: true });
        assert.strictEqual(result.dataStatus, 'paused');
        assert.strictEqual(transport.pendingCount(), 0);
    }

    {
        const { transport } = createHarness({ sla: { error: 'Порог выключен' } });
        const result = await transport.requestPanelSnapshot({ id: 'invalid' });
        assert.strictEqual(result.state, 'configuration_error');
        assert.strictEqual(result.error, 'Порог выключен');
    }

    {
        const { transport } = createHarness({ frame: null });
        const result = await transport.requestPanelSnapshot({ id: 'missing' });
        assert.strictEqual(result.dataStatus, 'iframe_unavailable');
    }

    {
        const harness = createHarness();
        const pending = harness.transport.requestPanelSnapshot({ id: 'cpu' });
        await nextTurn();
        assert.strictEqual(harness.messages.length, 1);
        const request = harness.messages[0].message;
        assert.strictEqual(request.action, 'collectPanelReportSnapshot');
        assert.deepStrictEqual(request.sla, { source: 'graph', value: 80 });
        assert.strictEqual(harness.transport.pendingCount(), 1);
        assert.strictEqual(
            harness.transport.acceptSnapshot(request.requestId, iframe(), { state: 'ok' }),
            false,
            'a response from another iframe must not resolve the request'
        );
        assert.strictEqual(harness.transport.pendingCount(), 1);
        assert.strictEqual(
            harness.transport.acceptSnapshot(request.requestId, harness.frame, { state: 'ok', series: [1] }),
            true
        );
        const result = await pending;
        assert.strictEqual(result.state, 'ok');
        assert.strictEqual(harness.transport.pendingCount(), 0);
        assert(harness.observers.every(observer => observer.disconnected));
    }

    {
        const harness = createHarness();
        const controller = new AbortController();
        const pending = harness.transport.requestPanelSnapshot({ id: 'abort' }, controller.signal);
        await nextTurn();
        controller.abort();
        await assert.rejects(pending, error => error?.name === 'AbortError');
        assert.strictEqual(harness.messages.at(-1).message.action, 'cancelPanelReportSnapshot');
        assert.strictEqual(harness.transport.pendingCount(), 0);
    }

    {
        const harness = createHarness({ postResult: false });
        const result = await harness.transport.requestPanelSnapshot({ id: 'send-failure' });
        assert.strictEqual(result.dataStatus, 'request_error');
        assert.strictEqual(harness.transport.pendingCount(), 0);
    }

    {
        const harness = createHarness({ totalTimeoutMs: 5 });
        const result = await harness.transport.requestPanelSnapshot({ id: 'timeout' });
        assert.strictEqual(result.state, 'timeout');
        assert.strictEqual(harness.transport.pendingCount(), 0);
    }

    {
        const harness = createHarness({ frame: iframe(false) });
        const pending = harness.transport.waitForIframeReady(harness.frame, 100);
        harness.frame.dataset.dashbridgeLoaded = 'true';
        harness.observers[0].callback();
        assert.strictEqual(await pending, harness.frame);
        assert.strictEqual(harness.observers[0].disconnected, true);
    }

    console.log('PASS DashBridge report transport preserves source, timeout and abort boundaries');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
