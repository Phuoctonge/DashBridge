'use strict';
/* global window, document, Blob, URL, createImageBitmap */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function inspectReportCollage(context, extensionId) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const result = { name: 'report-collage', status: 'passed', checks: [] };
    try {
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
            fixture.owner.setReport({ panelResults: panels.map(panel => ({ panel, included: true })) });
            fixture.owner.setCollecting(false);
        });
        await page.locator('.attachment-capture').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        const dimensions = await page.locator('.attachment-image').evaluate(image => [image.naturalWidth, image.naturalHeight]);
        if (dimensions.join(',') !== '2048,1264') throw new Error(`Unexpected collage dimensions: ${dimensions}`);
        await page.locator('.attachment-copy').click();
        const copied = await page.evaluate(async () => {
            const bitmap = await createImageBitmap(window.collageFixture.copied);
            const size = [bitmap.width, bitmap.height]; bitmap.close(); return size;
        });
        if (copied.join(',') !== dimensions.join(',')) throw new Error('Copied PNG differs from preview');
        result.checks.push('four PNGs compose into 2×2; preview and copied PNG match');
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
        if (await page.locator('.attachment-result').isVisible()) throw new Error('Partial result silently accepted');
        await page.locator('.attachment-accept').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        await page.evaluate(() => { window.collageFixture.mode = 'success'; });
        await page.locator('.attachment-retry').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
        const retried = await page.evaluate(() => window.collageFixture.calls.at(-1));
        if (retried.length !== 1) throw new Error('Retry must capture only failed panel');
        result.checks.push('partial result requires explicit acceptance; retry captures failed panel only');
        await page.evaluate(() => { window.collageFixture.mode = 'wait'; });
        await page.locator('.attachment-capture').click();
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
            fixture.controller = window.DashBridgeReportController.create({
                reportEngine: window.DashBridgeReport,
                transportFactory: { create: () => ({ throwIfAborted() {}, requestPanelSnapshot: async () => ({ state: 'ok', series: [] }) }) },
                testRunnerFactory: { create: () => ({}) }, auditEngine: {}, forceLoadPanel: () => null,
                postToDashboardFrame: () => false, getPanels: () => fixture.panels,
                getActiveProfile: () => ({ id: 'test', name: 'Нагрузочный тест', report: {} }),
                getTimeContext: () => ({ from: 'now-1h', to: 'now' }),
                attachmentsFactory: window.DashBridgeReportAttachments, collage: window.DashBridgeReportCollage,
                copyImage: async () => {}, captureSelection: async selected => ({ images: selected.map(panel => fixture.images.find(image => image.panelId === panel.id)), errors: [] })
            });
            fixture.controller.openPreview();
        });
        await page.locator('.report-preview-output').fill('Длинное сообщение для Telegram.\n'.repeat(80));
        await page.locator('#reportTextTab').focus();
        await page.keyboard.press('ArrowRight');
        if (await page.locator('#reportImagesTab').getAttribute('aria-selected') !== 'true') throw new Error('Arrow keys must switch tabs');
        await page.locator('.attachment-all').click();
        if (await page.locator('.attachment-count').textContent() !== 'Выбрано 4 из 8') throw new Error('Selection counter is incorrect');
        await page.locator('.attachment-capture').click();
        await page.locator('.attachment-result').waitFor({ state: 'visible' });
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
        await page.locator('.attachment-original').click();
        if (!await page.locator('.attachment-zoom').isVisible()) throw new Error('Zoom dialog did not open');
        await page.keyboard.press('Escape');
        if (await page.locator('.attachment-zoom').isVisible()) throw new Error('Escape must close zoom');
        if (!await page.locator('.report-preview-modal').isVisible()) throw new Error('Escape from zoom closed the report');
        await page.locator('#reportTextTab').click();
        if (!(await page.locator('.report-preview-output').inputValue()).includes('Длинное сообщение')) throw new Error('Tab switching lost text');
        await page.locator('.report-close').click();
        result.checks.push('real report tabs preserve text; keyboard tabs/zoom Escape work; header/footer stay visible at 1440/900/600');
        if (errors.length) throw new Error(errors.join('\n'));
        result.checks.push('cancel restores preview; context changes invalidate images; stop releases URLs');
    } catch (error) { result.status = 'failed'; result.error = { message: error.message, stack: error.stack }; }
    finally { await page.close(); }
    return result;
};
