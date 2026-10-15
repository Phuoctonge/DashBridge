'use strict';
/* global chrome, document, DataTransfer, innerWidth, devicePixelRatio */
const http = require('node:http');
const assert = require('node:assert/strict');
const JSZip = require('../../vendor/jszip.min.js');
const image = filename => `<p><ac:image><ri:attachment ri:filename="${filename}" /></ac:image></p>`;
const initialHtml = '<h3>T1</h3><h4>G</h4><p>CPU</p>' + image('old.png') + '<p>Memory</p>' + image('old.png')
    + '<h3>T2</h3><h4>G</h4><p>CPU</p>' + image('old.png');
module.exports = async function inspectConfluenceTarget(context, extensionId, { corruptVerification = false, cancelDuringUpload = false } = {}) {
    const result = { name: corruptVerification ? 'Confluence rejects wrong-target verification'
        : cancelDuringUpload ? `Confluence cancels Apply on ${cancelDuringUpload === true ? 'Rescan' : cancelDuringUpload}`
            : 'Confluence selected target replacement', status: 'passed', checks: [] };
    let html = initialHtml; let version = 3; let uploads = 0; let puts = 0;
    let failScan = false;
    let releaseUpload;
    const requests = [];
    const server = http.createServer(async (request, response) => {
        requests.push({ method: request.method, path: request.url });
        if (request.url.startsWith('/pages/')) {
            response.writeHead(200, { 'content-type': 'text/html' }); response.end('<html><body>Local Confluence test page</body></html>'); return;
        }
        response.setHeader('content-type', 'application/json');
        if (failScan && request.method === 'GET' && request.url.startsWith('/rest/api/content/42?')) {
            response.writeHead(500); response.end(JSON.stringify({ message: 'Local scan failure' })); return;
        }
        if (request.method === 'POST') { for await (const chunk of request) { void chunk; } uploads++;
            if (cancelDuringUpload && uploads === 1) await new Promise(resolve => { releaseUpload = resolve; });
            response.end(JSON.stringify({ results: [{ id: '44', title: 'new.png', version: { number: 1 } }] })); return; }
        if (request.method === 'PUT') { let body = ''; for await (const chunk of request) body += chunk;
            const data = JSON.parse(body); html = data.body.storage.value; version = data.version.number; puts++;
            response.end(JSON.stringify({ version: { number: version } })); return; }
        if (request.url.includes('/child/attachment')) { response.end(JSON.stringify({ results: [{ id: '43', title: 'old.png' }] })); return; }
        const returnedHtml = corruptVerification && puts ? initialHtml.replace('old.png', 'new.png') : html;
        response.end(JSON.stringify({ id: '42', type: 'page', title: 'Local target fixture', version: { number: version },
            space: { key: 'TEST' }, body: { storage: { representation: 'storage', value: returnedHtml } } }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await context.newPage();
    try {
        const zip = new JSZip(); zip.file('manifest.json', JSON.stringify({ schemaVersion: 3, captures: [
            { file: 'range/new.png', panelId: '1', panelTitle: 'CPU', rangeIndex: 0, from: '1787774259463', to: '1787791648851' }
        ] })); zip.file('range/new.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tQAAAABJRU5ErkJggg==', 'base64'));
        const buffer = await zip.generateAsync({ type: 'nodebuffer' });
        await page.goto(`chrome-extension://${extensionId}/pages/confluence-report/confluence-report.html`);
        await page.locator('#pageUrlInput').fill(origin + '/pages/viewpage.action?pageId=42');
        await page.locator('#scanLiveButton').click();
        await page.waitForFunction(() => document.getElementById('imageCount').textContent === '3', {}, { timeout: 40000 });
        assert.equal(await page.locator('#rescanButton').isEnabled(), true,
            'successful scan must make Rescan available');
        await page.locator('#archiveInput').setInputFiles({ name: 'target-fixture.zip', mimeType: 'application/zip', buffer });
        await page.waitForFunction(() => !document.getElementById('mappingBoardCard').hidden);
        if (!corruptVerification && !cancelDuringUpload) {
            const viewport = page.viewportSize();
            const worker = context.serviceWorkers()[0];
            const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
            const zoom = await worker.evaluate(id => chrome.tabs.getZoom(id), tabId);
            try {
                await page.setViewportSize({ width: 600, height: 900 });
                for (const factor of [1, 1.5]) {
                    await worker.evaluate(({ id, value }) => chrome.tabs.setZoom(id, value), { id: tabId, value: factor });
                    assert.equal(await worker.evaluate(id => chrome.tabs.getZoom(id), tabId), factor);
                    await page.locator('#mappingBoardCard').scrollIntoViewIfNeeded();
                    const layout = await page.locator('#mappingBoardCard .step-heading').evaluate(heading => {
                        const range = document.createRange();
                        range.selectNodeContents(heading.querySelector('p'));
                        const lines = [...range.getClientRects()];
                        const buttons = [...heading.querySelectorAll('button')].map(button => button.getBoundingClientRect());
                        return {
                            overlaps: lines.some(line => buttons.some(button => line.left < button.right
                                && line.right > button.left && line.top < button.bottom && line.bottom > button.top)),
                            controlsFit: buttons.every(button => button.left >= 0 && button.right <= document.documentElement.clientWidth),
                            viewport: innerWidth, dpr: devicePixelRatio,
                        };
                    });
                    await page.screenshot({ path: `test-results/confluence-target-600-zoom-${factor}.png` });
                    assert.equal(layout.overlaps, false, `mapping explanation must not overlap actions at zoom ${factor}: ${JSON.stringify(layout)}`);
                    assert.equal(layout.controlsFit, true, `mapping actions must fit narrow viewport at zoom ${factor}`);
                    result.checks.push({ check: 'populated-mapping-narrow-browser-zoom', factor, ...layout });
                }
            } finally {
                await worker.evaluate(({ id, value }) => chrome.tabs.setZoom(id, value), { id: tabId, value: zoom });
                if (viewport) await page.setViewportSize(viewport);
            }
        }
        await page.locator('.mapping-range > summary').first().click();
        const source = page.locator('.source-node:not(.aggregate-node)').first();
        const target = page.locator('.target-node.specific-node').filter({ hasText: 'CPU' }).last();
        const transfer = await page.evaluateHandle(() => new DataTransfer());
        await source.dispatchEvent('dragstart', { dataTransfer: transfer });
        await target.dispatchEvent('dragover', { dataTransfer: transfer });
        await target.dispatchEvent('drop', { dataTransfer: transfer });
        await source.dispatchEvent('dragend', { dataTransfer: transfer });
        await page.locator('#clearConnectionsButton').click();
        assert.equal(await page.locator('#applyConfluenceButton').isDisabled(), true,
            'clearing all connections must disable Apply');
        assert.equal(uploads, 0); assert.equal(puts, 0);
        for (const [selector, aggregate] of [
            ['.mapping-group > .mapping-add-graph', false],
            ['.mapping-test > .mapping-add-section', false],
            ['.mapping-add-group', false],
            ['.mapping-criteria-add-graph', true],
            ['.mapping-criteria-add', true],
            ['.mapping-section-dropzone', false]
        ]) {
            const addedSource = aggregate ? page.locator('.source-node.aggregate-node').first() : source;
            await addedSource.dispatchEvent('dragstart', { dataTransfer: transfer });
            await page.locator(selector).first().dispatchEvent('drop', { dataTransfer: transfer });
            await addedSource.dispatchEvent('dragend', { dataTransfer: transfer });
            assert.equal(await page.locator('#applyConfluenceButton').isEnabled(), true,
                `adding via ${selector} must enable Apply after Clear`);
            await page.locator('#clearConnectionsButton').click();
            assert.equal(await page.locator('#applyConfluenceButton').isDisabled(), true);
            assert.equal(uploads, 0); assert.equal(puts, 0);
        }
        await source.dispatchEvent('dragstart', { dataTransfer: transfer });
        await target.dispatchEvent('drop', { dataTransfer: transfer });
        await source.dispatchEvent('dragend', { dataTransfer: transfer });
        assert.equal(await page.locator('#applyConfluenceButton').isEnabled(), true);
        await page.locator('#applyConfluenceButton').click();
        if (cancelDuringUpload) {
            await page.waitForFunction(() => document.getElementById('mappingBoardStatus').textContent.includes('Загрузка'));
            const uploadDeadline = Date.now() + 10000;
            while (!releaseUpload && Date.now() < uploadDeadline) await new Promise(resolve => setTimeout(resolve, 10));
            assert(releaseUpload, 'fixture must receive the first upload');
            if (cancelDuringUpload === 'archive') {
                await page.locator('#archiveInput').setInputFiles({ name: 'changed.zip', mimeType: 'application/zip', buffer });
                await page.locator('#archiveStatus').filter({ hasText: 'Архив прочитан' }).waitFor();
            } else {
                if (cancelDuringUpload === 'url') await page.locator('#pageUrlInput').fill(origin + '/pages/viewpage.action?pageId=42&changed=1');
                await page.locator(cancelDuringUpload === 'url' ? '#scanLiveButton' : '#rescanButton').click();
            }
            await page.waitForFunction(() => !document.getElementById('scanLiveButton').disabled
                && document.getElementById('liveStatus').textContent.includes('версия 3'), {}, { timeout: 15000 });
            releaseUpload();
            await page.waitForTimeout(500);
            assert.equal(puts, 0, 'old Apply must not PUT after Rescan');
            assert.equal(html, initialHtml);
            if (cancelDuringUpload !== 'archive') assert.equal(await page.locator('#mappingBoardCard').isHidden(), true);
            assert(!/Готово:|failed/.test(await page.locator('#mappingBoardStatus').textContent()), 'stale operation must not report success/error');
            await page.locator('#archiveInput').setInputFiles({ name: 'retry.zip', mimeType: 'application/zip', buffer });
            await page.locator('#mappingBoardCard').waitFor({ state: 'visible' });
            await page.locator('.mapping-range > summary').first().click();
            const retrySource = page.locator('.source-node:not(.aggregate-node)').first();
            const retryTarget = page.locator('.target-node.specific-node').filter({ hasText: 'CPU' }).last();
            await retrySource.dispatchEvent('dragstart', { dataTransfer: transfer });
            await retryTarget.dispatchEvent('drop', { dataTransfer: transfer });
            await retrySource.dispatchEvent('dragend', { dataTransfer: transfer });
            await page.locator('#applyConfluenceButton').click();
        }
        await page.waitForFunction(() => /Готово:|verification failed|Нет применимых|Attachment not found/.test(document.getElementById('mappingBoardStatus').textContent), {}, { timeout: 40000 });
        const status = await page.locator('#mappingBoardStatus').textContent();
        const filenames = [...html.matchAll(/ri:filename="([^"]+)"/g)].map(match => match[1]);
        result.checks.push({ status, filenames, uploads, puts, requests });
        assert.match(status, corruptVerification ? /post-save verification failed/ : /Готово:/);
        assert.deepEqual(filenames, ['old.png', 'old.png', 'new.png']);
        assert.equal(uploads, cancelDuringUpload ? 2 : 1); assert.equal(puts, 1);
        if (cancelDuringUpload) return result;
        if (!corruptVerification) for (const kind of ['graph', 'group', 'section']) {
            html = initialHtml; version = 3; uploads = 0; puts = 0;
            await page.reload();
            await page.locator('#pageUrlInput').fill(origin + '/pages/viewpage.action?pageId=42');
            await page.locator('#scanLiveButton').click();
            await page.waitForFunction(() => !document.getElementById('scanLiveButton').disabled
                && /версия 3/.test(document.getElementById('liveStatus').textContent), {}, { timeout: 40000 });
            await page.locator('#archiveInput').setInputFiles({ name: 'additions.zip', mimeType: 'application/zip', buffer });
            await page.locator('#mappingBoardCard').waitFor({ state: 'visible' });
            await page.locator('.mapping-range > summary').first().click();
            const test = page.locator('.mapping-test').first();
            const zone = kind === 'section' ? test.locator(':scope > .mapping-add-section')
                : test.locator(kind === 'group' ? '.mapping-group > .mapping-add-group' : '.mapping-group > .mapping-add-graph');
            const additionTransfer = await page.evaluateHandle(() => new DataTransfer());
            await source.dispatchEvent('dragstart', { dataTransfer: additionTransfer });
            await zone.first().dispatchEvent('drop', { dataTransfer: additionTransfer });
            await source.dispatchEvent('dragend', { dataTransfer: additionTransfer });
            await test.locator('.mapping-added-graph input').first().fill('Added A');
            await test.locator('.mapping-added-graph input').first().blur();
            if (kind !== 'graph') {
                await test.locator('.mapping-added-section > summary input').fill('Extra');
                // Worklog fixes the shared context clock; these are separate user gestures.
                await page.clock.setFixedTime(new Date(Date.now() + 1000));
                const sectionTransfer = await page.evaluateHandle(() => new DataTransfer());
                await source.dispatchEvent('dragstart', { dataTransfer: sectionTransfer });
                await test.locator('.mapping-section-dropzone').dispatchEvent('drop', { dataTransfer: sectionTransfer });
                await source.dispatchEvent('dragend', { dataTransfer: sectionTransfer });
                assert.equal(await test.locator('.mapping-added-section').count(), 1);
                assert.equal(await test.locator('.mapping-added-graph').count(), 2);
                await test.locator('.mapping-added-graph input').nth(1).fill('Added B');
                await test.locator('.mapping-added-graph input').nth(1).blur();
            }
            const movingRow = test.locator('.mapping-added-graph').last();
            const reorderTransfer = await page.evaluateHandle(() => new DataTransfer());
            await movingRow.locator('.mapping-target-grip').dispatchEvent('dragstart', { dataTransfer: reorderTransfer });
            const reorderTarget = kind === 'graph' ? test.locator('.mapping-group > .mapping-reorder-dropzone').nth(1)
                : test.locator('.mapping-added-graph').first();
            await reorderTarget.dispatchEvent('drop', { dataTransfer: reorderTransfer });
            await test.locator('.mapping-added-graph').first().locator('.mapping-target-grip')
                .dispatchEvent('dragend', { dataTransfer: reorderTransfer });
            assert.match(await page.locator('#mappingBoardStatus').textContent(), /Панель перемещена/,
                `single added ${kind} must move through its real drop handler`);
            await page.locator('#applyConfluenceButton').click();
            await page.waitForFunction(() => /Готово:|verification failed/.test(document.getElementById('mappingBoardStatus').textContent), {}, { timeout: 40000 });
            assert.match(await page.locator('#mappingBoardStatus').textContent(), /Готово:/);
            const tests = await page.evaluate(value => globalThis.DashBridgeConfluenceReportScanner.fromStorageHtml(value).tests, html);
            const groups = tests[0].groups.map(group => [group.headingPath, group.images.map(item => item.imageReference.filename)]);
            assert.deepEqual(groups, kind === 'graph' ? [[['G'], ['old.png', 'new.png', 'old.png']]] : [
                [['G'], ['old.png', 'old.png']], [kind === 'group' ? ['G', 'Extra'] : ['Extra'], ['new.png', 'new.png']],
            ]);
            if (kind !== 'graph') assert(html.indexOf('Added B') < html.indexOf('Added A'),
                'saved section must preserve the reordered captions');
            assert.equal(html.slice(html.indexOf('<h3>T2')), initialHtml.slice(initialHtml.indexOf('<h3>T2')));
            assert.equal(uploads, 1); assert.equal(puts, 1);
            result.checks.push({ check: `saved-${kind}-hierarchy-and-order` });
        }
        await page.locator('#rescanButton').click();
        await page.waitForFunction(() => !document.getElementById('scanLiveButton').disabled
            && /версия 4/.test(document.getElementById('liveStatus').textContent), {}, { timeout: 40000 });
        assert.equal(await page.locator('#archiveInput').inputValue(), '');
        assert.equal(await page.locator('#mappingBoardCard').isHidden(), true);
        assert.equal(await page.locator('#rescanButton').isEnabled(), true);
        assert.equal(uploads, 1); assert.equal(puts, 1);
        failScan = true;
        await page.locator('#rescanButton').click();
        await page.waitForFunction(() => !document.getElementById('scanLiveButton').disabled
            && document.getElementById('liveStatus').hasAttribute('data-error'), {}, { timeout: 40000 });
        assert.equal(context.pages().filter(candidate => candidate.url().startsWith(origin)).length, 0,
            'failed scan must close its own Confluence window');
        assert.equal(await page.locator('#rescanButton').isEnabled(), true);
        failScan = false;
        await page.locator('#rescanButton').click();
        await page.waitForFunction(() => !document.getElementById('scanLiveButton').disabled
            && !document.getElementById('liveStatus').hasAttribute('data-error'), {}, { timeout: 40000 });
        assert.equal(uploads, 1); assert.equal(puts, 1);
    } catch (error) { result.status = 'failed'; result.error = error.stack || String(error); }
    finally {
        releaseUpload?.();
        if (!page.isClosed()) await page.close();
        for (const candidate of context.pages()) if (candidate.url().startsWith(origin)) await candidate.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    return result;
};
