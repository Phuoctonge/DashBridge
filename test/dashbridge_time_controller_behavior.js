'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const listeners = new Map();
const makeElement = (extra = {}) => ({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, isConnected: true,
    addEventListener(type, listener) { (this.listeners ||= {})[type] = listener; },
    click() { this.listeners?.click?.({ target: this, currentTarget: this, stopPropagation() {}, preventDefault() {} }); },
    focus() { this.focused = true; },
    hasAttribute(name) { return name === 'data-refresh' && Object.hasOwn(this.dataset, 'refresh'); },
    querySelector() { return { style: {} }; },
    replaceChildren(...children) { this.children = children; },
    ...extra,
});

const elements = Object.fromEntries([
    'timePickerBtn', 'refreshPickerBtn', 'timePopover', 'refreshPopover', 'profileDropdown',
    'absTimeFrom', 'absTimeTo', 'quickRangeSearch', 'copyTimeBtn', 'pasteTimeBtn',
    'applyAbsoluteTime', 'forceRefreshBtn', 'timePickerLabel', 'refreshPickerLabel', 'closeTimePopover',
    'recentTimeRanges', 'recentTimeRangesEmpty', 'timeRangeError'
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
    addEventListener(type, listener) { listeners.set(`document:${type}`, listener); },
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
const storage = new Map();
const windowRef = {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener(type, listener) { listeners.set(type, listener); }
};
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

const context = { console, URL, URLSearchParams, Intl, Date, DOMException, setTimeout, clearTimeout };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync('js/shared/grafana-time.js', 'utf8'), context);
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
    navigateDashboardFrame: (iframe, url) => { navigated.push({ iframe, url }); iframe.src = url; },
    refreshAllPanels: async () => { refreshCount += 1; },
    runtimeScopeId: 'scope-1',
    documentRef,
    windowRef,
    navigatorRef: { clipboard: { writeText: async () => {}, readText: async () => '{}' } },
    setTimer: (callback, delay) => { if (delay >= 90_000) return setTimeout(callback, delay); callback(); return 1; }
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
elements.timePickerBtn.click();
assert.equal(elements.timePopover.style.display, 'flex');
listeners.get('document:keydown')({ key: 'Escape' });
assert.equal(elements.timePopover.style.display, 'none');
assert.equal(elements.timePickerBtn.focused, true);
elements.timePickerBtn.click();
elements.closeTimePopover.click();
assert.equal(elements.timePopover.style.display, 'none');
assert.strictEqual(elements.absTimeFrom.value, 'now-6h');
assert.strictEqual(elements.timePickerLabel.textContent, 'За 6 ч');
assert.strictEqual(elements.timePickerBtn.title, 'Выбрать время: За 6 ч');
refreshOff.click();
assert.strictEqual(controller.getState().refresh, '');
assert.strictEqual(profile.timeState.refresh, '');
assert.strictEqual(saveCount, 1, 'Refresh Off persists the active profile exactly once');
assert.strictEqual(refreshCount, 1, 'Refresh Off navigates active panels exactly once');

elements.absTimeFrom.value = '2025-04-25 10:48:00';
// Native Scenes changes do not rewrite the parent iframe's src attribute.
panels[0].src += '&var-instance=selected&var-instance=second';
elements.absTimeTo.value = '2025-04-25 12:49:00';
elements.applyAbsoluteTime.click();
assert(Number(controller.getState().from) > 1_000_000_000_000, 'absolute input remains normalized to milliseconds');
assert.strictEqual(elements.timePickerLabel.textContent,
    `${controller.getState().from}–${controller.getState().to}`,
    'absolute header labels must use the compact time-state formatter');
assert.strictEqual(navigated.length, 2, 'absolute range navigates each known iframe once');
assert.deepStrictEqual(new URL(navigated[0].url).searchParams.getAll('var-instance'), ['selected', 'second']);

frames = [loadedFrame];
listeners.get('dashbridge-theme-change')();
assert.strictEqual(navigated.length, 3, 'follow-theme iframe navigates on theme change');
assert.deepStrictEqual(new URL(navigated[2].url).searchParams.getAll('var-instance'), ['selected', 'second']);
frames = [deferredFrame];
deferredFrame.src = '';
panels[1].grafanaTheme = 'follow';
listeners.get('dashbridge-theme-change')();
assert.equal(new URL(deferredFrame.dataset.src).searchParams.get('theme'), 'dark', 'queued follow-theme panel receives the latest theme');
assert.equal(navigated.length, 3, 'theme change does not bypass the startup queue');
panels[1].grafanaTheme = 'light';
frames = [loadedFrame];

console.log('PASS DashBridge time controller owns profile state, URL policy and iframe lifecycle');

const historyKey = 'dashbridge.timepicker.history';
const applyRange = (from, to) => {
    elements.absTimeFrom.value = from;
    elements.absTimeTo.value = to;
    elements.applyAbsoluteTime.click();
};
const openHistory = () => {
    elements.timePopover.style.display = 'none';
    elements.timePickerBtn.click();
    return elements.recentTimeRanges.children;
};
for (const impossible of ['2026-02-30 12:00:00', '2026-02-29 12:00:00', '2026-04-31 12:00:00']) {
    const before = {state: JSON.stringify(controller.getState()), history: storage.get(historyKey), saves: saveCount, navigations: navigated.length};
    applyRange(impossible, '2026-05-03 12:00:00');
    assert.equal(elements.timeRangeError.hidden, false, 'invalid calendar input must be reported');
    assert.equal(JSON.stringify(controller.getState()), before.state);
    assert.equal(storage.get(historyKey), before.history);
    assert.equal(saveCount, before.saves);
    assert.equal(navigated.length, before.navigations);
}
assert.equal(JSON.parse(storage.get(historyKey)).length, 1);
for (let day = 1; day <= 5; day++) applyRange(`2025-05-0${day}T10:00:00.123Z`, `2025-05-0${day}T11:00:00.456Z`);
let history = JSON.parse(storage.get(historyKey));
assert.equal(history.length, 4, 'history is bounded to four unique ranges');
assert.equal(history[0].from, String(Date.parse('2025-05-05T10:00:00.123Z')));
const selected = history[2];
const beforeReplay = navigated.length;
openHistory()[2].click();
assert.equal(navigated.length, beforeReplay + 1, 'history click navigates the one active frame exactly once');
assert.equal(controller.getState().from, selected.from, 'history preserves milliseconds');
assert.equal(JSON.parse(storage.get(historyKey))[0].from, selected.from, 'reused range moves to front');
assert.equal(JSON.parse(storage.get(historyKey)).length, 4, 'reused range does not duplicate');
const beforeRelative = storage.get(historyKey);
applyRange('now-5m', 'now');
assert.equal(storage.get(historyKey), beforeRelative, 'relative quick ranges do not enter history');
applyRange('2025-05-01T10:00:00Z', 'now');
assert.equal(JSON.parse(storage.get(historyKey))[0].to, 'now', 'mixed range retains relative endpoint');
const beforeInvalid = JSON.stringify(controller.getState());
const navigationBeforeInvalid = navigated.length;
applyRange('broken', '2025-05-01T10:00:00Z');
assert.equal(JSON.stringify(controller.getState()), beforeInvalid);
applyRange('2025-05-02T10:00:00Z', '2025-05-01T10:00:00Z');
assert.equal(navigated.length, navigationBeforeInvalid, 'invalid/reversed range cannot reload frames');
assert.equal(elements.timeRangeError.hidden, false);
storage.set(historyKey, JSON.stringify([{}, { from: '<script>', to: 'now' }, selected, selected]));
assert.equal(openHistory().length, 1, 'hostile and duplicate stored entries are ignored');
storage.set(historyKey, '{}');
assert.equal(openHistory().length, 0, 'wrong storage shape becomes empty history');
storage.set(historyKey, 'x'.repeat(4097));
assert.equal(openHistory().length, 0, 'oversized storage does not render');
storage.set(historyKey, '{');
assert.doesNotThrow(openHistory, 'broken JSON cannot break picker');
windowRef.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } };
assert.doesNotThrow(() => applyRange(selected.from, selected.to));
assert.equal(controller.getState().from, selected.from, 'storage error cannot block time apply');
assert.equal(openHistory().length, 1, 'history survives in memory when storage fails');
console.log('PASS recent time ranges: cap, deduplication, exact replay, mixed/relative, invalid/storage failure');

