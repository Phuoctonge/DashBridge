'use strict';
/* global chrome, window, document */
const assert = require('node:assert/strict');
const http = require('node:http');

module.exports = async function inspectRuntimePortScope(context, extensionId) {
    const result = { name: 'MAIN runtime exact port registration and backfill', status: 'passed', checks: [] };
    const servers = [];
    const pages = [];
    let originalHosts;
    const bounded = async (operation, label, ms = 10_000) => {
        let timer;
        try {
            return await Promise.race([operation, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Port scope fixture timed out: ${label}`)), ms);
            })]);
        } finally { clearTimeout(timer); }
    };
    const settings = await bounded(context.newPage(), 'settings page creation');
    const serve = async () => {
        const server = http.createServer((_request, response) => {
            response.writeHead(200, { 'content-type': 'text/html' });
            response.end('<!doctype html><html><body>Grafana route scope fixture</body></html>');
        });
        servers.push(server);
        await bounded(new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        }), 'server listening');
        return `http://127.0.0.1:${server.address().port}`;
    };
    try {
        console.log('Browser port scope: starting local fixtures');
        const [allowed, rejected] = await Promise.all([serve(), serve()]);
        await settings.goto(`chrome-extension://${extensionId}/pages/options/options.html`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        originalHosts = await bounded(settings.evaluate(async () => (await chrome.storage.sync.get('grafanaIframeDomains')).grafanaIframeDomains), 'settings read');
        const wrongPort = await bounded(context.newPage(), 'wrong-port page creation'); pages.push(wrongPort);
        await wrongPort.goto(`${rejected}/d/a`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        await bounded(settings.evaluate(host => chrome.storage.sync.set({ grafanaIframeDomains: [host] }), new URL(allowed).host), 'settings apply');
        await settings.waitForFunction(async host => {
            const list = await chrome.scripting.getRegisteredContentScripts({ ids: ['dashbridge-grafana-main-runtime-v1'] });
            return list[0]?.matches.includes(`http://${host}/d/*`);
        }, new URL(allowed).host, { timeout: 10_000 });
        console.log('Browser port scope: exact registration ready');
        const allowedPage = await bounded(context.newPage(), 'allowed page creation'); pages.push(allowedPage);
        await allowedPage.goto(`${allowed}/base/d/a`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        await allowedPage.waitForFunction(() => window.__dashbridgePanelToolsRuntimeLoaded === true, null, { timeout: 10_000 });
        assert.equal(await bounded(wrongPort.evaluate(() => window.__dashbridgePanelToolsRuntimeLoaded === true), 'backfill probe'), false,
            'backfill must not inject the existing document on another port');
        await wrongPort.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 });
        assert.equal(await bounded(wrongPort.evaluate(() => window.__dashbridgePanelToolsRuntimeLoaded === true), 'document-start probe'), false,
            'document_start registration must not match another port');
        console.log('Browser port scope: direct and backfill passed');
        const frameHost = await bounded(context.newPage(), 'frame host creation'); pages.push(frameHost);
        console.log('Browser port scope: frame host created');
        await frameHost.goto(`chrome-extension://${extensionId}/pages/batch/batch.html`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        console.log('Browser port scope: frame host loaded');
        await bounded(frameHost.evaluate(({ allowed, rejected }) => {
            for (const base of [allowed, rejected]) {
                const frame = document.createElement('iframe'); frame.src = base + '/d-solo/a';
                document.body.append(frame);
            }
        }, { allowed, rejected }), 'iframe append');
        console.log('Browser port scope: iframes appended');
        await frameHost.waitForFunction(() => document.querySelectorAll('iframe').length >= 2, null, { timeout: 10_000 });
        const findFrame = base => frameHost.frames().find(frame => frame.url().startsWith(base));
        for (let attempt = 0; attempt < 50 && (!findFrame(allowed) || !findFrame(rejected)); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        await findFrame(allowed).waitForFunction(() => window.__dashbridgePanelToolsRuntimeLoaded === true, null, { timeout: 10_000 });
        assert.equal(await bounded(findFrame(rejected).evaluate(() => window.__dashbridgePanelToolsRuntimeLoaded === true), 'rejected iframe probe'), false);
        result.checks.push('allowed port direct/iframe loads MAIN; wrong port stays native across backfill and reload');
    } catch (error) { result.status = 'failed'; result.error = error.stack || String(error); console.error(result.error); }
    finally {
        if (!settings.isClosed()) {
            await bounded(settings.evaluate(hosts => hosts === undefined ? chrome.storage.sync.remove('grafanaIframeDomains')
                : chrome.storage.sync.set({ grafanaIframeDomains: hosts }), originalHosts), 'settings restore', 3_000).catch(() => {});
        }
        await Promise.all([...pages, settings].map(page => bounded(page.close(), 'page close', 3_000).catch(() => {})));
        await Promise.all(servers.map(server => bounded(new Promise(resolve => {
            server.close(resolve);
            server.closeAllConnections();
        }), 'server close', 3_000)));
    }
    return result;
};
