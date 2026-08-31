'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const projectRoot = path.resolve(__dirname, '..');
const resultsRoot = path.join(projectRoot, 'test-results');
const reportPath = path.join(resultsRoot, 'extension-smoke.json');
const chromeExecutable = process.env.DASHBRIDGE_CHROME_PATH
    || chromium.executablePath();
const settleMs = Number.parseInt(process.env.DASHBRIDGE_SMOKE_SETTLE_MS || '1000', 10);

function findHtmlFiles(directory) {
    const found = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...findHtmlFiles(absolutePath));
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
            found.push(path.relative(projectRoot, absolutePath).replaceAll(path.sep, '/'));
        }
    }
    return found.sort();
}

function serializeError(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || null
    };
}

async function discoverExtensionId(context) {
    let workers = context.serviceWorkers();
    if (workers.length === 0) {
        try {
            await context.waitForEvent('serviceworker', { timeout: 10_000 });
        } catch {
            // The detailed error below includes the actual worker list.
        }
        workers = context.serviceWorkers();
    }

    const worker = workers.find(candidate => candidate.url().startsWith('chrome-extension://'));
    const match = worker?.url().match(/^chrome-extension:\/\/([^/]+)\//);
    if (!match) {
        throw new Error(`DashBridge service worker was not started. Workers: ${workers.map(item => item.url()).join(', ') || '(none)'}`);
    }
    return match[1];
}

async function inspectPage(context, extensionId, relativePath) {
    const url = `chrome-extension://${extensionId}/${relativePath}`;
    const result = {
        path: relativePath,
        url,
        finalUrl: null,
        title: null,
        console: [],
        pageErrors: [],
        failedRequests: [],
        status: 'passed'
    };
    const page = await context.newPage();

    page.on('console', message => {
        const type = message.type();
        if (type === 'error' || type === 'warning') {
            result.console.push({ type, text: message.text() });
        }
    });
    page.on('pageerror', error => result.pageErrors.push(serializeError(error)));
    page.on('requestfailed', request => {
        result.failedRequests.push({
            url: request.url(),
            method: request.method(),
            errorText: request.failure()?.errorText || 'unknown'
        });
    });

    try {
        await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
        await page.waitForTimeout(settleMs);
        if (!page.isClosed()) {
            result.finalUrl = page.url();
            result.title = await page.title();
        }
    } catch (error) {
        result.navigationError = serializeError(error);
    }

    const extensionRequestFailures = result.failedRequests.filter(item => (
        item.url.startsWith(`chrome-extension://${extensionId}/`)
    ));
    const externalRequestFailures = result.failedRequests.filter(item => (
        !item.url.startsWith(`chrome-extension://${extensionId}/`)
    ));
    const consoleErrors = result.console.filter(item => (
        item.type === 'error'
        && !(externalRequestFailures.length > 0 && item.text.startsWith('Failed to load resource:'))
    ));
    if (result.navigationError || result.pageErrors.length || consoleErrors.length || extensionRequestFailures.length) {
        result.status = 'failed';
        if (!page.isClosed()) {
            const screenshotName = relativePath.replace(/[^a-z0-9.-]+/gi, '_').replace(/\.html$/i, '.png');
            result.screenshot = `test-results/${screenshotName}`;
            await page.screenshot({ path: path.join(projectRoot, result.screenshot), fullPage: true });
        }
    }

    if (!page.isClosed()) await page.close();
    return result;
}

async function inspectTestSelectionWorkflow(context, extensionId) {
    const result = {
        name: 'test-runner scenario selection',
        status: 'passed',
        checks: []
    };
    const runner = await context.newPage();
    let selector = null;
    try {
        await runner.goto(`chrome-extension://${extensionId}/pages/test-runner/test-runner.html`, {
            waitUntil: 'load',
            timeout: 20_000
        });
        await runner.locator('#trSelectTestsBtn').waitFor({ state: 'visible' });
        const popupPromise = context.waitForEvent('page', { timeout: 10_000 });
        await runner.locator('#trSelectTestsBtn').click();
        selector = await popupPromise;
        await selector.waitForLoadState('load');
        await selector.locator('.selector-test').first().waitFor({ state: 'visible' });

        const total = await selector.locator('.selector-test').count();
        if (total < 1) throw new Error('Selector did not render any scenarios');
        result.checks.push({ check: 'catalog-rendered', total });

        await selector.locator('#selectorSearch').fill('Заливка графика');
        const searchMatches = await selector.locator('.selector-test').count();
        if (searchMatches < 1 || searchMatches >= total) {
            throw new Error(`Search did not narrow the catalog: ${searchMatches}/${total}`);
        }
        result.checks.push({ check: 'human-search', matches: searchMatches });

        await selector.locator('#selectorSearch').fill('');
        await selector.locator('[data-preset="failed"]').click();
        if (await selector.locator('#selectorApply').isEnabled()) {
            throw new Error('Empty last-failure preset must not be runnable');
        }
        result.checks.push({ check: 'empty-failure-preset-guard' });

        await selector.locator('[data-preset="all"]').click();
        const firstCheckbox = selector.locator('.selector-test input[type="checkbox"]').first();
        await firstCheckbox.uncheck();
        const expectedSelected = total - 1;
        const selectorClosePromise = selector.waitForEvent('close');
        await selector.locator('#selectorApply').click();
        await selectorClosePromise;
        selector = null;
        await runner.locator('#trSelectionSummary').waitFor({
            state: 'visible',
            timeout: 5_000
        });
        const summary = await runner.locator('#trSelectionSummary').textContent();
        if (!summary?.includes(`Выбрано: ${expectedSelected} из ${total}`)) {
            throw new Error(`Runner did not receive saved selection: ${summary}`);
        }
        result.checks.push({ check: 'selection-saved-and-received', selected: expectedSelected, total });
    } catch (error) {
        result.status = 'failed';
        result.error = serializeError(error);
        if (!runner.isClosed()) {
            result.screenshot = 'test-results/test_runner_selection_workflow.png';
            await runner.screenshot({ path: path.join(projectRoot, result.screenshot), fullPage: true });
        }
    } finally {
        if (selector && !selector.isClosed()) await selector.close();
        if (!runner.isClosed()) await runner.close();
    }
    return result;
}

async function main() {
    if (!fs.existsSync(chromeExecutable)) {
        throw new Error(`Chrome executable not found: ${chromeExecutable}`);
    }
    if (!Number.isFinite(settleMs) || settleMs < 0 || settleMs > 30_000) {
        throw new Error(`Invalid DASHBRIDGE_SMOKE_SETTLE_MS: ${process.env.DASHBRIDGE_SMOKE_SETTLE_MS}`);
    }

    fs.mkdirSync(resultsRoot, { recursive: true });
    const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-smoke-'));
    const startedAt = new Date().toISOString();
    let context;
    let report;
    let cleanupError;

    try {
        context = await chromium.launchPersistentContext(profileRoot, {
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

        const extensionId = await discoverExtensionId(context);
        const pages = [];
        for (const htmlPath of findHtmlFiles(path.join(projectRoot, 'pages'))) {
            pages.push(await inspectPage(context, extensionId, htmlPath));
        }
        const workflows = [await inspectTestSelectionWorkflow(context, extensionId)];

        report = {
            startedAt,
            completedAt: new Date().toISOString(),
            chromeExecutable,
            chromeVersion: await context.browser()?.version(),
            extensionId,
            pages,
            workflows,
            summary: {
                total: pages.length + workflows.length,
                passed: pages.filter(page => page.status === 'passed').length + workflows.filter(workflow => workflow.status === 'passed').length,
                failed: pages.filter(page => page.status === 'failed').length + workflows.filter(workflow => workflow.status === 'failed').length,
                consoleWarnings: pages.reduce((sum, page) => sum + page.console.filter(item => item.type === 'warning').length, 0),
                externalRequestFailures: pages.reduce((sum, page) => sum + page.failedRequests.filter(item => !item.url.startsWith(`chrome-extension://${extensionId}/`)).length, 0)
            }
        };
    } finally {
        if (context) {
            try {
                await context.close();
            } catch (error) {
                if (!/Target page, context or browser has been closed/.test(error.message)) cleanupError = error;
            }
        }
        try {
            fs.rmSync(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch (error) {
            cleanupError ||= error;
        }
    }

    if (cleanupError) throw cleanupError;
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Browser smoke: ${report.summary.passed}/${report.summary.total} pages passed.`);
    console.log(`Diagnostics: ${reportPath}`);
    if (report.summary.failed > 0) process.exitCode = 1;
}

main().catch(error => {
    fs.mkdirSync(resultsRoot, { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({
        startedAt: new Date().toISOString(),
        fatalError: serializeError(error)
    }, null, 2)}\n`, 'utf8');
    console.error(error.stack || error);
    process.exitCode = 1;
});
