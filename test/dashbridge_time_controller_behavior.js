'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const listeners = new Map();
const makeElement = (extra = {}) => ({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, isConnected: true,
    addEventListener(type, listener) { (this.listeners ||= {})[type] = listener; },
    click() { this.listeners?.click?.({ target: this, currentTarget: this, stopPropagation() {}, preventDefault() {} }); },
    hasAttribute(name) { return name === 'data-refresh' && Object.hasOwn(this.dataset, 'refresh'); },
    querySelector() { return { style: {} }; },
    replaceChildren(...children) { this.children = children; },
    ...extra,
});

const elements = Object.fromEntries([
    'timePickerBtn', 'refreshPickerBtn', 'timePopover', 'refreshPopover', 'profileDropdown',
    'absTimeFrom', 'absTimeTo', 'quickRangeSearch', 'copyTimeBtn', 'pasteTimeBtn',
    'applyAbsoluteTime', 'forceRefreshBtn', 'timePickerLabel', 'refreshPickerLabel'
].map(id => [id, makeElement()]));
const refreshOff = makeElement({ dataset: { refresh: '' } });
const loadedFrame = makeElement({
    src: 'https://grafana.example/d-solo/x/y?panelId=2',
    dataset: { dashbridgeProfileId: 'profile-1', dashbridgeScopeId: 'scope-1' }, contentWindow: {},
    closest: () => ({ dataset: { panelId: 'panel-1' } })
});
const deferredFrame = makeElement({
    src: '', dataset: {
        src: 'https://grafana.example/d-solo/x/y?panelId=3',
        dashbridgeProfileId: 'profile-1', dashbridgeScopeId: 'scope-1'
    }, contentWindow: null,
    closest: () => ({ dataset: { panelId: 'panel-2' } })
});
let frames = [loadedFrame, deferredFrame];
const documentRef = {
    documentElement: { getAttribute: () => 'dark' },
    getElementById: id => elements[id] || null,
    querySelectorAll(selector) {
        if (selector === 'iframe[name="dashbridge-iframe"]') return frames;
        if (selector === '#refreshPopover .dropdown-item') return [refreshOff];
        return [];
    },
    createElement: () => makeElement(),
    createTextNode: text => ({ textContent: text })
};
const windowRef = { addEventListener(type, listener) { listeners.set(type, listener); } };
const profile = { id: 'profile-1', timeState: { from: 'now-6h', to: 'now', refresh: '10s' } };
const panels = [
    { id: 'panel-1', src: loadedFrame.src, grafanaTheme: 'follow' },
    { id: 'panel-2', src: deferredFrame.dataset.src, grafanaTheme: 'light' }
];
const toolsById = {
    'panel-1': {
        legendMode: 'fast_complete_hide', legendSelectionVersion: 2, legendVisibleSeries: [' A ', 'B'],
        seriesQueryFilterEnabled: true, seriesQueryFilterValue: 7, seriesQueryFilterRawValue: 7,
        seriesQueryFilterMode: 'last', seriesQueryFilterHighlightEnabled: true,
        cpuCapacityFilterEnabled: false
    },
    'panel-2': { legendMode: 'fast_complete_hide', legendFilter: ['hidden'], cpuCapacityFilterEnabled: true,
        cpuCapacityFilterCoefficient: 0.8, cpuCapacityFilterMode: 'max', cpuCapacityFilterLoad1: true,
        cpuCapacityFilterLoad5: false, cpuCapacityFilterLoad15: false }
};
let saveCount = 0;
let refreshCount = 0;
const sent = [];
const navigated = [];
const timeState = {
    defaults: () => ({ from: 'now-1h', to: 'now', refresh: '' }),
    normalize: value => ({ from: value?.from || 'now-1h', to: value?.to || 'now', refresh: value?.refresh || '' }),
    formatForInput: value => value,
    formatForLabel: (from, to) => `${from}–${to}`,
    formatForUrl: (_url, value) => value,
    applyToUrl(urlValue, state) {
        const url = new URL(urlValue);
        url.searchParams.set('from', state.from);
        url.searchParams.set('to', state.to);
        if (state.refresh) url.searchParams.set('refresh', state.refresh);
        else url.searchParams.delete('refresh');
        return url.toString();
    }
};

