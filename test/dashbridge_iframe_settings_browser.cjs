'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
async function inspectIframeSettings(executablePath) {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
        const page = await browser.newPage();
        await page.setContent('<main id="dashboard"><div class="panel-card fullscreen"><button id="opener">Settings</button></div></main>');
        for (const file of ['pages/shared/theme.css', 'pages/shared/theme-compat.css',
            'pages/dashbridge/dashbridge.css', 'pages/dashbridge/dashbridge-dialogs.css',
            'pages/dashbridge/dashbridge-interactions.css', 'pages/dashbridge/dashbridge-report.css']) {
            await page.addStyleTag({ path: path.resolve(file) });
        }
        for (const file of ['pages/dashbridge/dashbridge-panel-card-controller.js',
            'pages/dashbridge/dashbridge-modal.js', 'pages/shared/modal-accessibility.js']) {
            await page.addScriptTag({ path: path.resolve(file) });
        }
        await page.evaluate(() => {
            const noop = () => {};
            const panel = { id: 'p', src: 'https://grafana.test/d-solo/u/name?panelId=1', width: '50%', height: '350px' };
            const controller = DashBridgePanelCardController.create({
                renderer: { createPanelCard: noop }, getPanels: () => [panel], setPanels: noop,
                savePanels: async () => ({ current: true }), getActiveProfile: () => ({ id: 'a' }),
                applyPanelParamsToUrl: item => item.src, navigateDashboardFrame: noop, findPanelCard: () => null,
                getPanelAnalysisType: noop, syncPanelAnalysisAction: noop, closePanelAnalysis: noop,
                isPanelAnalysisOpen: () => false, escapeHtml: String, icons: { expand: 'E', collapse: 'C' }, runtimeScopeId: 'fixture',
                actionDependencies: { showAlert: async () => {}, showConfirm: async () => true,
                    setPanelDataStatus: noop, postToDashboardFrame: noop, panelAnalysis: { isPanel: () => false },
                    panelTools: { removePanel: noop }, isSupportedPanelUrl: () => true, normalizePanelUrl: value => value,
                    runToolbarCapture: noop, openPanelReportEditor: noop, openPanelTools: noop, openPanelAnalysis: noop },
            });
            document.getElementById('opener').onclick = () => controller.openIframeSettings(panel);
            // The page's Escape handler is downstream of the shared modal trap.
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape') document.querySelector('.fullscreen')?.classList.remove('fullscreen');
            });
        });
        await page.click('#opener');
        const clickable = await page.locator('.iframe-settings-save').evaluate(save => {
            const r = save.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === save;
        });
        assert.equal(clickable, true, 'iframe settings Save must be above fullscreen card');
        await page.locator('.iframe-settings-save').focus(); await page.keyboard.press('Tab');
        assert.equal(await page.locator('.iframe-settings-cancel').evaluate(node => node === document.activeElement), true, 'Tab follows primary action with cancel');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#iframeSettingsUrl').evaluate(node => node === document.activeElement), true, 'Tab wraps in modal');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.iframe-settings-modal').count(), 0);
        assert.equal(await page.locator('.fullscreen').count(), 1, 'Escape closes modal before fullscreen');
        assert.equal(await page.locator('#opener').evaluate(node => node === document.activeElement), true, 'focus returns to opener');
        await page.evaluate(() => { void DashBridgeModal.showConfirm('Delete profile?'); });
        await page.locator('.modal-ok').click();
        assert.equal(await page.locator('.modal-overlay').count(), 0, 'ordinary confirm stays clickable above fullscreen');
        // Use the report editor's production class/rules to cover the shared layer ordering.
        assert.equal(await page.evaluate(() => {
            const overlay = document.createElement('div'); overlay.className = 'modal-overlay report-panel-editor-overlay';
            overlay.style.display = 'flex'; overlay.innerHTML = '<div class="modal-content"><button>Report settings</button></div>';
            document.body.append(overlay); const button = overlay.querySelector('button'); const r = button.getBoundingClientRect();
            const visible = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === button;
            overlay.remove(); return visible;
        }), true, 'report editor layer also remains above fullscreen');
        console.log('PASS fullscreen iframe/confirm/report layers, modal Tab, Escape priority and focus restoration');
        return { name: 'iframe-settings-fullscreen-accessibility', status: 'passed' };
    } finally { await browser.close(); }
}
module.exports = inspectIframeSettings;
if (require.main === module) inspectIframeSettings().catch(error => { console.error(error); process.exitCode = 1; });
