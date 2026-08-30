'use strict';
/* global DashBridgeTestRunner, buildFailureReport, diagnosticSpool */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const {
    projectRoot,
    resolveProfileRoot,
    validateGrafanaUrls,
    waitForExtensionWorker
} = require('./setup-grafana-e2e-profile');

const resultsRoot = path.join(projectRoot, 'test-results');
const reportPath = path.join(resultsRoot, 'live-grafana-e2e.json');
const failureReportPath = path.join(resultsRoot, 'live-grafana-e2e-failures.txt');
const MAX_EVIDENCE_ENTRIES = 200;
const compactText = (value, maxLength = 2_000) => String(value || '').slice(0, maxLength);

function pushBoundedEvidence(target, entry) {
    target.push(entry);
    if (target.length > MAX_EVIDENCE_ENTRIES) {
        target.splice(0, target.length - MAX_EVIDENCE_ENTRIES);
    }
}

function parseArguments(values) {
    let mode = 'fast';
    const urls = [];
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value === '--mode') {
            mode = values[index + 1] || '';
            index += 1;
        } else if (value.startsWith('--mode=')) {
            mode = value.slice('--mode='.length);
        } else if (value.startsWith('--')) {
            throw new Error(`Unknown option: ${value}`);
        } else {
            urls.push(value);
        }
    }
    if (!['fast', 'full'].includes(mode)) throw new Error(`Unsupported E2E mode: ${mode}`);
    return { mode, urls: validateGrafanaUrls(urls) };
}

function compactSnapshot(snapshot) {
    return {
        running: !!snapshot?.running,
        aborted: !!snapshot?.aborted,
        runId: snapshot?.runId || null,
        startedAt: snapshot?.startedAt || null,
        finishedAt: snapshot?.finishedAt || null,
        mode: snapshot?.mode || 'fast',
        total: Number(snapshot?.total) || 0,
        planned: Number(snapshot?.planned) || 0,
        scheduled: Number(snapshot?.scheduled) || 0,
        started: Number(snapshot?.started) || 0,
        completed: Number(snapshot?.completed) || 0,
        abortedNotRun: Number(snapshot?.abortedNotRun) || 0,
        passed: Number(snapshot?.passed) || 0,
        failed: Number(snapshot?.failed) || 0,
        skipped: Number(snapshot?.skipped) || 0,
        results: (snapshot?.results || []).map(result => ({
            url: result.url,
            grafanaVersion: result.grafanaVersion || null,
            engine: result.engine || null,
            isFlot: result.isFlot ?? null,
            probeOk: result.probeOk === true,
            probeError: result.probeError || null,
            panelId: result.panelId || null,
            capabilities: result.capabilities || null,
            planned: Number(result.planned) || 0,
            completed: Number(result.completed) || 0,
            abortedNotRun: Number(result.abortedNotRun) || 0,
            environmentUnsafe: result.environmentUnsafe === true,
            tests: (result.tests || []).map(test => ({
                id: test.id,
                category: test.category,
                name: test.name,
                pass: test.pass === true,
                skip: test.skip === true,
                aborted: test.aborted === true,
                timedOut: test.timedOut === true,
                durationMs: Number(test.durationMs) || 0,
                details: test.details || '',
                error: test.error || null,
                diagnosticRef: test.diagnosticRef || null
            }))
        }))
    };
}

function attachEvidenceListeners(context, evidence) {
    const attached = new WeakSet();
    const attach = page => {
        if (attached.has(page)) return;
        attached.add(page);
        page.on('console', message => {
            if (!['error', 'warning'].includes(message.type())) return;
            pushBoundedEvidence(evidence.console, {
                at: new Date().toISOString(),
                type: message.type(),
                page: compactText(page.url(), 2_048),
                text: compactText(message.text())
            });
        });
        page.on('pageerror', error => pushBoundedEvidence(evidence.pageErrors, {
            at: new Date().toISOString(),
            page: compactText(page.url(), 2_048),
            message: compactText(error.message),
            stack: error.stack ? compactText(error.stack, 4_000) : null
        }));
        page.on('requestfailed', request => pushBoundedEvidence(evidence.failedRequests, {
            at: new Date().toISOString(),
            page: compactText(page.url(), 2_048),
            url: compactText(request.url(), 2_048),
            method: compactText(request.method(), 16),
            errorText: compactText(request.failure()?.errorText || 'unknown', 500)
        }));
    };
    context.pages().forEach(attach);
    context.on('page', attach);
}

async function readRunnerSnapshot(page) {
    return page.evaluate(() => DashBridgeTestRunner.getSnapshot());
}

