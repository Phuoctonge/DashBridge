'use strict';
/* global document, innerWidth, getComputedStyle */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { resolveChromeExecutable, testBrowserNetworkArgs } = require('../scripts/setup-grafana-e2e-profile');

const root = path.resolve(__dirname, '..');
const sizes = [
    [1024, 768], [1280, 800], [1366, 768], [1440, 900],
    [1920, 1080], [2560, 1440], [3840, 2160], [7680, 4320]
];
const pages = [
    'pages/popup/popup.html', 'pages/options/options.html',
    'pages/dashbridge/dashbridge.html', 'pages/batch/batch.html',
    'pages/worklog/worklog.html', 'pages/recorder/recorder.html',
    'pages/confluence-report/confluence-report.html',
    'pages/test-runner/test-runner.html', 'pages/test-runner/test-selector.html',
    'pages/debug-easter-egg/debug-easter-egg.html'
];

function stageExtension(directory) {
    fs.mkdirSync(directory, { recursive: true });
    for (const entry of ['manifest.json', 'icons', 'js', 'pages', 'vendor']) {
        fs.cpSync(path.join(root, entry), path.join(directory, entry), { recursive: true });
    }
}

(async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-visual-'));
    const extension = path.join(temp, 'extension');
    stageExtension(extension);
    const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
        executablePath: resolveChromeExecutable(), headless: false,
        viewport: { width: 1280, height: 800 },
        args: [...testBrowserNetworkArgs, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    try {
        for (const [width, height] of sizes) {
            for (const relativePath of pages) {
                const page = await context.newPage();
                await page.setViewportSize({ width, height });
                await page.goto(`chrome-extension://${extensionId}/${relativePath}`, { waitUntil: 'load' });
                const geometry = await page.evaluate(() => ({
                    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
                    tableOverscroll: getComputedStyle(document.querySelector('.table-container') || document.body).overscrollBehaviorX,
                    tableScrollbar: getComputedStyle(document.querySelector('.table-container') || document.body).scrollbarGutter
                }));
                assert.equal(geometry.pageOverflow, false, `${relativePath} overflows at ${width}x${height}`);
                if (relativePath === 'pages/worklog/worklog.html') {
                    assert.equal(geometry.tableOverscroll, 'contain', 'Worklog table must contain horizontal overscroll');
                    assert.match(geometry.tableScrollbar, /stable/, 'Worklog table must reserve scrollbar space');
                }
                await page.close();
            }
        }
    } finally {
        await context.close();
    }
    console.log(`Desktop visual geometry passed: ${pages.length} pages × ${sizes.length} sizes`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
