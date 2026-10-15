'use strict';
/* global chrome, document, window, createBatchCaptureWindowRunner */
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
        const disclosure = options.locator('.collapsible-header-title');
        const submodules = options.locator('.collapsible-content');
        const parentModule = options.locator('#settingModuleGrafana');
        await disclosure.focus();
        assert.equal(await disclosure.evaluate(node => node === document.activeElement), true,
            'Grafana disclosure must be keyboard focusable');
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
        await options.keyboard.press('Space');
        assert.equal(await submodules.isVisible(), true);
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
        await options.keyboard.press('Tab');
        assert.equal(await parentModule.evaluate(node => node === document.activeElement), true,
            'parent switch remains separate from the disclosure');
        const parentEnabled = await parentModule.isChecked();
        await options.locator('.collapsible-header .switch').click();
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'true', 'switch click must not collapse submodules');
        assert.equal(await options.locator('#settingModuleGrafanaLinks').isDisabled(), parentEnabled);
        await options.locator('.collapsible-header .switch').click();
        assert.equal(await parentModule.isChecked(), parentEnabled);
        await disclosure.focus(); await options.keyboard.press('Enter');
        assert.equal(await submodules.isHidden(), true);
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
        await options.keyboard.press('Tab'); await options.keyboard.press('Tab');
        assert.equal(await options.locator('#settingModuleRecorder').evaluate(node => node === document.activeElement), true,
            'Tab must skip collapsed subcontrols');
        await disclosure.click(); assert.equal(await submodules.isVisible(), true);
        await disclosure.click(); assert.equal(await submodules.isHidden(), true);
        await options.reload();
        await options.waitForFunction(() => document.getElementById('settingGrafanaIframeDomains').value.length > 0);
        result.checks.push('Options Grafana disclosure supports Space/Enter and excludes collapsed subcontrols from Tab');
        assert.equal(await options.locator('#restoreImportBackupBtn').isHidden(), true,
            'Restore must stay hidden when no import backup exists');
        const initialViewport = options.viewportSize();
        try {
            await options.evaluate(() => chrome.storage.local.set({ dashbridge_import_backup: { sync: {}, local: {} } }));
            await options.reload();
            await options.waitForFunction(() => !document.getElementById('restoreImportBackupBtn').hidden);
            await options.setViewportSize({ width: 600, height: 900 });
            await options.evaluate(() => { document.documentElement.dataset.uiScale = '150'; });
            const bounds = await options.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth,
                buttons: [...document.querySelectorAll('.maintenance-actions button')].map(button => button.getBoundingClientRect().right) }));
            assert(bounds.content <= bounds.width && bounds.buttons.every(right => right <= bounds.width),
                `Maintenance actions must fit a 600px viewport at 150%: ${JSON.stringify(bounds)}`);
        } finally {
            await options.evaluate(() => chrome.storage.local.remove('dashbridge_import_backup'));
            await options.setViewportSize(initialViewport);
            await options.reload();
            await options.waitForFunction(() => document.getElementById('settingGrafanaIframeDomains').value.length > 0);
        }
        result.checks.push('restore visibility follows backup availability; maintenance actions fit 600px at 150%');
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
        await inspectPanelRuleConflicts(context, extensionId);
        result.checks.push('two Batch editors merge unrelated panels and preserve drafts on conflicts');
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

async function inspectPanelRuleConflicts(context, extensionId) {
    const pages = [await context.newPage(), await context.newPage()];
    const url = 'https://batch-conflict.test/d/rules?orgId=1';
    const read = () => pages[0].evaluate(async url => window.BatchPanelRules.load(url), url);
    const wait = async (page, text) => page.locator('#batchPanelRulesStatus').filter({ hasText: text }).waitFor();
    const open = async page => {
        await page.goto(`chrome-extension://${extensionId}/pages/batch/batch.html`);
        await page.locator('#dashUrl').fill(url); await page.locator('#dashUrl').press('Tab');
        await wait(page, 'правил');
    };
    const add = async (page, id, field) => {
        await page.locator('#addBatchPanelRuleBtn').click();
        const row = page.locator('.batch-panel-rule').last();
        await row.locator('.batch-panel-rule-id-input').fill(id);
        await row.locator(`[data-rule-field="${field}"]`).check();
        await wait(page, 'Сохранено');
    };
    try {
        await pages[0].goto(`chrome-extension://${extensionId}/pages/batch/batch.html`);
        await pages[0].evaluate(url => window.BatchPanelRules.save(url, {}), url);
        await open(pages[0]); await open(pages[1]);
        await add(pages[0], '1', 'removeFill');
        await add(pages[1], '2', 'invertLegend');
        assert.deepEqual(await read(), { 1: { removeFill: true }, 2: { invertLegend: true } });
        await open(pages[0]); await open(pages[1]);
        // IDs are live input properties, so find the first row in sorted panel order.
        await pages[0].locator('.batch-panel-rule').first().locator('[data-rule-field="invertIdle"]').check();
        await wait(pages[0], 'Сохранено');
        await pages[1].locator('.batch-panel-rule').first().locator('[data-rule-field="invertLegend"]').check();
        await wait(pages[1], 'другом окне');
        assert.equal(await pages[1].locator('.batch-panel-rule').first().locator('[data-rule-field="invertLegend"]').isChecked(), true);
        assert.equal((await read())[1].invertLegend, undefined, 'conflicting draft must not overwrite stored rule');
        await pages[1].getByRole('button', { name: 'Загрузить сохранённые правила' }).click();
        await wait(pages[1], 'Загружено');
        assert.equal(await pages[1].locator('.batch-panel-rule').first().locator('[data-rule-field="invertIdle"]').isChecked(), true);
        await pages[1].locator('.batch-panel-rule').first().locator('[data-rule-field="invertLegend"]').check();
        await wait(pages[1], 'Сохранено');
        await pages[0].locator('#resetBatchPanelRulesBtn').click();
        await wait(pages[0], 'другом окне');
        assert.deepEqual(Object.keys(await read()), ['1', '2'], 'stale reset must preserve stored rules');
        await pages[0].getByRole('button', { name: 'Загрузить сохранённые правила' }).click();
        await wait(pages[0], 'Загружено');
        await pages[0].evaluate(() => {
            const original = window.BatchPanelRules.save;
            let first = true;
            window.BatchPanelRules.save = async (...args) => {
                if (first) {
                    first = false; window.batchSaveStarted = true;
                    await new Promise(resolve => { window.releaseBatchSave = resolve; });
                }
                return original(...args);
            };
        });
        await pages[0].locator('.batch-panel-rule').first().locator('[data-rule-field="thickenLines"]').check();
        await pages[0].waitForFunction(() => window.batchSaveStarted);
        await pages[0].locator('.batch-panel-rule').first().locator('[data-rule-field="invertLegend"]').uncheck();
        // Let the second debounce enqueue while the first real save is held.
        await pages[0].waitForTimeout(450);
        await pages[0].evaluate(() => window.releaseBatchSave());
        await pages[0].waitForFunction(async url => {
            const rule = (await window.BatchPanelRules.load(url))[1];
            return rule.thickenLines && !rule.invertLegend;
        }, url);
        assert.equal((await read())[1].invertIdle, true, 'queued local saves preserve the other settings');
    } finally {
        for (const page of pages) await page.close();
    }
}
module.exports.inspectPanelRuleConflicts = inspectPanelRuleConflicts;
