'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
    reconcileRegisteredGrafanaRuntime,
    resolveChromeExecutable,
    resolveProfileRoot,
    validateGrafanaUrls,
} = require('../scripts/setup-grafana-e2e-profile');

assert.deepStrictEqual(validateGrafanaUrls([
    'https://grafana-one.example/d/main',
    'https://grafana-two.example/d/legacy?orgId=1'
]), [
    'https://grafana-one.example/d/main',
    'https://grafana-two.example/d/legacy?orgId=1'
]);
assert.deepStrictEqual(validateGrafanaUrls([
    'https://grafana-one.example/d/main'
]), [
    'https://grafana-one.example/d/main'
]);
assert.throws(() => validateGrafanaUrls([]), /one or two/);
assert.throws(() => validateGrafanaUrls([
    'https://grafana-one.example',
    'https://grafana-two.example',
    'https://grafana-three.example'
]), /one or two/);
assert.throws(() => validateGrafanaUrls([
    'file:///tmp/grafana',
    'https://grafana-two.example'
]), /Only HTTP\(S\)/);
assert.throws(() => validateGrafanaUrls([
    'https://user:secret@grafana-one.example',
    'https://grafana-two.example'
]), /Do not put a username/);
assert.throws(() => validateGrafanaUrls([
    'https://grafana-one.example',
    'https://grafana-one.example'
]), /must be different/);
const previousProfileOverride = process.env.DASHBRIDGE_E2E_PROFILE;
delete process.env.DASHBRIDGE_E2E_PROFILE;
const localProfile = resolveProfileRoot();
assert.match(localProfile, /[\\/]\.dashbridge-local[\\/]e2e[\\/]browser-profile$/,
    'default live profile must be in the ignored local runtime directory');
assert.strictEqual(resolveProfileRoot(localProfile), localProfile,
    'the canonical local profile may be explicitly selected');
assert.throws(() => resolveProfileRoot(path.resolve(__dirname, '..', 'test-results', 'profile')), /outside the repository/);
// Exercise local-copy selection without depending on this machine's OS or installed revision.
const browserRoot = path.resolve(__dirname, '..', '.dashbridge-local', 'playwright');
const browserCopy = path.join(browserRoot, 'chromium-2000', 'chrome-win64', 'chrome.exe');
let localCopyAvailable = true;
const resolverRequire = name => {
    if (name === 'node:fs') return {
        existsSync: candidate => localCopyAvailable && [browserRoot, browserCopy].includes(candidate),
        readdirSync: () => ['chromium-1000', 'chromium-2000', 'other'].map(name => ({
            name, isDirectory: () => true
        }))
    };
    if (name === '@playwright/test') return { chromium: { executablePath: () => '/fixture/browser' } };
    return require(name);
};
const resolverModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../scripts/setup-grafana-e2e-profile.js'), 'utf8'), {
    require: resolverRequire, module: resolverModule,
    __dirname: path.resolve(__dirname, '../scripts'), process: { env: {} }
});
assert.strictEqual(resolverModule.exports.resolveChromeExecutable(), browserCopy,
    'live launch must prefer the newest available ignored local Chromium copy');
localCopyAvailable = false;
assert.strictEqual(resolverModule.exports.resolveChromeExecutable(), '/fixture/browser',
    'a clean workstation must use the installed Playwright runtime');
assert.strictEqual(resolveChromeExecutable('C:\\custom\\chrome.exe'), path.resolve('C:\\custom\\chrome.exe'),
    'explicit Chrome override must remain supported');
if (previousProfileOverride === undefined) delete process.env.DASHBRIDGE_E2E_PROFILE;
else process.env.DASHBRIDGE_E2E_PROFILE = previousProfileOverride;

(async () => {
    const previousManifest = globalThis.DashBridgeGrafanaRuntimeManifest;
    const previousChrome = globalThis.chrome;
    const currentFiles = Array.from({ length: 28 }, (_, index) => `js/runtime-${index}.js`);
    const registrations = [
        { id: 'foreign-script', js: ['foreign.js'] },
        { id: 'dashbridge-grafana-main-runtime-v1', js: currentFiles.slice(0, 18) },
    ];
    const updates = [];
    try {
        globalThis.DashBridgeGrafanaRuntimeManifest = { files: currentFiles };
        globalThis.chrome = { scripting: {
            async getRegisteredContentScripts() {
                return registrations.map(item => ({ ...item, js: [...item.js] }));
            },
            async updateContentScripts(changes) {
                updates.push(...changes);
                for (const change of changes) {
                    const target = registrations.find(item => item.id === change.id);
                    if (target) target.js = [...change.js];
                }
            },
        } };

        const repaired = await reconcileRegisteredGrafanaRuntime({ settleMs: 0, pollMs: 0 });
        assert.deepStrictEqual(repaired, {
            checked: 1,
            updated: ['dashbridge-grafana-main-runtime-v1'],
            currentFileCount: 28,
        });
        assert.deepStrictEqual(updates, [{
            id: 'dashbridge-grafana-main-runtime-v1',
            js: currentFiles,
        }]);
        assert.deepStrictEqual(registrations[0].js, ['foreign.js'], 'foreign registrations must remain untouched');

        updates.length = 0;
        const current = await reconcileRegisteredGrafanaRuntime({ settleMs: 0, pollMs: 0 });
        assert.deepStrictEqual(current.updated, [], 'a current registration must remain unchanged');
        assert.deepStrictEqual(updates, []);
    } finally {
        if (previousManifest === undefined) delete globalThis.DashBridgeGrafanaRuntimeManifest;
        else globalThis.DashBridgeGrafanaRuntimeManifest = previousManifest;
        if (previousChrome === undefined) delete globalThis.chrome;
        else globalThis.chrome = previousChrome;
    }

    console.log('PASS persistent Grafana E2E profile reconciles stale runtime files without touching foreign scripts');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
