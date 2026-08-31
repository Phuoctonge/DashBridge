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
    'sampleCap = 64',
    "samplePolicy: 'first-and-newest-bounded/v1'",
    'samples.splice(1, removeCount);',
    "schema: 'dashbridge-e2e-panel-settlement/v1'",
    "dataStatusKind === 'filtered_empty'",
    'const renderStateReady = canvas.length > 0 || facts.dataStatus.intentionalEmpty;',
    "current.diagnostic?.dataStatus?.intentionalEmpty === true",
    'будет применена после выхода из filtered_empty',
    'порог сохранён в filtered_empty без ложной линии и ложного превышения',
    'status.exceeded === false',
    'const fingerprint = JSON.stringify(observableFacts);',
    'mutationSummary:',
    "command.settlement?.status === 'stable'",
    'const commandCursor = (await readQueryLifecycle(tabId)).nextEventId;',
    "e.data.commandStatus === 'error'",
    'e.data.legendVisibilityDeferred !== true',
    'const verifyPersistence = activeIds.length > 0 && !persistenceProvenFor.has(persistenceKey);',
    'applySettingsAndWait(tabId, panelId, resolvedSettings, { verifyPersistence })',
    "status: verifyPersistence ? 'not-run' : 'not-required'",
    'persistence.beforeRefresh = await captureRuntimeDiagnostic',
    "const intentionalEmpty = after?.dataStatus?.intentionalEmpty === true;",
    'deferredByIntentionalEmpty: intentionalEmpty,',
    "schema: 'dashbridge-e2e-action-event/v1'",
    "schema: 'dashbridge-e2e-runtime-diff/v1'",
    'buildRuntimeDiagnosticDiff(before, after)',
    'diagnostic.actionTimeline',
    'viewportImage:',
    'outerHTMLHash:',
    'readNetworkDiagnosticArchive',
    'const includeCanvasImages = mode === DIAGNOSTIC_CAPTURE_MODES.CANVAS;',
    'const retainFullDom = mode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC;',
    'const retainFullResources = mode === DIAGNOSTIC_CAPTURE_MODES.FORENSIC;',
    "allResourceEntries.slice(-25)",
    "const sampleWidth = Math.max(1, Math.min(160, sourceWidth));",
    "const sampleHeight = Math.max(1, Math.min(90,",
    'const h = hashBytes(sampledPixels || dimensionBytes);',
    ".find('.graph-panel__chart, .flot-base, canvas')",
    ".addBack('.graph-panel__chart, .flot-base, canvas')",
    "hosts.find(element => !!$(element).data('plot'))",
    'function findEquivalentVisibilityEntry(entries, target, current)',
    "const calculatedKey = target.key.replace(new RegExp(escapedIdle, 'gi'), 'load (calc)');",
    'if (runtimeTools.convertMemToUsed !== true) return null;',
    ".replace(/used\\s*%\\s*\\(calc\\)/gi, '')",
].forEach(fragment => {
    assert(suiteCode.includes(fragment), `Отсутствует последовательный matrix-контракт: ${fragment}`);
});

assert(!suiteCode.includes("const includeCanvasImages = mode !== DIAGNOSTIC_CAPTURE_MODES.SEMANTIC;"),
    'panel/forensic evidence must not duplicate its screenshots as canvas base64 payloads');
assert(!suiteCode.includes("context.getImageData(0, 0, element.width, element.height).data"),
    'matrix checkpoints must not allocate a full-panel RGBA buffer for every capture');
assert(!suiteCode.includes('window.jQuery?.plot?.getPlot?.(host)'),
    'Flot diagnostics must use Grafana\'s actual jQuery data(plot) owner');

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