timeState.forReport = () => ({ from: '1788951600000', to: '1788955200000', refresh: '' });
elements['iframe-panel-1'] = loadedFrame;
elements['iframe-panel-2'] = deferredFrame;
deferredFrame.src = 'about:blank';
const originalSources = [loadedFrame.src, deferredFrame.dataset.src || deferredFrame.src];
const originalState = JSON.stringify(controller.getState());
const originalSaves = saveCount;
const lease = controller.beginReport();
assert.throws(() => controller.beginReport(), /Уже/);
assert.equal(new URL(loadedFrame.src).searchParams.get('from'), '1788951600000');
assert.equal(new URL(loadedFrame.src).searchParams.has('refresh'), false);
assert.equal(controller.getReportFrameSource(loadedFrame), originalSources[0]);
assert.equal(controller.getReportFrameSource(deferredFrame), originalSources[1], 'queued panel retains its intended source during report');
controller.sendTimeUpdate(loadedFrame);
assert.equal(sent.at(-1).message.refresh, '');
assert.equal(JSON.stringify(controller.getState()), originalState);
assert.equal(saveCount, originalSaves, 'temporary override never writes profile storage');
lease.release(); lease.release();
assert.deepStrictEqual([loadedFrame.src, deferredFrame.src], originalSources);
const changedLease = controller.beginReport();
loadedFrame.src = 'https://grafana.example/d-solo/changed/a';
changedLease.release();
assert.equal(loadedFrame.src, 'https://grafana.example/d-solo/changed/a', 'release must not overwrite an external navigation');
delete elements['iframe-panel-2'];
assert.throws(() => controller.beginReport(), /Панель отсутствует/);
assert.equal(loadedFrame.src, 'https://grafana.example/d-solo/changed/a', 'partial acquisition restores earlier frames');
console.log('PASS report lease: fixed period, no persistence, restore, idempotence, external navigation and acquisition failure');
void (async () => {
    elements['iframe-panel-2'] = deferredFrame;
    for (const frame of [loadedFrame, deferredFrame]) {
        frame.removeEventListener = function(type) { delete this.listeners[type]; };
    }
    const readyLease = controller.beginReport();
    let ready = false;
    readyLease.ready.then(() => { ready = true; });
    await Promise.resolve();
    assert.equal(ready, false, 'collection waits for new documents');
    loadedFrame.listeners.load(); deferredFrame.listeners.load();
    await readyLease.ready;
    readyLease.release();
    const abort = new AbortController();
    const cancelled = controller.beginReport({ signal: abort.signal });
    abort.abort();
    await assert.rejects(cancelled.ready, { name: 'AbortError' });
    cancelled.release();
    assert.equal(loadedFrame.listeners.load, undefined);
    assert.equal(deferredFrame.listeners.load, undefined);
    timeState.forReport = () => controller.getState();
    loadedFrame.src = controller.applyPanelParamsToUrl(panels[0]);
    deferredFrame.src = controller.applyPanelParamsToUrl(panels[1]);
    const beforeReport = loadedFrame.src;
    const sameRangeLease = controller.beginReport();
    try {
        assert.notEqual(loadedFrame.src.split('#')[0], beforeReport.split('#')[0],
            'an already absolute Refresh Off panel needs a new document, not a same-document fragment navigation');
        loadedFrame.listeners.load(); deferredFrame.listeners.load();
        await sameRangeLease.ready;
    } finally { sameRangeLease.release(); }
    assert.equal(loadedFrame.src, beforeReport, 'release restores the original URL after a same-range report');
    console.log('PASS report load readiness and abort clean up listeners and watchdogs');
})().catch(error => { console.error(error); process.exitCode = 1; });
