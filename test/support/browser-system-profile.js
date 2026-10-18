'use strict';
/* global chrome, document, sessionStorage, CustomEvent, profiles, panels */
const assert = require('node:assert/strict');
module.exports = async function inspectSystemProfile(context, extensionId) {
    const page = await context.newPage();
    const options = await context.newPage();
    const native = await context.newPage();
    const result = { name: 'System profile protection and editable graph settings', status: 'passed', checks: [] };
    try {
        await page.route(/^https?:/, route => route.abort());
        await page.goto(`chrome-extension://${extensionId}/pages/dashbridge/dashbridge.html`);
        await page.waitForFunction(() => profiles.length > 0);
        await page.evaluate(async () => {
            const seed = await (await fetch('dashbridge-default-profile.json')).json();
            const system = { ...seed, id: 'system-protection', name: 'DashBridge', systemKey: 'dashbridge', isSystemDefault: true };
            await chrome.storage.local.set({ dashbridge_profiles: [system, { id: 'custom-protection', name: 'Custom', panels: [] }],
                dashbridge_activeProfileId: system.id });
            sessionStorage.setItem('dashbridge_tab_activeProfileId', system.id);
            await chrome.storage.sync.set({ grafanaIframeDomains: ['system-profile.test'] });
        });
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.dashbridgeSystemProfile === 'true'
            && profiles.some(profile => profile.id === 'system-protection') && panels.length === 8);
        for (const selector of ['.add-panel-menu', '#addPanelBtn', '#addPanelMenuBtn', '#renameProfileBtn', '#deleteProfileBtn', '#configureReportBtn',
            '.btn-delete', '.btn-pause', '.btn-iframe-settings', '.btn-report-settings', '.drag-handle']) {
            assert.equal(await page.locator(selector).first().isVisible(), false, selector);
        }
        const settings = page.locator('.btn-panel-tools').first();
        assert.equal(await settings.isVisible(), true);
        await settings.click();
        const fill = page.locator('[data-key="removeFill"]');
        await page.locator('.panel-tools-save').waitFor();
        if (await fill.isChecked()) await fill.locator('..').click();
        const thicken = page.locator('[data-key="thickenLines"]');
        if (!await thicken.isChecked()) await thicken.locator('..').click();
        await page.locator('[data-key="thickenLinesValue"]').evaluate(input => {
            input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.locator('.panel-tools-save').click();
        await page.locator('.panel-tools-save').waitFor({ state: 'detached' });
        await page.waitForFunction(async () => {
            const stored = await chrome.storage.local.get('dashbridge_profiles');
            const tools = stored.dashbridge_profiles.find(p => p.id === 'system-protection')?.panels[0].tools;
            if (!tools) return false;
            return tools.removeFill === false && tools.thickenLines === true && tools.thickenLinesValue === 3;
        });
        result.checks.push('structural controls are hidden; graph switches and parameters save successfully');
        await options.goto(`chrome-extension://${extensionId}/pages/options/options.html`);
        options.on('dialog', dialog => dialog.accept());
        await options.locator('#importFile').setInputFiles({ name: 'protected.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
            sync: {}, local: { dashbridge_profiles: [{ id: 'system-protection', name: 'Overwrite', panels: [], systemKey: 'dashbridge' },
                { id: 'import-custom', name: 'Imported', panels: [] }], dashbridge_activeProfileId: 'import-custom' }
        })) });
        await options.waitForFunction(async () => (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles.some(p => p.id === 'import-custom'));
        const saved = await options.evaluate(async () => (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles.find(p => p.id === 'system-protection'));
        assert.equal(saved.name, 'DashBridge'); assert.equal(saved.panels.length, 8);
        assert.equal(saved.panels[0].tools.thickenLinesValue, 3);
        result.checks.push('Options import preserves the system profile and its graph preferences');
        await native.route('https://system-profile.test/**', route => route.fulfill({ contentType: 'text/html',
            body: '<html><body><button id="save-panel">Save</button></body></html>' }));
        await native.goto('https://system-profile.test/d/uid/test');
        await native.waitForFunction(() => document.documentElement.dataset.dashbridgeGrafanaMenuEnabled === 'true');
        await native.evaluate(() => document.getElementById('save-panel').addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('dashbridgeSavePanelRequest', { detail: { panelId: '999', title: 'Test' } }));
        }));
        await native.locator('#save-panel').click();
        const protectedOption = native.locator('.dashbridge-profile-save-select option[value="system-protection"]');
        await protectedOption.waitFor({ state: 'attached' });
        assert.equal(await protectedOption.evaluate(option => option.disabled), true, 'native option must be disabled');
        assert.match(await protectedOption.textContent(), /защищённый/);
        result.checks.push('native Grafana picker disables the protected profile with an explanation');
        await options.evaluate(async () => {
            await chrome.storage.local.set({ dashbridge_import_backup: { sync: {}, local: {} } });
        });
        await options.reload();
        await options.locator('#restoreImportBackupBtn').click();
        await options.waitForFunction(async () => {
            const stored = await chrome.storage.local.get('dashbridge_profiles');
            return stored.dashbridge_profiles?.length === 1 && stored.dashbridge_profiles[0].id === 'system-protection';
        });
        result.checks.push('backup restore removes absent custom profiles while preserving the system profile');
    } catch (error) { result.status = 'failed'; result.error = error.message; }
    finally { await Promise.all([page.close(), options.close(), native.close()]); }
    return result;
};
