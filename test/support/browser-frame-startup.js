'use strict';
/* global chrome, document, location */
const assert = require('node:assert/strict');
const http = require('node:http');

module.exports = async function inspectFrameStartup(context, extensionId) {
    const result = { name: 'frame-startup-and-home-recovery', status: 'passed', checks: [] };
    let origin;
    const runner = await context.newPage();
    let page, backup, syncBackup;
    const visits = [];
    const counts = new Map();
    const handler = async route => {
        const url = new URL(route.request().url());
        const mode = url.pathname.split('/')[2];
        const base = `/startup/${mode}/`;
        const id = url.searchParams.get('panelId');
        if (url.pathname.includes('/d-solo/')) {
            const key = mode + ':' + id;
            counts.set(key, (counts.get(key) || 0) + 1);
            visits.push(key);
            if (mode === 'refresh') {
                await route.fulfill({ contentType: 'text/html', body: '<title>Refresh - Grafana</title><div class="panel-content"><canvas width="300" height="100"></canvas></div>' }); return;
            }
            if (id === '1' && mode === 'slow') {
                await route.fulfill({ contentType: 'text/html', body: '<title>Panel - Grafana</title><h2>Waiting for data</h2>' }); return;
            }
            if (id === '1' && (mode !== 'recover' || counts.get(key) === 1)) {
                await route.fulfill({ status: 302, headers: { location: base + 'rotate' }, body: '' }); return;
            }
            await route.fulfill({ contentType: 'text/html', body: '<title>Panel - Grafana</title><h2>Expected graph</h2><div class="panel-content"><canvas width="300" height="100"></canvas></div>' }); return;
        }
        if (url.pathname.endsWith('/rotate')) {
            await route.fulfill({ status: 302, headers: { location: base + 'login' }, body: '' }); return;
        }
        if (url.pathname.endsWith('/login') && mode !== 'login') {
            await route.fulfill({ status: 302, headers: { location: base }, body: '' }); return;
        }
        await route.fulfill({ contentType: 'text/html', body: mode === 'login'
            ? '<title>Login - Grafana</title><h1>Sign in</h1><input aria-label="Login">'
            : '<title>Home - Dashboards - Grafana</title><h1>Welcome to Grafana</h1>' });
    };
    // Playwright routing only intercepts the first URL in a redirect chain.
    // Serve real HTTP redirects so every hop exercises Chromium navigation.
    const server = http.createServer((request, response) => {
        void handler({ request: () => ({ url: () => origin + request.url }),
            fulfill: async ({ status = 200, headers = {}, contentType, body }) => {
                response.writeHead(status, { ...headers, ...(contentType ? { 'content-type': contentType } : {}) });
                response.end(body);
            } }).catch(() => { response.writeHead(500); response.end(); });
    });
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        origin = `http://127.0.0.1:${server.address().port}`;
        await runner.goto(`chrome-extension://${extensionId}/pages/test-runner/test-runner.html`);
        backup = await runner.evaluate(() => chrome.storage.local.get(['dashbridge_profiles', 'dashbridge_activeProfileId']));
        syncBackup = await runner.evaluate(() => chrome.storage.sync.get('grafanaIframeDomains'));
        for (const mode of ['slow', 'recover', 'repeat', 'login', 'refresh']) {
            const profile = { id: 'startup-' + mode, name: 'Startup ' + mode,
                timeState: { from: '1787774259463', to: '1787791648851', refresh: '' },
                panels: (mode === 'refresh' ? [1, 2, 3] : [1, 2]).map(id => ({
                id: 'startup-' + id, title: 'Graph ' + id, width: '50%', height: '350px',
                paused: id === 3,
                src: `${origin}/startup/${mode}/d-solo/uid/name?panelId=${id}&var-host=one&var-host=two`
            })) };
            await runner.evaluate(p => chrome.storage.local.set({ dashbridge_profiles: [p], dashbridge_activeProfileId: p.id }), profile);
            page = await context.newPage();
            await page.goto(`chrome-extension://${extensionId}/pages/dashbridge/dashbridge.html`);
            await page.locator('#iframe-startup-2').waitFor();
            if (mode === 'refresh') {
                await page.frameLocator('#iframe-startup-1').locator('canvas').waitFor();
                await page.frameLocator('#iframe-startup-2').locator('canvas').waitFor();
                for (let attempt = 0; attempt < 2; attempt++) {
                    const expected = [1, 2].map(id => (counts.get('refresh:' + id) || 0) + 1);
                    await Promise.all([
                        ...[1, 2].map(id => page.waitForResponse(response =>
                            response.request().isNavigationRequest() && new URL(response.url()).searchParams.get('panelId') === String(id),
                        { timeout: 4000 })),
                        page.locator('#forceRefreshBtn').click(),
                    ]);
                    assert.deepEqual([1, 2].map(id => counts.get('refresh:' + id)), expected,
                        'each header refresh must load exactly one document per active panel');
                    for (const id of [1, 2]) {
                        const url = new URL(await page.locator('#iframe-startup-' + id).getAttribute('src'));
                        assert.equal(url.searchParams.get('from'), profile.timeState.from);
                        assert.equal(url.searchParams.get('to'), profile.timeState.to);
                        assert.deepEqual(url.searchParams.getAll('var-host'), ['one', 'two']);
                        assert.match(url.hash, /dashbridgeRefresh=off/);
                    }
                }
                assert.equal(counts.get('refresh:3'), undefined, 'paused panels stay unloaded');
                const saved = await runner.evaluate(async () => (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles[0]);
                assert(saved.panels.every(panel => !new URL(panel.src).searchParams.has('_t')),
                    'refresh navigation tokens must not be saved in panel URLs');
                result.checks.push('repeated header refresh reloads each active document once, preserves period/variables/Off and excludes paused panels');
            } else if (mode === 'slow') {
                await page.frameLocator('#iframe-startup-2').locator('canvas').waitFor({ timeout: 5000 });
                assert.equal(await page.frameLocator('#iframe-startup-1').locator('canvas,table,.panel-content').count(), 0);
                result.checks.push('completed document releases followers within five seconds even without any first-panel renderer');
            } else if (mode === 'recover') {
                await page.frameLocator('#iframe-startup-2').locator('canvas').waitFor();
                assert.deepEqual(visits.filter(v => v.startsWith(mode)), ['recover:1', 'recover:1', 'recover:2']);
                assert.equal(await page.locator('.frame-load-notice').count(), 0);
                assert.equal(await page.locator('#iframe-startup-1').getAttribute('data-dashbridge-loaded'), 'true');
                result.checks.push('real redirect chain retries original panel once before releasing follower');
            } else if (mode === 'repeat') {
                await page.locator('.frame-load-notice button').waitFor();
                await page.frameLocator('#iframe-startup-2').locator('canvas').waitFor();
                assert.equal(counts.get('repeat:1'), 2);
                assert.equal(await page.locator('#iframe-startup-1').getAttribute('data-dashbridge-loaded'), 'false');
                await page.locator('.frame-load-notice button').click();
                await page.locator('.frame-load-notice button').waitFor();
                assert.equal(counts.get('repeat:1'), 4);
                result.checks.push('repeated Home shows bounded error and manual retry; Home is never panel-ready');
            } else {
                await page.frameLocator('#iframe-startup-1').getByRole('textbox', { name: 'Login' }).waitFor();
                await page.frameLocator('#iframe-startup-2').locator('canvas').waitFor();
                assert.equal(counts.get('login:1'), 1);
                assert.equal(await page.locator('.frame-load-notice').count(), 0);
                result.checks.push('login stays interactive without retry and releases followers');
            }
            const saved = await runner.evaluate(async () => (await chrome.storage.local.get('dashbridge_profiles')).dashbridge_profiles[0]);
            assert(!saved.panels.some(p => /Welcome|Home|Sign in/.test(p.title)), 'redirected page must not overwrite panel titles');
            await page.close(); page = null;
        }
    } catch (error) {
        result.status = 'failed'; result.error = error.stack || String(error);
        result.visits = visits;
        result.frames = await Promise.all((page?.frames().slice(1) || []).map(frame => frame.evaluate(() => ({
            url: location.href, title: document.title, body: document.body?.innerText.slice(0,250),
            canvas: document.querySelectorAll('canvas').length,
        })).catch(() => null)));
        await page?.screenshot({ path: 'test-results/frame-startup-failure.png' }).catch(() => {});
    } finally {
        await page?.close();
        await new Promise(resolve => server.close(resolve));
        if (backup) await runner.evaluate(b => chrome.storage.local.set(b), backup);
        if (syncBackup) await runner.evaluate(b => chrome.storage.sync.set(b), syncBackup);
        await runner.close();
    }
    return result;
};
