'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const projectRoot = path.resolve(__dirname, '..');
// Browser-process scope includes extension workers from their first request.
// Force direct connections: PAC/WPAD proxies can resolve the blocked host remotely.
const testBrowserNetworkArgs = Object.freeze([
    '--host-resolver-rules=MAP analytics.tongehub.com ~NOTFOUND',
    '--no-proxy-server',
]);

function validateGrafanaUrls(values) {
    if (values.length < 1 || values.length > 2) {
        throw new Error('Pass one or two Grafana URLs: npm run auth:grafana -- <url-1> [url-2]');
    }

    const urls = values.map(value => {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`Only HTTP(S) Grafana URLs are allowed: ${parsed.protocol}`);
        }
        if (parsed.username || parsed.password) {
            throw new Error('Do not put a username, password or token into a Grafana URL. Sign in inside the browser.');
        }
        return parsed.href;
    });
    if (new Set(urls).size !== urls.length) {
        throw new Error('Grafana URLs must be different.');
    }
    return urls;
}

function resolveProfileRoot(override = process.env.DASHBRIDGE_E2E_PROFILE) {
    const localProfileRoot = path.join(projectRoot, '.dashbridge-local', 'e2e', 'browser-profile');
    const profileRoot = path.resolve(override || localProfileRoot);
    const relativeToProject = path.relative(projectRoot, profileRoot);
    const isInsideRepository = !relativeToProject.startsWith('..') && !path.isAbsolute(relativeToProject);
    const isCanonicalLocalProfile = profileRoot === path.resolve(localProfileRoot);
    if (isInsideRepository && !isCanonicalLocalProfile) {
        throw new Error('The persistent E2E browser profile must stay in the canonical local runtime directory or outside the repository.');
    }
    return profileRoot;
}

function resolveChromeExecutable(override = process.env.DASHBRIDGE_CHROME_PATH) {
    if (override) return path.resolve(override);
    const localBrowserRoot = path.join(projectRoot, '.dashbridge-local', 'playwright');
    if (fs.existsSync(localBrowserRoot)) {
        const revisions = fs.readdirSync(localBrowserRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
            .sort((left, right) => Number(right.name.slice(9)) - Number(left.name.slice(9)));
        for (const revision of revisions) {
            const executable = path.join(localBrowserRoot, revision.name, 'chrome-win64', 'chrome.exe');
            if (fs.existsSync(executable)) return executable;
        }
    }
    return chromium.executablePath();
}

async function waitForExtensionWorker(context) {
    let workers = context.serviceWorkers();
    if (!workers.some(worker => worker.url().startsWith('chrome-extension://'))) {
        await context.waitForEvent('serviceworker', { timeout: 10_000 });
        workers = context.serviceWorkers();
    }
    const worker = workers.find(candidate => candidate.url().startsWith('chrome-extension://'));
    if (!worker) throw new Error('DashBridge service worker did not start in the E2E browser profile.');
    return new URL(worker.url()).host;
}

async function reconcileRegisteredGrafanaRuntime({ settleMs = 4_000, pollMs = 200 } = {}) {
    const runtimeFiles = [...(globalThis.DashBridgeGrafanaRuntimeManifest?.files || [])];
    const scripting = globalThis.chrome?.scripting;
    if (!runtimeFiles.length || typeof scripting?.getRegisteredContentScripts !== 'function'
        || typeof scripting?.updateContentScripts !== 'function') {
        throw new Error('Current Grafana runtime manifest or scripting API is unavailable');
    }

    const isOwnedRegistration = registration => registration?.id === 'dashbridge-grafana-main-runtime-v1'
        || registration?.id?.startsWith('dashbridge-grafana-explicit-');
    const hasCurrentFiles = registration => JSON.stringify(registration?.js || [])
        === JSON.stringify(runtimeFiles);
    const updated = new Set();
    const deadline = Date.now() + Math.max(0, Number(settleMs) || 0);
    const delay = () => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(pollMs) || 0)));

    // MV3 may restore persisted registrations shortly after the worker becomes
    // visible. Keep polling when none exist so a late stale registration cannot
    // race the preflight and inject an old split-module list into Grafana.
    while (true) {
        const owned = (await scripting.getRegisteredContentScripts()).filter(isOwnedRegistration);
        for (const registration of owned.filter(item => !hasCurrentFiles(item))) {
            await scripting.updateContentScripts([{ id: registration.id, js: [...runtimeFiles] }]);
            updated.add(registration.id);
        }
        if (owned.length || Date.now() >= deadline) break;
        await delay();
    }

    const registrations = (await scripting.getRegisteredContentScripts()).filter(isOwnedRegistration);
    const stale = registrations.filter(item => !hasCurrentFiles(item));
    if (stale.length) {
        throw new Error(`Stale Grafana runtime registration remains: ${stale.map(item => item.id).join(', ')}`);
    }
    return {
        checked: registrations.length,
        updated: [...updated],
        currentFileCount: runtimeFiles.length,
    };
}

async function main() {
    const grafanaUrls = validateGrafanaUrls(process.argv.slice(2));
    const profileRoot = resolveProfileRoot();
    const chromeExecutable = resolveChromeExecutable();
    if (!fs.existsSync(chromeExecutable)) {
        throw new Error(`Playwright Chromium is missing: ${chromeExecutable}. Run npm run browser:install.`);
    }

    fs.mkdirSync(profileRoot, { recursive: true });
    const context = await chromium.launchPersistentContext(profileRoot, {
        executablePath: chromeExecutable,
        headless: false,
        viewport: null,
        args: [
            ...testBrowserNetworkArgs,
            `--disable-extensions-except=${projectRoot}`,
            `--load-extension=${projectRoot}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--start-maximized'
        ]
    });

    let closing = false;
    const close = async () => {
        if (closing) return;
        closing = true;
        await context.close().catch(() => undefined);
    };
    process.once('SIGINT', () => void close());
    process.once('SIGTERM', () => void close());

    try {
        const extensionId = await waitForExtensionWorker(context);
        const pages = context.pages();
        const firstPage = pages[0] || await context.newPage();
        const targetPages = [firstPage];
        while (targetPages.length < grafanaUrls.length) targetPages.push(await context.newPage());
        await Promise.allSettled(grafanaUrls.map((url, index) => (
            targetPages[index].goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        )));

        const hosts = grafanaUrls.map(value => new URL(value).host).join(', ');
        console.log(`DashBridge ${extensionId} loaded in the persistent E2E profile.`);
        console.log(`Opened Grafana hosts: ${hosts}`);
        console.log(`Profile: ${profileRoot}`);
        console.log('Sign in to every opened Grafana site, verify its dashboard opens, then close the browser window.');

        await new Promise(resolve => context.once('close', resolve));
    } finally {
        await close();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
}

module.exports = {
    projectRoot,
    testBrowserNetworkArgs,
    reconcileRegisteredGrafanaRuntime,
    resolveChromeExecutable,
    resolveProfileRoot,
    validateGrafanaUrls,
    waitForExtensionWorker,
};
