'use strict';

const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const { projectRoot, testBrowserNetworkArgs, resolveChromeExecutable, resolveProfileRoot, waitForExtensionWorker } = require('../../scripts/setup-grafana-e2e-profile');
const { acquireProfileLock } = require('./profile-lock');
const { runLiveLegendScenario } = require('./scenarios/live-legend-scenario');
const { runLiveThresholdScenario } = require('./scenarios/threshold-live-scenario');
const { writeEvidence } = require('./evidence-writer');

function parseArgs(argv) {
    const values = {};
    const allowed = new Set(['url', 'panelSelector', 'panelId', 'hidden', 'threshold', 'sourceNames', 'scenario', 'evidence']);
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--') || !argv[index + 1]) throw new Error('Expected bounded --name value arguments');
        const name = token.slice(2);
        if (!allowed.has(name)) throw new Error(`Unknown live scenario option: --${name}`);
        values[name] = argv[index + 1]; index += 1;
    }
    const url = values.url;
    if (!url) throw new Error('Pass --url <Grafana dashboard URL>');
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('url must be HTTP(S) without credentials');
    return { url: parsed.href, panelSelector: values.panelSelector || '[data-testid="data-testid Panel header"]', panelId: values.panelId || null, hidden: (values.hidden || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, 100), threshold: values.threshold === undefined ? null : Number(values.threshold), sourceNames: (values.sourceNames || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, 100), scenario: values.scenario || 'legend-complete-hide', evidenceDir: values.evidence || null };
}

async function runLiveScenario(options) {
    const profileRoot = resolveProfileRoot();
    const executablePath = resolveChromeExecutable();
    if (!fs.existsSync(profileRoot) || !fs.existsSync(executablePath)) return { status: 'blocked', reason: 'profile-or-chromium-not-found' };
    const lock = acquireProfileLock(profileRoot);
    let context;
    try {
        context = await chromium.launchPersistentContext(profileRoot, { executablePath, headless: process.env.DASHBRIDGE_LIVE_HEADLESS !== 'false', viewport: { width: 1280, height: 900 }, args: [...testBrowserNetworkArgs, `--disable-extensions-except=${projectRoot}`, `--load-extension=${projectRoot}`, '--no-first-run'] });
        await waitForExtensionWorker(context);
        const page = await context.newPage();
        try {
            await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            if (typeof page.waitForSelector === 'function') {
                await page.waitForSelector(options.panelSelector, { state: 'attached', timeout: 5_000 });
            }
            const api = await context.request.get(new URL('/api/user', new URL(options.url).origin).href, { failOnStatusCode: false, timeout: 5_000 });
            if (api.status() !== 200 || /^\/login(?:\/|$)/.test(new URL(page.url()).pathname)) return { status: 'blocked', reason: 'grafana-authentication-required' };
            if (options.scenario === 'threshold-highlight') return await runLiveThresholdScenario({ page, panelSelector: options.panelSelector, panelId: options.panelId, threshold: options.threshold, sourceNames: options.sourceNames });
            return await runLiveLegendScenario({ page, panelSelector: options.panelSelector, panelId: options.panelId, hidden: options.hidden });
        } finally { await page.close().catch(() => undefined); }
    } catch (error) { return { status: 'blocked', reason: String(error.message || error).slice(0, 240) }; }
    finally { await context?.close().catch(() => undefined); lock.release(); }
}

if (require.main === module) runLiveScenario(parseArgs(process.argv.slice(2))).then(result => { const args = parseArgs(process.argv.slice(2)); if (args.evidenceDir) writeEvidence(args.evidenceDir, result, { filename: 'live-scenario.json' }); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'passed' ? 0 : 2; }).catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { parseArgs, runLiveScenario };
