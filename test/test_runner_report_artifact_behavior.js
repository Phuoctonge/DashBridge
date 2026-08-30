// Behavioral tests for compact adaptive v4 diagnostic artifacts.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'test-runner', 'test-runner-report.js'),
    'utf8'
);
const context = vm.createContext({ console, Date });
vm.runInContext(`${code}\nthis.__report = DashBridgeTestReport;`, context);

const image = `data:image/png;base64,${'A'.repeat(2048)}`;
const skipImage = `data:image/png;base64,${'B'.repeat(1024)}`;
const repeatedOuterHTML = '<section class="panel">same panel</section>';
const repeatedNetworkEvent = { id: 7, type: 'transform-complete', panelId: '12' };
const repeatedVisualEvent = { id: 9, type: 'visual-reapply', panelId: '12' };
const repeatedResource = { name: 'https://grafana.example/api/ds/query', initiatorType: 'fetch', duration: 12 };
const snapshot = {
    runId: 'run-test', startedAt: 1000, finishedAt: 2500,
    mode: 'full', total: 4, planned: 4, scheduled: 4, started: 2, completed: 2,
    passed: 0, failed: 1, skipped: 1, abortedNotRun: 2, aborted: false,
    results: [{
        url: 'https://grafana.example/d/test', planned: 4, completed: 2, abortedNotRun: 2,
        tests: [
            {
                id: 'H4_1', name: 'visibility', category: 'H', pass: false, durationMs: 500,
                details: 'Сброс не выполнен',
                diagnostic: {
                    reset: { pass: false, verdict: { reason: 'Нативная видимость легенды не восстановлена' } },
                    before: {
                        canvas: [{ dataUrl: image }],
                        visualCapture: { visualStateRef: 'visual-state-test', signatureHash: 'same', requestedMode: 'canvas', reason: 'test' },
                        domSnapshot: { root: { outerHTML: repeatedOuterHTML, outerHTMLHash: 'same' } },
                        environment: { resources: [repeatedResource] },
                        interceptor: { nextEventId: 8, events: [repeatedNetworkEvent] },
                        visualReapplyDiagnostic: { nextEventId: 10, events: [repeatedVisualEvent] },
                    },
                    after: {
                        canvas: [{ dataUrl: image }],
                        visualCapture: { visualStateRef: 'visual-state-test', signatureHash: 'same', requestedMode: 'canvas', reason: 'test' },
                        domSnapshot: { root: { outerHTML: repeatedOuterHTML, outerHTMLHash: 'same' } },
                        environment: { resources: [repeatedResource] },
                        interceptor: { nextEventId: 8, events: [repeatedNetworkEvent] },
                        visualReapplyDiagnostic: { nextEventId: 10, events: [repeatedVisualEvent] },
                    },
                },
            },
            { id: 'H5_1', name: 'CPU', category: 'H', pass: true, skip: true, details: 'SKIP: нет CPU-панели', durationMs: 10, diagnostic: { before: { canvas: [{ dataUrl: skipImage }] } } },
            { id: 'H4_2', name: 'next', category: 'H', pass: false, aborted: true, details: 'Не запущен', diagnostic: { notRun: true, environmentUnsafe: true } },
            { id: 'H4_3', name: 'next', category: 'H', pass: false, aborted: true, details: 'Не запущен', diagnostic: { notRun: true, environmentUnsafe: true } },
        ],
    }],
};

