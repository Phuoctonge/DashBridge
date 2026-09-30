'use strict';

const { chromium } = require('@playwright/test');

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 9222) || 9222;

(async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const pages = browser.contexts().flatMap(context => context.pages());
    const page = pages.find(candidate => /^https?:\/\/grafanakns\.mos\.ru\//.test(candidate.url())) || pages[0];
    if (!page) throw new Error('Открытая Grafana-вкладка не найдена.');
    const result = await page.evaluate(async () => {
        const response = await fetch('/api/user', { credentials: 'include' });
        return {
            apiUserStatus: response.status,
            url: location.href,
            path: location.pathname,
            authenticated: response.status === 200 && !/^\/login(?:\/|$)/.test(location.pathname),
        };
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.authenticated) process.exitCode = 2;
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