async function readFailureDiagnostics(page) {
    return page.evaluate(async () => {
        const snapshot = DashBridgeTestRunner.getSnapshot();
        if (!diagnosticSpool) return [];
        const compactRuntime = runtime => runtime ? {
            at: runtime.at || null,
            environment: runtime.environment || null,
            panelFound: runtime.panelFound ?? null,
            renderer: runtime.renderer || null,
            tools: runtime.tools || null,
            markers: runtime.markers || null,
            visualStyleState: runtime.visualStyleState || null,
            interceptor: runtime.interceptor ? {
                queryResponses: runtime.interceptor.queryResponses || 0,
                transformed: runtime.interceptor.transformed || 0,
                exactMatches: runtime.interceptor.exactMatches || 0,
                legendFallbackMatches: runtime.interceptor.legendFallbackMatches || 0,
                unmatched: runtime.interceptor.unmatched || 0,
                activeRequests: runtime.interceptor.activeRequests || 0,
                last: runtime.interceptor.last || null,
                events: runtime.interceptor.events || []
            } : null,
            visualReapplyDiagnostic: runtime.visualReapplyDiagnostic || null,
            thresholdDiagnostic: runtime.thresholdDiagnostic || null,
            logs: runtime.logs || []
        } : null;
        const compactCommand = command => command ? {
            status: command.status || null,
            acknowledgement: command.acknowledgement || null,
            commandDiagnostic: command.commandDiagnostic || null,
            lifecycle: command.lifecycle || null,
            settlement: command.settlement || null,
            persistence: command.persistence || null,
            afterCommandBeforeRefresh: compactRuntime(command.afterCommandBeforeRefresh)
        } : null;
        const failures = [];
        for (let urlIndex = 0; urlIndex < snapshot.results.length; urlIndex += 1) {
            const result = snapshot.results[urlIndex];
            for (let testIndex = 0; testIndex < result.tests.length; testIndex += 1) {
                const test = result.tests[testIndex];
                if (test.pass || test.skip || test.aborted || !test.diagnosticRef) continue;
                const full = await diagnosticSpool.readTest(test.diagnosticRef);
                const diagnostic = full?.diagnostic || null;
                failures.push({
                    urlIndex,
                    testIndex,
                    id: test.id,
                    name: test.name,
                    details: test.details || '',
                    diagnostic: diagnostic ? {
                        kind: diagnostic.kind || null,
                        schema: diagnostic.schema || null,
                        environmentUnsafe: diagnostic.environmentUnsafe === true,
                        opened: compactRuntime(diagnostic.opened),
                        baseline: compactRuntime(diagnostic.baseline),
                        isolation: diagnostic.isolation ? {
                            ...diagnostic.isolation,
                            afterCommandBeforeRefresh: compactRuntime(diagnostic.isolation.afterCommandBeforeRefresh)
                        } : null,
                        transitions: (diagnostic.transitions || []).map(transition => ({
                            index: transition.index,
                            label: transition.label,
                            settings: transition.settings,
                            activeIds: transition.activeIds,
                            command: compactCommand(transition.command),
                            lifecycle: transition.lifecycle || null,
                            settlement: transition.settlement || null,
                            invariant: transition.invariant || null,
                            verdict: transition.verdict || null,
                            before: compactRuntime(transition.before),
                            after: compactRuntime(transition.after)
                        })),
                        reset: diagnostic.reset ? {
                            command: compactCommand(diagnostic.reset.command),
                            lifecycle: diagnostic.reset.lifecycle || null,
                            settlement: diagnostic.reset.settlement || null,
                            nativeLegend: diagnostic.reset.nativeLegend || null,
                            invariant: diagnostic.reset.invariant || null,
                            pass: diagnostic.reset.pass === true,
                            verdict: diagnostic.reset.verdict || null,
                            after: compactRuntime(diagnostic.reset.after)
                        } : null,
                        actionTimeline: (diagnostic.actionTimeline || []).map(action => ({
                            sequence: action.sequence,
                            action: action.action,
                            description: action.description,
                            durationMs: action.durationMs,
                            output: action.output
                        }))
                    } : null
                });
            }
        }
        return failures;
    });
}

