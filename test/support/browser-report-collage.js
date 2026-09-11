'use strict';
/* global window, document, Blob, URL, createImageBitmap */
const fs = require('node:fs');
const path = require('node:path');
const inspectForcedSelection = require('./browser-report-forced-selection');

module.exports = async function inspectReportCollage(context, extensionId) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const result = { name: 'report-collage', status: 'passed', checks: [] };
    try {
        result.checks.push(await inspectForcedSelection(context, extensionId));
        await page.goto(`chrome-extension://${extensionId}/pages/dashbridge/dashbridge.html`);
        await page.waitForFunction(() => window.DashBridgeReportAttachments && window.DashBridgeReportCollage);
        await page.evaluate(async () => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay report-preview-overlay'; overlay.style.display = 'flex';
            overlay.innerHTML = '<section class="modal-content report-preview-modal"><h3>Сводное сообщение</h3><p>Нагрузочный тест · 8 сентября, 14:00–15:00</p><div class="fixture-attachments"></div></section>';
            document.body.appendChild(overlay);
            const titles = ['CPU — загрузка серверов', 'RAM — использование памяти', 'HTTP — время ответа', 'Ошибки — количество запросов'];
            const panels = titles.map((title, index) => ({ id: `fixture-${index}`, title, src: `https://grafana.test/d-solo/${index}` }));
            const images = [];
            for (let index = 0; index < panels.length; index++) {
                const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 520;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#111820'; ctx.fillRect(0, 0, 1000, 520);
                ctx.strokeStyle = '#33404e'; ctx.lineWidth = 1;
                for (let y = 60; y < 470; y += 80) { ctx.beginPath(); ctx.moveTo(55, y); ctx.lineTo(965, y); ctx.stroke(); }
                ctx.strokeStyle = ['#73bf69', '#5794f2', '#ff9830', '#f2495c'][index]; ctx.lineWidth = 4;
                ctx.beginPath();
                for (let x = 55; x < 965; x += 5) {
                    const y = 260 + Math.sin(x / (50 + index * 15)) * 80 + Math.cos(x / 17) * 15;
                    if (x === 55) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke(); ctx.fillStyle = '#dce3eb'; ctx.font = '20px Arial';
                ctx.fillText('14:00                         14:30                         15:00', 55, 495);
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                images.push({ panelId: panels[index].id, title: panels[index].title, width: 1000, height: 520, blob });
            }
            const fixture = { panels, images, mode: 'success', calls: [], copied: null, contextVersion: 1, urls: new Set() };
            window.collageFixture = fixture;
            fixture.owner = window.DashBridgeReportAttachments.create({
                host: overlay.querySelector('.fixture-attachments'), overlay,
                getPanels: () => panels,
                getContext: () => ({ name: 'Нагрузочный тест', period: '8 сентября, 14:00–15:00', version: fixture.contextVersion }),
                collage: window.DashBridgeReportCollage,
                copyImage: async blob => { if (fixture.mode === 'clipboard-error') throw new Error('clipboard'); fixture.copied = blob; },
                download: async () => { fixture.saved = true; },
                urlApi: { createObjectURL: blob => { const url = URL.createObjectURL(blob); fixture.urls.add(url); return url; },
                    revokeObjectURL: url => { fixture.urls.delete(url); URL.revokeObjectURL(url); } },
                captureSelection: async (selected, options) => {
                    fixture.calls.push(selected.map(panel => panel.id));
                    options.onProgress(0, selected.length, selected[0].title);
                    if (fixture.mode === 'wait') await new Promise((resolve, reject) => {
                        options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
                    });
                    const failed = fixture.mode === 'partial' ? selected[0].id : null;
                    return { images: selected.filter(panel => panel.id !== failed).map(panel => images.find(image => image.panelId === panel.id)),
                        errors: failed ? [{ panelId: failed, title: selected[0].title, error: 'Тестовая ошибка снимка' }] : [] };
                }
            });
            fixture.owner.setReport({ panelResults: panels.map(panel => ({ panel, included: true, state: 'critical' })) });
            fixture.owner.setCollecting(false);
        });
        await page.locator('.attachment-capture').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        const dimensions = await page.locator('.attachment-image').evaluate(image => [image.naturalWidth, image.naturalHeight]);
        if (dimensions.join(',') !== '2048,1184') throw new Error(`Collage must omit the profile/date header: ${dimensions}`);
        await page.locator('.attachment-copy').click();
        const copied = await page.evaluate(async () => {
            const bitmap = await createImageBitmap(window.collageFixture.copied);
            const size = [bitmap.width, bitmap.height]; bitmap.close(); return size;
        });
        if (copied.join(',') !== dimensions.join(',')) throw new Error('Copied PNG differs from preview');
        result.checks.push('four PNGs compose into 2×2; preview and copied PNG match');
        if (await page.locator('.attachment-panel-row button').count()) throw new Error('Screenshot rows must not have arrow buttons');
        await page.locator('.attachment-panel-row').first().locator('.attachment-drag')
            .dragTo(page.locator('.attachment-panel-row').nth(1));
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        if (await page.locator('.attachment-panel-row').first().getAttribute('data-panel-id') !== 'fixture-1') throw new Error('Screenshot arrow did not reorder');
        if (await page.evaluate(() => window.collageFixture.calls.length) !== 1) throw new Error('Reordering recaptured panels');
        await page.locator('.attachment-panel-row').first().locator('.attachment-drag')
            .dragTo(page.locator('.attachment-panel-row').nth(1));
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        if (await page.locator('.attachment-panel-row').first().getAttribute('data-panel-id') !== 'fixture-0') throw new Error('Screenshot drag did not reorder');
        result.checks.push('drag reorders screenshots and rebuilds cached PNGs without recapture; arrow buttons are absent');
        const output = path.resolve('test-results'); fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'report-collage-preview.png') });
        const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.collageFixture.copied.arrayBuffer())));
        fs.writeFileSync(path.join(output, 'report-collage.png'), Buffer.from(bytes));
        await page.locator('.attachment-layout').selectOption('column');
        await page.waitForFunction(() => document.querySelector('.attachment-image').naturalWidth === 1032);
        if (await page.evaluate(() => window.collageFixture.calls.length) !== 1) throw new Error('Layout change recaptured panels');
        await page.evaluate(() => { window.collageFixture.mode = 'clipboard-error'; });
        await page.locator('.attachment-copy').click();
        await page.waitForFunction(() => document.querySelector('.attachment-status').textContent.includes('Сохраните PNG'));
        await page.locator('.attachment-save').click();
        await page.waitForFunction(() => window.collageFixture.saved);
        result.checks.push('layout rebuild reuses PNGs; failed clipboard keeps save available');
        await page.evaluate(() => { window.collageFixture.mode = 'partial'; });
        await page.locator('.attachment-capture').click();
        await page.locator('.attachment-accept').waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(output, 'report-collage-partial.png') });
        if (await page.locator('.attachment-result').isVisible()) throw new Error('Partial result silently accepted');
        await page.locator('.attachment-accept').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        await page.evaluate(() => { window.collageFixture.mode = 'success'; });
        await page.locator('.attachment-retry').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        const retried = await page.evaluate(() => window.collageFixture.calls.at(-1));
        if (retried.length !== 1) throw new Error('Retry must capture only failed panel');
        result.checks.push('partial result requires explicit acceptance; retry captures failed panel only');
        await page.evaluate(() => {
            const fixture = window.collageFixture;
            fixture.owner.setReport({ panelResults: fixture.panels.map((panel, index) => ({
                panel, included: true, snapshot: { state: ['ok', 'warning', 'critical', 'timeout'][index] }
            })) });
        });
        if (!await page.locator('.attachment-sla').isChecked()) throw new Error('SLA filter must default on');
        const checkedSla = await page.locator('.report-attachment-panels .attachment-select:checked').evaluateAll(nodes => nodes.map(node => node.dataset.panelId));
        if (checkedSla.join(',') !== 'fixture-1,fixture-2') throw new Error(`Wrong SLA selection: ${checkedSla}`);
        await page.locator('.attachment-capture').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        if ((await page.evaluate(() => window.collageFixture.calls.at(-1))).join(',') !== 'fixture-1,fixture-2') throw new Error('Capture ignored SLA filter');
        await page.evaluate(() => {
            const fixture = window.collageFixture;
            fixture.owner.setReport({ panelResults: fixture.panels.map(panel => ({ panel, state: 'ok' })) });
        });
        if (!await page.locator('.attachment-capture').isDisabled()) throw new Error('No breaches must not produce an arbitrary collage');
        await page.screenshot({ path: path.join(output, 'report-collage-no-breaches.png') });
        await page.locator('.attachment-sla').uncheck();
        if (await page.locator('.report-attachment-panels .attachment-select:checked').count() !== 4) throw new Error('Filter off must allow normal and unknown panels');
        await page.evaluate(() => {
            const fixture = window.collageFixture;
            fixture.panels.push(...Array.from({ length: 6 }, (_, index) => ({ id: `extra-${index}`, title: `Дополнительная ${index}` })));
            fixture.contextVersion++;
            fixture.owner.setReport({ panelResults: fixture.panels.map(panel => ({ panel, state: 'critical' })) });
        });
        await page.locator('.attachment-sla').check();
        if (await page.locator('.report-attachment-panels .attachment-select:checked').count() !== 8) throw new Error('Automatic selection must cap at eight');
        if (await page.locator('.report-attachment-panels .attachment-select:not(:checked):not(:disabled)').count()) throw new Error('Manual selection must not allow a ninth panel');
        await page.locator('.report-attachment-panels .attachment-select:checked').first().uncheck();
        if (!await page.locator('.report-attachment-panels .attachment-select:not(:checked):not(:disabled)').count()) throw new Error('Unchecking must free the eighth slot');
        await page.locator('.attachment-all').click();
        if (await page.locator('.report-attachment-panels .attachment-select:checked').count() !== 8) throw new Error('Select available must cap at eight');
        await page.evaluate(() => {
            const fixture = window.collageFixture;
            fixture.panels.splice(4); fixture.contextVersion++;
            fixture.owner.setReport({ panelResults: fixture.panels.map(panel => ({ panel, state: 'critical' })) });
        });
        await page.locator('.attachment-all').click();
        result.checks.push('default SLA filter captures warning/critical only; normal, unknown and empty states are explicit; filter off and first-eight selection work');
        await page.evaluate(() => { window.collageFixture.mode = 'wait'; });
        await page.locator('.attachment-capture').click();
        await page.locator('.report-collage-progress').waitFor({ state: 'visible' });
        if (await page.locator('.report-preview-overlay button:visible, .report-preview-overlay select:visible').count()) throw new Error('Hidden report controls leak into capture');
        await page.screenshot({ path: path.join(output, 'report-collage-progress.png') });
        await page.locator('.report-collage-progress button').click();
        await page.waitForFunction(() => document.querySelector('.attachment-status').textContent.includes('отменена'));
        if (await page.locator('.report-preview-overlay').evaluate(node => node.inert || node.style.visibility === 'hidden')) throw new Error('Preview not restored after cancel');
        await page.evaluate(() => { window.collageFixture.mode = 'success'; });
        await page.locator('.attachment-capture').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        await page.evaluate(() => { window.collageFixture.contextVersion++; document.dispatchEvent(new Event('change')); });
        await page.locator('.attachment-result').waitFor({ state: 'hidden' });
        await page.evaluate(() => window.collageFixture.owner.stop());
        if (await page.evaluate(() => window.collageFixture.urls.size)) throw new Error('Blob URLs leaked');
        await page.evaluate(() => document.querySelector('.report-preview-overlay').remove());
        await page.bringToFront();
        const realCapture = await page.evaluate(async () => {
            const panels = [{ id: 'capture-fixture', title: 'Capture fixture' }];
            const card = document.createElement('div'); card.className = 'panel-card';
            card.style.cssText = 'width: 400px; height: 250px; position: relative;';
            const originalStyle = card.getAttribute('style');
            const frame = document.createElement('iframe');
            frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
            frame.srcdoc = '<body style="margin:0;background:rgb(17,97,173);height:100vh"></body>';
            card.appendChild(frame); document.body.appendChild(card);
            await new Promise(resolve => { frame.onload = resolve; });
            frame.dataset.dashbridgeRendered = 'true';
            const capture = window.DashBridgeCapture.create({
                getPanels: () => panels, getActiveProfile: () => ({ id: 'fixture' }),
                getDefaultCapturePrepared: () => false, setDefaultCapturePrepared() {},
                getCompactCaptureDimensions: () => ({ width: 1000, height: 520 }),
                forceLoadPanel: () => frame, postToDashboardFrame() {}, showAlert() {}
            });
            try {
                const output = await capture.captureSelection(panels);
                if (output.errors.length) throw new Error(output.errors[0].error);
                const bitmap = await createImageBitmap(output.images[0].blob);
                const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
                const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 500, 260, 1, 1, 0, 0, 1, 1); bitmap.close();
                return { pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data),
                    restored: card.getAttribute('style') === originalStyle, count: output.images.length };
            } finally { card.remove(); }
        });
        if (!realCapture.restored || realCapture.pixel.join(',') !== '17,97,173,255') throw new Error(`Real capture failed: ${JSON.stringify(realCapture)}`);
        result.checks.push('real background captureVisibleTab and PNG crop capture the selected iframe and restore card styles');
        await page.evaluate(() => {
            const fixture = window.collageFixture;
            fixture.reportLease = { active: false, acquired: 0, released: 0, changed: false };
            fixture.panels.forEach(panel => { panel.report = { enabled: true }; });
            fixture.controller = window.DashBridgeReportController.create({
                reportEngine: window.DashBridgeReport,
                transportFactory: { create: () => ({ throwIfAborted() {}, requestPanelSnapshot: async () => ({ state: fixture.reportLease.slaState || 'ok', series: [], aggregateValue: Number(fixture.reportLease.changed) + 1 }) }) },
                testRunnerFactory: { create: () => ({}) }, auditEngine: {}, forceLoadPanel: () => null,
                postToDashboardFrame: () => false, getPanels: () => fixture.panels,
                getActiveProfile: () => ({ id: 'test', name: 'Нагрузочный тест', report: {} }),
                getTimeContext: () => ({ from: 'now-1h', to: 'now' }),
                beginReport: () => {
                    fixture.reportLease.active = true; fixture.reportLease.acquired += 1;
                    return { period: '09.09.2026 10:00–11:00', release() { fixture.reportLease.active = false; fixture.reportLease.released += 1; } };
                },
                attachmentsFactory: window.DashBridgeReportAttachments, collage: window.DashBridgeReportCollage,
                copyImage: async () => {}, captureSelection: async (selected, options) => {
                    if (!fixture.reportLease.active) throw new Error('Screenshots require the report lease');
                    for (const panel of selected) await options.waitForData(panel, options.signal);
                    if (fixture.reportLease.waitForCancel) await new Promise((_resolve, reject) => {
                        options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
                    });
                    if (fixture.reportLease.mutate) fixture.reportLease.changed = Number(fixture.reportLease.changed) + 1;
                    return { images: selected.map(panel => fixture.images.find(image => image.panelId === panel.id)), errors: [] };
                }
            });
            fixture.controller.openPreview();
        });
        await page.locator('.report-preview-output').fill('Длинное сообщение для Telegram.\n'.repeat(80));
        await page.locator('#reportTextTab').focus();
        await page.keyboard.press('ArrowRight');
        if (await page.locator('#reportImagesTab').getAttribute('aria-selected') !== 'true') throw new Error('Arrow keys must switch tabs');
        await page.locator('.attachment-sla').uncheck();
        await page.locator('.attachment-all').click();
        if (await page.locator('.attachment-count').textContent() !== 'Выбрано 4 из 8') throw new Error('Selection counter is incorrect');
        await page.locator('.attachment-capture').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        await page.waitForFunction(() => !window.collageFixture.reportLease.active);
        const lease = await page.evaluate(() => window.collageFixture.reportLease);
        if (lease.acquired !== 1 || lease.released !== 1) throw new Error('Combined report must release its refresh lease');
        for (const width of [1440, 900, 600]) {
            await page.setViewportSize({ width, height: 900 });
            const geometry = await page.evaluate(() => {
                const modal = document.querySelector('.report-preview-modal');
                const close = document.querySelector('.report-close').getBoundingClientRect();
                const copy = document.querySelector('.attachment-copy').getBoundingClientRect();
                const image = document.querySelector('.attachment-image-scroll');
                return { shellScrolls: modal.scrollHeight > modal.clientHeight + 1,
                    closeVisible: close.top >= 0 && close.bottom <= window.innerHeight,
                    copyVisible: copy.top >= 0 && copy.bottom <= window.innerHeight,
                    imageScrolls: image.scrollHeight > image.clientHeight + 1 };
            });
            if (geometry.shellScrolls || !geometry.closeVisible || !geometry.copyVisible || geometry.imageScrolls) throw new Error(`Preview geometry ${width}: ${JSON.stringify(geometry)}`);
            await page.screenshot({ path: path.join(output, `report-tabs-${width}.png`) });
        }
        await page.locator('.attachment-capture').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        const previewVisible = await page.locator('.attachment-result').evaluate(node => {
            const box = node.getBoundingClientRect();
            const footer = document.querySelector('.report-attachments .report-preview-footer').getBoundingClientRect();
            return box.top >= 0 && box.bottom <= footer.top + 1;
        });
        if (!previewVisible) throw new Error('New collage must scroll into view on a narrow viewport');
        await page.screenshot({ path: path.join(output, 'report-tabs-600-created.png'), animations: 'disabled' });
        await page.locator('.attachment-original').click();
        if (!await page.locator('.attachment-zoom').isVisible()) throw new Error('Zoom dialog did not open');
        for (const width of [1440, 900, 600, 360]) {
            await page.setViewportSize({ width, height: 900 });
            const zoom = await page.locator('.attachment-zoom').evaluate(node => {
                const rect = node.getBoundingClientRect();
                const close = node.querySelector('.attachment-zoom-close').getBoundingClientRect();
                return { centered: Math.abs(rect.left + rect.width / 2 - document.documentElement.clientWidth / 2) < 2
                        && Math.abs(rect.top + rect.height / 2 - document.documentElement.clientHeight / 2) < 2,
                    fits: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
                    closeVisible: close.left >= 0 && close.right <= window.innerWidth && close.bottom <= window.innerHeight };
            });
            await page.screenshot({ path: path.join(output, `report-zoom-${width}.png`), animations: 'disabled' });
            if (!zoom.centered || !zoom.fits || !zoom.closeVisible) throw new Error(`Zoom geometry ${width}: ${JSON.stringify(zoom)}`);
        }
        await page.setViewportSize({ width: 600, height: 900 });
        await page.keyboard.press('Escape');
        if (await page.locator('.attachment-zoom').isVisible()) throw new Error('Escape must close zoom');
        if (!await page.locator('.report-preview-modal').isVisible()) throw new Error('Escape from zoom closed the report');
        await page.locator('#reportTextTab').click();
        if (!(await page.locator('.report-preview-output').inputValue()).includes('Длинное сообщение')) throw new Error('Tab switching lost text');
        await page.evaluate(() => { window.collageFixture.reportLease.mutate = true; });
        await page.locator('.report-combined').click();
        await page.locator('.attachment-status').filter({ hasText: 'Данные изменились' }).waitFor();
        if (await page.locator('.attachment-result').isVisible()) throw new Error('Changed data must not yield a collage');
        await page.waitForFunction(() => !window.collageFixture.reportLease.active);
        await page.screenshot({ path: path.join(output, 'report-consistency-rejected.png'), animations: 'disabled' });
        result.checks.push('combined text/collage holds and restores refresh lease; detects changed values and rejects inconsistent images');
        await page.evaluate(() => { window.collageFixture.reportLease.waitForCancel = true; });
        await page.locator('.report-combined').click();
        await page.locator('.report-collage-progress button').click();
        await page.locator('.attachment-status').filter({ hasText: 'Подготовка отменена' }).waitFor();
        await page.waitForFunction(() => !window.collageFixture.reportLease.active);
        const finalLease = await page.evaluate(() => window.collageFixture.reportLease);
        if (finalLease.acquired !== finalLease.released) throw new Error('Cancellation leaked the report lease');
        result.checks.push('combined capture cancellation restores refresh and exposes no cancelled collage');
        await page.locator('.report-close').click();
        await page.evaluate(() => {
            window.collageFixture.reportLease.waitForCancel = false;
            window.collageFixture.reportLease.mutate = false;
            window.collageFixture.controller.openPreview();
        });
        await page.locator('#reportImagesTab').click();
        if (!await page.locator('.report-preview-header .report-regenerate').isVisible()) throw new Error('Refresh must be available from the screenshot tab header');
        if (await page.locator('.attachment-heading').count()) throw new Error('Collage heading checkbox must be absent');
        await page.locator('.attachment-sla').uncheck();
        await page.locator('.attachment-all').click();
        await page.locator('.report-combined').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        await page.evaluate(() => { window.collageFixture.reportLease.slaState = 'critical'; });
        await page.locator('.report-regenerate').click();
        await page.locator('.attachment-result').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.querySelector('.report-regenerate').disabled);
        if (await page.locator('#reportImagesTab').getAttribute('aria-selected') !== 'true') throw new Error('Refresh must preserve the selected tab');
        if ((await page.locator('.attachment-panel-row small').allTextContents()).some(text => text.includes('Ожидаем'))) throw new Error('Refresh must replace pending SLA states');
        await page.locator('.attachment-sla').check();
        if (await page.locator('.attachment-panel-row input:checked').count() !== 4) throw new Error('Refreshed critical SLA must make all four panels eligible');
        await page.screenshot({ path: path.join(output, 'report-header-refreshed.png'), animations: 'disabled' });
        await page.locator('.report-close').click();
        result.checks.push('real report tabs preserve text; keyboard tabs/zoom Escape work; header/footer stay visible at 1440/900/600');
        if (errors.length) throw new Error(errors.join('\n'));
        result.checks.push('cancel restores preview; context changes invalidate images; stop releases URLs');
    } catch (error) {
        result.status = 'failed'; result.error = { message: error.message, stack: error.stack };
        result.uiStatus = await page.locator('.report-preview-status, .attachment-status').allTextContents().catch(() => []);
        await page.screenshot({ path: path.resolve('test-results/report-collage-failure.png'), animations: 'disabled' }).catch(() => {});
    }
    finally { await page.close(); }
    return result;
};