const artifact = context.__report.buildArtifact(snapshot, { exportedAt: '2026-08-17T00:00:00.000Z', extensionVersion: '2.0' });
assert.strictEqual(artifact.schema, 'dashbridge-e2e-diagnostics/v4');
assert.strictEqual(artifact.capturePolicy.mode, 'adaptive-visual-evidence/v1');
assert.strictEqual(artifact.aiIndex.verdict, 'failed');
assert.strictEqual(artifact.summary.runId, 'run-test');
assert.strictEqual(artifact.exportedAt, '2026-08-17T00:00:00.000Z');
assert.strictEqual(artifact.summary.durationMs, 1500);
assert.strictEqual(artifact.summary.reconciliation.valid, true);
assert.strictEqual(artifact.analysis.verdict, 'failed');
assert.strictEqual(artifact.analysis.primaryFailure.testId, 'H4_1');
assert.strictEqual(artifact.analysis.primaryFailure.reasonCode, 'reset-native-legend-not-restored');
assert.strictEqual(artifact.analysis.skipClusters[0].reasonCode, 'capability-no-cpu');
assert.strictEqual(artifact.analysis.notRunClusters[0].reasonCode, 'not-run-environment-unsafe');
assert.strictEqual(artifact.assets.policy, 'all-snapshots-deduplicated/v1');
assert.strictEqual(artifact.assets.retainedImages, 2, 'все изображения сохраняются, одинаковые дедуплицируются');
assert.strictEqual(artifact.assets.omittedImages, 0);
assert.strictEqual(artifact.visualStates['visual-state-test'].uses, 2);
assert.strictEqual(artifact.visualStates['visual-state-test'].evidence.canvasImageRefs.length, 1);
assert.strictEqual(artifact.assets.retainedDomSnapshots, 1, 'одинаковый DOM сохраняется один раз');
assert.strictEqual(artifact.assets.retainedDiagnosticEvents, 2, 'сетевое и визуальное события сохраняются без копий');
assert.strictEqual(artifact.assets.retainedPerformanceResources, 1, 'одинаковый resource timing сохраняется один раз');
const streamPlan = context.__report.createArtifactStreamPlan(snapshot, { extensionVersion: 'test' });
const streamedResults = streamPlan.sourceResults.map(urlResult => ({
    ...streamPlan.compactUrlMetadata(urlResult),
    tests: urlResult.tests.map(test => streamPlan.compactTest(test)),
}));
assert.deepStrictEqual(JSON.parse(JSON.stringify(streamedResults)), JSON.parse(JSON.stringify(artifact.results)),
    'streamed report plan must preserve the normal artifact result schema');
assert.deepStrictEqual(JSON.parse(JSON.stringify(streamPlan.assets())), JSON.parse(JSON.stringify(artifact.assets)),
    'streamed report plan must preserve deduplicated screenshot assets');
const isolatedTestArtifact = context.__report.createTestArtifact(snapshot.results[0].tests[0]);
assert.strictEqual(isolatedTestArtifact.value.reasonCode, 'reset-native-legend-not-restored');
assert(isolatedTestArtifact.analysisUnit && !isolatedTestArtifact.value.analysisUnit,
    'incremental analysis metadata must stay out of exported test results');
assert.strictEqual(isolatedTestArtifact.assets.retainedImages, 1,
    'per-test compaction must expose assets for immediate disk persistence');
assert(!JSON.stringify(isolatedTestArtifact.value).includes(image),
    'a disposable compacted test must not retain inline image payloads');
const isolatedUrlArtifact = context.__report.createUrlMetadataArtifact({
    url: 'https://grafana.example/d/test',
    diagnostic: { opened: { panelImage: { dataUrl: image } } },
    tests: [{ id: 'must-not-be-copied' }],
});
assert.strictEqual(isolatedUrlArtifact.value.tests, undefined);
assert.strictEqual(isolatedUrlArtifact.assets.retainedImages, 1,
    'URL lifecycle evidence must use the same disk-persistable asset contract');
const precomputedTests = snapshot.results[0].tests.map(test => {
    const isolated = context.__report.createTestArtifact(test, { url: snapshot.results[0].url });
    const value = isolated.value;
    return {
        id: value.id, category: value.category, name: value.name,
        pass: value.pass, skip: value.skip, aborted: value.aborted,
        details: value.details, durationMs: value.durationMs,
        reasonCode: value.reasonCode, shortReason: value.shortReason,
        visualAudit: value.visualAudit, analysisUnit: isolated.analysisUnit,
    };
});
const precomputedArtifact = context.__report.buildArtifact({
    ...snapshot,
    results: [{ url: snapshot.results[0].url, tests: precomputedTests }],
});
assert.strictEqual(precomputedArtifact.analysis.verdict, artifact.analysis.verdict);
assert.deepStrictEqual(JSON.parse(JSON.stringify(precomputedArtifact.analysis.failureClusters)),
    JSON.parse(JSON.stringify(artifact.analysis.failureClusters)),
    'incremental per-test analysis must preserve failure clustering');
assert.deepStrictEqual(JSON.parse(JSON.stringify(precomputedArtifact.analysis.visualEvidenceCoverage)),
    JSON.parse(JSON.stringify(artifact.analysis.visualEvidenceCoverage)),
    'incremental per-test analysis must preserve visual evidence accounting');
assert.deepStrictEqual(JSON.parse(JSON.stringify(precomputedArtifact.analysis.resetHealth)),
    JSON.parse(JSON.stringify(artifact.analysis.resetHealth)),
    'incremental per-test analysis must preserve reset accounting');
