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
    constructor(value) { super(); this.currentValue = value; this.type = 'text'; this.events = []; }
    get value() { return this.currentValue; }
    set value(value) { this.currentValue = value; }
    dispatchEvent(event) { this.events.push(event.type); return super.dispatchEvent(event); }
}
const button = text => ({
    textContent: text, dataset: {}, title: '', isConnected: true, handlers: [],
    classList: { contains: () => false, toggle() {}, remove() {} },
    matches: () => true,
    addEventListener(type, handler) { if (type === 'click') this.handlers.push(handler); }
});

async function run() {
    const inputs = [new Input('original-from'), new Input('original-to')];
    const copy = button('Copy');
    const paste = button('Paste');
    const apply = button('Apply time range');
    const actions = { textContent: '', children: [copy, paste, apply], querySelector: () => null, querySelectorAll: () => [] };
    const picker = { textContent: 'Absolute time range', querySelectorAll: () => inputs };
    actions.parentElement = picker;
    copy.parentElement = paste.parentElement = apply.parentElement = actions;
    const document = {
        body: {}, documentElement: { dataset: { dashbridgeGrafanaMenuEnabled: 'true' } },
        querySelectorAll: () => [copy, paste, apply], addEventListener() {}
    };
    let payload = '';
    let copied = '';
    const context = {
        document, URL, Date, Event, HTMLInputElement: Input, HTMLTextAreaElement: class {},
        MutationObserver: class { observe() {} },
        requestAnimationFrame: callback => callback(), setTimeout() {},
        navigator: { clipboard: {
            async readText() { return payload; }, async writeText(text) { copied = text; }
        } }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('js/content/grafana-time-picker-clipboard.js', 'utf8'), context);
    const click = async target => {
        target.handlers.forEach(handler => handler({ preventDefault() {}, stopImmediatePropagation() {} }));
        await new Promise(resolve => setImmediate(resolve));
    };
    assert.strictEqual(paste.handlers.length, 1, 'native Paste must be mounted');
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
    assert.strictEqual(apply.handlers.length, 0, 'Apply remains owned by Grafana');
    console.log('PASS native clipboard handlers reject invalid ranges atomically and preserve valid copy/paste');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
