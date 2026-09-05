'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(file, 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function locks() {
    const held = new Map();
    return { async request(name, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (options.ifAvailable && held.has(name)) return callback(null);
        while (held.has(name)) await held.get(name);
        let release; const promise = new Promise(resolve => { release = resolve; });
        held.set(name, promise);
        try { return await callback({ name }); }
        finally { held.delete(name); release(); }
    } };
}
async function spoolOwnership() {
    const directories = new Map();
    const base = {
        async *entries() { yield* [...directories.entries()]; },
        async getDirectoryHandle(name) { const dir = { name }; directories.set(name, dir); return dir; },
        async removeEntry(name) { directories.delete(name); }
    };
    const context = vm.createContext({ navigator: { locks: locks(), storage: {
        getDirectory: async () => ({ getDirectoryHandle: async () => base })
    } } });
    vm.runInContext(read('pages/test-runner/test-runner-spool.js') + '\nthis.Spool = DiagnosticSpool;', context);
    const first = new context.Spool(); const second = new context.Spool();
    await first.begin('one'); await second.begin('two');
    await context.Spool.clearStaleSessions();
    assert.equal(directories.size, 2, 'opening/running another page must preserve live evidence');
    first.releaseLease(); await tick();
    await context.Spool.clearStaleSessions();
    assert.deepEqual([...directories.keys()], ['dashbridge-e2e-run-two'], 'only orphaned evidence is removed');
    await second.clear(); assert.equal(directories.size, 0);
}
async function captureIdentity() {
    const event = () => { const callbacks = new Set(); return {
        addListener: fn => callbacks.add(fn), removeListener: fn => callbacks.delete(fn),
        emit: (...args) => callbacks.forEach(fn => fn(...args)), callbacks
    }; };
    const tab = { id: 1, windowId: 2, url: 'https://grafana.test/d/a' };
    let active = 1; let duringCapture = () => {};
    const tabs = { get: async () => ({ ...tab }), query: async () => [{ id: active }],
        onActivated: event(), onUpdated: event(), onRemoved: event(),
        captureVisibleTab: async () => { duringCapture(); return 'image'; } };
    const context = vm.createContext({ chrome: { tabs } });
    vm.runInContext(read('js/shared/grafana-panel-capture.js'), context);
    assert.equal(await context.captureGrafanaVisibleTab(1, tab.url), 'image');
    duringCapture = () => tabs.onActivated.emit({ windowId: 99 });
    assert.equal(await context.captureGrafanaVisibleTab(1, tab.url), 'image', 'other windows do not invalidate capture');
    duringCapture = () => { active = 3; };
    await assert.rejects(context.captureGrafanaVisibleTab(1, tab.url), /capture-target-changed/);
    active = 1; duringCapture = () => tabs.onUpdated.emit(1, { status: 'loading' });
    await assert.rejects(context.captureGrafanaVisibleTab(1, tab.url), /capture-target-changed/);
    for (const name of ['onActivated', 'onUpdated', 'onRemoved']) assert.equal(tabs[name].callbacks.size, 0);
}
async function batchWrites() {
    let stored = {};
    const context = vm.createContext({ URL, navigator: { locks: locks() }, chrome: { storage: { local: {
        get: async () => structuredClone(stored), set: async value => { stored = structuredClone(value); }
    } } } }); context.window = context;
    vm.runInContext(read('js/shared/grafana-url.js'), context);
    vm.runInContext(read('js/shared/grafana-batch-panel-rules.js'), context);
    await Promise.all(['one', 'two'].map(uid => context.BatchPanelRules.save(`https://g.test/d/${uid}`, { 1: { removeFill: true } })));
    assert.equal(Object.keys(stored.batchPanelToolRules).length, 2);
}
async function registrationAndCache() {
    const context = vm.createContext({ URL });
    vm.runInContext(read('js/background-grafana-infrastructure.js'), context);
    let registrations = 0;
    const chromeRef = { runtime: { getURL: p => 'chrome-extension://fixture/' + p }, tabs: { query: async () => [] },
        storage: { sync: { get: async () => ({ grafanaIframeDomains: ['g.test'] }) } },
        scripting: {
            getRegisteredContentScripts: async () => [{ matches: ['*://g.test/d/*'], js: ['consumer.js', 'dependency.js'], allFrames: true, runAt: 'document_start', world: 'MAIN' }],
            unregisterContentScripts: async () => {}, registerContentScripts: async () => { registrations++; }
        }, declarativeNetRequest: { getSessionRules: async () => [], getDynamicRules: async () => [], updateSessionRules: async () => {} }
    };
    const owner = context.DashBridgeBackgroundGrafanaInfrastructure.create({ chromeRef,
        runtimeManifest: { files: ['dependency.js', 'consumer.js'], matchesForHostname: () => ['*://g.test/d/*'] },
        dnrRules: { planSessionRules: () => ({ rules: [] }) }, settingsDefaults: () => ({}), normalizeHost: v => v, parseUrl: v => new URL('https://' + v) });
    await owner.sync(); assert.equal(registrations, 1, 'changed load order must be registered');
    const urls = [];
    const definition = vm.createContext({ URLSearchParams, location: { pathname: '/grafana/d/uid', search: '?panelId=1&orgId=1' }, document: {},
        fetch: async url => { urls.push(url); return { ok: true, json: async () => ({ dashboard: { panels: [{ id: 1, title: url }] } }) }; }
    }); definition.window = definition;
    vm.runInContext(read('js/content/grafana-panel-definition.js'), definition);
    const api = definition.DashBridgeGrafanaPanelDefinition;
    const first = await api.getPanelDefinition();
    definition.location.search = '?panelId=1&orgId=2';
    assert.equal(api.getCachedPanelDefinition(), null);
    const second = await api.getPanelDefinition();
    assert.notEqual(first.title, second.title);
    assert.deepEqual(urls, ['/grafana/api/dashboards/uid/uid?orgId=1', '/grafana/api/dashboards/uid/uid?orgId=2']);
}
async function analyticsNetwork() {
    let stored = {}; const reads = [];
    const area = { get: async keys => { reads.push(keys); return structuredClone(stored); },
        set: async value => { stored = structuredClone(value); } };
    let time = Date.now(); let sequence = 0; let complete; let timeout;
    const requests = [];
    const context = vm.createContext({ AbortController, clearTimeout: () => {},
        setTimeout: (fn, ms) => { if (ms > 0) timeout = fn; return 1; } });
    vm.runInContext(read('js/shared/analytics-contract.js'), context);
    vm.runInContext(read('js/background-analytics.js'), context);
    const api = context.DashBridgeBackgroundAnalytics.create({ storageArea: area, syncStorageArea: area,
        runtimeApi: { getManifest: () => ({ version: '2.4.3' }) }, now: () => time,
        randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
        config: { endpoint: 'https://fixture.test', minimumSendIntervalMs: 0 },
        fetchFn: (_url, options) => { requests.push(options); return new Promise(resolve => { complete = resolve; }); }
    });
    const event = { featureId: 'popup.opened', signal: 'used', dimensions: {} };
    await api.track(event); const sending = api.send(); await tick();
    assert.equal((await api.track(event)).ok, true, 'track must commit while fetch is pending');
    const original = JSON.parse(requests[0].body).events;
    timeout(); assert.equal((await sending).reason, 'network-error');
    assert(requests[0].signal.aborted);
    assert.equal((await api.loadState()).aggregates.find(item => item.featureId === 'popup.opened').count, 1);
    time += 10_000_000;
    const retry = api.send(); await tick();
    assert.deepEqual(JSON.parse(requests[1].body).events, original, 'retry body must retain event IDs and counts');
    complete({ ok: true }); assert((await retry).sent > 0);
    assert.equal((await api.loadState()).aggregates.find(item => item.featureId === 'popup.opened').count, 1);
    assert(reads.every(keys => Array.isArray(keys)), 'daily snapshot must not read unrelated local storage');
}
async function worklogStableIds() {
    const source = read('pages/worklog/worklog.js');
    const handler = source.slice(source.indexOf('sendAllBtn.onclick = async () => {'), source.lastIndexOf('\n});'));
    let finish; const posted = new Promise(resolve => { finish = resolve; });
    const rows = ['a', 'b'].map(id => ({ id, issueId: `${id}-1`, timeSpent: '1h', dateStarted: '2026-09-06', status: 'new' }));
    const commits = []; const submits = [];
    const context = vm.createContext({ worklogs: rows, sendingWorklogs: false, sendAllBtn: {},
        document: { querySelectorAll: () => [] },
        parseDate: () => new Date(), jiraClient: { submitWorklog: input => { submits.push(input.key); return posted; } },
        worklogWriter: { write: async value => commits.push(structuredClone(value)) },
        sortOrder: 'desc', issueCache: {}, findWorklogRow: () => null, renderTable() {}, updateStats() {},
        DashBridgeAnalytics: null, DashBridgeAnalyticsContract: null, console, alert: assert.fail, setTimeout: fn => fn() });
    vm.runInContext(handler, context);
    const sending = context.sendAllBtn.onclick();
    await context.sendAllBtn.onclick(); assert.equal(submits.length, 1, 'double click cannot send another batch');
    context.worklogs = [rows[1]]; finish({ ok: true }); await sending;
    assert.equal(commits[0].jiraWorklogs[0].status, 'new', 'success A must not mark B sent');
    assert.deepEqual(submits, ['a-1', 'b-1']);
    assert.equal(commits[1].jiraWorklogs[0].status, 'sent');
    assert.equal(context.sendingWorklogs, false);
}
(async () => {
    await spoolOwnership(); await captureIdentity(); await batchWrites(); await registrationAndCache(); await analyticsNetwork(); await worklogStableIds();
    console.log('PASS module audit regressions: OPFS ownership, capture identity, concurrent storage, analytics deadline, Worklog IDs');
})().catch(error => { console.error(error); process.exitCode = 1; });
