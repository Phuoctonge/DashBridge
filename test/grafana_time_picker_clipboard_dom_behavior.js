'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { EventTarget, Event } = globalThis;
const localDate = milliseconds => {
    const date = new Date(milliseconds);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// Only the DOM/clipboard boundary is simulated; mount and click handlers run
// unchanged, including native value setters and input/change dispatch.
class Input extends EventTarget {
    constructor(value) { super(); this.currentValue = value; this.type = 'text'; this.events = []; this.isConnected = true; }
    get value() { return this.currentValue; }
    set value(value) { this.currentValue = value; }
    dispatchEvent(event) { this.events.push(event.type); return super.dispatchEvent(event); }
}
const button = text => ({
    textContent: text, dataset: {}, title: `Native ${text}`, isConnected: true, handlers: [], captureHandlers: new Set(),
    classList: { values: new Set(), contains(name) { return this.values.has(name); }, toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); }, remove(...names) { names.forEach(name => this.values.delete(name)); } },
    matches: () => true,
    addEventListener(type, handler, capture = false) { if (type === 'click') { this.handlers.push(handler); if (capture) this.captureHandlers.add(handler); } },
    removeEventListener(type, handler, capture = false) {
        if (type === 'click' && this.captureHandlers.has(handler) === capture) {
            this.handlers = this.handlers.filter(value => value !== handler);
            this.captureHandlers.delete(handler);
        }
    },
    getAttribute(name) { return name === 'title' ? this.title : null; },
    setAttribute(name, value) { if (name === 'title') this.title = value; },
    removeAttribute(name) { if (name === 'title') this.title = ''; }
});

