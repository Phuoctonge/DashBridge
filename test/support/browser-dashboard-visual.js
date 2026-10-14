'use strict';
/* global chrome, document, window, panels, profiles, savePanels, createProfile, switchProfile */
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function inspectDashboardVisual(context, extensionId) {
    const page = await context.newPage();
    const result = { name: 'DashBridge message editor visual and draft regression', status: 'passed', checks: [], screenshots: [] };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const snapshot = async name => {
        const file = path.resolve(`test-results/dashboard-${name}.png`);
        await page.screenshot({ path: file, animations: 'disabled' }); result.screenshots.push(file);
    };
    try {
        await page.goto(`chrome-extension://${extensionId}/pages/dashbridge/dashbridge.html`);
        await page.evaluate(async () => {
            const profile = { id: 'visual-audit', name: 'Проверка нагрузки', report: {
                template: '{{profileName}}\n{{testName}} · {{environment}}\n{{panels}}',
                context: { testName: 'Проверка оплаты', environment: 'Stage' },
            }, panels: ['CPU', 'RAM', 'Load Average'].map((title, index) => ({
                id: `visual-${index}`, title, paused: true, src: `https://visual.test/d-solo/test/a?panelId=${index + 1}`,
                width: '50%', height: '350px', report: { enabled: true, includeMode: 'issue_only', detailsEnabled: false,
                    sla: { source: 'custom', value: 80, warningValue: 70, unit: '%' } },
            })) };
            await chrome.storage.local.set({ dashbridge_profiles: [profile], dashbridge_activeProfileId: profile.id });
        });
        await page.reload();
        await page.locator('#profilePickerLabel').filter({ hasText: 'Проверка нагрузки' }).waitFor();
        await page.locator('#reportMenuBtn').click();
        await page.locator('#reportDropdown').waitFor({ state: 'visible' });
        await page.locator('#configureReportBtn').click();
        for (const theme of ['light', 'dark']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
            for (const width of [1440, 900, 600]) {
                await page.setViewportSize({ width, height: 900 });
                const fits = await page.locator('.report-settings-modal').evaluate(node => {
                    const rect = node.getBoundingClientRect();
                    return rect.left >= 0 && rect.right <= window.innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1;
                });
                assert(fits, `settings overflow at ${theme}/${width}`);
                await snapshot(`settings-${theme}-${width}`);
            }
        }
        await page.setViewportSize({ width: 1200, height: 900 });
        await page.locator('.report-open-panel-editor').first().click();
        await page.locator('.report-editor-advanced > summary').click();
        assert.equal(await page.locator('.report-editor-include-mode').inputValue(), 'issue_only');
        await page.locator('.report-editor-list-limit').fill('5');
        for (const theme of ['light', 'dark']) {
            await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
            for (const width of [1200, 600]) {
                await page.setViewportSize({ width, height: 900 });
                assert(await page.locator('.report-panel-editor-modal').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
                await page.locator('.report-list-limit-setting').scrollIntoViewIfNeeded();
                await snapshot(`editor-${theme}-${width}`);
            }
        }
        await page.setViewportSize({ width: 1200, height: 900 });
        await page.locator('.report-editor-warning-value').fill('90');
        await page.locator('.report-panel-editor-save').click();
        await page.locator('.report-panel-editor-error').filter({ hasText: 'раньше' }).waitFor();
        await snapshot('sla-invalid');
        await page.locator('.report-editor-warning-value').fill('70');
        await page.locator('.report-editor-breached').fill('CPU превышен: {{aggregateValue}}');
        await page.locator('.report-panel-editor-save').click();
        await page.locator('.report-panel-editor-overlay').waitFor({ state: 'detached' });
        const template = page.locator('.report-profile-template');
        await template.evaluate(node => { node.closest('details').open = true; });
        await template.fill('{{profileName}}\n{{testName}} · {{environment}}\n{{panels}}');
        await page.locator('.report-save').click();
        await page.locator('.report-settings-overlay').waitFor({ state: 'detached' });
        await page.reload();
        const saved = await page.evaluate(async () => {
            const profiles = (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles;
            return profiles.find(profile => profile.id === 'visual-audit') || profiles[0];
        });
        assert.equal(saved.panels[0].report.templates.breached, 'CPU превышен: {{aggregateValue}}');
        assert.equal(saved.panels[0].report.sla.unit, '%');
        assert.equal(saved.panels[0].report.includeMode, 'issue_only');
        assert.equal(saved.panels[0].report.listLimit, 5);
        assert.equal(saved.panels[0].report.detailsEnabled, false);
        result.checks.push('real menu/editor, invalid SLA, panel phrase and profile template persist through storage and reload; six theme/viewport screenshots');
        const openPreview = async () => {
            await page.locator('#reportMenuBtn').click(); await page.locator('#generateReportBtn').click();
            await page.locator('#reportImagesTab').click();
        };
        await openPreview();
        await page.evaluate(() => chrome.storage.onChanged.addListener(changes => {
            if (changes.dashbridge_profiles) window.preferencesStorageDiff = {
                before: JSON.stringify(profiles), after: JSON.stringify(changes.dashbridge_profiles.newValue)
            };
        }));
        await page.locator('.attachment-sla').uncheck();
        assert.equal(await page.locator('.attachment-heading').count(), 0);
        await page.locator('.attachment-layout').selectOption('column');
        await page.locator('.attachment-none').click();
        await page.waitForFunction(async () => {
            const saved = (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles.find(profile => profile.id === 'visual-audit').report.attachments;
            return saved?.slaOnly === false && saved.heading === false && saved.layout === 'column' && saved.selectedIds?.length === 0;
        });
        assert(await page.locator('.report-preview-modal').isVisible(), 'saving preferences must not close the preview');
        await page.locator('.report-close').click();
        await page.reload(); await openPreview();
        assert.equal(await page.locator('.attachment-sla').isChecked(), false);
        assert.equal(await page.locator('.attachment-heading').count(), 0);
        assert.equal(await page.locator('.attachment-layout').inputValue(), 'column');
        await page.locator('.report-close').click();
        await page.locator('#reportMenuBtn').click(); await page.locator('#configureReportBtn').click();
        await page.locator('.report-save').click();
        await page.locator('.report-settings-overlay').waitFor({ state: 'detached' });
        const retained = await page.evaluate(async () => (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles.find(profile => profile.id === 'visual-audit').report.attachments);
        assert.equal(retained.slaOnly, false, 'saving the text template must preserve screenshot preferences');
        await page.route('https://visual.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Test panel</body></html>' }));
        await page.evaluate(async () => {
            panels.forEach(panel => { panel.paused = false; panel.report.enabled = false; });
            await savePanels();
        });
        await openPreview();
        await page.locator('.attachment-panel-row .attachment-select').nth(1).check();
        await page.locator('.attachment-panel-row .attachment-select').nth(2).check();
        await page.locator('.attachment-panel-row').nth(2).locator('.attachment-drag')
            .dragTo(page.locator('.attachment-panel-row').first());
        await page.waitForFunction(async () => {
            const saved = (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles.find(profile => profile.id === 'visual-audit').report.attachments;
            return saved.selectedIds?.length === 2 && saved.panelOrder[0] === 'visual-2';
        });
        await page.locator('.report-close').click(); await page.reload(); await openPreview();
        assert.equal(await page.locator('.attachment-panel-row .attachment-select:checked').count(), 2);
        assert.equal(await page.locator('.attachment-panel-row').first().getAttribute('data-panel-id'), 'visual-2');
        await page.locator('.report-close').click();
        await page.evaluate(() => createProfile('Другой профиль'));
        await openPreview();
        assert.equal(await page.locator('.attachment-sla').isChecked(), true);
        assert.equal(await page.locator('.attachment-heading').count(), 0);
        assert.equal(await page.locator('.attachment-layout').inputValue(), 'auto');
        await page.locator('.report-close').click();
        await page.evaluate(() => switchProfile('visual-audit'));
        await openPreview();
        assert.equal(await page.locator('.attachment-panel-row .attachment-select:checked').count(), 2);
        await page.locator('.report-close').click();
        // The following draft-generation fixture uses an enabled reporting panel.
        await page.evaluate(async () => { panels[0].report.enabled = true; panels[0].paused = true; await savePanels(); });
        result.checks.push('screenshot SLA/heading/layout/empty selection persist through broker, close/reload and text settings save');
        result.checks.push('manual panel selection and drag order survive reload and profile switching; another profile keeps its own defaults');
        await page.evaluate(async () => {
            const profile = (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles.find(item => item.id === 'visual-audit');
            const state = { release: null, value: 91 };
            window.messageVisualFixture = state;
            const owner = window.DashBridgeReportController.create({
                reportEngine: window.DashBridgeReport,
                transportFactory: { create: () => ({ throwIfAborted(signal) { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); },
                    requestPanelSnapshot: async () => {
                        await new Promise(resolve => { state.release = resolve; });
                        return { state: 'critical', aggregateValue: state.value, series: [{ name: 'server-1', value: state.value, max: state.value, last: state.value }] };
                    } }) },
                testRunnerFactory: { create: () => ({}) }, auditEngine: {}, forceLoadPanel() {}, postToDashboardFrame() {},
                getPanels: () => [profile.panels[0]], getActiveProfile: () => profile,
                getTimeContext: () => ({ from: 'now-1h', to: 'now' }),
            });
            owner.openPreview();
        });
        assert(await page.locator('.report-copy').isDisabled(), 'empty pending output cannot be copied');
        await page.locator('.report-preview-output').fill('Мой черновик во время загрузки');
        await snapshot('text-loading');
        await page.evaluate(() => window.messageVisualFixture.release());
        await page.locator('.report-generated-draft').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.report-preview-output').inputValue(), 'Мой черновик во время загрузки');
        await page.locator('.report-generated-draft summary').click();
        await snapshot('text-preserved');
        await page.locator('.report-apply-generated').click();
        assert.match(await page.locator('.report-preview-output').inputValue(), /Проверка оплаты.*Stage/);
        await page.locator('.report-preview-output').fill('Ручная правка после генерации');
        await page.locator('.report-regenerate').click();
        await page.evaluate(() => window.messageVisualFixture.release());
        await page.locator('.report-generated-draft').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.report-preview-output').inputValue(), 'Ручная правка после генерации');
        result.checks.push('slow initial generation and refresh preserve manual text; generated candidate requires explicit apply; empty copy disabled');
        await page.locator('.report-close').click();
        await page.evaluate(() => {
            const panel = { ...panels[0], paused: false, tools: { thresholdEnabled: false },
                report: { enabled: true, sla: { source: 'graph' } } };
            const baseline = JSON.stringify(panel);
            const owner = window.DashBridgeReportController.create({
                reportEngine: window.DashBridgeReport, transportFactory: window.DashBridgeReportTransport,
                testRunnerFactory: window.DashBridgeReportTestRunner, auditEngine: window.DashBridgeReportAudit,
                forceLoadPanel() { throw new Error('Invalid SLA must be caught before loading Grafana'); },
                postToDashboardFrame() { throw new Error('Invalid SLA must not send a frame request'); },
                getPanels: () => [panel], getActiveProfile: () => ({ name: 'Report warning', report: {} }),
                getTimeContext: () => ({ from: 'now-1h', to: 'now' }),
            });
            window.reportWarningFixture = { owner, panel, baseline };
            const wrapper = document.querySelector(`.panel-card[data-panel-id="${panel.id}"] .iframe-wrapper`);
            if (!wrapper) throw new Error('The report warning fixture requires a real dashboard card');
            owner.setPanelDataStatus(panel, { dataStatus: 'timeout', error: 'Previous loading error' });
            if (!wrapper.querySelector('.dashbridge-panel-data-status')) throw new Error('Loading error overlay must be visible before the check');
            owner.testRunner.open();
        });
        await page.locator('.report-audit-status').filter({ hasText: 'Проверка завершена:' }).waitFor();
        const problem = page.locator('.report-runner-problem').filter({ hasText: 'Проверка сообщения: CPU' });
        assert.equal(await problem.count(), 1);
        assert.match(await problem.textContent(), /Собственный SLA/);
        assert.equal(await page.locator('.dashbridge-panel-data-status').count(), 0);
        await snapshot('report-configuration-warning');
        await page.locator('.report-audit-close').click();
        await page.evaluate(() => window.reportWarningFixture.owner.openPreview());
        await page.locator('.report-preview-warnings').waitFor({ state: 'visible' });
        assert.match(await page.locator('.report-preview-warnings').textContent(), /Настройки сообщения — CPU:.*порог графика/);
        assert.equal(await page.locator('.dashbridge-panel-data-status').count(), 0);
        assert(await page.evaluate(() => JSON.stringify(window.reportWarningFixture.panel) === window.reportWarningFixture.baseline));
        await snapshot('report-preview-warning');
        await page.locator('.report-close').click();
        result.checks.push('disabled graph SLA stays visible in report check and preview with recovery guidance, without graph overlay or settings mutation');
        assert.deepEqual(errors, []);
    } catch (error) { result.status = 'failed'; result.error = error.stack || String(error); result.storageDiff = await page.evaluate(() => window.preferencesStorageDiff).catch(() => null); await snapshot('failure').catch(() => {}); }
    finally { await page.close(); }
    return result;
};

