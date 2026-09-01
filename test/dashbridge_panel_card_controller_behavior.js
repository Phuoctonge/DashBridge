'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-panel-card-controller.js', 'utf8'), context);

let panels = [{
    id: 'panel-1', src: 'https://grafana.example/d-solo/uid/name?panelId=1',
    width: '50%', height: '350px', paused: false, tools: {},
}, {
    id: 'panel-2', src: 'https://grafana.example/d-solo/uid/name?panelId=2',
    width: '50%', height: '350px', paused: false, tools: {},
}];
const navigations = [];
const calls = { actions: 0, sync: 0, close: 0, removed: 0 };
let saveCount = 0;
const cards = new Map();

const makeClassList = () => {
    const values = new Set();
    return {
        add: value => values.add(value),
        remove: (...items) => items.forEach(item => values.delete(item)),
        contains: value => values.has(value),
    };
};

const makeIframe = src => ({
    src: '', dataset: { src }, removed: [],
    removeAttribute(name) { this.removed.push(name); delete this.dataset[name.replace(/^data-/, '')]; },
});
const makeCard = panel => {
    const iframe = makeIframe(`prepared:${panel.src}`);
    const openButton = { dataset: {} };
    const dragHandle = { listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } };
    const card = {
        dataset: { panelId: panel.id }, style: {}, iframe, openButton, dragHandle,
        draggable: false, listeners: {}, offsetWidth: 100,
        classList: makeClassList(),
        addEventListener(type, listener) { this.listeners[type] = listener; },
        getBoundingClientRect: () => ({ left: 100 }),
        querySelector(selector) {
            if (selector === 'iframe') return iframe;
            if (selector === '.btn-open') return openButton;
            if (selector === '.drag-handle') return dragHandle;
            return null;
        },
        remove() { cards.delete(panel.id); },
        replaceWith(replacement) { cards.set(panel.id, replacement); },
    };
    cards.set(panel.id, card);
    return card;
};
const dashboard = {
    innerHTML: '', children: [], listeners: {}, classList: makeClassList(),
    addEventListener(type, listener) { this.listeners[type] = listener; },
    contains: node => dashboard.children.includes(node),
    querySelector: () => null,
    querySelectorAll: () => dashboard.children,
    insertBefore(node, reference) {
        this.children = this.children.filter(child => child !== node);
        const index = reference ? this.children.indexOf(reference) : -1;
        if (index < 0) this.children.push(node); else this.children.splice(index, 0, node);
    },
    appendChild(value) {
        const children = value.children || [value];
        children.forEach(child => {
            this.children.push(child);
            cards.set(child.dataset.panelId, child);
        });
    },
};
const documentRef = {
    getElementById(id) {
        if (id === 'dashboard') return dashboard;
        if (id === 'iframe-panel-1') return cards.get('panel-1')?.iframe || null;
        return null;
    },
    createDocumentFragment: () => ({ children: [], appendChild(child) { this.children.push(child); } }),
};

const controller = context.DashBridgePanelCardController.create({
    renderer: { createPanelCard: ({ panel }) => makeCard(panel) },
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    savePanels: () => { saveCount += 1; },
    getActiveProfile: () => ({ name: 'Test' }),
    applyPanelParamsToUrl: panel => `prepared:${panel.src}`,
    navigateDashboardFrame: (iframe, src) => { iframe.src = src; navigations.push(src); },
    bindPanelActions: () => { calls.actions += 1; },
    findPanelCard: id => cards.get(id) || null,
    getPanelAnalysisType: () => null,
    syncPanelAnalysisAction: () => { calls.sync += 1; },
    closePanelAnalysis: () => { calls.close += 1; },
    isPanelAnalysisOpen: () => false,
    onPanelRemoved: () => { calls.removed += 1; },
    escapeHtml: value => value,
    icons: { collapse: '<collapse>' },
    documentRef,
});

(async () => {
    await controller.renderDashboard();
    assert.strictEqual(cards.size, 2);
    assert.strictEqual(navigations.length, 2, 'active cards must navigate exactly once during creation');
    assert.strictEqual(calls.actions, 2);

    panels[0].height = '420px';
    panels[0].width = '33%';
    controller.updatePanelCard('panel-1', { reloadFrame: false });
    assert.strictEqual(cards.get('panel-1').dataset.panelSize, 'third');
    assert.strictEqual(cards.get('panel-1').style.height, '420px');
    assert.strictEqual(cards.get('panel-1').openButton.dataset.url, panels[0].src);
    assert.strictEqual(navigations.length, 2, 'layout-only update must preserve the iframe');

    const target = { id: 'panel-1', stale: true };
    controller.adoptPanelState(target, { id: 'panel-1', title: 'Current' });
    assert.deepStrictEqual(target, { id: 'panel-1', title: 'Current' });
    assert(controller.panelFrameSignature(panels[0]).includes('grafanaTheme'));

    controller.setupDrag();
    const first = cards.get('panel-1');
    const second = cards.get('panel-2');
    second.dragHandle.listeners.mousedown();
    const transfer = { effectAllowed: '', dropEffect: '', setData(type, value) { this[type] = value; } };
    second.listeners.dragstart({ dataTransfer: transfer });
    dashboard.listeners.dragover({
        target: { closest: () => first }, clientX: 110, dataTransfer: transfer, preventDefault() {},
    });
    dashboard.listeners.drop({ preventDefault() {} });
    assert.strictEqual(dashboard.children.map(card => card.dataset.panelId).join(','), 'panel-2,panel-1');
    assert.strictEqual(panels.map(panel => panel.id).join(','), 'panel-2,panel-1');
    assert.strictEqual(saveCount, 1);
    second.listeners.dragend();
    assert.strictEqual(second.draggable, false);

    panels.length = 0;
    controller.removePanelCard('panel-1');
    assert.strictEqual(calls.removed, 1);
    assert(dashboard.innerHTML.includes('Профиль «Test» пуст'));

    assert.throws(
        () => context.DashBridgePanelCardController.create({ documentRef }),
        error => error?.name === 'TypeError'
    );
    console.log('PASS DashBridge panel card controller preserves render, update and cleanup lifecycle');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
