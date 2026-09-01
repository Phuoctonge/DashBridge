'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const {
    projectRoot,
    reconcileRegisteredGrafanaRuntime,
    resolveProfileRoot,
    validateGrafanaUrls,
    waitForExtensionWorker
} = require('./setup-grafana-e2e-profile');

async function main() {
    const grafanaUrls = validateGrafanaUrls(process.argv.slice(2));
    const profileRoot = resolveProfileRoot();
    const chromeExecutable = process.env.DASHBRIDGE_CHROME_PATH || chromium.executablePath();
    if (!fs.existsSync(profileRoot)) throw new Error(`Grafana E2E profile does not exist: ${profileRoot}`);
    if (!fs.existsSync(chromeExecutable)) throw new Error(`Playwright Chromium is missing: ${chromeExecutable}`);

    const context = await chromium.launchPersistentContext(profileRoot, {
        executablePath: chromeExecutable,
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: [
            `--disable-extensions-except=${projectRoot}`,
            `--load-extension=${projectRoot}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--window-position=-32000,-32000'
        ]
    });

    const results = [];
    try {
        const extensionId = await waitForExtensionWorker(context);
        const runtimePage = context.pages()[0] || await context.newPage();
        await runtimePage.goto(`chrome-extension://${extensionId}/pages/test-runner/test-runner.html`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000
        });
        await runtimePage.waitForFunction(() => (
            Array.isArray(globalThis.DashBridgeGrafanaRuntimeManifest?.files)
        ), null, { timeout: 30_000 });
        const runtimeRegistration = await runtimePage.evaluate(reconcileRegisteredGrafanaRuntime);
        await runtimePage.close();
        for (const value of grafanaUrls) {
            const target = new URL(value);
            const page = await context.newPage();
            const pageErrors = [];
            page.on('pageerror', error => pageErrors.push(error.message));
            const response = await page.goto(value, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForTimeout(2_000);
            const apiResponse = await context.request.get(new URL('/api/user', target.origin).href, {
                failOnStatusCode: false,
                timeout: 20_000
            });
            const finalUrl = new URL(page.url());
            const result = {
                host: target.host,
                dashboardPath: target.pathname,
                navigationStatus: response?.status() || null,
                apiUserStatus: apiResponse.status(),
                remainedOnTargetOrigin: finalUrl.origin === target.origin,
                finalPath: finalUrl.pathname,
                pageErrors,
                authenticated: apiResponse.status() === 200
                    && finalUrl.origin === target.origin
                    && !/^\/login(?:\/|$)/.test(finalUrl.pathname)
            };
            results.push(result);
            await page.close();
        }

        const report = {
            checkedAt: new Date().toISOString(),
            extensionId,
            profileRoot,
            runtimeRegistration,
            results
        };
        const resultsRoot = path.join(projectRoot, 'test-results');
        fs.mkdirSync(resultsRoot, { recursive: true });
        fs.writeFileSync(path.join(resultsRoot, 'grafana-session-check.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

        for (const result of results) {
            console.log(`${result.authenticated ? 'PASS' : 'FAIL'} ${result.host}: /api/user ${result.apiUserStatus}, page ${result.finalPath}`);
        }
        if (results.some(result => !result.authenticated || result.pageErrors.length > 0)) process.exitCode = 1;
    } finally {
        await context.close();
    }
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
