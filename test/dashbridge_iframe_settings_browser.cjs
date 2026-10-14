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

        // A cross-origin document focuses its input after navigation, as an async
        // Grafana bootstrap can. Parent focusin/Tab handlers do not see that focus.
        await page.route('https://modal-focus.test/**', route => route.fulfill({
            contentType: 'text/html', body: '<input id="child"><script>document.querySelector("input").focus()</script>',
        }));
        await page.evaluate(() => {
            const frame = document.createElement('iframe'); frame.id = 'focus-frame';
            document.getElementById('dashboard').append(frame);
        });
        const navigate = async sequence => {
            const navigation = page.waitForEvent('framenavigated', { predicate: item => item.url().endsWith('/' + sequence) });
            await page.evaluate(value => { document.getElementById('focus-frame').src = `https://modal-focus.test/${value}`; }, sequence);
            const frame = await navigation;
            await frame.waitForLoadState();
            return frame;
        };
        for (let attempt = 0; attempt < 3; attempt++) {
            await page.focus('#opener');
            await page.evaluate(() => { void DashBridgeModal.showPrompt('Profile name', 'AB'); });
            await page.locator('.modal-input').evaluate(input => input.setSelectionRange(1, 1));
            const frame = await navigate('prompt-' + attempt);
            await page.waitForFunction(() => document.querySelector('.modal-input') === document.activeElement);
            assert.equal(await page.locator('.modal-input').evaluate(node => node === document.activeElement), true,
                'loading cross-origin iframe must not steal prompt focus');
            await page.keyboard.type('X');
            assert.equal(await page.locator('.modal-input').inputValue(), 'AXB', 'keyboard input and caret survive iframe loading');
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#opener').evaluate(node => node === document.activeElement), true);
            await frame.locator('input').focus();
            assert.equal(await page.evaluate(() => document.activeElement.id), 'focus-frame', 'iframe can receive focus after modal closes');
        }
        await page.focus('#opener');
        await page.evaluate(() => { void DashBridgeModal.showPrompt('Parent name', 'AB'); });
        await page.evaluate(() => { void DashBridgeModal.showAlert('Nested alert'); });
        await navigate('nested');
        await page.waitForFunction(() => document.querySelectorAll('.modal-overlay')[1].contains(document.activeElement));
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.modal-input').evaluate(node => node === document.activeElement), true,
            'closing nested dialog restores the parent field');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#opener').evaluate(node => node === document.activeElement), true);

        await page.focus('#opener'); await page.click('#opener');
        const height = page.locator('#iframeSettingsHeight');
        await height.focus(); await height.fill('420');
        await navigate('settings');
        await page.waitForFunction(() => document.getElementById('iframeSettingsHeight') === document.activeElement);
        await page.keyboard.type('1');
        assert.equal(await height.inputValue(), '4201', 'settings restores the edited field, not the first control');
        await page.keyboard.press('Escape');

        await page.evaluate(() => {
            void DashBridgeModal.showPrompt('Parent');
            const dialog = document.createElement('dialog'); dialog.id = 'native-dialog';
            dialog.innerHTML = '<input id="native-input">'; document.body.append(dialog); dialog.showModal();
        });
        await navigate('native-dialog');
        await page.waitForFunction(() => document.getElementById('native-input') === document.activeElement);
        assert.equal(await page.locator('#native-input').evaluate(node => node === document.activeElement), true,
            'native modal retains its own focus contract');
        await page.keyboard.type('native');
        assert.equal(await page.locator('#native-input').inputValue(), 'native');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        await page.focus('#opener');
        await page.evaluate(() => {
            void DashBridgeModal.showPrompt('Cleanup');
            window.dispatchEvent(new Event('blur')); // schedules one restoration frame
            window.dispatchEvent(new Event('pagehide')); // cancels it and removes listeners
        });
        const stoppedFrame = await navigate('stopped');
        await stoppedFrame.locator('input').focus();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'focus-frame', 'pagehide releases focus ownership');
        await page.locator('.modal-cancel').click();
        await page.focus('#opener');
        await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
        await page.evaluate(() => { void DashBridgeModal.showPrompt('Restarted'); });
        await navigate('restarted');
        await page.waitForFunction(() => document.querySelector('.modal-input') === document.activeElement);
        await page.keyboard.type('restored');
        assert.equal(await page.locator('.modal-input').inputValue(), 'restored', 'pageshow reinstalls focus ownership');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#opener').evaluate(node => node === document.activeElement), true);
        await page.evaluate(() => {
            void DashBridgeModal.showPrompt('Frame within the modal');
            document.querySelector('.modal-content').append(document.getElementById('focus-frame'));
        });
        const insideFrame = await navigate('inside-modal');
        await insideFrame.locator('input').focus();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'focus-frame', 'iframe within the modal keeps focus');
        await page.locator('.modal-cancel').click();
        console.log('PASS fullscreen layers, Tab/Escape, cross-origin iframe focus, caret, nested/native dialogs and stop/start');
        return { name: 'iframe-settings-fullscreen-accessibility', status: 'passed',
            checks: ['fullscreen layers and Tab/Escape', 'three active iframe navigations preserve input/caret',
                'nested and native modal focus', 'edited settings field', 'opener and iframe focus after close',
                'pagehide cancellation and pageshow restart', 'iframe inside dialog remains interactive'] };
    } finally { await browser.close(); }
}
module.exports = inspectIframeSettings;
if (require.main === module) inspectIframeSettings().catch(error => { console.error(error); process.exitCode = 1; });
