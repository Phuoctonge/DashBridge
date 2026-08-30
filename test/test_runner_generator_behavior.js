// test_runner_generator_behavior.js
// Проверка активных runtime-контрактов тест-раннера.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const suiteCode = fs.readFileSync(
    path.join(__dirname, '..', 'pages/test-runner/test-runner-suite.js'),
    'utf8'
);

// Контракт автоматической диагностики остаётся доступным в suite.
[
    'async function installRuntimeDiagnostics(tabId)',
    'async function captureRuntimeDiagnostic(tabId, panelId, {',
    "captureMode = DIAGNOSTIC_CAPTURE_MODES.FORENSIC",
    "function canReuseRuntimeVisual(snapshot, source, captureMode = 'forensic')",
    'async function readRuntimeDiagnosticEvents(tabId, afterEventId = 0)',
    "kind: 'transition'",
    'diagnostic.transitions.push',
    'const changedIds = [...new Set([...previousActiveIds, ...activeIds])]',
    'visualEvidenceRequirement:',
    'nextEventId',
].forEach(fragment => {
    assert(suiteCode.includes(fragment), `Отсутствует диагностический контракт: ${fragment}`);
});

const coreCode = fs.readFileSync(
    path.join(__dirname, '..', 'pages/test-runner/test-runner-core.js'),
    'utf8'
);
[
    'function classifyRuntimeEvidence(runtime)',
    "policy: 'dashbridge-and-targeted-query-errors-fail/v1'",
    'const finalPass = functionalPass && runtimeEvidence.pass;',
    "schema: 'dashbridge-e2e-verdict/v1'",
    'runtime: runtimeEvidence,',
    'notRun: true,',
    'captureErrors: { before: beforeError, after: afterError }',
].forEach(fragment => {
    assert(coreCode.includes(fragment), `Отсутствует core-диагностика: ${fragment}`);
});

const uiCode = fs.readFileSync(
    path.join(__dirname, '..', 'pages/test-runner/test-runner-ui.js'),
    'utf8'
);
[
    'DashBridgeTestReport.createArtifactStreamPlan',
    'serializeSpoolArtifact(lastSnapshot, diagnosticSpool, exportMetadata,',
    'function showDiagnostic(test, urlResult)',
    'Предупреждения Grafana (не влияют на PASS/FAIL)',
    'Доказательства переходов:',
    'tr-diagnostic-btn',
    'function statusIcon(test)',
    "window.addEventListener('dashbridge-theme-change', syncPopupTheme)",
    "elCopyBtn.disabled = running || !lastSnapshot?.results?.length;",
    "elRunBtn.querySelector('.tr-btn-label')",
    'одинаковые viewport, panel и canvas повторно не показываются',
    'Журнал действий',
    'Страница при открытии сценария',
].forEach(fragment => {
    assert(uiCode.includes(fragment), `Отсутствует UI-диагностика: ${fragment}`);
});

const reportCode = fs.readFileSync(
    path.join(__dirname, '..', 'pages/test-runner/test-runner-report.js'),
    'utf8'
);
[
    "dashbridge-e2e-diagnostics/v4",
    'adaptive-visual-evidence/v1',
    'visualStates',
    'aiIndex',
    'primaryFailure:',
    'failureClusters',
    'reconciliation',
    'suspiciousPasses',
    'visualEvidenceCoverage',
    'featureHealth',
    'combinationHealth',
    'resetHealth',
    'actionTraceHealth',
    'networkPayloadHealth',
    'diagnosticDepthHealth',
    'settlementHealth',
    'commandQueueHealth',
    'persistenceHealth',
    'histogramDistance',
    'fullPanelCaptured',
    'missing-after-${requiredAfterEvidence}-evidence',
    'idempotent-repeat-large-visual-change',
    'pixelComparisonSource',
    'changed-active-set-without-image-change',
    'all-snapshots-deduplicated/v1',
].forEach(fragment => {
    assert(reportCode.includes(fragment), `Отсутствует контракт компактного отчёта: ${fragment}`);
});

[
    "status: i === 0 ? isolationReset.status : 'not-repeated'",
    'Состояние предыдущего шага сохранено для последовательного перехода',
    'inactive.filter(result => !result?.skip)',
    'lastPanelDiagnosticCaptureAt',
    "error: 'captureVisibleTab-empty-result'",
    'async function waitForPanelStability',
    "schema: 'dashbridge-e2e-panel-settlement/v1'",
    'const fingerprint = JSON.stringify(observableFacts);',
    'mutationSummary:',
    "command.settlement?.status === 'stable'",
    'const commandCursor = (await readQueryLifecycle(tabId)).nextEventId;',
    "e.data.commandStatus === 'error'",
    'verifyPersistence: activeIds.length > 0',
    "status: verifyPersistence ? 'not-run' : 'not-required'",
    'persistence.beforeRefresh = await captureRuntimeDiagnostic',
    "schema: 'dashbridge-e2e-action-event/v1'",
    "schema: 'dashbridge-e2e-runtime-diff/v1'",
    'buildRuntimeDiagnosticDiff(before, after)',
    'diagnostic.actionTimeline',
    'viewportImage:',
    'outerHTMLHash:',
    'readNetworkDiagnosticArchive',
].forEach(fragment => {
    assert(suiteCode.includes(fragment), `Отсутствует последовательный matrix-контракт: ${fragment}`);
});

const panelToolsCode = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'),
    'utf8'
);
[
    "acceptance: 'painted-awaiting-native-refresh'",
    'diagnostic.nativeSuccess',
    'diagnostic.paintedSuccess',
].forEach(fragment => {
    assert(panelToolsCode.includes(fragment), `Отсутствует visibility-контракт: ${fragment}`);
});

console.log('[OK] Test runner runtime contracts');
