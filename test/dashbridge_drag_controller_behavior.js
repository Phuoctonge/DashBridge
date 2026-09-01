'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const makeClassList = () => {
    const values = new Set();
    return {
        add: value => values.add(value),
        remove: (...items) => items.forEach(item => values.delete(item)),
        contains: value => values.has(value)
    };
};
const makeCard = id => ({
    dataset: { panelId: id }, draggable: false, classList: makeClassList(), listeners: {}, offsetWidth: 100,
    addEventListener(type, listener) { this.listeners[type] = listener; },
    querySelector(selector) {
        assert.strictEqual(selector, '.drag-handle');
        return this.handle ||= { listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } };
    },
    getBoundingClientRect: () => ({ left: 100 })
});
const first = makeCard('a');
const second = makeCard('b');
const container = {
    cards: [first, second], listeners: {}, classList: makeClassList(),
    addEventListener(type, listener) { this.listeners[type] = listener; },
    querySelectorAll: () => container.cards,
    contains: node => container.cards.includes(node),
    insertBefore(node, reference) {
        this.cards = this.cards.filter(card => card !== node);
        const index = reference ? this.cards.indexOf(reference) : -1;
        if (index < 0) this.cards.push(node); else this.cards.splice(index, 0, node);
    }
};
Object.defineProperty(first, 'nextSibling', { get: () => container.cards[container.cards.indexOf(first) + 1] || null });
Object.defineProperty(second, 'nextSibling', { get: () => container.cards[container.cards.indexOf(second) + 1] || null });

const context = { console };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync('pages/dashbridge/dashbridge-drag-controller.js', 'utf8'), context);
let panels = [{ id: 'a' }, { id: 'b' }];
let saveCount = 0;
const controller = context.DashBridgeDragController.create({
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    savePanels: () => { saveCount += 1; },
    documentRef: { getElementById: id => { assert.strictEqual(id, 'dashboard'); return container; } }
});
controller.setup();
controller.bindCard(second, panels[1], container);

second.handle.listeners.mousedown();
assert.strictEqual(second.draggable, true);
const transfer = { effectAllowed: '', dropEffect: '', setData(type, value) { this[type] = value; } };
second.listeners.dragstart({ dataTransfer: transfer });
assert.strictEqual(transfer.effectAllowed, 'move');
assert.strictEqual(transfer['text/plain'], 'b');
assert(second.classList.contains('dragging') && container.classList.contains('is-dragging'));

container.listeners.dragover({
    target: { closest: () => first }, clientX: 110, dataTransfer: transfer, preventDefault() {}
});
assert(first.classList.contains('drag-over-left'));
container.listeners.drop({ preventDefault() {} });
assert.strictEqual(container.cards.map(card => card.dataset.panelId).join(','), 'b,a');
assert.strictEqual(panels.map(panel => panel.id).join(','), 'b,a');
assert.strictEqual(saveCount, 1);

second.listeners.dragend();
assert.strictEqual(second.draggable, false);
assert(!second.classList.contains('dragging') && !container.classList.contains('is-dragging'));
console.log('PASS DashBridge drag controller preserves card reorder and cleanup lifecycle');
