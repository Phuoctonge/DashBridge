'use strict';
/* global chrome, document, createBatchCaptureWindowRunner */
const assert = require('node:assert/strict');
module.exports = async function inspectAuditFixes(context, extensionId) {
    const result = { name: 'Audit fixes: Options conflicts and Batch owner teardown', status: 'passed', checks: [] };
    const options = await context.newPage();
    const dashboard = await context.newPage();
    const batch = await context.newPage();
    try {
        await dashboard.goto(`chrome-extension://${extensionId}/pages/dashbridge/dashbridge.html`);
        await options.goto(`chrome-extension://${extensionId}/pages/options/options.html`);
        await options.waitForFunction(() => document.getElementById('settingGrafanaIframeDomains').value.length > 0);
        const initial = await options.locator('#settingGrafanaIframeDomains').inputValue();
        const response = await dashboard.evaluate(() => chrome.runtime.sendMessage({
            type: 'dashbridge-grafana-connection', url: 'https://audit-added.test/d/a', add: true,
        }));
        assert.equal(response.ok, true);
        await options.locator('#saveBtn').click();
        await options.waitForFunction(async () => (await chrome.storage.sync.get('grafanaIframeDomains')).grafanaIframeDomains.includes('audit-added.test'));
        await options.locator('#settingGrafanaIframeDomains').fill(initial + '\naudit-local.test');
        await options.locator('#saveBtn').click();
        await options.locator('#maintenanceStatus').filter({ hasText: 'другой вкладке' }).waitFor();
        const stored = await options.evaluate(async () => (await chrome.storage.sync.get('grafanaIframeDomains')).grafanaIframeDomains);
        assert(stored.includes('audit-added.test')); assert(!stored.includes('audit-local.test'));
        result.checks.push('stale Options preserves new connection; explicit stale edit returns conflict without overwriting');
        await batch.goto(`chrome-extension://${extensionId}/pages/batch/batch.html`);
        const windowId = await batch.evaluate(async () => {
            const runner = createBatchCaptureWindowRunner();
            const first = await runner.acquire({ focused: false });
            await runner.release();
            const removed = await chrome.windows.get(first.id).then(() => false, () => true);
            if (!removed) throw new Error('Normal Batch release leaked a window');
            const leased = await runner.acquire({ focused: false });
            // Cross the normal MV3 idle threshold: an active lease must survive it.
            await new Promise(resolve => setTimeout(resolve, 35_000));
            await chrome.windows.get(leased.id);
            return leased.id;
        });
        await batch.close();
        await dashboard.waitForFunction(async id => {
            try { await chrome.windows.get(id); return false; } catch { return true; }
        }, windowId);
        result.checks.push('active lease survives 35 seconds; normal release and Batch document destruction close its window');
    } catch (error) { result.status = 'failed'; result.error = error.stack || String(error); }
    finally { await options.close(); await dashboard.close(); if (!batch.isClosed()) await batch.close(); }
    return result;
};
