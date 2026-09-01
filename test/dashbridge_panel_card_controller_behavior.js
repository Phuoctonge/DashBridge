'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-panel-card-controller.js', 'utf8'), context);

const panels = [{
    id: 'panel-1', src: 'https://grafana.example/d-solo/uid/name?panelId=1',
    width: '50%', height: '350px', paused: false, tools: {},
}];
const navigations = [];
const calls = { drag: 0, actions: 0, sync: 0, close: 0, removed: 0 };
const cards = new Map();

const makeIframe = src => ({
    src: '', dataset: { src }, removed: [],
    removeAttribute(name) { this.removed.push(name); delete this.dataset[name.replace(/^data-/, '')]; },
});
const makeCard = panel => {
    const iframe = makeIframe(`prepared:${panel.src}`);
    const openButton = { dataset: {} };
    const card = {
        dataset: { panelId: panel.id }, style: {}, iframe, openButton,
        classList: { contains: () => false, add: () => undefined },
        querySelector(selector) {
            if (selector === 'iframe') return iframe;
            if (selector === '.btn-open') return openButton;
            return null;
        },
        remove() { cards.delete(panel.id); },
        replaceWith(replacement) { cards.set(panel.id, replacement); },
    };
    cards.set(panel.id, card);
    return card;
};
const dashboard = {
    innerHTML: '', children: [],
    querySelector: () => null,
    querySelectorAll: () => [...cards.values()],
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
    getActiveProfile: () => ({ name: 'Test' }),
    applyPanelParamsToUrl: panel => `prepared:${panel.src}`,
    navigateDashboardFrame: (iframe, src) => { iframe.src = src; navigations.push(src); },
    bindCardDrag: () => { calls.drag += 1; },
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
    assert.strictEqual(cards.size, 1);
    assert.strictEqual(navigations.length, 1, 'active card must navigate exactly once during creation');
    assert.deepStrictEqual({ drag: calls.drag, actions: calls.actions }, { drag: 1, actions: 1 });

    panels[0].height = '420px';
    panels[0].width = '33%';
    controller.updatePanelCard('panel-1', { reloadFrame: false });
    assert.strictEqual(cards.get('panel-1').dataset.panelSize, 'third');
    assert.strictEqual(cards.get('panel-1').style.height, '420px');
    assert.strictEqual(cards.get('panel-1').openButton.dataset.url, panels[0].src);
    assert.strictEqual(navigations.length, 1, 'layout-only update must preserve the iframe');

    const target = { id: 'panel-1', stale: true };
    controller.adoptPanelState(target, { id: 'panel-1', title: 'Current' });
    assert.deepStrictEqual(target, { id: 'panel-1', title: 'Current' });
    assert(controller.panelFrameSignature(panels[0]).includes('grafanaTheme'));

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