assert(!JSON.stringify(artifact.results).includes(image), 'data URL должен находиться только в assets');
assert(!JSON.stringify(artifact.results).includes(skipImage), 'кадр SKIP также должен находиться в assets');
assert(!JSON.stringify(artifact.results).includes(repeatedOuterHTML), 'полный DOM должен находиться только в assets');
assert.strictEqual(artifact.results[0].tests[0].diagnostic.before.domSnapshot.root.outerHTMLRef,
    artifact.results[0].tests[0].diagnostic.after.domSnapshot.root.outerHTMLRef);
assert.strictEqual(artifact.results[0].tests[0].diagnostic.before.interceptor.events[0].assetRef,
    artifact.results[0].tests[0].diagnostic.after.interceptor.events[0].assetRef);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(artifact.assets.diagnosticEvents[
        artifact.results[0].tests[0].diagnostic.before.interceptor.events[0].assetRef
    ].value)),
    repeatedNetworkEvent,
    'ссылка на событие обязана разрешаться в полное исходное доказательство'
);
assert.strictEqual(artifact.results[0].tests[0].diagnostic.before.canvas[0].imageRef,
    artifact.results[0].tests[0].diagnostic.after.canvas[0].imageRef);
assert.strictEqual(context.__report.reasonCodeOf({
    pass: false,
    details: 'команда не подтверждена: isolation-reset-failed',
    diagnostic: {
        transitions: [{ command: { status: 'isolation-reset-failed' }, verdict: { outcome: 'fail' } }],
        reset: { pass: false, verdict: { reason: 'Нативная видимость легенды не восстановлена' } },
    },
}), 'isolation-reset-failed', 'каскад должен отделяться от первичного reset-дефекта');
assert.strictEqual(context.__report.reasonCodeOf({
    pass: false,
    details: 'Сброс не доказан',
    diagnostic: {
        reset: {
            pass: false,
            nativeLegend: { pass: true },
            verdict: { reason: 'легенда восстановлена; не доказано отключение source-фильтра' },
        },
    },
}), 'reset-not-proven', 'положительное упоминание легенды не должно маскировать настоящую причину reset');
assert.strictEqual(context.__report.reasonCodeOf({
    pass: false,
    details: 'панель не стабилизировалась',
    diagnostic: {
        transitions: [{
            command: { status: 'applied' },
            lifecycle: { status: 'target-complete' },
            settlement: { status: 'timeout' },
            invariant: { pass: false },
            verdict: { outcome: 'fail' },
        }],
        reset: { pass: true },
    },
}), 'panel-settlement-timeout', 'гонка отрисовки должна иметь отдельный reason code');

const suspiciousAudit = context.__report.buildVisualAudit({
    pass: true,
    diagnostic: {
        before: { canvas: [{ hash: 'external-before' }] },
        baseline: { canvas: [{ hash: 'baseline' }] },
        transitions: [{
            label: 'removeFill ON',
            settings: { visualSettings: { removeFill: true } },
            before: { canvas: [{ hash: 'same' }], renderer: 'uplot', series: [{ fill: true }] },
            after: { canvas: [{ hash: 'same' }], renderer: 'uplot', series: [{ fill: true }] },
            invariant: { pass: true }, verdict: { outcome: 'pass' },
        }],
        after: { canvas: [{ hash: 'external-after' }] },
        reset: { after: { canvas: [{ hash: 'reset' }] } },
    },
});
assert.strictEqual(suspiciousAudit.suspicious, true);
assert(suspiciousAudit.transitions[0].issues.includes('changed-active-set-without-image-change'));
assert.strictEqual(suspiciousAudit.transitions[0].imageChanged, false);

const repeatedOnAudit = context.__report.buildVisualAudit({
    pass: true,
    diagnostic: {
        before: { canvas: [{ hash: 'external-before' }] }, baseline: { canvas: [{ hash: 'baseline' }] },
        transitions: [1, 2].map(index => ({
            label: `removeFill ON ${index}`, settings: { visualSettings: { removeFill: true } },
            before: { canvas: [{ hash: index === 1 ? 'off' : 'on' }] }, after: { canvas: [{ hash: 'on' }] },
            invariant: { pass: true }, verdict: { outcome: 'pass' },
        })),
        after: { canvas: [{ hash: 'external-after' }] }, reset: { after: { canvas: [{ hash: 'reset' }] } },
    },
});
assert.strictEqual(repeatedOnAudit.transitions[1].activeSetChanged, false);
assert(!repeatedOnAudit.transitions[1].issues.includes('changed-active-set-without-image-change'), 'повторный ON обязан быть идемпотентным');