async function run(legacy = false) {
    const inputs = [new Input('original-from'), new Input('original-to')];
    let copy = button('Copy');
    let paste = button('Paste');
    const apply = button('Apply time range');
    const actions = {
        textContent: '', children: legacy ? [apply] : [copy, paste, apply],
        querySelector: () => actions.children.find(child => child.className?.includes('dashbridge-time-picker-clipboard')) || null,
        querySelectorAll: () => [],
        insertBefore(node, target) {
            node.parentElement = actions;
            actions.children.splice(actions.children.indexOf(target), 0, node);
            if (node.className.includes('dashbridge-time-picker-copy')) copy = node;
            else paste = node;
        }
    };
    const picker = { isConnected: true, textContent: 'Absolute time range', querySelectorAll: () => inputs,
        contains: node => actions.children.includes(node) };
    actions.parentElement = picker;
    copy.parentElement = paste.parentElement = apply.parentElement = actions;
    const listeners = new Map();
    const timers = new Map();
    let timerId = 0;
    let mutation;
    const document = {
        body: {}, documentElement: { dataset: { dashbridgeGrafanaMenuEnabled: 'true' }, append() {} },
        querySelectorAll: selector => selector.startsWith('.') ? actions.children.filter(node => node.className?.includes('dashbridge-time-picker-clipboard')) : actions.children,
        addEventListener(type, handler) { listeners.set(type, handler); },
        getElementById: () => legacy,
        createElement() {
            const node = button('');
            node.ownerDocument = document;
            node.append = () => {};
            node.remove = () => {
                node.isConnected = false;
                actions.children = actions.children.filter(child => child !== node);
            };
            return node;
        },
        createElementNS() { return { setAttribute() {}, append() {} }; }
    };
    let payload = '';
    let copied = '';
    let deferredRead = null;
    let deferredWrite = null;
    let writes = 0;
    let reads = 0;
    let nativeCalls = 0;
    const nativeHandler = () => { nativeCalls++; };
    if (!legacy) {
        copy.addEventListener('click', nativeHandler);
        paste.addEventListener('click', nativeHandler);
        copy.dataset.dashbridgeTimeClipboardBound = 'site-marker';
        copy.classList.toggle('dashbridge-time-picker-failed', true);
    }
    const extensionHandlers = target => target.handlers.filter(handler => handler !== nativeHandler).length;
    const outcomes = [];
    [copy, paste, apply, picker, ...inputs].forEach(node => { node.ownerDocument = document; });
    const scope = allowed => { document.documentElement.dataset.dashbridgeGrafanaMenuEnabled = String(allowed); listeners.get('dashbridgeGrafanaMenuScopeChanged')(); };
    const context = {
        document, URL, Date, Event, HTMLInputElement: Input, HTMLTextAreaElement: class {},
        addEventListener(type, handler) { listeners.set(type, handler); },
        MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} disconnect() {} },
        requestAnimationFrame: callback => callback(),
        setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        DashBridgeAnalytics: { outcome(...args) { outcomes.push(args); } },
        navigator: { clipboard: {
            async readText() { reads++; return deferredRead ? deferredRead : payload; }, async writeText(text) { writes++; copied = text; return deferredWrite; }
        } }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('js/content/grafana-time-picker-clipboard.js', 'utf8'), context);
    const click = async target => {
        let stopped = false;
        const event = { preventDefault() {}, stopImmediatePropagation() { stopped = true; }, stopPropagation() {} };
        for (const handler of [...target.handlers].sort((a, b) => Number(target.captureHandlers.has(b)) - Number(target.captureHandlers.has(a)))) {
            if (stopped) break;
            handler(event);
        }
        await new Promise(resolve => setImmediate(resolve));
    };
    assert.strictEqual(extensionHandlers(paste), 1, 'Paste must be mounted');
    for (const range of [
        { from: 'garbage', to: 'also garbage' },
        { from: 'now-1h', to: 'garbage' },
        { from: '2026-02-30 12:00:00', to: 'now' },
        { from: {}, to: 'now' }
    ]) {
        payload = JSON.stringify(range);
        await click(paste);
        assert.deepStrictEqual(inputs.map(input => input.value), ['original-from', 'original-to'],
            'invalid endpoint must leave BOTH native inputs untouched');
        assert.deepStrictEqual(inputs.map(input => input.events), [[], []],
            'invalid range must emit no native input/change events');
    }
    for (const [range, expected] of [
        [{ from: 'now-15m', to: 'now' }, ['now-15m', 'now']],
        [{ from: '2024-02-29 12:34:56', to: '2024-03-01 12:34:56' }, ['2024-02-29 12:34:56', '2024-03-01 12:34:56']],
        [{ from: '2025-04-25T10:48:00Z', to: '2025-04-25T12:49:00+00:00' }, [localDate(1745578080000), localDate(1745585340000)]],
        [{ from: 1745578080000, to: '1745585340000' }, [localDate(1745578080000), localDate(1745585340000)]]
    ]) {
        payload = JSON.stringify(range);
        await click(paste);
        assert.deepStrictEqual(inputs.map(input => input.value), expected);
        assert.deepStrictEqual(inputs.map(input => input.events.slice(-2)), [['input', 'change'], ['input', 'change']]);
        await click(copy);
        assert.deepStrictEqual(JSON.parse(copied), { from: inputs[0].value, to: inputs[1].value });
    }
    const beforeWrites = writes;
    const restoredCopyTitle = legacy ? 'Копировать диапазон времени' : 'Native Copy';
    const restoredPasteTitle = legacy ? 'Вставить диапазон времени' : 'Native Paste';
    const staleTimers = [...timers.values()];
    scope(false);
    assert.strictEqual(extensionHandlers(copy), 0, 'scope revoke removes extension capture handler');
    assert.strictEqual(copy.dataset.dashbridgeTimeClipboardBound, legacy ? undefined : 'site-marker');
    assert.strictEqual(copy.title, restoredCopyTitle);
    assert.strictEqual(paste.title, restoredPasteTitle);
    assert.strictEqual(copy.classList.values.size, legacy ? 0 : 1);
    if (!legacy) assert(copy.classList.contains('dashbridge-time-picker-failed'), 'original presentation class is restored');
    staleTimers.forEach(callback => callback());
    assert.strictEqual(copy.title, restoredCopyTitle, 'old flash callback cannot overwrite restored title');
    if (legacy) assert.strictEqual(actions.children.length, 1, 'legacy custom actions are removed');
    await click(copy);
    assert.strictEqual(writes, beforeWrites, 'extension clipboard must stay idle after scope revoke');
    assert.strictEqual(nativeCalls, legacy ? 0 : 1, 'Grafana native action passes through while scope is off');
    for (let cycle = 0; cycle < 3; cycle++) {
        scope(true); mutation(); mutation();
        assert.strictEqual(extensionHandlers(copy), 1, 'repeated mount never duplicates handler');
        scope(false);
        assert.strictEqual(extensionHandlers(copy), 0);
    }
    scope(true);
    document.documentElement.dataset.dashbridgeGrafanaMenuEnabled = 'false';
    await click(copy);
    assert.strictEqual(writes, beforeWrites);
    assert.strictEqual(nativeCalls, legacy ? 0 : 2);
    scope(false); scope(true);
    for (const invalidate of [
        () => { scope(false); scope(true); },
        () => { picker.isConnected = false; mutation(); },
        () => { inputs[0].isConnected = false; },
        () => { picker.querySelectorAll = () => [new Input('replacement'), inputs[1]]; }
    ]) {
        let resolveRead;
        deferredRead = new Promise(resolve => { resolveRead = resolve; });
        const values = inputs.map(input => input.value);
        const eventCounts = inputs.map(input => input.events.length);
        const beforeOutcomes = outcomes.length;
        const pending = click(paste);
        invalidate();
        resolveRead('{"from":"now-2h","to":"now"}');
        await pending;
        assert.deepStrictEqual(inputs.map(input => input.value), values, 'late paste cannot mutate stale inputs');
        assert.deepStrictEqual(inputs.map(input => input.events.length), eventCounts);
        assert.strictEqual(outcomes.length, beforeOutcomes, 'cancelled paste emits no success or failure');
        picker.isConnected = inputs[0].isConnected = true;
        picker.querySelectorAll = () => inputs;
        deferredRead = null;
        mutation();
    }
    const beforeReads = reads;
    picker.isConnected = false; mutation();
    assert.strictEqual(extensionHandlers(paste), 0, 'detached picker releases native binding');
    assert.strictEqual(paste.title, restoredPasteTitle);
    await click(paste);
    assert.strictEqual(reads, beforeReads);
    picker.isConnected = true; mutation();
    assert.strictEqual(extensionHandlers(paste), 1, 'remounted picker binds once');
    for (const reject of [false, true]) {
        let finish;
        deferredWrite = new Promise((resolve, rejectPromise) => { finish = reject ? rejectPromise : resolve; });
        const beforeOutcomes = outcomes.length;
        const pending = click(copy);
        scope(false);
        finish(reject ? new Error('clipboard unavailable') : undefined);
        await pending;
        assert.strictEqual(outcomes.length, beforeOutcomes, 'late write completion/error produces no false feedback');
        assert.strictEqual(copy.title, restoredCopyTitle);
        deferredWrite = null;
        scope(true);
    }
    let rejectRead;
    deferredRead = new Promise((resolve, reject) => { rejectRead = reject; });
    const beforeErrorOutcomes = outcomes.length;
    const rejectedPaste = click(paste);
    scope(false);
    rejectRead(new Error('clipboard unavailable'));
    await rejectedPaste;
    assert.strictEqual(outcomes.length, beforeErrorOutcomes, 'late read rejection emits no failure after cleanup');
    deferredRead = null;
    scope(true);
    const beforeHideWrites = writes;
    assert.strictEqual(typeof listeners.get('pagehide'), 'function', 'document teardown must own clipboard cleanup');
    listeners.get('pagehide')();
    await click(copy);
    assert.strictEqual(writes, beforeHideWrites, 'hidden old document has no extension clipboard handler');
    listeners.get('pageshow')();
    assert.strictEqual(extensionHandlers(copy), 1, 'BFCache return mounts one handler');
    assert.strictEqual(apply.handlers.length, 0, 'Apply remains owned by Grafana');
    console.log(`PASS ${legacy ? 'legacy' : 'native'} clipboard validation, scope cleanup, pass-through, late paste/write/error, document and remount lifecycle`);
}
run().then(() => run(true)).catch(error => { console.error(error); process.exitCode = 1; });
