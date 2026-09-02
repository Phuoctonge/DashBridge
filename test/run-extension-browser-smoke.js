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

async function inspectPanelUnitWorkflow(context) {
    const result = { name: 'panel threshold unit radios', status: 'passed', checks: [] };
    const page = await context.newPage();
    try {
        await page.setContent('<!doctype html><html><head></head><body></body></html>');
        await page.addScriptTag({ path: path.join(projectRoot, 'js/shared/grafana-panel-settings-modal.js') });
        await page.evaluate(() => {
            const modal = globalThis.DashBridgePanelSettingsModal;
            const state = {
                thresholdEnabled: true,
                thresholdValue: 0,
                seriesQueryFilterEnabled: true,
                seriesQueryFilterValue: 0
            };
            modal.open({
                state,
                content: `${modal.transformFields(state)}${modal.thresholdFields(state)}${modal.legendFields('', state)}`,
                advanced: {
                    getLegendSeries: async () => [],
                    getThresholdStatus: async () => ({ unit: 'mins', factor: 60_000, engine: 'uplot' })
                },
                onSave: saved => { globalThis.__savedPanelTools = saved; }
            });
        });
        const seriesUnits = page.locator('[data-unit-control="seriesQueryFilterInputUnit"] input');
        await seriesUnits.first().waitFor({ state: 'attached' });
        const labels = await seriesUnits.evaluateAll(inputs => inputs.map(input => input.value));
        if (JSON.stringify(labels) !== JSON.stringify(['ms', 's', 'min'])) {
            throw new Error(`Unexpected duration radios: ${labels.join(', ')}`);
        }
        result.checks.push({ check: 'duration-radio-set', labels });
        if (!await page.locator('[name="seriesQueryFilterInputUnit"][value="s"]').isChecked()
            || !await page.locator('[name="thresholdInputUnit"][value="s"]').isChecked()) {
            throw new Error('The middle duration unit was not selected by default');
        }
        await page.locator('.panel-series-filter-unit .panel-tools-unit-choice', { hasText: /^min$/ }).click();
        await page.locator('.panel-tools-reset-all').click();
        if (!await page.locator('[name="seriesQueryFilterInputUnit"][value="s"]').isChecked()
            || !await page.locator('[name="thresholdInputUnit"][value="s"]').isChecked()) {
            throw new Error('Reset All did not restore the recommended middle unit');
        }
        result.checks.push({ check: 'middle-default-and-reset' });
        await page.locator('[name="seriesQueryFilterEnabled"]').evaluate(input => input.click());
        await page.locator('[name="thresholdEnabled"]').evaluate(input => input.click());

        const filterLayout = await page.locator('[data-threshold="seriesQueryFilter"] .panel-tools-threshold-value')
            .evaluate(root => {
                const prompt = root.querySelector('.panel-tools-series-filter-prompt').getBoundingClientRect();
                const input = root.querySelector('[name="seriesQueryFilterValue"]').getBoundingClientRect();
                const thresholdInput = root.ownerDocument.querySelector('[name="thresholdValue"]').getBoundingClientRect();
                return { promptBottom: prompt.bottom, inputTop: input.top, inputWidth: input.width, thresholdWidth: thresholdInput.width };
            });
        if (filterLayout.inputTop < filterLayout.promptBottom) {
            throw new Error(`Series filter input was not moved below its prompt: ${JSON.stringify(filterLayout)}`);
        }
        if (Math.abs(filterLayout.inputWidth - filterLayout.thresholdWidth) > 0.5) {
            throw new Error(`Series and threshold fields have different widths: ${JSON.stringify(filterLayout)}`);
        }
        result.checks.push({ check: 'filter-value-on-second-row' });

        const seriesValue = page.locator('[name="seriesQueryFilterValue"]');
        await seriesValue.fill('2,5');
        await page.locator('.panel-series-filter-unit .panel-tools-unit-choice', { hasText: /^s$/ }).click();
        if (await seriesValue.inputValue() !== '2,5') throw new Error('Changing the series unit rewrote the entered number');

        const thresholdValue = page.locator('[name="thresholdValue"]');
        await thresholdValue.fill('3');
        await page.locator('.panel-threshold-unit .panel-tools-unit-choice', { hasText: /^min$/ }).click();
        if (await thresholdValue.inputValue() !== '3') throw new Error('Changing the threshold unit rewrote the entered number');
        await page.locator('.panel-tools-save').click();
        const saved = await page.evaluate(() => globalThis.__savedPanelTools);
        if (saved.seriesQueryFilterRawValue !== 2500 || saved.seriesQueryFilterInputUnit !== 's') {
            throw new Error(`Series value was saved incorrectly: ${JSON.stringify(saved)}`);
        }
        if (saved.thresholdRawValue !== 180_000 || saved.thresholdInputUnit !== 'min') {
            throw new Error(`Threshold value was saved incorrectly: ${JSON.stringify(saved)}`);
        }
        result.checks.push({ check: 'decimal-comma-kept-and-raw-converted', seriesRaw: 2500, thresholdRaw: 180_000 });

        await page.evaluate(() => {
            const modal = globalThis.DashBridgePanelSettingsModal;
            const state = { thresholdEnabled: true, seriesQueryFilterEnabled: true };
            modal.open({
                state,
                content: `${modal.transformFields(state)}${modal.thresholdFields(state)}${modal.legendFields('', state)}`,
                advanced: {
                    getLegendSeries: async () => [],
                    getThresholdStatus: async () => ({ unit: 'req/s', factor: 1, engine: 'uplot' })
                },
                onSave: () => {}
            });
        });
        await page.locator('.panel-tools-unit-static').first().waitFor({ state: 'visible' });
        if (await page.locator('.panel-tools-unit-options input').count() !== 0) {
            throw new Error('A fixed unknown unit was rendered as a non-actionable radio');
        }
        result.checks.push({ check: 'unknown-unit-is-static' });
    } catch (error) {
        result.status = 'failed';
        result.error = serializeError(error);
    } finally {
        if (!page.isClosed()) await page.close();
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
        const workflows = [
            await inspectTestSelectionWorkflow(context, extensionId),
            await inspectPanelUnitWorkflow(context)
        ];

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
