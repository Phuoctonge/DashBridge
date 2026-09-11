'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
    const noop = () => {};
    let panels = [{ id: 'p', src: 'https://grafana.test/d-solo/u/name?panelId=1', width: '50%', height: '350px' }];
    let profileId = 'a', saveResult;
    const overlays = [], saves = [], navigations = [];
    const frame = { src: panels[0].src + '&theme=light', dataset: {}, removeAttribute() {} };
    const card = { dataset: {}, style: {}, querySelector: selector => selector === 'iframe' ? frame : null };
    class Element {
        constructor() { this.listeners = {}; this.style = {}; this.children = []; this.isConnected = true; }
        set innerHTML(value) {
            this.html = value; this.nodes = new Map();
            for (const [selector, initial] of [['#iframeSettingsUrl', panels[0].src], ['#iframeSettingsTheme', 'follow'],
                ['#iframeSettingsWidth', '50%'], ['#iframeSettingsHeight', '350'],
                ['.iframe-settings-save', ''], ['.iframe-settings-cancel', ''], ['.iframe-settings-modal', '']]) {
                const node = new Element(); node.value = initial; this.nodes.set(selector, node);
            }
        }
        querySelector(selector) { return this.nodes?.get(selector) || this.children.find(child => `.${child.className}` === selector) || null; }
        querySelectorAll() { return [...(this.nodes?.values() || [])]; }
        addEventListener(type, fn) { this.listeners[type] = fn; }
        setAttribute(name, value) { this[name] = value; }
        removeAttribute(name) { delete this[name]; }
        prepend(node) { this.children.unshift(node); }
        appendChild(node) { this.children.push(node); }
        remove() { this.isConnected = false; }
    }
    const documentRef = { createElement: () => new Element(), body: { appendChild: overlay => overlays.push(overlay) },
        getElementById: () => null };
    const c = vm.createContext({ URL, console, requestAnimationFrame: noop });
    vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-panel-card-controller.js', 'utf8'), c);
    const api = c.DashBridgePanelCardController.create({
        renderer: { createPanelCard: noop }, getPanels: () => panels, setPanels: value => { panels = value; },
        savePanels: () => { saves.push(structuredClone(panels)); return new Promise(resolve => { saveResult = resolve; }); },
        getActiveProfile: () => ({ id: profileId }), applyPanelParamsToUrl: panel => panel.src + '&theme=' + (panel.grafanaTheme === 'dark' ? 'dark' : 'light'),
        navigateDashboardFrame: (_frame, src) => { navigations.push(src); frame.src = src; }, findPanelCard: () => card, getPanelAnalysisType: noop,
        syncPanelAnalysisAction: noop, closePanelAnalysis: noop, isPanelAnalysisOpen: () => false,
        escapeHtml: String, icons: { expand: 'expand', collapse: 'collapse' }, runtimeScopeId: 'test', documentRef,
        actionDependencies: { showAlert: async () => {}, showConfirm: async () => true,
            setPanelDataStatus: noop, postToDashboardFrame: noop, panelAnalysis: { isPanel: () => false },
            panelTools: { removePanel: noop }, isSupportedPanelUrl: () => true, normalizePanelUrl: value => value,
            runToolbarCapture: noop, openPanelReportEditor: noop, openPanelTools: noop, openPanelAnalysis: noop },
    });
    return { api, saves, navigations, get panels() { return panels; }, set panels(value) { panels = value; },
        switchProfile: value => { profileId = value; }, resolve: value => saveResult(value),
        open() { api.openIframeSettings(panels[0]); return overlays.at(-1); } };
}
const clickSave = overlay => overlay.querySelector('.iframe-settings-save').listeners.click();
(async () => {
    {
        const h = harness(), overlay = h.open();
        overlay.querySelector('#iframeSettingsHeight').value = '640';
        const saving = clickSave(overlay);
        assert.equal(overlay.isConnected, true, 'modal must stay visible until save resolves');
        await clickSave(overlay);
        assert.equal(h.saves.length, 1, 'double Save cannot enqueue another commit');
        h.resolve({ error: 'QUOTA_BYTES exceeded' }); await saving;
        assert.equal(overlay.isConnected, true, 'failed draft stays open');
        assert.equal(overlay.querySelector('#iframeSettingsHeight').value, '640');
        assert.equal(overlay.querySelector('.iframe-settings-save').disabled, false);
        const retry = clickSave(overlay); h.resolve({ current: true }); await retry;
        assert.equal(overlay.isConnected, false, 'successful retry closes');
        assert.equal(h.panels[0].height, '640px');
        assert.equal(h.navigations.length, 0, 'layout-only save with absent/follow theme never navigates iframe');
    }
    for (const property of ['theme', 'url']) {
        const h = harness(), overlay = h.open();
        if (property === 'theme') overlay.querySelector('#iframeSettingsTheme').value = 'dark';
        else overlay.querySelector('#iframeSettingsUrl').value = 'https://grafana.test/d-solo/u/name?panelId=2';
        const first = clickSave(overlay); h.resolve({ error: 'quota' }); await first;
        assert.equal(h.navigations.length, 0, 'unpersisted settings do not navigate');
        const retry = clickSave(overlay); h.resolve({ current: true }); await retry;
        assert.equal(h.navigations.length, 1, `${property} change navigates once after acknowledged retry`);
        assert(h.navigations[0].includes(property === 'theme' ? 'theme=dark' : 'panelId=2'));
    }
    for (const change of ['replace', 'profile', 'delete', 'equivalent']) {
        const h = harness(), original = h.panels[0], overlay = h.open();
        overlay.querySelector('#iframeSettingsHeight').value = '990';
        if (change === 'replace') h.panels = [{ ...original, height: '800px' }];
        if (change === 'profile') { h.switchProfile('b'); h.panels = [{ ...original }]; }
        if (change === 'delete') h.panels = [];
        if (change === 'equivalent') h.panels = [{ ...original, tools: { thresholdUnit: 'bytes' } }];
        const saving = clickSave(overlay);
        if (change === 'equivalent') { h.resolve({ current: true }); await saving; assert.equal(h.panels[0].height, '990px'); }
        else { await saving; assert.equal(h.saves.length, 0, `${change} must reject stale editor`); assert.equal(overlay.isConnected, true); }
        assert.equal(original.height, '350px', 'detached original is never mutated');
    }
    {
        const h = harness(), overlay = h.open();
        const saving = clickSave(overlay); h.switchProfile('b'); h.resolve({ current: false }); await saving;
        assert.equal(overlay.isConnected, true, 'profile switch during save cannot report success');
    }
    console.log('PASS iframe settings awaits persistence, retains failed drafts, rejects stale owners and allows equivalent objects');
})().catch(error => { console.error(error); process.exitCode = 1; });
