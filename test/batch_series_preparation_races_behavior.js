'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
    constructor() { this.value = ''; this.hidden = true; this.children = []; this.dataset = {}; this.listeners = {}; }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    emit(type) { for (const callback of this.listeners[type] || []) callback(); }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
}

function fixture() {
    const ids = ['seriesDashUrl', 'seriesLoaderStatus', 'seriesPanelsContainer', 'getSeriesPanelsBtn',
        'loadSelectedSeriesBtn', 'copyMainSettingsToSeriesBtn'];
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    elements.seriesDashUrl.value = 'https://grafana.test/d/old/name';
    const pending = [], notices = [], logs = [];
    let selectedIds = ['7'];
    const documentRef = { getElementById: id => elements[id], createElement: () => new Element() };
    const chromeRef = { tabs: { create() {}, update() {}, get() {}, onUpdated: { addListener() {}, removeListener() {} } }, scripting: { executeScript() {} } };
    const context = vm.createContext({ URL, DOMException, document: documentRef, chrome: chromeRef });
    vm.runInContext(fs.readFileSync('pages/batch/batch-series-discovery-controller.js', 'utf8'), context);
    const controller = context.BatchSeriesDiscoveryController.create({
        panelPicker: { open() {}, getSeriesSelectedPanelIds: () => [...selectedIds] },
        getCaptureTheme: () => 'light', showToast: (...args) => notices.push(args), logMessage: (...args) => logs.push(args),
        escapeHtml: value => String(value), parseDashboardUrl: () => ({}), buildSoloPanelUrl: value => value,
        buildPanelUrl: (url, id) => `${url}?viewPanel=${id}`, ensureEarlyRuntime() {},
        fetchDashboardDefinition: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
        findDashboardPanel: dashboard => dashboard.panel, getPanelQuerySignatures: panel => [panel.title],
        documentRef, chromeRef,
    });
    controller.setup();
    const resolve = (index, title) => pending[index].resolve({ payload: { dashboard: { panel: { title } } } });
    return { controller, elements, pending, notices, logs, resolve, select: ids => { selectedIds = ids; } };
}

(async () => {
    const changed = fixture();
    const old = changed.controller.loadSelectedPanels();
    changed.elements.seriesDashUrl.value = 'https://grafana.test/d/new/name';
    changed.select([]);
    changed.elements.seriesPanelsContainer.replaceChildren();
    changed.resolve(0, 'OLD');
    await old;
    assert.equal(changed.elements.seriesPanelsContainer.children.length, 0, 'old URL must not restore cards');
    assert.equal(changed.notices.length, 0, 'stale completion must not publish success');

    for (const rejectOld of [false, true]) {
        const racing = fixture();
        const first = racing.controller.loadSelectedPanels();
        const second = racing.controller.loadSelectedPanels();
        if (rejectOld) racing.pending[0].reject(new Error('old request failed'));
        else racing.resolve(0, 'OLD');
        await first;
        assert.equal(racing.elements.seriesLoaderStatus.hidden, false, 'old finally must not hide newer loader');
        assert.equal(racing.notices.length, 0, 'old success/error must be silent');
        assert.equal(racing.logs.length, 0, 'old failure must not pollute current operation log');
        racing.resolve(1, 'NEW');
        await second;
        assert.equal(racing.elements.seriesLoaderStatus.hidden, true);
        assert.equal(racing.elements.seriesPanelsContainer.children.length, 1);
        assert.match(racing.elements.seriesPanelsContainer.children[0].innerHTML, /NEW/);
        assert.equal(racing.notices.length, 1);
    }

    // Returning to the same URL does not restore ownership to an obsolete load.
    for (const event of ['input', 'change']) {
        const reverted = fixture();
        const job = reverted.controller.loadSelectedPanels();
        reverted.elements.seriesDashUrl.value = 'https://grafana.test/d/new/name';
        reverted.elements.seriesDashUrl.emit(event);
        reverted.elements.seriesDashUrl.value = 'https://grafana.test/d/old/name';
        reverted.elements.seriesDashUrl.emit(event);
        reverted.resolve(0, 'OLD');
        await job;
        assert.equal(reverted.elements.seriesPanelsContainer.children.length, 0, `${event} invalidates generation`);
        assert.equal(reverted.notices.length, 0);
        assert.equal(reverted.elements.seriesLoaderStatus.hidden, true);
    }
    const selection = fixture();
    const job = selection.controller.loadSelectedPanels();
    selection.select(['9']);
    selection.resolve(0, 'OLD');
    await job;
    assert.equal(selection.elements.seriesPanelsContainer.children.length, 0, 'changed selection rejects old cards');
    assert.equal(selection.notices.length, 0);

    const invalid = fixture();
    const abandoned = invalid.controller.loadSelectedPanels();
    invalid.select([]);
    await invalid.controller.loadSelectedPanels();
    assert.equal(invalid.elements.seriesLoaderStatus.hidden, true, 'invalid replacement stops obsolete loader');
    invalid.resolve(0, 'OLD');
    await abandoned;
    assert.equal(invalid.elements.seriesPanelsContainer.children.length, 0);

    const newerFinished = fixture();
    const late = newerFinished.controller.loadSelectedPanels();
    const newest = newerFinished.controller.loadSelectedPanels();
    newerFinished.resolve(1, 'NEW');
    await newest;
    newerFinished.resolve(0, 'OLD');
    await late;
    assert.equal(newerFinished.elements.seriesPanelsContainer.children.length, 1);
    assert.match(newerFinished.elements.seriesPanelsContainer.children[0].innerHTML, /NEW/);
    assert.equal(newerFinished.notices.length, 1, 'late result cannot add a second completion notice');
    console.log('PASS Series preparation rejects stale URL/selection/generation results and preserves newer loader');
})().catch(error => { console.error(error); process.exitCode = 1; });
