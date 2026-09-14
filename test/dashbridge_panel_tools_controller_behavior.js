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
        if (selector.startsWith('.threshold-notification')) return notificationContainer.children.find(node =>
            !node.removed && selector.includes(`"${node.dataset.panelId}"`)) || null;
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
const analyticsEvents = [];
const context = { console, setTimeout, clearTimeout, DashBridgeAnalytics: {
    track: (featureId, signal, dimensions) => analyticsEvents.push({ featureId, signal, dimensions }),
    changed: () => undefined,
    outcome: (featureId, outcome, dimensions) => analyticsEvents.push({
        featureId, signal: 'outcome', dimensions: { ...dimensions, outcome }
    }),
} };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync('pages/dashbridge/dashbridge-panel-tools-controller.js', 'utf8'), context);

const panel = {
    id: 'panel-1', title: 'Memory Usage',
    tools: {
        legendMode: 'fast_complete_hide', legendFilter: ['idle'],
        legendColumnsEnabled: true, legendColumns: { mean: false, max: true, total: false, last: true },
        seriesFilterSettingsVersion: 2, seriesQueryFilterEnabled: true,
        seriesQueryFilterValue: 80, seriesQueryFilterInputUnit: 's', seriesQueryFilterMode: 'last',
        thresholdEnabled: true, thresholdValue: 90, thresholdInputUnit: 'ms', thresholdNotifyEnabled: true,
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
assert.strictEqual(tools.seriesQueryFilterInputUnit, 's');
assert.strictEqual(tools.thresholdInputUnit, 'ms');
assert.strictEqual(tools.cpuCapacityFilterCoefficient, 0.8);
assert.strictEqual(tools.legendColumnsEnabled, true);
assert.strictEqual(JSON.stringify(tools.legendColumns), JSON.stringify({ mean: false, max: true, total: false, last: true }));
controller.apply(panel, iframe);
assert.strictEqual(messages.at(-1).action, 'applyPanelTools');
assert.strictEqual(messages.at(-1).transformSettings.grafanaCpuCapacityCoefficient, 0.8);
assert.strictEqual(controller.acceptApplied({ requestId: messages.at(-1).requestId,
    commandStatus: 'error', failureCode: 'visual_verification_failed' }), true);
assert.deepStrictEqual(analyticsEvents, [{
    featureId: 'internal.panel_tools_apply', signal: 'outcome',
    dimensions: { surface: 'dashbridge', failure: 'visual_verification_failed', outcome: 'error' }
}], 'one shared command failure must not be multiplied across every enabled panel tool');

analyticsEvents.length = 0;
controller.apply({ id: 'disabled-tools', title: 'CPU', tools: {} }, iframe);
controller.acceptApplied({ requestId: messages.at(-1).requestId, commandStatus: 'applied' });
assert.deepStrictEqual(analyticsEvents, [],
    'disabled parent tools and prepared capture preference must not produce effective evidence');
controller.apply({ id: 'enabled-tools', title: 'CPU', tools: {
    thresholdEnabled: true, cpuCapacityFilterEnabled: true, cpuCapacityFilterLoad5: true
} }, iframe);
controller.acceptApplied({ requestId: messages.at(-1).requestId, commandStatus: 'applied' });
assert.deepStrictEqual(analyticsEvents.map(event => event.featureId).sort(), [
    'grafana.panel.load_cpu_capacity_filter', 'grafana.panel.load_cpu_capacity_highlight',
    'grafana.panel.load_series_1m', 'grafana.panel.load_series_5m',
    'grafana.panel.threshold', 'grafana.panel.threshold_notification'
].sort(), 'only enabled tools and their enabled children may be acknowledged');

(async () => {
    await controller.open(panel, iframe);
    assert.strictEqual(modalOptions.content, 'transform:ram|threshold|legend');
    assert.strictEqual(modalOptions.advanced.cpuCapacityFilterCoefficientDefault, 0.75);

    const thresholdOnly = { ...modalOptions.state, thresholdValue: 91 };
    await modalOptions.onSave(thresholdOnly);
    assert.strictEqual(forceCount, 1, 'threshold-only save applies to the live iframe');
    assert.strictEqual(refreshCount, 0);
    assert.strictEqual(messages.at(-1).action, 'applyPanelTools');

    await controller.open(panel, iframe);
    await modalOptions.onSave({ ...modalOptions.state, invertLegend: true });
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

    const notify = (exceeded, extra = {}, target = panel) => controller.acceptThresholdStatus({ status: {
        enabled: true, exceeded, thresholdNotifyEnabled: true, ...extra
    } }, target);
    notify(false);
    assert.strictEqual(notice.removed, true, 'recovery must remove the stale threshold notification');
    notify(true);
    const repeated = notificationContainer.children.at(-1);
    notify(true);
    assert.strictEqual(notificationContainer.children.at(-1), repeated, 'repeated breach must not duplicate notices');
    repeated.button.click();
    notify(true);
    assert.strictEqual(notificationContainer.children.at(-1), repeated, 'dismissed breach stays dismissed');
    notify(false);
    notify(true);
    assert.notStrictEqual(notificationContainer.children.at(-1), repeated, 'a new breach after recovery must notify');
    const other = { id: 'other-panel', tools: {} };
    notify(true, {}, other);
    const otherNotice = notificationContainer.children.at(-1);
    notify(false);
    assert(!otherNotice.removed, 'recovery must not remove another panel notification');
    notify(true);
    const disabledNotice = notificationContainer.children.at(-1);
    notify(false, { enabled: false });
    assert(disabledNotice.removed, 'disabling threshold clears its notice');
    notify(true);
    const mutedNotice = notificationContainer.children.at(-1);
    notify(true, { thresholdNotifyEnabled: false });
    assert(mutedNotice.removed, 'disabling notifications clears its notice');

    controller.removePanel(panel.id);
    assert(saveCount >= 3, 'tool and threshold state changes remain persisted');
    console.log('PASS DashBridge panel tools controller preserves settings and correlated status lifecycle');
})().catch(error => { console.error(error); process.exitCode = 1; });
