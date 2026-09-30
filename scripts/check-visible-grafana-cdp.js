'use strict';

const { chromium } = require('@playwright/test');

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 9222) || 9222;

(async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const pages = browser.contexts()
        .flatMap(context => context.pages())
        .filter(candidate => /^https?:\/\//.test(candidate.url()));
    if (!pages.length) throw new Error('Открытая HTTP(S)-вкладка не найдена.');

    const results = [];
    for (const page of pages) {
        const result = await page.evaluate(async () => {
            try {
                const response = await fetch('/api/user', { credentials: 'include' });
                return {
                    apiUserStatus: response.status,
                    url: location.href,
                    path: location.pathname,
                    authenticated: response.status === 200 && !/^\/login(?:\/|$)/.test(location.pathname),
                };
            } catch (error) {
                return { url: location.href, authenticated: false, error: String(error) };
            }
        });
        results.push(result);
        if (result.authenticated) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }
    }
    console.log(JSON.stringify({ authenticated: false, pages: results }, null, 2));
    process.exitCode = 2;
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
