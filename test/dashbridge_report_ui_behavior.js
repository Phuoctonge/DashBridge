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
                    if (selector === '[data-emoji]' || selector === '.report-panel-card') return [];
                    return [];
                },
                remove() { this.removed = true; },
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
    vm.runInContext(fs.readFileSync('js/shared/dashbridge-report.js', 'utf8'), context,
        { filename: 'dashbridge-report.js' });
    vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-report-ui.js', 'utf8'), context,
        { filename: 'dashbridge-report-ui.js' });

    assert(Object.isFrozen(context.DashBridgeReportUi), 'report UI factory API must be immutable');
    const panel = {
        id: 'panel-1', title: 'CPU <production>',
        tools: { thresholdEnabled: true, thresholdValue: 80, thresholdUnit: '%' },
        report: { enabled: true, sla: { source: 'custom', operator: 'gt', value: 80 } },
    };
    const profile = { name: 'Prod <unsafe>', report: { template: '{{panels}}' } };
    let saveCalls = 0;
    const controller = context.DashBridgeReportUi.create({
        getPanels: () => [panel],
        getActiveProfile: () => profile,
        savePanels: async () => { saveCalls += 1; },
        normalizePanelMetadataText: (value, maxLength) => String(value || '').slice(0, maxLength),
        escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    });
    assert(Object.isFrozen(controller));

    controller.openPanelEditor(panel);
    const validOverlay = document.overlays.at(-1);
    assert(validOverlay.innerHTML.includes('CPU &lt;production&gt;'), 'panel title must be escaped');
    await validOverlay.controls.get('.report-panel-editor-save').listeners.click();
    assert.strictEqual(saveCalls, 1);
    assert.strictEqual(panel.report.sla.source, 'custom');
    assert.strictEqual(panel.report.sla.value, 80);
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
    settingsOverlay.controls.get('.report-cancel').listeners.click();
    assert.strictEqual(settingsOverlay.removed, true, 'cancel must close without persisting');
    assert.strictEqual(saveCalls, 1);

    console.log('PASS DashBridge report UI validates SLA settings and owns modal cleanup');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
