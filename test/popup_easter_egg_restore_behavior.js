'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { projectRoot, resolveChromeExecutable, testBrowserNetworkArgs,
    waitForExtensionWorker } = require('../scripts/setup-grafana-e2e-profile');

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-popup-restore-'));
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            executablePath: resolveChromeExecutable(), headless: true,
            args: [...testBrowserNetworkArgs, `--disable-extensions-except=${projectRoot}`,
                `--load-extension=${projectRoot}`, '--no-first-run'],
        });
        const extensionId = await waitForExtensionWorker(context);
        const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'));
        await worker.evaluate(() => globalThis.chrome.storage.sync.set({
            lastActiveTab: 'tab-grafana', lastActiveGrafanaSubTab: 'grafana-debug',
            rememberLastTab: true, rememberLastSubTab: true,
        }));
        for (let reopen = 0; reopen < 2; reopen += 1) {
            const page = await context.newPage();
            await page.goto(`chrome-extension://${extensionId}/pages/popup/popup.html`);
            await page.locator('.tab-btn[data-tab="tab-grafana"].active').waitFor();
            await page.locator('.grafana-sub-btn[data-sub="grafana-debug"].active').waitFor();
            const trigger = page.locator('#debugFreshCodeEasterEgg');
            assert(await trigger.isVisible(), 'restored Debug tab must expose the Easter egg without another tab click');
            const opened = context.waitForEvent('page');
            await trigger.click();
            const egg = await opened;
            await egg.waitForLoadState('domcontentloaded');
            assert(egg.url().includes('/pages/debug-easter-egg/debug-easter-egg.html'));
            await egg.locator('label[for="debugEasterEggFile"]').waitFor();
            await egg.close();
            for (const selector of ['.tab-btn[data-tab="tab-jira"]',
                '.grafana-sub-btn[data-sub="grafana-links"]']) {
                await page.locator(selector).click();
                assert(!await trigger.isVisible(), 'the Easter egg must remain limited to Grafana Debug');
                await page.locator('.tab-btn[data-tab="tab-grafana"]').click();
                await page.locator('.grafana-sub-btn[data-sub="grafana-debug"]').click();
                assert(await trigger.isVisible());
            }
            await page.close();
        }
        console.log('PASS popup restores the Easter egg twice, opens its window and limits it to Grafana Debug');
    } finally {
        await context?.close();
        fs.rmSync(profile, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
