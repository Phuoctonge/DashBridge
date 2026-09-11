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
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
}
const host = new Element('div');
const dashboard = new Element('main');
const toggle = new Element('button');
const dialog = new Element('dialog');
const closeButton = new Element('button');
const listeners = {};
const timers = new Map();
let timerId = 0;
let id = 0;
let replacements = 0;
let saves = 0;
let navigations = 0;
let updates = 0;
let now = 100000;
const messages = [];
const panel = { id: 'p', src: 'https://grafana.test/d-solo/uid/name?orgId=1&var-x=a#policy=off' };
const frame = () => ({ isConnected: true, dataset: { dashbridgeLoaded: 'true' }, src: panel.src,
    contentWindow: { postMessage: message => messages.push(message) } });
let currentFrame = frame();
const context = vm.createContext({
    URL, URLSearchParams, console, Date: { now: () => now }, crypto: { randomUUID: () => String(++id) },
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
    documentRef: { getElementById: name => ({ dashboardVariables: host, dashboardVariablesToggle: toggle,
        dashboardVariablesDialog: dialog, closeDashboardVariables: closeButton })[name] || dashboard,
        querySelectorAll: () => [currentFrame], createElement: tag => new Element(tag) },
    windowRef: { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; } },
});
const respond = (source, data) => listeners.message({ source, origin: 'https://grafana.test', data });
const snapshot = { action: 'dashbridgeVariablesResponse', adapter: 'template', variables: [
    { name: 'x', label: 'X', type: 'textbox', values: ['a'], texts: ['a'], options: [], supported: true }
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
    assert.equal(dialog.open, true, 'button opens modal dialog');
    assert.equal(toggle['aria-expanded'], 'true');
    toggle.events.click();
    assert.equal(host.hidden, true);
    assert.equal(dialog.open, false);
    assert.equal(toggle.focused, true, 'closing restores focus');
    toggle.events.click();
    dialog.events.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(dialog.open, false, 'Escape closes dialog');
    toggle.events.click();
    closeButton.events.click();
    assert.equal(dialog.open, false, 'close button does not cancel transport');
    respond(currentFrame.contentWindow, { ...snapshot, requestId: messages.at(-1).requestId });
    await new Promise(resolve => setImmediate(resolve));
    const group = host.children[0];
    const budgetBody = group.children[1].children[0].children[1];
    const budgetInput = budgetBody.children[0];
    const originalUrl = panel.src;
    budgetInput.value = 'x'.repeat(5000); budgetInput.events.input();
    budgetBody.children.find(child => child.textContent === 'Применить').events.click();
    assert.equal(navigations, 0, 'oversized selection must be rejected before navigation');
    assert.equal(saves, 0); assert.equal(panel.src, originalUrl);
    assert.match(group.children[2].textContent, /4096/, 'show a useful URL limit message');
    budgetInput.value = 'a'; budgetInput.events.input();
    assert.equal(group.children.some(child => child.textContent === 'Обновить поля'), false);
    const readsBeforeOpen = messages.length;
    toggle.events.click();
    assert.equal(messages.length, readsBeforeOpen, 'fresh cached fields open immediately without another request');
    closeButton.events.click();
    now += 61000;
    toggle.events.click();
    assert.equal(messages.length, readsBeforeOpen + 1, 'opening rereads all fields');
    assert.equal(messages.at(-1).operation, 'read');
    assert.equal(replacements, 0, 'opening must not reload Grafana');
    respond(currentFrame.contentWindow, { ...snapshot, requestId: messages.at(-1).requestId });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 0, 'reading must not save or apply selection');
    for (let repeat = 0; repeat < 2; repeat++) {
        const staleWindow = currentFrame.contentWindow;
        const button = group.children[1].children[0].children[1].children.find(child => child.textContent === 'Обновить варианты');
        button.events.click();
        assert.equal(replacements, repeat + 1);
        assert.equal(group['aria-busy'], 'true');
        respond(staleWindow, { action: 'dashbridgeIframeReady' });
        assert.equal(messages.length, repeat + readsBeforeOpen + 1, 'old frame cannot finish a refresh');
        respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' });
        tick(300);
        respond(currentFrame.contentWindow, { ...snapshot, requestId: messages.at(-1).requestId });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(group['aria-busy'], undefined);
        assert.equal([...timers.values()].some(timer => timer.delay === 35000), false);
    }
    assert.equal(saves, 2);
    assert.equal(navigations, 0, 'refresh must recreate the frame even with an unchanged URL');
    for (const adapter of ['template', 'scenes']) {
        const dependent = { ...snapshot.variables[0], name: 'child', type: 'query', hide: 2,
            dependencies: ['x'], values: ['stale'] };
        const editable = { ...snapshot, adapter, variables: [{ ...snapshot.variables[0], type: 'textbox' }, dependent] };
        respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' });
        tick(300);
        respond(currentFrame.contentWindow, { ...editable, requestId: messages.at(-1).requestId });
        await new Promise(resolve => setImmediate(resolve));
        const body = group.children[1].children[0].children[1];
        const input = body.children[0];
        input.value = adapter;
        input.events.input();
        const sourceFrame = currentFrame;
        body.children.find(child => child.textContent === 'Применить').events.click();
        assert.equal(new URL(currentFrame.src).searchParams.get('var-x'), adapter, 'first navigation already uses the selected project');
        assert.equal(new URL(currentFrame.src).searchParams.has('var-child'), false, 'stale dependent selection must not reach the new document');
        assert.equal(messages.some(message => message.operation === 'set'), false, 'native mutation must not precede navigation');
        respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' });
        tick(300);
        respond(currentFrame.contentWindow, { ...editable,
            variables: [{ ...editable.variables[0], values: [adapter] }, { ...dependent, values: ['resolved'] }], requestId: messages.at(-1).requestId });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(currentFrame, sourceFrame, 'source has already navigated and must not reload on commit');
        assert.equal(new URL(panel.src).searchParams.get('var-x'), adapter);
        assert.equal(new URL(panel.src).searchParams.get('var-child'), 'resolved', 'commit saves Grafana-resolved dependencies');
        assert.equal(replacements, 2);
    }
    assert.equal(updates, 2, 'both adapters preserve the already navigated source');
    assert.equal(navigations, 2, 'each selection navigates once');
    respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' }); tick(300);
    respond(currentFrame.contentWindow, { ...snapshot, requestId: messages.at(-1).requestId });
    await new Promise(resolve => setImmediate(resolve));
    const beforeOverflow = { src: panel.src, saves, replacements };
    const overflowBody = group.children[1].children[0].children[1];
    overflowBody.children[0].value = 'small'; overflowBody.children[0].events.input();
    overflowBody.children.find(child => child.textContent === 'Применить').events.click();
    respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' }); tick(300);
    respond(currentFrame.contentWindow, { ...snapshot, variables: [
        { ...snapshot.variables[0], values: ['small'] },
        { name: 'expanded', label: 'Expanded', type: 'textbox', values: ['x'.repeat(5000)], supported: true, options: [] },
    ], requestId: messages.at(-1).requestId });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(panel.src, beforeOverflow.src, 'Grafana-resolved overflow cannot mutate profile');
    assert.equal(saves, beforeOverflow.saves, 'invalid resolved selection never reaches persistence');
    assert.equal(replacements, beforeOverflow.replacements + 1, 'source is restored after rejected resolution');
    assert.match(group.children[2].textContent, /4096/);
    // A later refresh must retry the last accepted snapshot, not the rejected
    // over-budget response (which would fail locally before any transport).
    const beforeRetry = replacements;
    overflowBody.children.find(child => child.textContent === 'Обновить варианты').events.click();
    assert.equal(replacements, beforeRetry + 1, 'failed resolution must retain the previous accepted snapshot');
    respond(currentFrame.contentWindow, { action: 'dashbridgeIframeReady' }); tick(300);
    respond(currentFrame.contentWindow, { ...snapshot, requestId: messages.at(-1).requestId });
    await new Promise(resolve => setImmediate(resolve));
    closeButton.events.click();
    now += 61000;
    toggle.events.click();
    const failedRequest = messages.at(-1);
    respond(currentFrame.contentWindow, { action: 'dashbridgeVariablesResponse', requestId: failedRequest.requestId, error: 'unavailable' });
    closeButton.events.click();
    toggle.events.click();
    assert.notEqual(messages.at(-1).requestId, failedRequest.requestId, 'reopening retries a failed read without waiting for cache expiry');
    const pendingRequestCount = messages.length;
    closeButton.events.click();
    toggle.events.click();
    assert.equal(messages.length, pendingRequestCount, 'reopening during a pending read must not duplicate it');
    controller.stop();
    assert.equal(toggle.events.click, undefined);
    assert.equal(dialog.events.keydown, undefined);
    assert.equal(dialog.events.cancel, undefined);
    assert.equal(dialog.events.click, undefined);
    assert.equal(closeButton.events.click, undefined);
    assert.equal(timers.size, 0);
    assert.equal(listeners.resize, undefined, 'menu resize listener must be released');
    assert.equal(listeners.scroll, undefined, 'menu scroll listener must be released');
    console.log('Repeated unchanged-URL refresh replaces frame, rejects stale ready and clears watchdog: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
