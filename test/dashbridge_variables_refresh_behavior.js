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
    removeEventListener(name) { delete this.events[name]; }
    querySelector(name) { return this.children.find(child => child.tag === name); }
    querySelectorAll() { return []; }
    remove() {}
}
const host = new Element('div');
const dashboard = new Element('main');
const toggle = new Element('button');
const listeners = {};
const timers = new Map();
let timerId = 0;
let id = 0;
let replacements = 0;
let saves = 0;
let navigations = 0;
let updates = 0;
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
    applyPanelParamsToUrl: (item, src = item.src) => src,
    navigateDashboardFrame: (target, src) => { navigations++; target.src = src; },
    savePanels: async () => { saves++; }, invalidate() {},
    replacePanelCard: () => { currentFrame.isConnected = false; currentFrame = frame(); replacements++; },
    updatePanelCard: (panelId, options) => {
        assert.equal(panelId, panel.id);
        assert.equal(options.reloadFrame, false);
        updates++;
    },
    documentRef: { getElementById: name => name === 'dashboardVariables' ? host : name === 'dashboardVariablesToggle' ? toggle : dashboard,
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
    assert.equal(host.hidden, true, 'variables start collapsed without blocking requests');
    assert.equal(toggle.hidden, false);
    toggle.events.click();
    assert.equal(host.hidden, false);
    assert.equal(toggle['aria-expanded'], 'true');
    toggle.events.click();
    assert.equal(host.hidden, true);
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
    assert.equal(navigations, 0, 'refresh must recreate the frame even with an unchanged URL');
    for (const adapter of ['template', 'scenes']) {
        const editable = { ...snapshot, adapter, variables: [{ ...snapshot.variables[0], type: 'textbox' }] };
        respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' });
        tick(300);
        respond(currentFrame.contentWindow, { ...editable, requestId: messages.at(-1).requestId });
        await Promise.resolve();
        const body = group.children[1].children[0].children[1];
        const input = body.children[0];
        input.value = adapter;
        input.events.input();
        const sourceFrame = currentFrame;
        body.children.find(child => child.textContent === 'Применить').events.click();
        if (adapter === 'template') {
            respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' });
            tick(300);
        } else {
            assert.equal(messages.at(-1).operation, 'set');
        }
        respond(currentFrame.contentWindow, { ...editable,
            variables: [{ ...editable.variables[0], values: [adapter] }], requestId: messages.at(-1).requestId });
        await Promise.resolve();
        assert.equal(currentFrame, sourceFrame, 'settled source must not be recreated on commit');
        assert.equal(new URL(panel.src).searchParams.get('var-x'), adapter);
        assert.equal(replacements, 2);
    }
    assert.equal(updates, 2, 'source card links update without navigating');
    assert.equal(navigations, 1, 'only legacy apply needs a document navigation');
    controller.stop();
    assert.equal(toggle.events.click, undefined);
    assert.equal(timers.size, 0);
    assert.equal(listeners.resize, undefined, 'menu resize listener must be released');
    assert.equal(listeners.scroll, undefined, 'menu scroll listener must be released');
    console.log('Repeated unchanged-URL refresh replaces frame, rejects stale ready and clears watchdog: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
