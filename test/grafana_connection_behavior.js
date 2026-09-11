'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ URL });
for (const file of ['js/shared/url-validation.js', 'js/background-grafana-infrastructure.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
}
let stored;
let writes = 0;
let rulesReady = false;
let registrationReady = false;
let failWrite = false;
const chromeRef = {
    runtime: { id: 'fixture', getURL: path => `chrome-extension://fixture/${path}` },
    storage: { sync: {
        get: async () => stored ? { grafanaIframeDomains: [...stored] } : {},
        set: async value => {
            if (failWrite) throw new Error('quota exceeded');
            stored = [...value.grafanaIframeDomains]; writes++;
        }
    } },
    tabs: { query: async () => [{ id: 1, url: 'chrome-extension://fixture/pages/dashbridge/dashbridge.html' }] },
    scripting: {
        getRegisteredContentScripts: async () => [],
        registerContentScripts: async () => { registrationReady = true; }
    },
    declarativeNetRequest: {
        getSessionRules: async () => [], getDynamicRules: async () => [],
        updateSessionRules: async () => { rulesReady = true; }
    }
};
const owner = context.DashBridgeBackgroundGrafanaInfrastructure.create({
    chromeRef,
    runtimeManifest: { files: ['runtime.js'], matchesForHostname: host => [`*://${host}/d/*`] },
    dnrRules: { planSessionRules: () => ({ rules: [] }) },
    settingsDefaults: () => ({ grafanaIframeDomains: ['default.test', 'strict.test:8443'] })
});
(async () => {
    assert.equal((await owner.configureConnection('https://default.test/base/d/a', false)).configured, true);
    assert(registrationReady && rulesReady, 'response must await runtime and DNR readiness');
    assert.equal(writes, 0, 'existing connection is not rewritten');
    assert.equal((await owner.configureConnection('https://new.test/d/a', false)).configured, false);
    assert.equal(writes, 0, 'checking an unknown host never grants access');
    assert.equal((await owner.configureConnection('https://strict.test:9443/d/a', false)).configured, false);
    await Promise.all([
        owner.configureConnection('https://NEW.test/base/d/a?var-secret=x', true),
        owner.configureConnection('https://second.test:8443/d-solo/a?panelId=1', true),
        owner.configureConnection('https://new.test/d/b', true)
    ]);
    assert.deepEqual(stored, ['default.test', 'strict.test:8443', 'new.test', 'second.test:8443']);
    assert.equal(writes, 2, 'concurrent registrations merge and deduplicate hostname entries');
    for (const url of ['javascript:alert(1)', 'ftp://g.test/d/a', 'https://user:pass@g.test/d/a',
        'https://g.test/login', 'g.test/d/a']) {
        await assert.rejects(owner.configureConnection(url, true));
    }
    assert.equal(writes, 2, 'invalid inputs never modify settings');
    failWrite = true;
    await assert.rejects(owner.configureConnection('https://failure.test/d/a', true), /quota/);
    failWrite = false;
    await owner.configureConnection('https://recovered.test/d/a', true);
    assert(stored.includes('recovered.test'), 'failed writes must not poison the queue');
    const staleConnections = [...stored];
    await owner.configureConnection('https://another.test/d/a', true);
    await assert.rejects(owner.replaceConnections(staleConnections, ['default.test']), /другой вкладке/);
    assert(stored.includes('another.test'), 'stale Options must not delete a newly added connection');
    await owner.replaceConnections([...stored], ['default.test']);
    assert.deepEqual(stored, ['default.test'], 'explicit removal with a current baseline remains supported');
    await assert.rejects(owner.replaceConnections(['default.test'], ['https://bad.test/path']), /Некорректный/);
    stored = Array.from({ length: 100 }, (_, index) => `host-${index}.test`);
    await assert.rejects(owner.configureConnection('https://overflow.test/d/a', true), /100/);
    console.log('PASS Grafana connection confirmation, validation, serialization, defaults, readiness and limits');
})().catch(error => { console.error(error); process.exitCode = 1; });
