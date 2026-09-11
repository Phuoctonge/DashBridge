'use strict';
/* global chrome, document, window */
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function inspectGrafanaConnection(context, extensionId, endpoint) {
    const page = await context.newPage();
    const result = { name: 'grafana-connection-and-report-context', status: 'passed', checks: [] };
    try {
        const origin = new URL(endpoint).origin;
        const host = new URL(endpoint).host;
        await page.goto(`chrome-extension://${extensionId}/pages/dashbridge/dashbridge.html`);
        await page.waitForFunction(() => document.getElementById('profilePickerLabel').textContent.trim());
        await page.evaluate(() => chrome.storage.sync.set({ grafanaIframeDomains: [] }));
        const initialCount = await page.locator('.panel-card').count();
        await page.locator('#addPanelBtn').click();
        await page.locator('#newPanelUrl').fill(`${origin}/fixture/d-solo/uid/name?panelId=1`);
        await page.locator('#savePanelBtn').click();
        const confirmation = page.locator('.modal-overlay').filter({ has: page.locator('.modal-cancel') });
        await confirmation.waitFor();
        assert((await confirmation.textContent()).includes(host));
        await page.screenshot({ path: path.resolve('test-results/grafana-connection-confirmation.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await confirmation.waitFor({ state: 'detached' });
        assert.equal(await page.locator('.panel-card').count(), initialCount);
        assert.deepEqual(await page.evaluate(async () => (await chrome.storage.sync.get('grafanaIframeDomains')).grafanaIframeDomains), []);
        await page.locator('#savePanelBtn').click();
        await confirmation.locator('.modal-ok').click();
        await page.locator('#modalOverlay').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.panel-card').count(), initialCount + 1);
        assert.deepEqual(await page.evaluate(async () => (await chrome.storage.sync.get('grafanaIframeDomains')).grafanaIframeDomains), [host]);
        // The fixture sends XFO DENY and frame-ancestors none: loading proves DNR was ready before navigation.
        await page.frameLocator('.panel-card iframe').last().locator('body').filter({ hasText: 'boundary fixture' }).waitFor();
        result.checks.push('Escape preserves settings and panels; confirm saves host and loads an XFO/CSP protected iframe');
        const options = await context.newPage();
        try {
            await options.goto(`chrome-extension://${extensionId}/pages/options/options.html`);
            await options.waitForFunction(expected => document.getElementById('settingGrafanaIframeDomains').value === expected, host);
        } finally { await options.close(); }
        result.checks.push('saved host is visible in Options Grafana connection');
        await page.locator('#addPanelBtn').click();
        await page.locator('#newPanelUrl').fill(`${origin}/fixture/d-solo/uid/name?panelId=2`);
        await page.locator('#savePanelBtn').click();
        await page.locator('#modalOverlay').waitFor({ state: 'hidden' });
        assert.equal(await confirmation.count(), 0);
        assert.equal(await page.locator('.panel-card').count(), initialCount + 2);
        result.checks.push('another panel on the configured host does not prompt again');

        const reportResult = await page.evaluate(async () => {
            const engine = window.DashBridgeReport;
            const common = '{{profileName}}|{{testName}}|{{environment}}|{{testDuration}}|{{stableLoadDuration}}|{{period}}|{{generatedAt}}';
            const profile = { name: 'Browser profile', report: { template: common + '\n{{panels}}', context: {
                testName: 'Browser load test', environment: 'Stage',
                testStartedAt: '2026-01-01T10:00', stableLoadStartedAt: '2026-01-01T11:00'
            } } };
            const panel = { id: 'fixture', report: { enabled: true, sla: { source: 'none' },
                templates: { neutral: common + '\n{{allSeriesList}}', listItem: common + '|{{name}}' } } };
            const owner = window.DashBridgeReportController.create({
                reportEngine: engine, transportFactory: { create: () => ({
                    throwIfAborted() {}, requestPanelSnapshot: async () => ({
                        state: 'no_threshold', series: [{ name: 'server', value: 42 }]
                    })
                }) }, testRunnerFactory: { create: () => ({}) },
                forceLoadPanel() {}, postToDashboardFrame() {}, getPanels: () => [panel],
                getActiveProfile: () => profile, getTimeContext: () => ({ from: 'now-15m', to: 'now' })
            });
            const collected = await owner.collect();
            return { output: collected.output, unresolved: engine.extractTemplateVariables(collected.output) };
        });
        assert.deepEqual(reportResult.unresolved, []);
        assert.equal(reportResult.output.split('Browser profile|Browser load test|Stage|').length - 1, 3);
        result.checks.push('production report controller supplies shared context to profile, panel and series templates');
    } catch (error) {
        result.status = 'failed'; result.error = error.stack || String(error);
        await page.screenshot({ path: path.resolve('test-results/grafana-connection-failure.png') }).catch(() => {});
    } finally { await page.close(); }
    return result;
};
