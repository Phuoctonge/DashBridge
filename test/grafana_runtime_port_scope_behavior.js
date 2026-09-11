'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({ URL });
for (const file of ['js/shared/url-validation.js', 'js/shared/grafana-runtime-manifest.js',
    'js/shared/dnr-rules.js', 'js/background-grafana-infrastructure.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
}
let registration, injected = [];
const urls = ['https://grafana.test:8443/d/uid/name', 'https://grafana.test:9443/d/uid/name',
    'http://grafana.test:8443/base/d-solo/uid/name', 'https://child.grafana.test:8443/d/a',
    'https://grafana.test:8443/login', 'https://wide.test:9443/d/a'];
const chromeRef = {
    runtime: { id: 'fixture', getURL: path => `chrome-extension://fixture/${path}` },
    storage: { sync: { get: async () => ({ grafanaIframeDomains: ['grafana.test:8443', 'wide.test'] }) } },
    tabs: { query: async () => [{ id: 1, url: urls[0] }] },
    scripting: {
        getRegisteredContentScripts: async () => [],
        registerContentScripts: async value => { registration = value[0]; },
        executeScript: async options => {
            if (options.files) injected.push(...options.target.frameIds);
            return urls.map((url, frameId) => ({ frameId, result: { url, loaded: false } }));
        },
    },
    declarativeNetRequest: {
        getSessionRules: async () => [], getDynamicRules: async () => [], updateSessionRules: async () => {},
    },
};
const checks = [];
const check = async (name, run) => {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { checks.push(name); console.error('FAIL ' + name, error.message); }
};
(async () => {
    const owner = context.DashBridgeBackgroundGrafanaInfrastructure.create({
        chromeRef, settingsDefaults: () => ({ grafanaIframeDomains: [] }),
    });
    await owner.sync({ backfillOpenFrames: true });
    await check('automatic MAIN patterns preserve a configured port with separate HTTP and HTTPS schemes', () => {
        assert(registration.matches.includes('https://grafana.test:8443/d/*'));
        assert(registration.matches.includes('http://grafana.test:8443/*/d-solo/*'));
        assert(!registration.matches.some(pattern => pattern.includes('://grafana.test/')));
        assert(registration.matches.includes('*://wide.test/d/*'));
    });
    await check('backfill rejects wrong port, subdomain and route but accepts host-only nondefault ports', () => {
        assert.deepEqual(injected, [0, 2, 5]);
    });
    await check('explicit registration distinguishes ports and does not mistake another permanent port for coverage', async () => {
        const explicit = [];
        context.chrome = { scripting: {
            getRegisteredContentScripts: async ({ ids }) => ids.includes('dashbridge-grafana-main-runtime-v1')
                ? [{ id: 'dashbridge-grafana-main-runtime-v1', matches: ['https://grafana.test:8443/d/*'] }]
                : explicit.filter(item => ids.includes(item.id)),
            registerContentScripts: async value => explicit.push(...value),
        } };
        vm.runInContext(fs.readFileSync('js/shared/grafana-runtime.js', 'utf8'), context);
        await context.ensureEarlyGrafanaRuntimeForUrl('https://grafana.test:9443/d/a');
        await context.ensureEarlyGrafanaRuntimeForUrl('https://grafana.test:10443/d/a');
        assert.equal(explicit.length, 2);
        assert(explicit[0].matches.includes('https://grafana.test:9443/d/*'));
        assert(explicit[1].matches.includes('https://grafana.test:10443/d/*'));
        const invalid = await context.ensureEarlyGrafanaRuntimeForUrl('http://[::1]:3000/d/a');
        assert.equal(invalid.ok, false, 'an unsupported host cannot be covered by vacuous pattern checks');
        assert.equal(explicit.length, 2);
    });
    if (checks.length) throw new Error(checks.length + ' port scope checks failed');
})().catch(error => { console.error(error); process.exitCode = 1; });
