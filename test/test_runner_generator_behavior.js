// test_runner_generator_behavior.js
// Проверка поведения generateSingleToggleTests и корректности структуры тестов.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Загружаем test-runner-suite.js в изолированный контекст
const suiteCode = fs.readFileSync(
    path.join(__dirname, '..', 'js/test-runner/test-runner-suite.js'),
    'utf8'
);

// Извлекаем функцию generateSingleToggleTests с учётом вложенных структур
const funcStart = suiteCode.indexOf('function generateSingleToggleTests(');
assert(funcStart !== -1, 'generateSingleToggleTests not found');

// Найдём закрывающую скобку функции (учитывая вложенность)
let depth = 0;
let inFunc = false;
let funcEnd = funcStart;
for (let i = funcStart; i < suiteCode.length; i++) {
    const char = suiteCode[i];
    if (char === '{') {
        depth++;
        inFunc = true;
    } else if (char === '}') {
        depth--;
        if (inFunc && depth === 0) {
            funcEnd = i + 1;
            break;
        }
    }
}

const funcCode = suiteCode.substring(funcStart, funcEnd);
assert(funcCode.includes('return ['), 'function body extraction failed');

// Создаём минимальные заглушки для зависимостей
const mockContext = `
async function runTransitionTest(tabId, env, transitions) {
    return { pass: true, skip: false, details: 'mock' };
}
${funcCode}
`;

// Выполняем в изолированном контексте
const vm = require('vm');
const context = vm.createContext({
    runTransitionTest: null,
    generateSingleToggleTests: null
});
vm.runInContext(mockContext, context);

// Минимальные заглушки для инвариантов
const mockInvariantOn = (baseline, current) => ({ pass: true, reason: 'on' });
const mockInvariantOff = (baseline, current) => ({ pass: true, reason: 'off' });

// Тест 1: функция возвращает массив из 3 тестов
const tests = context.generateSingleToggleTests(
    'T1',
    'mockToggle',
    'X',
    { visualSettings: { mockToggle: true } },
    mockInvariantOn,
    mockInvariantOff
);

assert.strictEqual(Array.isArray(tests), true, 'generateSingleToggleTests должна возвращать массив');
assert.strictEqual(tests.length, 3, 'должно быть ровно 3 теста на каждый toggle');

// Тест 2: каждый тест имеет правильную структуру
tests.forEach((test, idx) => {
    assert.strictEqual(typeof test.id, 'string', `test[${idx}].id должен быть строкой`);
    assert.strictEqual(typeof test.name, 'string', `test[${idx}].name должен быть строкой`);
    assert.strictEqual(test.category, 'X', `test[${idx}].category должна быть 'X'`);
    assert.strictEqual(typeof test.run, 'function', `test[${idx}].run должна быть функцией`);
});

// Тест 3: ID тестов уникальны и следуют паттерну
assert.strictEqual(tests[0].id, 'T1_1', 'первый тест должен иметь ID T1_1');
assert.strictEqual(tests[1].id, 'T1_2', 'второй тест должен иметь ID T1_2');
assert.strictEqual(tests[2].id, 'T1_3', 'третий тест должен иметь ID T1_3');

// Тест 4: имена тестов содержат корректные метки переходов
assert(tests[0].name.includes('OFF→ON'), 'первый тест должен проверять OFF→ON');
assert(tests[1].name.includes('ON→OFF'), 'второй тест должен проверять ON→OFF');
assert(tests[2].name.includes('OFF→ON→OFF→ON'), 'третий тест должен проверять идемпотентность');
assert(tests[2].name.includes('идемпотентность'), 'третий тест должен упоминать идемпотентность');

// Тест 5: имена тестов включают название toggle
tests.forEach((test, idx) => {
    assert(test.name.includes('mockToggle'), `test[${idx}].name должно включать 'mockToggle'`);
});

// Тест 6: контракт автоматической диагностики остаётся доступным в suite.
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
    path.join(__dirname, '..', 'js/test-runner/test-runner-core.js'),
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
    path.join(__dirname, '..', 'js/test-runner/test-runner-ui.js'),
    'utf8'
);
[
    'DashBridgeTestReport.createArtifactStreamPlan',
    'serializeArtifactPlan(plan,',
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
    path.join(__dirname, '..', 'js/test-runner/test-runner-report.js'),
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

console.log('[OK] Test runner generator behavior');
console.log('  ✓ generateSingleToggleTests produces exactly 3 tests per toggle');
console.log('  ✓ each test has correct structure (id, name, category, run)');
console.log('  ✓ test IDs follow pattern (base_1, base_2, base_3)');
console.log('  ✓ test names describe transition sequences correctly');
console.log('  ✓ test names include toggle name');