async function main() {
    const { mode, urls } = parseArguments(process.argv.slice(2));
    const profileRoot = resolveProfileRoot();
    const chromeExecutable = process.env.DASHBRIDGE_CHROME_PATH || chromium.executablePath();
    if (!fs.existsSync(profileRoot)) throw new Error(`Grafana E2E profile does not exist: ${profileRoot}`);
    if (!fs.existsSync(chromeExecutable)) throw new Error(`Playwright Chromium is missing: ${chromeExecutable}`);

    fs.mkdirSync(resultsRoot, { recursive: true });
    const evidence = { console: [], pageErrors: [], failedRequests: [] };
    const startedAt = new Date().toISOString();
    let context;
    let runnerPage;
    let snapshot;
    let failureReport = '';
    let failureDiagnostics = [];
    let interrupted = false;

    const stop = async () => {
        if (interrupted) return;
        interrupted = true;
        if (runnerPage && !runnerPage.isClosed()) {
            await runnerPage.evaluate(() => DashBridgeTestRunner.abort()).catch(() => undefined);
        }
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());

    try {
        context = await chromium.launchPersistentContext(profileRoot, {
            executablePath: chromeExecutable,
            headless: false,
            viewport: { width: 1400, height: 900 },
            args: [
                `--disable-extensions-except=${projectRoot}`,
                `--load-extension=${projectRoot}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--window-position=-32000,-32000'
            ]
        });
        attachEvidenceListeners(context, evidence);
        const extensionId = await waitForExtensionWorker(context);
        runnerPage = context.pages()[0] || await context.newPage();
        for (const extraPage of context.pages().slice(1)) await extraPage.close();
        await runnerPage.goto(`chrome-extension://${extensionId}/pages/test-runner/test-runner.html`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000
        });
        await runnerPage.waitForFunction(() => (
            globalThis.document.documentElement.dataset.dashbridgeTestRunnerReady === 'true'
        ), null, { timeout: 30_000 });
        await runnerPage.locator('#trUrlInput').fill(urls.join('\n'));
        await runnerPage.locator('#trRunMode').selectOption(mode);
        await runnerPage.locator('#trRunBtn').click();
        await runnerPage.waitForFunction(() => DashBridgeTestRunner.getSnapshot().running === true, null, {
            timeout: 30_000
        });

        let lastProgress = '';
        const timeoutMs = mode === 'full' ? 4 * 60 * 60_000 : 45 * 60_000;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            snapshot = await readRunnerSnapshot(runnerPage);
            const progress = `${snapshot.completed}/${snapshot.planned}:${snapshot.failed}:${snapshot.skipped}:${snapshot.currentUrl || ''}`;
            if (progress !== lastProgress) {
                console.log(`Live E2E ${snapshot.completed}/${snapshot.planned}: passed=${snapshot.passed}, failed=${snapshot.failed}, skipped=${snapshot.skipped}`);
                lastProgress = progress;
            }
            if (!snapshot.running && snapshot.finishedAt) break;
            await runnerPage.waitForTimeout(1_000);
        }
        if (!snapshot?.finishedAt || snapshot.running) {
            await stop();
            throw new Error(`Live Grafana E2E exceeded ${Math.round(timeoutMs / 60_000)} minutes`);
        }

        failureReport = await runnerPage.evaluate(() => (
            typeof buildFailureReport === 'function'
                ? buildFailureReport(DashBridgeTestRunner.getSnapshot())
                : ''
        ));
        failureDiagnostics = await readFailureDiagnostics(runnerPage);
        const compact = compactSnapshot(snapshot);
        const report = {
            schema: 'dashbridge-playwright-live-e2e/v1',
            startedAt,
            completedAt: new Date().toISOString(),
            chromeVersion: await context.browser()?.version(),
            extensionId,
            profileRoot,
            snapshot: compact,
            failureDiagnostics,
            evidence
        };
        fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        fs.writeFileSync(failureReportPath, failureReport || 'No failed, skipped or aborted tests.\n', 'utf8');

        console.log(`Live Grafana E2E: ${compact.passed} passed, ${compact.failed} failed, ${compact.skipped} skipped, ${compact.abortedNotRun} not run.`);
        console.log(`Report: ${reportPath}`);
        if (compact.failed || compact.aborted || compact.abortedNotRun) process.exitCode = 1;
    } catch (error) {
        const fatalReport = {
            schema: 'dashbridge-playwright-live-e2e/v1',
            startedAt,
            failedAt: new Date().toISOString(),
            error: { name: error.name, message: error.message, stack: error.stack || null },
            snapshot: snapshot ? compactSnapshot(snapshot) : null,
            failureDiagnostics,
            evidence
        };
        fs.writeFileSync(reportPath, `${JSON.stringify(fatalReport, null, 2)}\n`, 'utf8');
        if (runnerPage && !runnerPage.isClosed()) {
            await runnerPage.screenshot({ path: path.join(resultsRoot, 'live-grafana-e2e-fatal.png'), fullPage: true }).catch(() => undefined);
        }
        throw error;
    } finally {
        if (context) await context.close().catch(() => undefined);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
}

module.exports = { compactSnapshot, parseArguments, pushBoundedEvidence };
