'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function createControl(initial = {}) {
    return {
        value: '', checked: false, hidden: false, disabled: false,
        textContent: '', dataset: {}, style: {}, listeners: {},
        selectionStart: 0, selectionEnd: 0,
        addEventListener(type, listener) { this.listeners[type] = listener; },
        querySelector() { return createControl(); },
        focus() {},
        setAttribute() {},
        checkValidity() { return this.value === '' || (Number.isInteger(Number(this.value)) && Number(this.value) >= 1 && Number(this.value) <= 50); },
        reportValidity() {},
        setRangeText(value) { this.value += value; },
        ...initial,
    };
}

function createDocument() {
    const document = {
        nextValues: {},
        overlays: [],
        body: { appendChild(element) { document.overlays.push(element); } },
        createElement() {
            const values = document.nextValues;
            const controls = new Map();
            const control = (selector, initial = {}) => {
                const value = createControl(initial);
                controls.set(selector, value);
                return value;
            };
            control('.report-editor-source', { value: values.source || 'custom' });
            control('.report-editor-custom-sla');
            control('.report-editor-threshold-templates');
            control('.report-editor-neutral-template');
            control('.report-effective-threshold');
            control('.report-editor-include-mode', {
                value: values.includeMode || 'always',
                querySelector() { return createControl(); },
            });
            control('.report-panel-editor-close');
            control('.report-panel-editor-cancel');
            control('.report-panel-editor-save');
            control('.report-editor-sla-value', { value: values.slaValue ?? '80' });
            control('.report-editor-warning-value', { value: values.warningValue ?? '70' });
            control('.report-panel-editor-error');
            control('.report-editor-operator', { value: values.operator || 'gt' });
            control('.report-editor-evaluation', { value: values.evaluation || 'period_max' });
            control('.report-editor-enabled', { checked: true });
            control('.report-editor-normal', { value: 'Норма: {{aggregateValue}}' });
            control('.report-editor-warning', { value: 'Предупреждение: {{warningThreshold}}' });
            control('.report-editor-breached', { value: 'Нарушение: {{criticalThreshold}}' });
            control('.report-editor-neutral', { value: 'Значение: {{aggregateValue}}' });
            control('.report-editor-unavailable', { value: 'Нет данных: {{dataStatus}}' });
            control('.report-editor-details-enabled', { checked: true });
            control('textarea', { value: 'Норма: {{aggregateValue}}' });
            control('.report-close');
            control('.report-cancel');
            control('.report-test-header');
            control('.report-profile-template', { value: '{{panels}}' });
            control('.report-context-fields');
            control('.report-save');
            control('.report-test-name', { value: 'Нагрузочный тест' });
            control('.report-environment', { value: 'production' });
            control('.report-test-started', { value: '2026-08-31T10:00' });
            control('.report-stable-started', { value: '2026-08-31T11:00' });

            const panelList = control('.report-panel-list', {
                children: [],
                querySelectorAll(selector) { return selector === '.report-panel-card' ? this.children : []; },
                insertBefore(card, reference) {
                    this.children = this.children.filter(item => item !== card);
                    const index = reference ? this.children.indexOf(reference) : -1;
                    if (index < 0) this.children.push(card); else this.children.splice(index, 0, card);
                },
            });
            const makeReportCard = id => {
                const enabled = createControl({ checked: true });
                const status = createControl();
                const editor = createControl();
                const handle = createControl();
                const card = createControl({
                    dataset: { panelId: id },
                    classList: { add() {}, remove() {} },
                    getBoundingClientRect: () => ({ top: 0, height: 100 }),
                    querySelector(selector) {
                        if (selector === '.report-enabled') return enabled;
                        if (selector === '.report-panel-auto-status') return status;
                        if (selector === '.report-open-panel-editor') return editor;
                        if (selector === '.report-panel-drag-handle') return handle;
                        return createControl();
                    },
                    closest: selector => selector === '.report-panel-card' ? card : null,
                });
                handle.closest = selector => selector === '.report-panel-drag-handle' ? handle
                    : selector === '.report-panel-card' ? card : null;
                Object.defineProperties(card, {
                    previousElementSibling: { get: () => {
                        const index = panelList.children.indexOf(card); return panelList.children[index - 1] || null;
                    } },
                    nextElementSibling: { get: () => {
                        const index = panelList.children.indexOf(card); return panelList.children[index + 1] || null;
                    } },
                    nextSibling: { get: () => card.nextElementSibling },
                });
                return card;
            };

            const warningFields = [createControl(), createControl()];
            const textareas = [controls.get('textarea')];
            const overlay = createControl({
                controls,
                className: '',
                innerHTML: '',
                removed: false,
                querySelector(selector) {
                    if (!controls.has(selector)) controls.set(selector, createControl());
                    return controls.get(selector);
                },
                querySelectorAll(selector) {
                    if (selector === '.report-editor-warning-fields') return warningFields;
                    if (selector === 'textarea') return textareas;
                    if (selector === '.report-panel-card') return panelList.children;
                    if (selector === '[data-emoji]') return [];
                    return [];
                },
                remove() { this.removed = true; },
            });
            let markup = '';
            delete overlay.innerHTML;
            Object.defineProperty(overlay, 'innerHTML', {
                get: () => markup,
                set(value) {
                    markup = value;
                    panelList.children = [...value.matchAll(/report-overview-card" data-panel-id="([^"]+)"/g)]
                        .map(match => makeReportCard(match[1]));
                },
            });
            return overlay;
        },
    };
    return document;
}

(async () => {
    const document = createDocument();
    const context = { Intl, console, document, CSS: { escape: value => String(value) } };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('js/shared/grafana-panel-analysis.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('js/shared/dashbridge-report.js', 'utf8'), context,
        { filename: 'dashbridge-report.js' });
    vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-report-ui.js', 'utf8'), context,
        { filename: 'dashbridge-report-ui.js' });

    assert(Object.isFrozen(context.DashBridgeReportUi), 'report UI factory API must be immutable');
    const panel = {
        id: 'panel-1', title: 'CPU <production>',
        tools: { thresholdEnabled: true, thresholdValue: 80, thresholdUnit: '%' },
        report: { enabled: true, sla: { source: 'custom', operator: 'gt', value: 80, unit: '%' } },
    };
    const secondPanel = {
        id: 'panel-2', title: 'RAM', tools: {},
        report: { enabled: true, sla: { source: 'none' } },
    };
    const profile = { name: 'Prod <unsafe>', report: {
        template: '{{panels}}', panelOrder: ['panel-2', 'panel-1']
    } };
    let saveCalls = 0;
    let saveError = null;
    let activeProfile = profile;
    let transformSettings = {};
    const controller = context.DashBridgeReportUi.create({
        getTransformSettings: () => transformSettings,
        getPanels: () => [panel, secondPanel],
        getActiveProfile: () => activeProfile,
        savePanels: async () => { saveCalls += 1; return saveError ? { error: saveError } : undefined; },
        normalizePanelMetadataText: (value, maxLength) => String(value || '').slice(0, maxLength),
        escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    });
    assert(Object.isFrozen(controller));

    controller.openPanelEditor(panel);
    const validOverlay = document.overlays.at(-1);
    assert(!validOverlay.innerHTML.includes('<option value="cpu_capacity"'), 'CPU panel must not offer Load Average SLA');
    assert(validOverlay.innerHTML.includes('CPU &lt;production&gt;'), 'panel title must be escaped');
    await validOverlay.controls.get('.report-panel-editor-save').listeners.click();
    assert.strictEqual(saveCalls, 1);
    assert.strictEqual(panel.report.sla.source, 'custom');
    assert.strictEqual(panel.report.sla.value, 80);
    assert.strictEqual(panel.report.sla.unit, '%', 'editing text must preserve the SLA unit');
    assert.strictEqual(panel.report.sla.warningValue, 70);
    assert.strictEqual(validOverlay.removed, true, 'successful save must close the editor');

    document.nextValues = { source: 'custom', slaValue: '80', warningValue: '90' };
    controller.openPanelEditor(panel);
    const invalidOverlay = document.overlays.at(-1);
    await invalidOverlay.controls.get('.report-panel-editor-save').listeners.click();
    assert.strictEqual(saveCalls, 1, 'invalid warning order must not persist settings');
    assert.match(invalidOverlay.controls.get('.report-panel-editor-error').textContent, /наступать раньше/);
    assert.strictEqual(invalidOverlay.removed, false);

    document.nextValues = {};
    controller.openReportSettings();
    const settingsOverlay = document.overlays.at(-1);
    assert(settingsOverlay.innerHTML.includes('Prod &lt;unsafe&gt;'));
    assert(settingsOverlay.innerHTML.includes('Справочник переменных шаблона'));
    assert(settingsOverlay.innerHTML.includes('report-panel-drag-handle'),
        'every message panel must expose a dedicated drag handle');
    assert(settingsOverlay.innerHTML.indexOf('RAM') < settingsOverlay.innerHTML.indexOf('CPU &lt;production&gt;'),
        'the settings list must open in the saved message order');
    settingsOverlay.controls.get('.report-cancel').listeners.click();
    assert.strictEqual(settingsOverlay.removed, true, 'cancel must close without persisting');
    assert.strictEqual(saveCalls, 1);

    controller.openReportSettings();
    const reorderOverlay = document.overlays.at(-1);
    const panelList = reorderOverlay.controls.get('.report-panel-list');
    const [ramCard, cpuCard] = panelList.children;
    panelList.listeners.dragstart({
        target: ramCard.querySelector('.report-panel-drag-handle'),
        dataTransfer: { setData() {}, effectAllowed: '' },
    });
    panelList.listeners.dragover({
        target: cpuCard, clientY: 90, preventDefault() {}, dataTransfer: { dropEffect: '' },
    });
    panelList.listeners.drop({ preventDefault() {} });
    await reorderOverlay.controls.get('.report-save').listeners.click();
    assert.deepStrictEqual(Array.from(profile.report.panelOrder), ['panel-1', 'panel-2'],
        'dragging cards must persist only the message order');
    assert.strictEqual(saveCalls, 2);
    for (const title of ['Load Average', 'Load Average calculated']) {
        controller.openPanelEditor({ ...panel, title });
        assert(document.overlays.at(-1).innerHTML.includes('<option value="cpu_capacity"'), 'Load panels retain the filter option');
    }
    transformSettings = { grafanaLoadPanelTitle: 'System load' };
    controller.openPanelEditor({ ...panel, title: 'System load', tools: { cpuCapacityFilterEnabled: true } });
    assert(document.overlays.at(-1).innerHTML.includes('<option value="cpu_capacity"'), 'custom configured Load title is recognized');
    controller.openPanelEditor({ ...panel, title: 'Memory', tools: { cpuCapacityFilterEnabled: true } });
    assert(!document.overlays.at(-1).innerHTML.includes('<option value="cpu_capacity"'), 'stale filter settings must not expose Load SLA on Memory');

    saveError = 'quota exceeded';
    controller.openReportSettings();
    const failedSave = document.overlays.at(-1);
    await failedSave.controls.get('.report-save').listeners.click();
    assert.strictEqual(failedSave.removed, false, 'failed durable save keeps the editor and draft');
    assert.match(failedSave.controls.get('.report-save-error').textContent, /quota/);
    saveError = null;
    await failedSave.controls.get('.report-save').listeners.click();
    assert.strictEqual(failedSave.removed, true, 'retry succeeds after transient storage error');
    controller.openReportSettings();
    const staleEditor = document.overlays.at(-1);
    activeProfile = structuredClone(profile);
    activeProfile.report.template = 'updated elsewhere';
    staleEditor.controls.get('.report-profile-template').value = 'unsaved draft';
    await staleEditor.controls.get('.report-save').listeners.click();
    assert.strictEqual(staleEditor.removed, false);
    assert.strictEqual(activeProfile.report.template, 'updated elsewhere');
    assert.strictEqual(staleEditor.controls.get('.report-profile-template').value, 'unsaved draft');
    activeProfile = profile;
    controller.openReportSettings();
    const replacedEditor = document.overlays.at(-1);
    activeProfile = structuredClone(profile); // Replacement with no report changes is safe.
    replacedEditor.controls.get('.report-profile-template').value = 'new template';
    await replacedEditor.controls.get('.report-save').listeners.click();
    assert.strictEqual(activeProfile.report.template, 'new template');
    assert.notStrictEqual(profile.report.template, 'new template');
    saveError = 'quota exceeded';
    controller.openPanelEditor(panel);
    const failedPanel = document.overlays.at(-1);
    await failedPanel.controls.get('.report-panel-editor-save').listeners.click();
    assert.strictEqual(failedPanel.removed, false);
    assert.match(failedPanel.controls.get('.report-panel-editor-error').textContent, /quota/);
    saveError = null;
    controller.openReportSettings();
    const enabledConflict = document.overlays.at(-1);
    panel.report.enabled = !panel.report.enabled;
    const remoteEnabled = panel.report.enabled;
    await enabledConflict.controls.get('.report-save').listeners.click();
    assert.strictEqual(enabledConflict.removed, false, 'remote enabled state must not be silently overwritten');
    assert.strictEqual(panel.report.enabled, remoteEnabled);
    console.log('PASS DashBridge report UI validates SLA, preserves failed drafts and guards stale editors');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
