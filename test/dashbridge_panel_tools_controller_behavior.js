'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const notificationContainer = { children: [], appendChild(node) { this.children.push(node); } };
const panelCard = { toggles: [], classList: { toggle(name, enabled) { panelCard.toggles.push([name, enabled]); } } };
const documentRef = {
    body: { appendChild(node) { notificationContainer.node = node; } },
    getElementById: id => id === 'dashbridgeThresholdNotifications' ? notificationContainer : null,
    querySelector(selector) {
        if (selector.startsWith('.panel-card')) return panelCard;
        return null;
    },
    createElement() {
        const button = { addEventListener(type, listener) { this[type] = listener; } };
        return {
            dataset: {}, setAttribute() {}, remove() { this.removed = true; },
            querySelector: selector => selector === 'button' ? button : null,
            get button() { return button; }
        };
    }
};
const context = { console, setTimeout, clearTimeout };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync('pages/dashbridge/dashbridge-panel-tools-controller.js', 'utf8'), context);

const panel = {
    id: 'panel-1', title: 'Memory Usage',
    tools: {
        legendMode: 'fast_complete_hide', legendFilter: ['idle'],
        seriesFilterSettingsVersion: 2, seriesQueryFilterEnabled: true,
        seriesQueryFilterValue: 80, seriesQueryFilterMode: 'last',
        thresholdEnabled: true, thresholdValue: 90, thresholdNotifyEnabled: true,
        convertMemToUsed: false
    }
};
const iframe = {};
const messages = [];
let modalOptions = null;
let saveCount = 0;
let refreshCount = 0;
let forceCount = 0;
const controller = context.DashBridgePanelToolsController.create({
    postToDashboardFrame: (_iframe, message) => { messages.push(message); return true; },
    getCapturePrepared: () => true,
    getTransformSettings: () => ({ grafanaCpuCapacityCoefficient: 0.8 }),
    getDefaultCpuCapacityCoefficient: () => 0.8,
    normalizePanelMetadataText: (value, max = 96) => String(value || '').trim().slice(0, max),
    savePanels: () => { saveCount += 1; },
    forceLoadPanel: id => { forceCount += 1; assert.strictEqual(id, panel.id); return iframe; },
    refreshPanel: id => { refreshCount += 1; assert.strictEqual(id, panel.id); },
    settingsStorage: { get: async () => ({ grafanaCpuCapacityCoefficient: 0.75 }) },
    getSettingsKeys: () => ['grafanaCpuCapacityCoefficient'],
    normalizeSettings: value => value,
    panelAnalysis: { classifyPanelTitle: title => title === 'Memory Usage' ? 'ram' : null },
    settingsModal: {
        transformFields: (_tools, { panelKind }) => `transform:${panelKind}`,
        thresholdFields: () => '|threshold', legendFields: () => '|legend',
        open: options => { modalOptions = options; return options; }
    },
    escapeHtml: value => String(value).replaceAll('<', '&lt;'),
    documentRef,
    cssEscape: value => value,
});

const tools = controller.normalizeTools(panel);
assert.strictEqual(tools.capturePrepared, true);
assert.strictEqual(tools.forceMemByteUnit, true, 'legacy memory panel restores byte unit');
assert.strictEqual(tools.seriesQueryFilterEnabled, true);
assert.strictEqual(tools.seriesQueryFilterMode, 'last');
assert.strictEqual(tools.cpuCapacityFilterCoefficient, 0.8);
controller.apply(panel, iframe);
assert.strictEqual(messages.at(-1).action, 'applyPanelTools');
assert.strictEqual(messages.at(-1).transformSettings.grafanaCpuCapacityCoefficient, 0.8);

(async () => {
    await controller.open(panel, iframe);
    assert.strictEqual(modalOptions.content, 'transform:ram|threshold|legend');
    assert.strictEqual(modalOptions.advanced.cpuCapacityFilterCoefficientDefault, 0.75);

    const thresholdOnly = { ...modalOptions.state, thresholdValue: 91 };
    modalOptions.onSave(thresholdOnly);
    assert.strictEqual(forceCount, 1, 'threshold-only save applies to the live iframe');
    assert.strictEqual(refreshCount, 0);
    assert.strictEqual(messages.at(-1).action, 'applyPanelTools');

    await controller.open(panel, iframe);
    modalOptions.onSave({ ...modalOptions.state, invertLegend: true });
    assert.strictEqual(refreshCount, 1, 'non-live tool change refreshes only the selected panel');

    const legendPromise = modalOptions.advanced.getLegendSeries();
    assert.strictEqual(messages.at(-1).action, 'getPanelLegendSeries');
    assert.strictEqual(controller.acceptLegendSeries({ requestId: panel.id, series: ['A', 'B'] }, panel), true);
    assert.strictEqual(JSON.stringify(await legendPromise), JSON.stringify(['A', 'B']));

    const thresholdPromise = modalOptions.advanced.getThresholdStatus();
    assert.strictEqual(messages.at(-1).action, 'getPanelThresholdStatus');
    assert.strictEqual(controller.acceptThresholdStatus({
        requestId: panel.id, status: { unit: 'ms', enabled: true, exceeded: false }
    }, panel), true);
    assert.strictEqual((await thresholdPromise).unit, 'ms');
    assert.strictEqual(panel.tools.thresholdUnit, 'ms');

    controller.acceptThresholdStatus({ status: {
        enabled: true, exceeded: true, thresholdNotifyEnabled: true, panelTitle: '<unsafe>',
        unit: 'ms', rawThreshold: 91000, factor: 1000
    } }, panel);
    assert.deepStrictEqual(panelCard.toggles.at(-1), ['threshold-exceeded', true]);
    const notice = notificationContainer.children.at(-1);
    assert(notice.innerHTML.includes('&lt;unsafe>') && !notice.innerHTML.includes('<unsafe>'),
        'threshold notification escapes the Grafana title');

    controller.removePanel(panel.id);
    assert(saveCount >= 3, 'tool and threshold state changes remain persisted');
    console.log('PASS DashBridge panel tools controller preserves settings and correlated status lifecycle');
})().catch(error => { console.error(error); process.exitCode = 1; });
