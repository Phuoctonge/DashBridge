'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { acquireProfileLock } = require('./profile-lock');
const { projectRoot, resolveProfileRoot, validateGrafanaUrls, waitForExtensionWorker } = require('../../scripts/setup-grafana-e2e-profile');

async function runLiveCheck(urls, { headless = true } = {}) {
    const profileRoot = resolveProfileRoot();
    const executablePath = process.env.DASHBRIDGE_CHROME_PATH || chromium.executablePath();
    if (!fs.existsSync(profileRoot)) return { status: 'blocked', reason: 'profile-not-found' };
    if (!fs.existsSync(executablePath)) return { status: 'blocked', reason: 'chromium-not-found' };
    const lock = acquireProfileLock(profileRoot);
    let context;
    try {
        context = await chromium.launchPersistentContext(profileRoot, { executablePath, headless, viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${projectRoot}`, `--load-extension=${projectRoot}`, '--no-first-run'] });
        const extensionId = await waitForExtensionWorker(context);
        const results = [];
        for (const value of urls) {
            const target = new URL(value);
            const page = await context.newPage();
            try {
                const response = await page.goto(value, { waitUntil: 'domcontentloaded', timeout: 15_000 });
                await page.waitForTimeout(500);
                const api = await context.request.get(new URL('/api/user', target.origin).href, { failOnStatusCode: false, timeout: 5_000 });
                const finalUrl = new URL(page.url());
                results.push({ host: target.host, navigationStatus: response?.status() || null, apiUserStatus: api.status(), finalPath: finalUrl.pathname, authenticated: api.status() === 200 && finalUrl.origin === target.origin && !/^\/login(?:\/|$)/.test(finalUrl.pathname) });
            } catch (error) {
                results.push({ host: target.host, status: 'blocked', reason: String(error.message || error).slice(0, 240), authenticated: false });
            }
            await page.close();
        }
        return { status: results.every(item => item.authenticated) ? 'passed' : 'blocked', extensionId, results };
    } finally {
        await context?.close().catch(() => undefined);
        lock.release();
    }
}

if (require.main === module) {
    runLiveCheck(validateGrafanaUrls(process.argv.slice(2)), { headless: process.env.DASHBRIDGE_LIVE_HEADLESS !== 'false' })
        .then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'passed' ? 0 : 2; })
        .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

module.exports = { runLiveCheck };