const semanticSnapshot = (hash, tools = {}) => ({
    renderer: 'uplot',
    canvas: [{ hash, width: 100, height: 40, pixelStats: { samples: 10, luminanceMean: 20, luminanceStdDev: 5, histogram16: [10] } }],
    markers: {}, legend: { entries: 2 }, series: [{ label: 'A' }], tools,
    visualCapture: { mode: 'hash-only', requestedMode: 'semantic-only', visualStateRef: `visual-${hash}` },
});
const canvasSnapshot = (hash, tools = {}) => ({
    ...semanticSnapshot(hash, tools),
    canvas: [{ hash, dataUrl: image, width: 100, height: 40, pixelStats: { samples: 10, luminanceMean: 30, luminanceStdDev: 6, histogram16: [0, 10] } }],
    visualCapture: { mode: 'captured-canvas', requestedMode: 'canvas', visualStateRef: `visual-${hash}` },
});
const panelSnapshot = (hash, tools = {}) => ({
    ...canvasSnapshot(hash, tools),
    panelImage: { hash: `panel-${hash}`, dataUrl: image, width: 120, height: 80 },
    visualCapture: { mode: 'captured', requestedMode: 'panel', visualStateRef: `visual-${hash}` },
});
const adaptiveAudit = context.__report.buildVisualAudit({
    pass: true,
    diagnostic: {
        before: semanticSnapshot('off', { removeFill: false }),
        opened: semanticSnapshot('off', { removeFill: false }),
        baseline: panelSnapshot('off', { removeFill: false }),
        transitions: [{
            settings: { visualSettings: { removeFill: true } },
            before: semanticSnapshot('off', { removeFill: false }),
            command: { afterCommandBeforeRefresh: semanticSnapshot('on', { removeFill: true }) },
            persistence: { required: true, passed: true, beforeRefresh: semanticSnapshot('on', { removeFill: true }) },
            after: canvasSnapshot('on', { removeFill: true }),
            invariant: { pass: true }, verdict: { outcome: 'pass' },
        }],
        after: semanticSnapshot('off', { removeFill: false }),
        reset: {
            command: { afterCommandBeforeRefresh: semanticSnapshot('off', { removeFill: false }) },
            after: panelSnapshot('off', { removeFill: false }),
        },
    },
});
assert.strictEqual(adaptiveAudit.complete, true, 'adaptive evidence must not require duplicate PNGs for semantic checkpoints');
assert(!adaptiveAudit.transitions[0].issues.some(issue => issue.startsWith('missing-')));

const missingPanelAudit = context.__report.buildVisualAudit({
    pass: true,
    diagnostic: {
        before: semanticSnapshot('before'), opened: semanticSnapshot('before'), baseline: panelSnapshot('before'),
        transitions: [{
            settings: { visualSettings: { invertLegend: true } },
            before: semanticSnapshot('before'),
            command: { afterCommandBeforeRefresh: semanticSnapshot('after') },
            after: canvasSnapshot('after'), invariant: { pass: true }, verdict: { outcome: 'pass' },
        }],
        after: semanticSnapshot('before'),
        reset: { command: { afterCommandBeforeRefresh: semanticSnapshot('before') }, after: panelSnapshot('before') },
    },
});
assert(missingPanelAudit.transitions[0].issues.includes('missing-after-panel-evidence'),
    'legend/layout transitions must retain a full-panel image');

