'use strict';
/* global chrome, document, DataTransfer, File, ClipboardEvent */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { resolveChromeExecutable } = require('../scripts/setup-grafana-e2e-profile');
const inspectReportCollage = require('./support/browser-report-collage');
const inspectGrafanaConnection = require('./support/browser-grafana-connection');
const inspectFrameStartup = require('./support/browser-frame-startup');
const inspectAuditFixes = require('./support/browser-audit-fixes');
const inspectDashboardVisual = require('./support/browser-dashboard-visual');
const inspectRuntimePortScope = require('./support/browser-runtime-port-scope');
const inspectConfluenceTarget = require('./support/browser-confluence-target');
const inspectIframeSettings = require('./dashbridge_iframe_settings_browser.cjs');
const inspectWorklogUi = require('./support/browser-worklog-ui');

const projectRoot = path.resolve(__dirname, '..');
const resultsRoot = path.join(projectRoot, 'test-results');
const reportPath = path.join(resultsRoot, 'extension-smoke.json');
const chromeExecutable = resolveChromeExecutable();
const settleMs = Number.parseInt(process.env.DASHBRIDGE_SMOKE_SETTLE_MS || '1000', 10);
const extensionEntries = Object.freeze(['manifest.json', 'icons', 'js', 'pages', 'vendor']);

function stageExtension(directory, analyticsEndpoint) {
    fs.mkdirSync(directory, { recursive: true });
    for (const entry of extensionEntries) {
        fs.cpSync(path.join(projectRoot, entry), path.join(directory, entry), { recursive: true });
    }
    const configPath = path.join(directory, 'js', 'shared', 'analytics-config.js');
    const source = fs.readFileSync(configPath, 'utf8');
    const staged = source.replace(/endpoint:\s*'[^']*'/,
        `endpoint: '${analyticsEndpoint}'`);
    if (staged === source) throw new Error('Could not redirect the staged analytics endpoint');
    fs.writeFileSync(configPath, staged, 'utf8');
}

