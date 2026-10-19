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
        await submodules.waitFor({ state: 'visible' });
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
        await disclosure.click(); await submodules.waitFor({ state: 'visible' });
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
        await inspectLoadRuleRoundTrip(context, extensionId);
        result.checks.push('all eight Load selections survive autosave and reload; legacy defaults and unrelated rules remain intact');
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

async function inspectLoadRuleRoundTrip(context, extensionId) {
    const page = await context.newPage();
    const url = 'https://batch-load.test/d/round-trip?orgId=1';
    const fields = ['cpuCapacityFilterLoad1', 'cpuCapacityFilterLoad5', 'cpuCapacityFilterLoad15'];
    const open = async () => {
        await page.goto(`chrome-extension://${extensionId}/pages/batch/batch.html`);
        await page.locator('#dashUrl').fill(url);
        await page.locator('#dashUrl').press('Tab');
        await page.locator('#batchPanelRulesStatus').filter({ hasText: 'Загружено' }).waitFor();
    };
    const legacy = { cpuCapacityFilterEnabled: true, cpuCapacityFilterCoefficient: 0.65,
        cpuCapacityFilterMode: 'last', cpuCapacityFilterHighlightEnabled: false,
        invertIdle: true, thresholdEnabled: true, thresholdValue: 75 };
    try {
        await page.goto(`chrome-extension://${extensionId}/pages/batch/batch.html`);
        await page.evaluate(({ url, legacy }) => window.BatchPanelRules.save(url, {
            1: legacy, 2: { convertMemToUsed: true, removeFill: true },
        }), { url, legacy });
        await open();
        const row = page.locator('.batch-panel-rule').first();
        const field = name => row.locator(`[data-rule-field="${name}"]`);
        for (const [index, name] of fields.entries()) {
            assert.equal(await field(name).isChecked(), index === 0, 'legacy rule defaults to Load 1m only');
        }
        const baseline = await page.evaluate(url => window.BatchPanelRules.load(url), url);
        // Start with only 5m: the original bug silently re-enabled 1m on this save.
        for (const mask of [2, 4, 0, 1, 3, 5, 6, 7]) {
            const selected = fields.map((_, index) => Boolean(mask & (1 << index)));
            for (const [index, name] of fields.entries()) await field(name).setChecked(selected[index]);
            // Ensure an actual save even when a selection happens to be unchanged.
            await field('cpuCapacityFilterCoefficient').fill(String(0.5 + mask / 100));
            await page.locator('#batchPanelRulesStatus').filter({ hasText: 'Сохранено' }).waitFor();
            const saved = await page.evaluate(url => window.BatchPanelRules.load(url), url);
            const actual = fields.map((name, index) => index === 0 ? saved[1][name] !== false : saved[1][name] === true);
            assert.deepEqual(actual, selected, `stored Load selection for mask ${mask}`);
            const expected = { ...baseline[1], cpuCapacityFilterCoefficient: 0.5 + mask / 100 };
            fields.forEach((name, index) => {
                delete expected[name];
                if (index === 0 || selected[index]) expected[name] = selected[index];
            });
            assert.deepEqual(saved[1], expected, 'other filter, threshold and CPU settings must survive');
            assert.deepEqual(saved[2], baseline[2], 'another panel and its RAM transform must survive');
            assert.deepEqual(await page.evaluate(url => {
                const rule = window.BatchPanelRules.forPanel;
                return window.BatchPanelRules.load(url).then(rules => rule(rules, 1));
            }, url), { ...saved[1], targetPanelId: '1' }, 'capture consumer receives the saved selection');
            await open();
            for (const [index, name] of fields.entries()) {
                assert.equal(await field(name).isChecked(), selected[index], `reloaded ${name}, mask ${mask}`);
            }
        }
        await field('seriesQueryFilterEnabled').check();
        await page.locator('#batchPanelRulesStatus').filter({ hasText: 'Сохранено' }).waitFor();
        await open();
        assert.equal(await field('cpuCapacityFilterEnabled').isChecked(), false, 'series filter still excludes vCPU filter');
        const saved = await page.evaluate(url => window.BatchPanelRules.load(url), url);
        assert.equal(saved[1].seriesQueryFilterEnabled, true);
        for (const name of fields) assert.equal(saved[1][name], undefined, 'disabled capacity fields remain absent');
    } finally {
        await page.close();
    }
}
module.exports.inspectLoadRuleRoundTrip = inspectLoadRuleRoundTrip;