const thresholdBefore = semanticSnapshot('same-threshold', { thresholdEnabled: false });
thresholdBefore.thresholdDiagnostic = { enabled: false };
thresholdBefore.markers = { thresholdEngine: '' };
const thresholdAfter = canvasSnapshot('same-threshold', { thresholdEnabled: true });
thresholdAfter.thresholdDiagnostic = { enabled: true };
thresholdAfter.markers = { thresholdEngine: 'uplot' };
const semanticThresholdAudit = context.__report.buildVisualAudit({
    pass: true,
    diagnostic: {
        before: thresholdBefore, opened: thresholdBefore, baseline: panelSnapshot('baseline-threshold'),
        transitions: [{
            settings: { transformSettings: { thresholdEnabled: true } },
            activeIds: ['thresholdEnabled'], changedIds: ['thresholdEnabled'],
            before: thresholdBefore,
            command: { afterCommandBeforeRefresh: thresholdAfter },
            persistence: { required: true, passed: true, beforeRefresh: thresholdAfter },
            after: thresholdAfter,
            invariant: { pass: true }, verdict: { outcome: 'pass' },
        }],
        after: thresholdAfter,
        reset: { command: { afterCommandBeforeRefresh: thresholdBefore }, after: panelSnapshot('reset-threshold') },
    },
});
assert.strictEqual(semanticThresholdAudit.transitions[0].imageChanged, false);
assert.strictEqual(semanticThresholdAudit.transitions[0].provenSemanticThresholdToggle, true);
assert(!semanticThresholdAudit.transitions[0].issues.includes('changed-active-set-without-image-change'),
    'a proven threshold engine toggle may be semantically valid without a pixel change');

const unstableRepeatAudit = context.__report.buildVisualAudit({
    pass: true,
    diagnostic: {
        before: { canvas: [{ hash: 'external-before' }] }, baseline: { canvas: [{ hash: 'baseline' }] },
        transitions: [
            { settings: { visualSettings: { thickenLines: true } }, before: { canvas: [{ hash: 'off', pixelStats: { samples: 10, luminanceMean: 20, luminanceStdDev: 5, histogram16: [10] } }] }, after: { canvas: [{ hash: 'on', pixelStats: { samples: 10, luminanceMean: 40, luminanceStdDev: 10, histogram16: [0, 0, 10] } }] }, invariant: { pass: true }, verdict: { outcome: 'pass' } },
            { settings: { visualSettings: { thickenLines: true } }, before: { canvas: [{ hash: 'on', pixelStats: { samples: 10, luminanceMean: 40, luminanceStdDev: 10, histogram16: [0, 0, 10] } }] }, after: { canvas: [{ hash: 'changed-again', pixelStats: { samples: 10, luminanceMean: 80, luminanceStdDev: 20, histogram16: [0, 0, 0, 0, 0, 10] } }] }, invariant: { pass: true }, verdict: { outcome: 'pass' } },
        ],
        after: { canvas: [{ hash: 'external-after' }] }, reset: { after: { canvas: [{ hash: 'reset' }] } },
    },
});
assert(unstableRepeatAudit.transitions[1].issues.includes('idempotent-repeat-large-visual-change'));
assert.strictEqual(unstableRepeatAudit.transitions[1].pixelComparisonSource, 'canvas');

const notRunAudit = context.__report.buildVisualAudit({ pass: false, aborted: true, diagnostic: { notRun: true } });
assert.strictEqual(notRunAudit.missingPhases.length, 0, 'NOT RUN не требует скриншотов');

const skippedTransitionAudit = context.__report.buildVisualAudit({
    pass: true,
    skip: true,
    details: 'SKIP: нет CPU-панели',
    diagnostic: {
        transitions: [],
        before: { canvas: [{ hash: 'before-skip' }] },
        opened: { canvas: [{ hash: 'opened-skip' }] },
        baseline: { canvas: [{ hash: 'baseline-skip' }] },
        after: { canvas: [{ hash: 'after-skip' }] },
    },
});
assert(!skippedTransitionAudit.missingPhases.includes('reset-after-command-before-refresh'),
    'SKIP не должен требовать неисполнявшийся reset-before-refresh');
assert(!skippedTransitionAudit.missingPhases.includes('reset-after'),
    'SKIP не должен требовать неисполнявшийся reset-after');

const longDetails = 'x'.repeat(20_000);
const lossless = context.__report.buildArtifact({
    total: 1, planned: 1, completed: 1, passed: 1, failed: 0, skipped: 0, abortedNotRun: 0,
    results: [{ url: 'https://grafana.example/d/lossless', tests: [{ id: 'A', name: 'lossless', pass: true, details: longDetails, diagnostic: { before: { canvas: [{ hash: 'a' }] }, after: { canvas: [{ hash: 'b' }] }, runtime: { events: Array.from({ length: 300 }, (_, id) => ({ id })) } } }] }],
});
assert.strictEqual(lossless.results[0].tests[0].details.length, longDetails.length, 'текст отчёта нельзя обрезать');
assert.strictEqual(lossless.results[0].tests[0].diagnostic.runtime.events.length, 300, 'события отчёта нельзя обрезать');

console.log('[OK] Test runner full-evidence report artifact behavior');
