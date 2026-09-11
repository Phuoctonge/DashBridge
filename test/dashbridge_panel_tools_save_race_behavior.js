'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createHarness() {
    let profileId = 'profile-a';
    let panel = { id: 'panel-a', title: 'CPU Usage', src: 'https://grafana.example/d-solo/u/n?panelId=1', tools: { removeFill: false } };
    let modal, saveResult = Promise.resolve({ current: true }), saves = 0, refreshes = 0;
    const errors = [], button = { disabled: false };
    const overlay = { querySelector: selector => selector === '.panel-tools-save' ? button : null,
        prepend: node => errors.push(node.textContent) };
    const context = vm.createContext({ console, setTimeout, clearTimeout, CSS: { escape: value => value },
        document: { createElement: () => ({ setAttribute() {} }) } });
    vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-panel-tools-controller.js', 'utf8'), context);
    const controller = context.DashBridgePanelToolsController.create({
        getPanels: () => panel ? [panel] : [], getActiveProfile: () => ({ id: profileId }),
        postToDashboardFrame: () => true, getCapturePrepared: () => false,
        getTransformSettings: () => ({}), getDefaultCpuCapacityCoefficient: () => 0.8,
        normalizePanelMetadataText: value => String(value || ''),
        savePanels: () => { saves++; return saveResult; }, forceLoadPanel: () => null,
        refreshPanel: () => { refreshes++; }, settingsStorage: { get: async () => ({}) },
        getSettingsKeys: () => [], normalizeSettings: value => value,
        panelAnalysis: { classifyPanelTitle: () => 'cpu' },
        settingsModal: { open: options => { modal = options; return overlay; }, transformFields: () => '', thresholdFields: () => '', legendFields: () => '' },
        escapeHtml: value => value,
    });
    return { controller, errors, button, get panel() { return panel; }, get modal() { return modal; },
        get saves() { return saves; }, get refreshes() { return refreshes; },
        replace(value) { panel = value; }, switchProfile() { profileId = 'profile-b'; },
        setSaveResult(value) { saveResult = value; },
    };
}

(async () => {
    let failures = 0;
    const scenario = async (name, run) => {
        try { await run(); console.log('PASS ' + name); }
        catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.message); }
    };
    await scenario('remote tool changes reject the old modal without mutating either panel', async () => {
        const h = createHarness(), old = h.panel; await h.controller.open(old, {});
        h.replace({ ...old, tools: { removeFill: false, thickenLines: true } });
        assert.equal(await h.modal.onSave({ ...h.modal.state, removeFill: true }), false);
        assert.match(h.errors[0], /измен|актуаль/i);
        assert.equal(old.tools.removeFill, false); assert.equal(h.panel.tools.removeFill, false);
        assert.equal(h.saves, 0); assert.equal(h.refreshes, 0);
    });
    await scenario('equivalent replacement objects save to the current panel', async () => {
        const h = createHarness(), old = h.panel; await h.controller.open(old, {});
        h.replace(structuredClone(old));
        await h.modal.onSave({ ...h.modal.state, removeFill: true });
        assert.equal(h.panel.tools.removeFill, true); assert.equal(old.tools.removeFill, false);
        assert.equal(h.saves, 1); assert.equal(h.refreshes, 1);
    });
    await scenario('profile change with reused panel ID cannot receive old modal tools', async () => {
        const h = createHarness(); await h.controller.open(h.panel, {}); h.switchProfile();
        assert.equal(await h.modal.onSave({ ...h.modal.state, removeFill: true }), false);
        assert.equal(h.panel.tools.removeFill, false); assert.equal(h.saves, 0);
    });
    await scenario('deleted panel cannot be resurrected by its modal', async () => {
        const h = createHarness(); await h.controller.open(h.panel, {}); h.replace(null);
        assert.equal(await h.modal.onSave({ ...h.modal.state, removeFill: true }), false);
        assert.equal(h.saves, 0);
    });
    await scenario('profile switch while loading settings cancels opening without an unhandled rejection', async () => {
        const h = createHarness();
        const opening = h.controller.open(h.panel, {}); h.switchProfile();
        assert.equal(await opening, null);
        assert.equal(h.modal, undefined); assert.equal(h.saves, 0);
    });
    await scenario('save awaits persistence and preserves retry after quota error', async () => {
        const h = createHarness(); await h.controller.open(h.panel, {});
        let resolve; h.setSaveResult(new Promise(done => { resolve = done; }));
        let settled = false;
        const save = Promise.resolve(h.modal.onSave({ ...h.modal.state, removeFill: true }));
        save.then(() => { settled = true; }, () => { settled = true; });
        await Promise.resolve(); assert.equal(settled, false); assert.equal(h.refreshes, 0);
        assert.equal(h.button.disabled, true);
        assert.equal(await h.modal.onSave({ ...h.modal.state, removeFill: true }), false);
        assert.equal(h.saves, 1, 'a second Save while pending does not write again');
        resolve({ current: false, error: 'QUOTA_BYTES exceeded' });
        assert.equal(await save, false); assert.match(h.errors[0], /QUOTA_BYTES/);
        assert.equal(h.button.disabled, false);
        h.setSaveResult(Promise.resolve({ current: true }));
        await h.modal.onSave({ ...h.modal.state, removeFill: true });
        assert.equal(h.panel.tools.removeFill, true); assert.equal(h.refreshes, 1);
    });
    assert.equal(failures, 0, `${failures} panel tools scenarios failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
