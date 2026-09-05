'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    addEventListener(name, fn) { this.events[name] = fn; }
    querySelector(name) { return this.children.find(child => child.tag === name); }
    querySelectorAll() { return []; }
    remove() {}
}
const host = new Element('div');
const dashboard = new Element('main');
const listeners = {};
const timers = new Map();
let timerId = 0;
let id = 0;
let replacements = 0;
let saves = 0;
const messages = [];
const panel = { id: 'p', src: 'https://grafana.test/d-solo/uid/name?orgId=1&var-x=a#policy=off' };
const frame = () => ({ isConnected: true, dataset: { dashbridgeLoaded: 'true' }, src: panel.src,
    contentWindow: { postMessage: message => messages.push(message) } });
let currentFrame = frame();
const context = vm.createContext({
    URL, URLSearchParams, console, crypto: { randomUUID: () => String(++id) },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: key => timers.delete(key),
    MutationObserver: class { observe() {} disconnect() {} },
});
for (const file of ['dashbridge-variables-state.js', 'dashbridge-variables-controller.js']) {
    vm.runInContext(fs.readFileSync(`pages/dashbridge/${file}`, 'utf8'), context);
}
const controller = context.DashBridgeVariablesController.create({
    getPanels: () => [panel], getActiveProfile: () => ({ id: 'profile' }),
    getPanelForIframe: candidate => candidate === currentFrame ? panel : null,
    applyPanelParamsToUrl: () => panel.src,
    navigateDashboardFrame: () => { throw new Error('same-document navigation must not be used for refresh'); },
    savePanels: async () => { saves++; }, invalidate() {},
    replacePanelCard: () => { currentFrame.isConnected = false; currentFrame = frame(); replacements++; },
    documentRef: { getElementById: name => name === 'dashboardVariables' ? host : dashboard,
        querySelectorAll: () => [currentFrame], createElement: tag => new Element(tag) },
    windowRef: { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; } },
});
const respond = (source, data) => listeners.message({ source, origin: 'https://grafana.test', data });
const snapshot = { action: 'dashbridgeVariablesResponse', adapter: 'template', variables: [
    { name: 'x', label: 'X', type: 'constant', values: ['a'], texts: ['a'], options: [], supported: true }
] };
const tick = delay => {
    for (const [key, timer] of [...timers]) if (timer.delay === delay) { timers.delete(key); timer.fn(); }
};
(async () => {
    controller.start();
    respond(currentFrame.contentWindow, { ...snapshot, requestId: messages.at(-1).requestId });
    await Promise.resolve();
    const group = host.children[0];
    const button = group.children.find(child => child.tag === 'button');
    for (let repeat = 0; repeat < 2; repeat++) {
        const staleWindow = currentFrame.contentWindow;
        button.events.click();
        assert.equal(replacements, repeat + 1);
        assert.equal(group['aria-busy'], 'true');
        respond(staleWindow, { action: 'dashbridgeIframeReady' });
        assert.equal(messages.length, repeat + 1, 'old frame cannot finish a refresh');
        respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' });
        tick(300);
        respond(currentFrame.contentWindow, { ...snapshot, requestId: messages.at(-1).requestId });
        await Promise.resolve();
        assert.equal(group['aria-busy'], undefined);
        assert.equal([...timers.values()].some(timer => timer.delay === 35000), false);
    }
    assert.equal(saves, 2);
    controller.stop();
    assert.equal(timers.size, 0);
    console.log('Repeated unchanged-URL refresh replaces frame, rejects stale ready and clears watchdog: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
