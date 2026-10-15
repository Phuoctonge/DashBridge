'use strict';
/* global document, DataTransfer */
const http = require('node:http');
const assert = require('node:assert/strict');
const JSZip = require('../../vendor/jszip.min.js');
const image = filename => `<ac:image><ri:attachment ri:filename="${filename}" /></ac:image>`;
const initialHtml = '<h3>T1</h3><h4>G</h4><p>CPU</p>' + image('old.png') + '<p>Memory</p>' + image('old.png')
    + '<h3>T2</h3><h4>G</h4><p>CPU</p>' + image('old.png');
module.exports = async function inspectConfluenceTarget(context, extensionId, { corruptVerification = false } = {}) {
    const result = { name: corruptVerification ? 'Confluence rejects wrong-target verification' : 'Confluence selected target replacement', status: 'passed', checks: [] };
    let html = initialHtml; let version = 3; let uploads = 0; let puts = 0;
    const requests = [];
    const server = http.createServer(async (request, response) => {
        requests.push({ method: request.method, path: request.url });
        if (request.url.startsWith('/pages/')) {
            response.writeHead(200, { 'content-type': 'text/html' }); response.end('<html><body>Local Confluence test page</body></html>'); return;
        }
        response.setHeader('content-type', 'application/json');
        if (request.method === 'POST') { for await (const chunk of request) { void chunk; } uploads++;
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
        await page.locator('#archiveInput').setInputFiles({ name: 'target-fixture.zip', mimeType: 'application/zip', buffer });
        await page.waitForFunction(() => !document.getElementById('mappingBoardCard').hidden);
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
        await page.waitForFunction(() => /Готово:|verification failed|Нет применимых|Attachment not found/.test(document.getElementById('mappingBoardStatus').textContent), {}, { timeout: 40000 });
        const status = await page.locator('#mappingBoardStatus').textContent();
        const filenames = [...html.matchAll(/ri:filename="([^"]+)"/g)].map(match => match[1]);
        result.checks.push({ status, filenames, uploads, puts, requests });
        assert.match(status, corruptVerification ? /post-save verification failed/ : /Готово:/);
        assert.deepEqual(filenames, ['old.png', 'old.png', 'new.png']);
        assert.equal(uploads, 1); assert.equal(puts, 1);
    } catch (error) { result.status = 'failed'; result.error = error.stack || String(error); }
    finally {
        if (!page.isClosed()) await page.close();
        for (const candidate of context.pages()) if (candidate.url().startsWith(origin)) await candidate.close();
        await new Promise(resolve => server.close(resolve));
    }
    return result;
};