async function startAnalyticsSink() {
    const requests = [];
    const server = http.createServer((request, response) => {
        if (request.method === 'GET' && request.url.startsWith('/fixture/')) {
            response.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY',
                'content-security-policy': "frame-ancestors 'none'" });
            response.end('<html><body>boundary fixture</body></html>'); return;
        }
        if (request.method === 'OPTIONS') {
            response.writeHead(204, {
                'access-control-allow-origin': '*',
                'access-control-allow-methods': 'POST, OPTIONS',
                'access-control-allow-headers': 'content-type'
            });
            response.end(); return;
        }
        if (request.method !== 'POST' || request.url !== '/v1/events/batch') {
            response.writeHead(404); response.end(); return;
        }
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => {
            body += chunk;
            if (body.length > 1_000_000) request.destroy();
        });
        request.on('end', () => {
            requests.push(body);
            response.writeHead(202, {
                'access-control-allow-origin': '*',
                'content-type': 'application/json; charset=utf-8'
            });
            response.end('{"ok":true}');
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return {
        endpoint: `http://127.0.0.1:${address.port}/v1/events/batch`, requests,
        close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    };
}

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
    if (relativePath === 'pages/popup/popup.html') {
        // Startup smoke is local; release validation is covered separately.
        // Do not let a live GitHub rate limit turn a healthy popup into a failure.
        const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8')).version;
        const releaseUrl = `https://github.com/Phuoctonge/DashBridge/releases/download/v${version}/`;
        await page.route('https://api.github.com/repos/Phuoctonge/DashBridge/releases/latest', route => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                tag_name: `v${version}`, draft: false, prerelease: false,
                html_url: `https://github.com/Phuoctonge/DashBridge/releases/tag/v${version}`,
                assets: [
                    { name: `DashBridge-${version}.zip`, browser_download_url: `${releaseUrl}DashBridge-${version}.zip` },
                    { name: 'Install-DashBridge.ps1', browser_download_url: `${releaseUrl}Install-DashBridge.ps1` },
                ],
            }),
        }));
    }
    const isWorklog = relativePath === 'pages/worklog/worklog.html';
    let worklogAuthRequests = 0;
    const worklogDisplayName = 'Local smoke user';
    if (isWorklog) {
        // Install before navigation: only the startup read is local; Jira writes are not intercepted.
        await page.route('https://jira.lanit.ru/rest/api/2/myself', async route => {
            const request = route.request();
            const target = new URL(request.url());
            if (request.method() !== 'GET' || target.origin !== 'https://jira.lanit.ru'
                || target.pathname !== '/rest/api/2/myself' || target.search || target.hash) {
                await route.continue(); return;
            }
            worklogAuthRequests++;
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ displayName: worklogDisplayName }) });
        });
    }

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
        if (relativePath === 'pages/dashbridge/dashbridge.html') {
            // The temporary smoke profile owns this fixture. External sample iframes can
            // asynchronously take native focus; local modal checks must not race live sites.
            const worker = context.serviceWorkers().find(candidate => candidate.url().startsWith(`chrome-extension://${extensionId}/`));
            await worker.evaluate(async () => {
                const profile = { id: 'local-modal-smoke', name: 'Local modal smoke', panels: [{
                    id: 'local-paused-panel', title: 'Paused smoke panel', paused: true,
                    src: 'https://smoke.invalid/d-solo/local/panel?panelId=1', width: '50%', height: '350px'
                }] };
                await chrome.storage.local.set({ dashbridge_profiles: [profile], dashbridge_activeProfileId: profile.id });
            });
        }
        await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
        await page.waitForTimeout(settleMs);
        if (isWorklog) {
            await page.waitForFunction(name => document.getElementById('authText')?.textContent
                === `Авторизован: ${name}` && document.getElementById('authDot')?.classList.contains('auth-ok'),
            worklogDisplayName);
            if (worklogAuthRequests !== 1) throw new Error(`Worklog startup auth fixture consumed ${worklogAuthRequests} times`);
            result.authFixture = { requests: worklogAuthRequests,
                text: await page.locator('#authText').textContent(),
                dot: await page.locator('#authDot').getAttribute('class') };
        }
        if (!page.isClosed()) {
            result.finalUrl = page.url();
            result.title = await page.title();
            const isDashboard = relativePath === 'pages/dashbridge/dashbridge.html';
            const isPopup = relativePath === 'pages/popup/popup.html';
            if (isDashboard) {
                await page.locator('#profilePickerLabel').filter({ hasText: 'Local modal smoke' }).waitFor();
                if (await page.locator('#dashboard iframe').count() !== 0) {
                    throw new Error('Paused local modal fixture unexpectedly created an iframe');
                }
                const timeSnapshot = () => page.evaluate(async () => JSON.stringify({
                    profiles: (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles,
                    history: globalThis.localStorage.getItem('dashbridge.timepicker.history'),
                }));
                const beforeInvalidTime = await timeSnapshot();
                await page.locator('#timePickerBtn').click();
                for (const invalid of ['2026-02-30 12:00:00', '2026-02-29 12:00:00', '2026-04-31 12:00:00']) {
                    await page.locator('#absTimeFrom').fill(invalid);
                    await page.locator('#absTimeTo').fill('2026-05-03 12:00:00');
                    await page.locator('#applyAbsoluteTime').click();
                    await page.locator('#timeRangeError').waitFor({ state: 'visible' });
                    if (await timeSnapshot() !== beforeInvalidTime) throw new Error('Invalid date changed profile or time history');
                }
                await page.locator('#absTimeFrom').fill('2024-02-29 12:00:00');
                await page.locator('#absTimeTo').fill('2024-03-01 12:00:00');
                await page.locator('#applyAbsoluteTime').click();
                await page.waitForFunction(async () => {
                    const stored = await chrome.storage.local.get('dashbridge_profiles');
                    return stored.dashbridge_profiles?.[0]?.timeState?.from === String(new Date(2024, 1, 29, 12).getTime());
                });
                result.calendarInput = 'impossible dates rejected without persistence; valid leap date saved';
                await page.locator('#profilePickerBtn').click();
                await page.locator('#cloneProfileBtn').click();
                await page.locator('.modal-input').fill('Playwright profile copy');
                await page.locator('.modal-input').press('Enter');
                await page.waitForFunction(() => document.getElementById('profilePickerLabel').textContent === 'Playwright profile copy');
                await page.waitForFunction(async () => {
                    const stored = await chrome.storage.local.get('dashbridge_profiles');
                    return stored.dashbridge_profiles?.some(profile => profile.name === 'Playwright profile copy');
                });
                await page.reload();
                await page.waitForFunction(() => document.getElementById('profilePickerLabel').textContent === 'Playwright profile copy');
            }
            if (isDashboard) {
                for (const action of ['Escape', 'backdrop', 'cancel', 'replace', 'create']) {
                    await page.locator('#addPanelBtn').focus();
                    await page.evaluate(() => {
                        globalThis.importChoiceResult = 'pending';
                        void globalThis.DashBridgeModal.showImportChoice('Проверка импорта').then(value => {
                            globalThis.importChoiceResult = value;
                        });
                    });
                    const choiceModal = page.locator('.modal-overlay').filter({ has: page.locator('.modal-create') });
                    if (action === 'Escape') await page.keyboard.press('Escape');
                    else if (action === 'backdrop') await choiceModal.click({ position: { x: 2, y: 2 } });
                    else await choiceModal.locator(action === 'replace' ? '.modal-ok'
                        : action === 'create' ? '.modal-create' : '.modal-cancel').click();
                    await choiceModal.waitFor({ state: 'detached' });
                    const selected = await page.evaluate(() => globalThis.importChoiceResult);
                    const expected = ['replace', 'create'].includes(action) ? action : null;
                    if (selected !== expected) throw new Error(`Import choice ${action} returned ${selected}`);
                    if (!await page.locator('#addPanelBtn').evaluate(element => element === document.activeElement)) {
                        throw new Error('Import choice did not restore focus');
                    }
                }
            }
            if (relativePath === 'pages/debug-easter-egg/debug-easter-egg.html') {
                const pasted = await page.evaluate(async () => {
                    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
                    canvas.getContext('2d').fillRect(0, 0, 64, 48);
                    const blob = await new Promise(resolve => canvas.toBlob(resolve));
                    const data = new DataTransfer(); data.items.add(new File([blob], 'clipboard', { type: 'image/png' }));
                    const event = new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true });
                    document.dispatchEvent(event);
                    return event.defaultPrevented;
                });
                if (!pasted) throw new Error('Image paste was not handled');
                await page.waitForFunction(() => document.getElementById('debugEasterEggPortrait').naturalWidth === 64);
                const textHandled = await page.evaluate(() => {
                    const data = new DataTransfer(); data.setData('text/plain', 'ordinary text');
                    const event = new ClipboardEvent('paste', { clipboardData: data, cancelable: true });
                    document.dispatchEvent(event); return event.defaultPrevented;
                });
                if (textHandled) throw new Error('Ordinary text paste must remain native');
            }
            if (isDashboard || isPopup) {
                if (isPopup) await page.locator('[data-sub="grafana-links"]').click();
                const opener = isDashboard ? '#addPanelBtn' : '#openAddModal';
                await page.locator(opener).click();
                const modal = page.locator('#modalOverlay');
                await modal.waitFor({ state: 'visible' });
                await page.waitForFunction(() => document.getElementById('modalOverlay').contains(document.activeElement));
                for (const key of ['Tab', 'Shift+Tab']) {
                    for (let index = 0; index < 12; index++) {
                        await page.keyboard.press(key);
                        if (!await modal.evaluate(element => element.contains(document.activeElement))) {
                            const focus = await page.evaluate(() => {
                                const active = document.activeElement;
                                return { readyState: document.readyState, hasFocus: document.hasFocus(),
                                    tag: active?.tagName, id: active?.id,
                                    nativeIframe: active?.tagName === 'IFRAME',
                                    modalVisible: document.getElementById('modalOverlay')?.getClientRects().length > 0 };
                            });
                            throw new Error(`${key} escaped the modal at step ${index}: ${JSON.stringify(focus)}`);
                        }
                    }
                }
                if (isDashboard) {
                    await page.evaluate(() => { void globalThis.DashBridgeModal.showAlert('Nested smoke check'); });
                    await page.keyboard.press('Escape');
                    if (!await modal.isVisible()) throw new Error('Escape closed the parent with the child');
                }
                await page.keyboard.press('Escape');
                await modal.waitFor({ state: 'hidden' });
                if (!await page.locator(opener).evaluate(element => element === document.activeElement)) {
                    throw new Error('Modal did not restore opener focus');
                }
            }
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
        await runner.locator('#trSelectTestsBtn').click();
        selector = runner;
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
        await selector.locator('#selectorApply').click();
        await selector.locator('#testSelectorDialog').waitFor({ state: 'hidden' });
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
        if (selector && selector !== runner && !selector.isClosed()) await selector.close();
        if (!runner.isClosed()) await runner.close();
    }
    return result;
}