const context = { console, URL, URLSearchParams, Intl, Date, setTimeout, clearTimeout };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync('pages/dashbridge/dashbridge-time-controller.js', 'utf8'), context);
const controller = context.DashBridgeTimeController.create({
    timeState,
    getActiveProfile: () => profile,
    saveProfiles: () => { saveCount += 1; },
    getPanels: () => panels,
    getPanelTools: panel => toolsById[panel.id],
    legendSelection: {
        isAllowlistState: tools => tools.legendSelectionVersion === 2,
        normalizeNames: names => names.map(name => name.trim())
    },
    panelBootstrap: { applyToUrl: url => url },
    getTransformSettings: () => ({ removeFill: true }),
    postToDashboardFrame: (iframe, message) => { sent.push({ iframe, message }); return true; },
    navigateDashboardFrame: (iframe, url) => { navigated.push({ iframe, url }); },
    refreshAllPanels: async () => { refreshCount += 1; },
    runtimeScopeId: 'scope-1',
    documentRef,
    windowRef,
    navigatorRef: { clipboard: { writeText: async () => {}, readText: async () => '{}' } },
    setTimer: callback => { callback(); return 1; }
});

assert.strictEqual(JSON.stringify(controller.loadProfileState()), JSON.stringify(profile.timeState),
    'profile state must load without changing values');
const url = new URL(controller.applyPanelParamsToUrl(panels[0]));
assert.strictEqual(url.searchParams.get('from'), 'now-6h');
assert.strictEqual(url.searchParams.get('refresh'), '10s');
assert.strictEqual(url.searchParams.get('theme'), 'dark');
assert.strictEqual(url.searchParams.has('dashbridgeLegendSelection'), false, 'large legend selection must stay out of query');
assert.deepStrictEqual(JSON.parse(new URLSearchParams(url.hash.slice(1)).get('dashbridgeLegendSelection')),
    { version: 2, visibleSeries: ['A', 'B'] });
assert.strictEqual(JSON.parse(url.searchParams.get('dashbridgeSeriesQueryFilter')).mode, 'last');

controller.broadcast();
assert.strictEqual(sent.length, 1, 'loaded iframe receives one time message');
assert.strictEqual(sent[0].message.refresh, '10s');
loadedFrame.dataset.dashbridgeProfileId = 'profile-other';
assert.strictEqual(controller.getPanelForIframe(loadedFrame), null,
    'a frame created for another profile must not resolve against the active panel list');
loadedFrame.dataset.dashbridgeProfileId = 'profile-1';
loadedFrame.dataset.dashbridgeScopeId = 'scope-other';
assert.strictEqual(controller.getPanelForIframe(loadedFrame), null,
    'an iframe from another DashBridge tab runtime must not resolve in this tab');
loadedFrame.dataset.dashbridgeScopeId = 'scope-1';
const deferredUrl = new URL(deferredFrame.dataset.src);
assert.strictEqual(deferredUrl.searchParams.get('from'), 'now-6h', 'deferred iframe URL receives current time');
assert.strictEqual(deferredUrl.searchParams.get('theme'), 'light');
assert.strictEqual(JSON.parse(deferredUrl.searchParams.get('dashbridgeCpuCapacityFilter')).coefficient, 0.8);

controller.setupControls();
assert.strictEqual(elements.absTimeFrom.value, 'now-6h');
assert.strictEqual(elements.timePickerLabel.textContent, 'Last 6h');
assert.strictEqual(elements.timePickerBtn.title, 'Выбрать время: Last 6h');
refreshOff.click();
assert.strictEqual(controller.getState().refresh, '');
assert.strictEqual(profile.timeState.refresh, '');
assert.strictEqual(saveCount, 1, 'Refresh Off persists the active profile exactly once');
assert.strictEqual(refreshCount, 1, 'Refresh Off navigates active panels exactly once');

elements.absTimeFrom.value = '2025-04-25 10:48:00';
elements.absTimeTo.value = '2025-04-25 12:49:00';
elements.applyAbsoluteTime.click();
assert(Number(controller.getState().from) > 1_000_000_000_000, 'absolute input remains normalized to milliseconds');
assert.strictEqual(elements.timePickerLabel.textContent,
    `${controller.getState().from}–${controller.getState().to}`,
    'absolute header labels must use the compact time-state formatter');
assert.strictEqual(navigated.length, 2, 'absolute range navigates each known iframe once');

frames = [loadedFrame];
listeners.get('dashbridge-theme-change')();
assert.strictEqual(navigated.length, 3, 'follow-theme iframe navigates on theme change');

console.log('PASS DashBridge time controller owns profile state, URL policy and iframe lifecycle');
