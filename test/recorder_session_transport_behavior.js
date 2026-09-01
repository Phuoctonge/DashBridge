'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/recorder/recorder-session-transport.js', 'utf8'),
    context,
);

const calls = [];
const ports = [];
const makePort = () => {
    const port = {
        messages: [],
        onDisconnect: {
            addListener(listener) { port.disconnectListener = listener; },
        },
        postMessage(message) {
            this.messages.push(message);
            calls.push(['port', message]);
        },
    };
    ports.push(port);
    return port;
};
let windows = [];
const chromeRef = {
    runtime: {
        lastError: null,
        connect: options => {
            calls.push(['connect', options]);
            return makePort();
        },
    },
    debugger: {
        attach: async (...args) => calls.push(['attach', ...args]),
        detach: async (...args) => calls.push(['detach', ...args]),
        sendCommand: async (...args) => calls.push(['command', ...args]),
    },
    windows: {
        getAll: async () => windows,
        create: async options => {
            calls.push(['window', options]);
            return { id: 20, tabs: [{ id: 21 }] };
        },
    },
    scripting: {
        executeScript: async options => calls.push(['inject', options]),
    },
};
const state = {
    mode: 'idle',
    tabId: null,
    windowId: null,
    attached: false,
    detaching: false,
    sessionOptions: { disableCache: true, disableCookies: false },
};
let heartbeat = null;
let incognitoAllowed = true;
const transport = context.DashBridgeRecorderSessionTransport.create({
    state,
    refreshIncognitoAccess: async () => incognitoAllowed,
    cdpVersion: '1.3',
    maxBodyBytes: 5 * 1024 * 1024,
    maxRequestBodyBytes: 5 * 1024 * 1024,
    chromeRef,
    screenRef: { availLeft: 10, availTop: 20, availWidth: 1200, availHeight: 800 },
    setIntervalRef: (callback, delay) => {
        heartbeat = callback;
        calls.push(['interval', delay]);
        return 1;
    },
});

(async () => {
    assert.strictEqual(ports.length, 1);
    assert(calls.some(call => call[0] === 'interval' && call[1] === 20_000));
    heartbeat();
    assert.strictEqual(ports[0].messages.length, 0, 'idle transport must not heartbeat');

    await transport.attachNetwork(7);
    assert.strictEqual(state.tabId, 7);
    assert.strictEqual(state.attached, true);
    assert(calls.some(call => call[0] === 'attach'
        && call[1].tabId === 7 && call[2] === '1.3'));
    assert.deepStrictEqual(
        calls.filter(call => call[0] === 'command').map(call => call[2]),
        ['Network.enable', 'Page.enable', 'Page.setLifecycleEventsEnabled',
            'Network.setCacheDisabled', 'Network.setBypassServiceWorker'],
    );
    assert(ports[0].messages.some(message => message.type === 'bind' && message.tabId === 7));
    heartbeat();
    assert(ports[0].messages.some(message => message.type === 'heartbeat'));

    ports[0].disconnectListener();
    assert.strictEqual(transport.postLifecycle({ type: 'heartbeat' }), true);
    assert.strictEqual(ports.length, 2);
    assert.deepStrictEqual(
        ports[1].messages.map(message => message.type),
        ['bind', 'heartbeat'],
        'reconnected port must restore binding before the requested message',
    );

    await transport.detachNetwork();
    assert.strictEqual(state.attached, false);
    assert.strictEqual(state.detaching, false);
    assert(calls.some(call => call[0] === 'detach' && call[1].tabId === 7));
    assert(ports[1].messages.some(message => message.type === 'unbind'));

    assert.deepStrictEqual(JSON.parse(JSON.stringify(transport.buildWindowLayout())), {
        controlled: {
            left: 10, top: 20, width: 1200, height: 800, state: 'normal',
        },
    });
    const tabId = await transport.createControlledTab(transport.buildWindowLayout());
    assert.strictEqual(tabId, 21);
    assert.strictEqual(state.windowId, 20);
    assert(calls.some(call => call[0] === 'window'
        && call[1].incognito === false && call[1].width === 1200));

    state.mode = 'recording';
    state.tabId = 21;
    await transport.injectActionRecorder();
    assert(calls.some(call => call[0] === 'inject'
        && call[1].target.tabId === 21 && call[1].target.allFrames === true));

    state.sessionOptions.disableCookies = true;
    incognitoAllowed = false;
    await assert.rejects(() => transport.createControlledTab(), /Разрешить использование/);
    incognitoAllowed = true;
    windows = [{ id: 99, incognito: true }];
    await assert.rejects(() => transport.createControlledTab(), /Закройте остальные окна/);

    assert.strictEqual(await transport.ensureDebuggerPermission(), true);
    assert.throws(
        () => context.DashBridgeRecorderSessionTransport.create({
            chromeRef: {}, screenRef: {}, setIntervalRef: () => undefined,
        }),
        /dependencies are incomplete/,
    );
    console.log('recorder session transport behavior tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
