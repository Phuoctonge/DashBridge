'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { projectRoot, resolveChromeExecutable, testBrowserNetworkArgs,
    waitForExtensionWorker } = require('../scripts/setup-grafana-e2e-profile');

assert(Array.isArray(testBrowserNetworkArgs), 'live test browsers must have a network isolation policy');

(async () => {
    const requests = [];
    const proxy = http.createServer((request, response) => {
        if (request.url === '/proxy.pac') {
            response.setHeader('content-type', 'application/x-ns-proxy-autoconfig');
            response.end(`function FindProxyForURL() { return "PROXY 127.0.0.1:${proxy.address().port}"; }`);
            return;
        }
        requests.push(request.url);
        response.end('local proxy fixture');
    });
    proxy.on('connect', (request, socket) => {
        requests.push(request.url);
        socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-network-isolation-'));
    let context;
    try {
        for (const mode of ['manual', 'pac']) {
            context = await chromium.launchPersistentContext(profile, {
                executablePath: resolveChromeExecutable(), headless: true,
                ...(mode === 'manual' ? { proxy: { server: `http://127.0.0.1:${proxy.address().port}` } } : {}),
                args: [`--disable-extensions-except=${projectRoot}`, `--load-extension=${projectRoot}`,
                    ...testBrowserNetworkArgs,
                    ...(mode === 'pac' ? [`--proxy-pac-url=http://127.0.0.1:${proxy.address().port}/proxy.pac`] : []),
                    '--no-first-run'],
            });
            await waitForExtensionWorker(context);
            const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'));
            const endpoint = await worker.evaluate(() => globalThis.DashBridgeAnalyticsConfig.endpoint);
            assert.equal(new URL(endpoint).hostname, 'analytics.tongehub.com');
            // GET cannot ingest telemetry even if a future regression removes the block.
            const workerResult = await worker.evaluate(async url => {
                try { await fetch(url, { signal: globalThis.AbortSignal.timeout(5000) }); return 'reachable'; }
                catch { return 'blocked'; }
            }, endpoint);
            assert.equal(workerResult, 'blocked', 'the extension service worker must not reach the collector');
            const page = await context.newPage();
            await assert.rejects(page.goto(endpoint, { timeout: 5000 }), /ERR_NAME_NOT_RESOLVED/,
                'the collector must fail DNS locally rather than reach a proxy or the server');
            assert(!requests.some(value => value.includes('analytics.tongehub.com')),
                'a configured proxy must never receive a collector request');
            const proxyPage = await context.newPage();
            await proxyPage.goto(`http://127.0.0.1:${proxy.address().port}/fixture`, { timeout: 5000 });
            assert.equal(await proxyPage.locator('body').innerText(), 'local proxy fixture',
                'ordinary direct requests must remain available');
            await context.close();
            context = null;
        }
        console.log('PASS test browser blocks collector in worker/pages despite manual or PAC proxy configuration');
    } finally {
        await context?.close();
        proxy.closeAllConnections();
        await new Promise(resolve => proxy.close(resolve));
        fs.rmSync(profile, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