async function inspectNoDataWorkflow(context) {
    const result = { name: 'native No data lifecycle', status: 'passed' };
    const page = await context.newPage();
    try {
        await page.setContent('<main id="panel"></main><aside id="other"><p>No data</p></aside>');
        await page.addScriptTag({ path: path.join(projectRoot, 'js/content/grafana-dom.js') });
        await page.evaluate(() => {
            globalThis.noDataProbe = globalThis.DashBridgeGrafanaDom.createNativeNoDataVisibility();
            globalThis.noDataProbe.update(() => document.getElementById('panel'));
            document.getElementById('panel').innerHTML = '<p id="native" style="visibility:visible!important">No <span>data</span></p>';
        });
        await page.locator('#native').waitFor({ state: 'hidden' });
        if (!await page.locator('#other p').isVisible()) throw new Error('Unrelated panel was hidden');
        await page.evaluate(() => { document.getElementById('native').textContent = 'Returned data'; });
        await page.locator('#native').waitFor({ state: 'visible' });
        await page.evaluate(() => { document.getElementById('native').firstChild.data = 'No data'; });
        await page.locator('#native').waitFor({ state: 'hidden' });
        await page.evaluate(() => {
            const old = document.getElementById('panel');
            const next = document.createElement('main'); next.id = 'panel';
            next.innerHTML = '<div id="replacement">No data</div><button>No data</button>';
            old.replaceWith(next);
        });
        await page.locator('#replacement').waitFor({ state: 'hidden' });
        if (!await page.locator('#panel button').isVisible()) throw new Error('Interactive control was hidden');
        await page.evaluate(() => globalThis.noDataProbe.stop());
        await page.locator('#replacement').waitFor({ state: 'visible' });
        await page.evaluate(() => {
            globalThis.noDataProbe.update(() => document.getElementById('panel'));
            globalThis.noDataProbe.stop();
            document.getElementById('replacement').textContent = 'No data';
        });
        await page.waitForTimeout(100);
        if (!await page.locator('#replacement').isVisible()) throw new Error('Cleanup left observer/RAF active');
    } catch (error) {
        result.status = 'failed'; result.error = serializeError(error);
    } finally { await page.close(); }
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

async function inspectSecurityBoundaries(context, extensionId, endpoint) {
    const result = { name: 'DNR navigation and capture tab isolation', status: 'passed', checks: [] };
    const dashboard = await context.newPage();
    const control = await context.newPage();
    const base = new URL(endpoint).origin;
    try {
        await control.goto(`chrome-extension://${extensionId}/pages/options/options.html`);
        await control.evaluate(async host => chrome.storage.sync.set({ grafanaIframeDomains: [host] }), new URL(base).host);
        const dashboardUrl = `chrome-extension://${extensionId}/pages/dashbridge/dashbridge.html`;
        await dashboard.goto(dashboardUrl);
        await dashboard.evaluate(() => chrome.runtime.sendMessage({ type: 'dashbridge-ensure-iframe-rules' }));
        await dashboard.evaluate(base => {
            const frame = document.createElement('iframe'); frame.id = 'boundary-test-frame';
            frame.src = `${base}/fixture/protected`; document.body.append(frame);
        }, base);
        await dashboard.frameLocator('#boundary-test-frame').getByText('boundary fixture', { exact: true }).waitFor();
        result.checks.push('configured iframe loads with initiator guard');
        await control.bringToFront();
        const denied = await dashboard.evaluate(() => chrome.runtime.sendMessage({ type: 'dashbridge-capture-visible-tab' }));
        if (denied.ok || denied.error !== 'capture-target-changed') throw new Error('Inactive capture was not rejected');
        await dashboard.bringToFront();
        const captured = await dashboard.evaluate(() => chrome.runtime.sendMessage({ type: 'dashbridge-capture-visible-tab' }));
        if (!captured.ok || !captured.dataUrl.startsWith('data:image/png')) throw new Error('Active capture failed');
        result.checks.push('inactive capture rejects; active capture succeeds');
        await dashboard.goto(`${base}/fixture/unrelated`);
        await control.waitForFunction(async () => (await chrome.declarativeNetRequest.getSessionRules()).length === 0);
        await dashboard.evaluate(base => {
            const frame = document.createElement('iframe'); frame.id = 'boundary-test-frame';
            frame.src = `${base}/fixture/protected`; document.body.append(frame);
        }, base);
        await dashboard.waitForTimeout(300);
        const leaked = await dashboard.evaluate(() => {
            try { return document.querySelector('iframe')?.contentDocument?.body?.textContent === 'boundary fixture'; }
            catch { return false; }
        });
        if (leaked) throw new Error('DNR escaped extension navigation scope');
        result.checks.push('navigation removes rules and protected website iframe remains blocked');
    } catch (error) {
        result.status = 'failed'; result.error = serializeError(error);
    } finally {
        await dashboard.close(); await control.close();
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
    const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-smoke-'));
    const profileRoot = path.join(smokeRoot, 'profile');
    const extensionRoot = path.join(smokeRoot, 'extension');
    const startedAt = new Date().toISOString();
    let context;
    let analyticsSink;
    let report;
    let cleanupError;

    try {
        analyticsSink = await startAnalyticsSink();
        stageExtension(extensionRoot, analyticsSink.endpoint);
        context = await chromium.launchPersistentContext(profileRoot, {
            executablePath: chromeExecutable,
            headless: false,
            viewport: { width: 1280, height: 900 },
            args: [
                `--disable-extensions-except=${extensionRoot}`,
                `--load-extension=${extensionRoot}`,
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
            await inspectWorklogUi(context, extensionId),
            await inspectGrafanaConnection(context, extensionId, analyticsSink.endpoint),
            await inspectFrameStartup(context, extensionId, analyticsSink.endpoint),
            await inspectReportCollage(context, extensionId),
            await inspectAuditFixes(context, extensionId),
            await inspectDashboardVisual(context, extensionId),
            await inspectConfluenceTarget(context, extensionId),
            await inspectConfluenceTarget(context, extensionId, { corruptVerification: true }),
            await inspectTestSelectionWorkflow(context, extensionId),
            await inspectPanelUnitWorkflow(context),
            await inspectNoDataWorkflow(context),
            await inspectSecurityBoundaries(context, extensionId, analyticsSink.endpoint),
            await inspectRuntimePortScope(context, extensionId),
            await inspectIframeSettings(chromeExecutable)
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
                externalRequestFailures: pages.reduce((sum, page) => sum + page.failedRequests.filter(item => !item.url.startsWith(`chrome-extension://${extensionId}/`)).length, 0),
                localAnalyticsRequests: analyticsSink.requests.length
            }
        };
        if (analyticsSink.requests.length < 1) {
            throw new Error('Browser smoke did not exercise the loopback analytics sink');
        }
    } finally {
        if (context) {
            try {
                await context.close();
            } catch (error) {
                if (!/Target page, context or browser has been closed/.test(error.message)) cleanupError = error;
            }
        }
        if (analyticsSink) {
            try {
                await analyticsSink.close();
            } catch (error) {
                cleanupError ||= error;
            }
        }
        try {
            fs.rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
