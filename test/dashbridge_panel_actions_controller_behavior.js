'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { URL, console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync('pages/dashbridge/dashbridge-panel-card-controller.js', 'utf8'),
    context
);

const panel = {
    id: 'panel-1', src: 'https://grafana.example/d-solo/uid/name?panelId=1',
    width: '50%', height: '350px', paused: false, tools: {},
};
let panels = [panel];
const calls = {
    save: 0, remove: 0, replace: 0, force: 0, navigate: [], status: 0,
    closeAnalysis: 0, removeTools: 0, captures: [], opened: [],
};
const iframe = { src: panel.src, dataset: {}, removeAttribute() {} };
const fullscreenButton = { innerHTML: '', title: '', addEventListener() {} };
const dragHandle = { addEventListener() {} };
const cardClasses = new Set();
const card = {
    dataset: {}, style: {},
    addEventListener() {},
    classList: {
        add: value => cardClasses.add(value),
        remove: value => cardClasses.delete(value),
        contains: value => cardClasses.has(value),
    },
    querySelector: selector => selector === '.btn-fullscreen' ? fullscreenButton
        : selector === 'iframe' ? iframe
            : selector === '.drag-handle' ? dragHandle : null,
    replaceWith() { calls.replace += 1; },
    remove() { calls.remove += 1; },
};
const actionElements = new Map();
for (const selector of [
    '.btn-fullscreen', '.btn-refresh', '.btn-pause', '.btn-resume',
    '.btn-capture-save', '.btn-capture-copy', '.btn-iframe-settings',
    '.btn-report-settings', '.btn-panel-tools', '.btn-more', '.btn-analysis',
    '.btn-open', '.btn-delete',
]) {
    actionElements.set(selector, {
        dataset: selector === '.btn-analysis' ? { analysisType: 'cpu' } : {},
        addEventListener(type, listener) { this[type] = listener; },
    });
}
const actionCard = { querySelector: selector => actionElements.get(selector) || null };
const dashboard = { innerHTML: '', appendChild() {}, querySelectorAll: () => [] };

const controller = context.DashBridgePanelCardController.create({
    renderer: { createPanelCard: () => card },
    getPanels: () => panels,
    setPanels: value => { panels = value; },
    savePanels: () => { calls.save += 1; },
    getActiveProfile: () => ({ name: 'Test' }),
    applyPanelParamsToUrl: (_panel, value) => value || panel.src,
    navigateDashboardFrame: (_iframe, value) => calls.navigate.push(value),
    findPanelCard: id => id === panel.id ? card : null,
    getPanelAnalysisType: () => null,
    syncPanelAnalysisAction: () => undefined,
    closePanelAnalysis: () => { calls.closeAnalysis += 1; },
    isPanelAnalysisOpen: () => false,
    escapeHtml: value => value,
    icons: { expand: '<expand>', collapse: '<collapse>' },
    runtimeScopeId: 'scope-1',
    actionDependencies: {
        showAlert: async () => undefined,
        showConfirm: async () => true,
        setPanelDataStatus: () => { calls.status += 1; },
        postToDashboardFrame: () => undefined,
        panelAnalysis: { isPanel: value => value === panel || value === panel.id },
        panelTools: { removePanel: () => { calls.removeTools += 1; } },
        isSupportedPanelUrl: () => true,
        normalizePanelUrl: value => value,
        runToolbarCapture: (...args) => calls.captures.push(args),
        openPanelReportEditor: () => undefined,
        openPanelTools: () => undefined,
        openPanelAnalysis: () => undefined,
        openWindow: (...args) => calls.opened.push(args),
        now: () => 12345,
        requestFrame: callback => callback(),
    },
    documentRef: {
        getElementById: id => id === 'iframe-panel-1' ? iframe
            : id === 'dashboard' ? dashboard : null,
        createElement: () => { throw new Error('settings modal is covered by its contract tests'); },
    },
});

(async () => {
    controller.refreshPanel(panel.id);
    assert.strictEqual(calls.status, 1);
    assert(new URL(calls.navigate[0]).searchParams.get('_t') === '12345');

    await controller.togglePanelPause(panel.id);
    assert.strictEqual(panel.paused, true);
    assert.strictEqual(calls.replace, 1);
    assert.strictEqual(calls.closeAnalysis, 1);

    controller.toggleFullscreen(panel.id);
    assert(cardClasses.has('fullscreen'));
    assert.strictEqual(fullscreenButton.innerHTML, '<collapse>');
    assert.strictEqual(controller.exitFullscreen(), true);
    assert(!cardClasses.has('fullscreen'));
    assert.strictEqual(fullscreenButton.innerHTML, '<expand>');
    assert.strictEqual(controller.exitFullscreen(), false);

    controller.bindPanelActions(actionCard, panel, iframe);
    actionElements.get('.btn-open').dataset.url = panel.src;
    actionElements.get('.btn-open').click({
        currentTarget: actionElements.get('.btn-open'),
    });
    assert.deepStrictEqual(calls.opened[0].slice(1), ['_blank', 'noopener,noreferrer']);
    actionElements.get('.btn-capture-copy').click({
        currentTarget: actionElements.get('.btn-capture-copy'),
    });
    assert.strictEqual(calls.captures[0][2], 'copy');

    controller.handlePanelRemoved(panel.id);
    assert.strictEqual(calls.removeTools, 1);
    assert.strictEqual(calls.closeAnalysis, 2);

    await controller.deletePanel(panel.id);
    assert.strictEqual(panels.length, 0);
    assert.strictEqual(calls.remove, 1);
    assert.strictEqual(calls.save, 2);

    assert.throws(
        () => context.DashBridgePanelCardController.create({ documentRef: {} }),
        error => error?.name === 'TypeError'
    );
    console.log('PASS DashBridge panel card controller preserves actions, fullscreen and cleanup');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
