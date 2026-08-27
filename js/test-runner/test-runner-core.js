// test-runner-core.js
// Оркестратор E2E-тестов DashBridge.
// Для каждого URL: открыть НОВОЕ ОКНО с фокусом → дождаться загрузки → probe → тесты → закрыть.
// ВАЖНО: chrome.tabs.create({ active: false }) не рендерит canvas и не инициализирует
// виртуализацию панелей Grafana. Используем chrome.windows.create({ focused: true }).
// Зависит от: test-runner-probe.js (dashbridgeRunProbe), test-runner-suite.js (DASHBRIDGE_TEST_SUITE).

'use strict';

// --- Константы ---

const CORE_TAB_LOAD_TIMEOUT_MS = 30_000;
const CORE_TAB_SETTLE_MS = 3_500;    // Grafana SPA требует времени после DOMContentLoaded
const CORE_TEST_TIMEOUT_MS = 30_000;  // E2/E3: 2×(5s applyPanelTools) + 1+3+2s refresh + overhead
const CORE_PING_INTERVAL_MS = 400;
const CORE_PING_MAX_ATTEMPTS = 75;       // до 30 с ожидания DashBridge в MAIN world
const CORE_CANVAS_PING_ATTEMPTS = 50;      // до 20 с ожидания canvas после settle
const CORE_WINDOW_WIDTH = 1400;
const CORE_WINDOW_HEIGHT = 900;

// --- Вспомогательные ---

function coreSleeep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ждём, пока вкладка перейдёт в статус complete или истечёт таймаут.
 * @param {number} tabId
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} true — загрузилась, false — таймаут
 */
function waitForTabComplete(tabId, timeoutMs = CORE_TAB_LOAD_TIMEOUT_MS) {
    return new Promise(resolve => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve(false);
        }, timeoutMs);

        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId) return;
            if (changeInfo.status === 'complete') {
                if (done) return;
                done = true;
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(onUpdated);
                resolve(true);
            }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
    });
}

/**
 * Пробует запустить probe-функцию в MAIN world; повторяет до тех пор,
 * пока функция не вернёт { ok: true } или не истечут попытки.
 * Нужно, чтобы content script успел инициализироваться.
 */
async function waitForProbeReady(tabId) {
    for (let i = 0; i < CORE_PING_MAX_ATTEMPTS; i++) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: () => typeof window.DashBridgeGrafanaDom !== 'undefined'
                    || typeof window.DashBridgeGrafanaVisualEngine !== 'undefined'
                    || document.documentElement.hasAttribute('data-dashbridge-icon-url'),
            });
            if (results?.[0]?.result === true) return true;
        } catch (_) { /* вкладка ещё не готова */ }
        await coreSleeep(CORE_PING_INTERVAL_MS);
    }
    return false; // продолжаем в любом случае, probe сам проверит
}

/**
 * Ждёт появления хотя бы одного <canvas> на странице — признак того,
 * что Grafana отрендерила панели. Без canvas B/C/D тесты не имеют смысла.
 * @param {number} tabId
 * @returns {Promise<boolean>} true — canvas найден, false — таймаут
 */
async function waitForCanvasReady(tabId) {
    for (let i = 0; i < CORE_CANVAS_PING_ATTEMPTS; i++) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: () => document.querySelectorAll('canvas').length > 0,
            });
            if (results?.[0]?.result === true) return true;
        } catch (_) { /* вкладка ещё не готова */ }
        await coreSleeep(CORE_PING_INTERVAL_MS);
    }
    return false; // продолжаем даже без canvas — probe сам сообщит об ошибке
}

/**
 * Запускает probe в MAIN world и возвращает его результат.
 * Функция dashbridgeRunProbe должна быть доступна через files: [...] в executeScript
 * либо мы передаём её текст напрямую. Здесь используем прямой вызов — probe.js
 * загружается как отдельный файл в executeScript.files.
 */
async function runProbeInTab(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            files: ['js/test-runner/test-runner-probe.js'],
        });
        // probe.js объявляет и сразу вызывает dashbridgeRunProbe(),
        // результат последнего выражения файла — возврат функции.
        // Но файл может только объявить функцию; вызовем отдельно:
        const callResults = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                if (typeof dashbridgeRunProbe === 'function') return dashbridgeRunProbe();
                return { ok: false, error: 'dashbridgeRunProbe не найдена' };
            },
        });
        return callResults?.[0]?.result ?? { ok: false, error: 'нет результата probe' };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

/**
 * Запускает один тест с таймаутом.
 * @param {{ id, name, category, run }} test
 * @param {number} tabId
 * @param {{ probe: object }} env
 * @returns {Promise<{ id, category, name, pass, details, durationMs, error? }>}
 */
function classifyRuntimeEvidence(runtime) {
    const events = runtime?.events || [];
    const messageOf = event => (event?.args || []).map(value => {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch (_) { return String(value); }
    }).join(' ').toLowerCase();
    const runtimeErrors = events.filter(event => event.level === 'error' || event.level === 'unhandledrejection');
    const dashBridgeErrors = runtimeErrors.filter(event => /dashbridge|paneltools|grafana-visual-engine|grafana-panel-tools/.test(messageOf(event)));
    const grafanaWarnings = runtimeErrors.filter(event => !dashBridgeErrors.includes(event));
    const warnings = events.filter(event => event.level === 'warn');

    return {
        policy: 'dashbridge-and-targeted-query-errors-fail/v1',
        errorCount: runtimeErrors.length,
        dashBridgeErrorCount: dashBridgeErrors.length,
        grafanaWarningCount: grafanaWarnings.length,
        warningCount: warnings.length,
        dashBridgeErrors,
        grafanaWarnings,
        warnings,
        pass: dashBridgeErrors.length === 0,
        reason: dashBridgeErrors.length
            ? `Во время теста зафиксировано ошибок DashBridge: ${dashBridgeErrors.length}`
            : '',
    };
}

async function runSingleTest(test, tabId, env) {
    const start = Date.now();
    delete env.__dashbridgeTransitionProgress;
    let before = null;
    let beforeError = null;
    let eventCursor = 0;
    try {
        // A per-test event slice preserves errors and warnings for the command
        // sequence, without treating unrelated Grafana runtime noise as a failure.
        try {
            eventCursor = (await readRuntimeDiagnosticEvents(tabId)).nextEventId || 0;
        } catch (_) { }
        // DashBridge-originated runtime errors are verdict-relevant; unrelated
        // Grafana errors remain reportable warnings.
        try {
            before = await captureRuntimeDiagnostic(tabId, env.panelId, {
                reuseVisualFrom: env.__dashbridgeOuterSnapshot || null,
                captureMode: DIAGNOSTIC_CAPTURE_MODES.SEMANTIC,
                captureReason: 'test-envelope-before-semantic-proof',
            });
            env.__dashbridgeCurrentOuterBefore = before;
        } catch (error) {
            beforeError = error.message || String(error);
        }
        const testTimeoutMs = Number.isFinite(Number(test.timeoutMs))
            ? Math.max(CORE_TEST_TIMEOUT_MS, Number(test.timeoutMs))
            : CORE_TEST_TIMEOUT_MS;
        const resultPromise = test.run(tabId, env);
        const timeoutPromise = coreSleeep(testTimeoutMs).then(() => {
            const progress = env.__dashbridgeTransitionProgress;
            const timeoutProgress = progress ? {
                ...progress,
                current: progress.current ? { ...progress.current } : null,
                steps: Array.isArray(progress.steps)
                    ? progress.steps.map(step => ({ ...step }))
                    : [],
                capturedAt: Date.now(),
            } : null;
            return {
                pass: false,
                timedOut: true,
                details: `Таймаут ${testTimeoutMs / 1000}с`,
                diagnostic: timeoutProgress ? { timeoutProgress } : null,
            };
        });
        const result = await Promise.race([resultPromise, timeoutPromise]);
        const { pass, details, skip, timedOut } = result;
        let after = null;
        let afterError = null;
        try {
            after = await captureRuntimeDiagnostic(tabId, env.panelId, {
                reuseVisualFrom: result.diagnostic?.reset?.after
                    || result.diagnostic?.baseline
                    || null,
                captureMode: (pass || skip)
                    ? DIAGNOSTIC_CAPTURE_MODES.SEMANTIC
                    : DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                captureReason: (pass || skip)
                    ? 'test-envelope-after-semantic-proof'
                    : 'automatic-forensic-test-failure',
            });
            env.__dashbridgeOuterSnapshot = after;
        } catch (error) {
            afterError = error.message || String(error);
        }
        const runtime = await readRuntimeDiagnosticEvents(tabId, eventCursor).catch(error => ({
            startedAt: null,
            nextEventId: eventCursor,
            events: [],
            readError: error.message || String(error),
        }));
        const runtimeEvidence = classifyRuntimeEvidence(runtime);
        const functionalPass = !!pass;
        const finalPass = functionalPass && runtimeEvidence.pass;
        const finalSkip = !!skip && runtimeEvidence.pass;
        if (!finalPass && !finalSkip && after?.visualCapture?.requestedMode !== DIAGNOSTIC_CAPTURE_MODES.FORENSIC) {
            try {
                after = await captureRuntimeDiagnostic(tabId, env.panelId, {
                    captureMode: DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                    captureReason: 'automatic-forensic-runtime-failure',
                });
                env.__dashbridgeOuterSnapshot = after;
            } catch (error) {
                afterError = error.message || String(error);
            }
        }
        const verdict = {
            schema: 'dashbridge-e2e-verdict/v1',
            outcome: finalSkip ? 'skip' : (finalPass ? 'pass' : 'fail'),
            functionalPass,
            runtimePass: runtimeEvidence.pass,
            reason: runtimeEvidence.reason || (details || ''),
            runtime: runtimeEvidence,
        };
        const testEnvelope = {
            schema: 'dashbridge-e2e-action-event/v1',
            sequence: 0,
            action: 'test-lifecycle-envelope',
            description: `Полный жизненный цикл теста ${test.id}: внешний снимок до запуска → выполнение → внешний снимок после`,
            startedAt: start,
            finishedAt: Date.now(),
            durationMs: Date.now() - start,
            input: {
                testId: test.id,
                testName: test.name,
                category: test.category,
                panelId: env.panelId || null,
                timeoutMs: testTimeoutMs,
                expectedRefreshCount: test.expectedRefreshCount ?? null,
                timeoutBudgetModel: test.timeoutBudgetModel || null,
            },
            output: { verdict, details: details || '', runtime },
            snapshotRefs: {
                before: runtimeSnapshotRef('diagnostic.before', before),
                after: runtimeSnapshotRef('diagnostic.after', after),
            },
            diffs: [{ phase: 'external-before-to-external-after', ...buildRuntimeDiagnosticDiff(before, after) }],
        };
        return {
            id: test.id,
            category: test.category,
            name: test.name,
            feature: getTestFeatureReference(test.id),
            pass: finalPass,
            skip: finalSkip,
            // Preserve the suite's reset-safety verdict. Without this field
            // the core would keep executing a contaminated URL and turn one
            // failed reset into a cascade of unrelated FAIL results.
            environmentUnsafe: result.environmentUnsafe === true,
            // A timed-out scenario may still have an outstanding command in
            // the page. The caller must quarantine this URL instead of
            // executing another scenario against an unknown panel state.
            timedOut: !!timedOut,
            details: runtimeEvidence.reason
                ? `${details || ''}${details ? ' | ' : ''}✗ ${runtimeEvidence.reason}`
                : (details || ''),
            durationMs: Date.now() - start,
            diagnostic: {
                before,
                after,
                runtime,
                verdict,
                ...(beforeError || afterError ? { captureErrors: { before: beforeError, after: afterError } } : {}),
                ...(result.diagnostic || {}),
                opened: result.diagnostic?.opened || before,
                actionTimeline: [testEnvelope, ...(result.diagnostic?.actionTimeline || [])],
            },
        };
    } catch (e) {
        let after = null;
        let afterError = null;
        try {
            after = await captureRuntimeDiagnostic(tabId, env.panelId, {
                captureMode: DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                captureReason: 'automatic-forensic-test-exception',
            });
        } catch (error) {
            afterError = error.message || String(error);
        }
        const runtime = await readRuntimeDiagnosticEvents(tabId, eventCursor).catch(error => ({
            startedAt: null,
            nextEventId: eventCursor,
            events: [],
            readError: error.message || String(error),
        }));
        const runtimeEvidence = classifyRuntimeEvidence(runtime);
        const exceptionReason = `Исключение: ${e.message || String(e)}`;
        const verdict = {
            schema: 'dashbridge-e2e-verdict/v1',
            outcome: 'fail',
            functionalPass: false,
            runtimePass: runtimeEvidence.pass,
            reason: runtimeEvidence.reason || exceptionReason,
            runtime: runtimeEvidence,
        };
        return {
            id: test.id,
            category: test.category,
            name: test.name,
            feature: getTestFeatureReference(test.id),
            pass: false,
            skip: false,
            details: runtimeEvidence.reason
                ? `${exceptionReason} | ✗ ${runtimeEvidence.reason}`
                : exceptionReason,
            durationMs: Date.now() - start,
            error: true,
            diagnostic: {
                before,
                after,
                runtime,
                verdict,
                opened: before,
                actionTimeline: [{
                    schema: 'dashbridge-e2e-action-event/v1',
                    sequence: 0,
                    action: 'test-lifecycle-envelope',
                    description: `Полный жизненный цикл теста ${test.id} завершился исключением`,
                    startedAt: start,
                    finishedAt: Date.now(),
                    durationMs: Date.now() - start,
                    input: { testId: test.id, testName: test.name, category: test.category, panelId: env.panelId || null },
                    output: { verdict, exception: { name: e.name || 'Error', message: e.message || String(e), stack: String(e.stack || '') }, runtime },
                    snapshotRefs: {
                        before: runtimeSnapshotRef('diagnostic.before', before),
                        after: runtimeSnapshotRef('diagnostic.after', after),
                    },
                    diffs: [{ phase: 'external-before-to-external-after', ...buildRuntimeDiagnosticDiff(before, after) }],
                }],
                ...(beforeError || afterError ? { captureErrors: { before: beforeError, after: afterError } } : {}),
            },
        };
    }
}

// --- Основной оркестратор ---

/**
 * Состояние текущего прогона. Сбрасывается при каждом запуске.
 */
let runnerState = {
    running: false,
    aborted: false,
    runId: null,
    startedAt: null,
    finishedAt: null,
    // `total`/`done` remain compatibility aliases for planned/completed.
    total: 0,
    done: 0,
    planned: 0,
    scheduled: 0,
    started: 0,
    completed: 0,
    abortedNotRun: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    results: [],        // [{ url, grafanaVersion, engine, tests: [...] }]
    currentUrl: null,
    onProgress: null,   // callback(state) — вызывается после каждого теста/URL
    onComplete: null,   // callback(state) — вызывается по завершении
};

function emitProgress() {
    try { runnerState.onProgress?.(getRunnerSnapshot()); } catch (_) { }
}

function emitComplete() {
    try { runnerState.onComplete?.(getRunnerSnapshot()); } catch (_) { }
}

/**
 * Снимок состояния (без функций-коллбэков, пригоден для JSON).
 */
function getRunnerSnapshot() {
    return {
        running: runnerState.running,
        aborted: runnerState.aborted,
        runId: runnerState.runId || null,
        startedAt: runnerState.startedAt || null,
        finishedAt: runnerState.finishedAt || null,
        mode: runnerState.mode || 'fast',
        total: runnerState.total,
        done: runnerState.done,
        planned: runnerState.planned,
        scheduled: runnerState.scheduled,
        started: runnerState.started,
        completed: runnerState.completed,
        abortedNotRun: runnerState.abortedNotRun,
        passed: runnerState.passed,
        failed: runnerState.failed,
        skipped: runnerState.skipped,
        results: runnerState.results,
        currentUrl: runnerState.currentUrl,
    };
}

/**
 * Прерывает текущий прогон.
 */
function abortRunner() {
    if (runnerState.running) {
        runnerState.aborted = true;
    }
}

function makeNotRunTest(test, reason, { environmentUnsafe = false } = {}) {
    return {
        id: test.id,
        category: test.category,
        name: test.name,
        feature: getTestFeatureReference(test.id),
        pass: false,
        skip: false,
        aborted: true,
        details: `Не запущен: ${reason}`,
        durationMs: 0,
        diagnostic: {
            notRun: true,
            aborted: true,
            environmentUnsafe,
            reason,
            actionTimeline: [{
                schema: 'dashbridge-e2e-action-event/v1',
                sequence: 0,
                action: 'test-not-run',
                description: 'Тест запланирован, но намеренно не запускался, чтобы не продолжать работу в недоказанном окружении',
                startedAt: null,
                finishedAt: null,
                durationMs: 0,
                input: { testId: test.id, testName: test.name, category: test.category },
                output: { status: 'not-run', reason, environmentUnsafe },
                snapshotRefs: {},
                diffs: [],
            }],
        },
    };
}

function recordNotRunTests(urlResult, tests, reason, options) {
    const executedIds = new Set(urlResult.tests.map(test => test.id));
    const pending = tests.filter(test => !executedIds.has(test.id));
    pending.forEach(test => urlResult.tests.push(makeNotRunTest(test, reason, options)));
    runnerState.abortedNotRun += pending.length;
    urlResult.abortedNotRun += pending.length;
    return pending.length;
}

/**
 * Запускает полный прогон по списку URL.
 *
 * @param {string[]} urls          — список URL Grafana дашбордов
 * @param {object}   [options]
 * @param {Function} [options.onProgress]  — callback после каждого теста
 * @param {Function} [options.onComplete]  — callback по окончании
 * @param {Function} [options.onTestFinalized] — awaited disk-spool hook after
 *     every executed test; may return a compact replacement for runnerState.
 * @param {boolean}  [options.keepTab]     — не закрывать вкладку после теста (debug)
 * @param {Function} [options.onUrlFinalized] — awaited hook after one URL is
 *     completely finished.  It may return a compact replacement retained in
 *     the runner snapshot; the original result is then eligible for GC.
 * @returns {Promise<object>} снимок финального состояния
 */
async function runTestsForUrls(urls, {
    onProgress = null,
    onComplete = null,
    onTestFinalized = null,
    onUrlFinalized = null,
    // Compatibility defaults: keepTab = false, mode = 'fast'
    keepTab = false,
    mode = 'fast',
} = {}) {
    if (runnerState.running) throw new Error('Тест-раннер уже запущен');

    const fullSuite = (typeof DASHBRIDGE_TEST_SUITE !== 'undefined') ? DASHBRIDGE_TEST_SUITE : [];
    if (!fullSuite.length) throw new Error('DASHBRIDGE_TEST_SUITE не загружен');

    // Нормализуем список URL
    const urlList = urls
        .map(u => u.trim())
        .filter(u => u.length > 0 && (u.startsWith('http://') || u.startsWith('https://')));

    if (!urlList.length) throw new Error('Список URL пуст или содержит некорректные адреса');

    // Each dashboard can select a different subset of the suite.
    const suiteForUrl = u => {
        let hostname = '';
        try { hostname = new URL(u).hostname; } catch (_) { }
        return fullSuite.filter(t => {
            const hostMatch = !t.urlHost || hostname === t.urlHost;
            const filterMatch = !t.urlFilter || u.includes(t.urlFilter);
            const modeMatch = !Array.isArray(t.runModes) || t.runModes.includes(mode);
            return hostMatch && filterMatch && modeMatch;
        });
    };
    const totalCount = urlList.reduce((acc, url) => acc + suiteForUrl(url).length, 0);

    // Инициализация состояния
    runnerState = {
        running: true,
        mode,
        aborted: false,
        runId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        startedAt: Date.now(),
        finishedAt: null,
        total: totalCount,
        done: 0,
        planned: totalCount,
        scheduled: 0,
        started: 0,
        completed: 0,
        abortedNotRun: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        results: [],
        currentUrl: null,
        onProgress,
        onComplete,
    };

    emitProgress();

    for (const url of urlList) {
        if (runnerState.aborted) break;

        const suite = suiteForUrl(url);

        runnerState.currentUrl = url;
        emitProgress();

        runnerState.scheduled += suite.length;
        const urlResult = {
            url,
            grafanaVersion: null,
            engine: null,
            isFlot: null,
            probeOk: false,
            probeError: null,
            planned: suite.length,
            scheduled: suite.length,
            started: 0,
            completed: 0,
            abortedNotRun: 0,
            startedAt: Date.now(),
            finishedAt: null,
            tests: [],
        };

        // Добавляем urlResult в results ДО запуска тестов — как живой объект.
        // onProgress будет видеть его с обновляющимся массивом tests во время прогона.
        runnerState.results.push(urlResult);

        let tabId = null;
        let windowId = null;
        let autoRefreshState = null;
        let probe = null;
        let urlOpenedSnapshot = null;

        try {
            const registration = await ensureEarlyGrafanaRuntimeForUrl(url);
            if (!registration.ok) throw new Error(`Не удалось подготовить Grafana runtime: ${registration.reason}`);
            // 1. Открыть НОВОЕ ОКНО с фокусом — единственный способ получить
            //    полноценный рендеринг canvas и виртуализацию панелей Grafana.
            //    URL остаётся исходным: после загрузки отключаем scheduler через RefreshPicker.
            const win = await chrome.windows.create({
                url,
                focused: true,
                width: CORE_WINDOW_WIDTH,
                height: CORE_WINDOW_HEIGHT,
                type: 'normal',
            });
            windowId = win.id;
            tabId = win.tabs[0].id;

            // 2. Ждём загрузки
            const loaded = await waitForTabComplete(tabId);
            if (!loaded) {
                urlResult.probeError = `Окно не загрузилось за ${CORE_TAB_LOAD_TIMEOUT_MS / 1000}с`;
                recordNotRunTests(urlResult, suite, 'окно не загрузилось');
                // urlResult уже в runnerState.results (добавлен до try)
                emitProgress();
                continue;
            }

            // 3. Даём странице "осесть" (React/Angular/Grafana SPA инициализируется)
            await coreSleeep(CORE_TAB_SETTLE_MS);

            // 3b. Один раз отключаем автообновление на весь suite данной вкладки.
            // Ручные refresh-тесты используют штатную кнопку RefreshPicker.
            autoRefreshState = await disableAutoRefresh(tabId);

            // 4. Ждём готовности DashBridge в MAIN world
            await waitForProbeReady(tabId);

            // 4b. Ждём появления canvas — признак того, что панели отрендерились.
            //     Без этого B/C/D тесты упадут с "Нет видимой панели".
            await waitForCanvasReady(tabId);

            // 5. Запускаем probe и start a page-scoped runtime event journal.
            probe = await runProbeInTab(tabId);
            const diagnosticCollector = await installRuntimeDiagnostics(tabId);
            urlResult.probeOk = probe?.ok === true;
            urlResult.probeError = probe?.error || null;
            urlResult.grafanaVersion = probe?.grafanaVersion || null;
            urlResult.engine = probe?.engine || null;
            urlResult.isFlot = probe?.isFlot || false;

            // Контекст тестов: используем именно выбранную graph-панель. В v12
            // data-viz-panel-key находится внутри grid-item, поэтому capability
            // probe обязан работать с outerPanel(), а не только с keyed-узлом.
            const panelId = resolvePanelId({ probe });
            const panelCapabilities = panelId ? await execMain(tabId, id => {
                const dom = window.DashBridgeGrafanaDom;
                const panel = dom?.findPanelById?.(id) || document.querySelector(
                    `[data-viz-panel-key="${id}"], [data-panelid="${String(id).replace(/^panel-/, '')}"]`
                );
                const root = dom?.outerPanel?.(panel) || panel;
                if (!root) return { hasLegend: false, hasSeries: false, title: '', panelFound: false };
                const legendItems = dom?.legendItems?.(panel) || root.querySelectorAll(
                    '.graph-legend-series, [class*="LegendRow"], [class*="legend-item" i], .u-legend tr, .u-legend-row, .u-off, [class*="legend"] [role="button"]'
                );
                const legendLabels = [...legendItems]
                    .map(item => (dom?.legendLabel?.(item) || item).textContent?.trim())
                    .filter(Boolean);
                // Production keys identify duplicate labels by their occurrence
                // among equal labels, rather than the global legend row index.
                const legendOccurrences = new Map();
                const visibilityCandidates = legendLabels.map(label => {
                    const occurrence = legendOccurrences.get(label) || 0;
                    legendOccurrences.set(label, occurrence + 1);
                    return { label, occurrence, key: `${label}\u0000${occurrence}` };
                });
                const titleNode = root.querySelector('[data-testid*="Panel header"] h6[title], [data-testid*="Panel header"] h6, .panel-title, h6[title]');
                const title = titleNode?.getAttribute('title') || titleNode?.textContent?.trim() || root.getAttribute('aria-label') || '';
                const series = window.DashBridgeGrafanaVisualEngine?.getChartSeriesCount?.(root) || 0;
                return {
                    hasLegend: legendItems.length > 0,
                    hasSeries: series > 0 || root.querySelectorAll('canvas').length > 0,
                    hasVisibilitySeries: visibilityCandidates.length >= 2,
                    visibilityTarget: visibilityCandidates.length >= 2 ? visibilityCandidates[0] : null,
                    title,
                    panelFound: true,
                };
            }, [panelId]) : { hasLegend: false, hasSeries: false, title: '', panelFound: false };
            const panelTitle = String(panelCapabilities.title || '');
            const env = {
                probe,
                panelId,
                hasCPU: /cpu|processor|idle/i.test(panelTitle),
                hasRAM: /ram|memory|mem|памят/i.test(panelTitle),
                ...panelCapabilities,
                diagnosticCollector,
            };
            urlResult.panelId = panelId;
            urlResult.capabilities = {
                panelFound: !!env.panelFound,
                panelTitle,
                hasLegend: !!env.hasLegend,
                hasSeries: !!env.hasSeries,
                hasVisibilitySeries: !!env.hasVisibilitySeries,
                hasCPU: !!env.hasCPU,
                hasRAM: !!env.hasRAM,
                visibilityTarget: env.visibilityTarget || null,
            };
            // URL-level bookends show what the page looked like immediately
            // before the first test and what the entire suite left behind.
            urlOpenedSnapshot = await captureRuntimeDiagnostic(tabId, panelId, {
                captureMode: DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                captureReason: 'url-opened-integration-proof',
            });
            env.__dashbridgeOuterSnapshot = urlOpenedSnapshot;

            // 6. Прогоняем тесты. A failed causal reset makes the current tab
            // untrustworthy: do not send any more commands into a potentially
            // transformed panel. Remaining planned tests are recorded as NOT RUN.
            let environmentUnsafe = false;
            let environmentUnsafeReason = '';
            for (const test of suite) {
                if (runnerState.aborted || environmentUnsafe) break;

                runnerState.started += 1;
                urlResult.started += 1;
                const testResult = await runSingleTest(test, tabId, env);
                urlResult.tests.push(testResult);
                const testIndex = urlResult.tests.length - 1;

                runnerState.done += 1;
                runnerState.completed += 1;
                urlResult.completed += 1;
                if (testResult.skip) {
                    runnerState.skipped += 1;
                } else if (testResult.pass) {
                    runnerState.passed += 1;
                } else {
                    runnerState.failed += 1;
                }

                if (testResult.environmentUnsafe) {
                    environmentUnsafe = true;
                    environmentUnsafeReason = 'Не доказан откат настроек выбранной панели';
                    urlResult.environmentUnsafe = true;
                }
                if (testResult.timedOut) {
                    environmentUnsafe = true;
                    environmentUnsafeReason = 'сценарий превысил таймаут; состояние панели неизвестно';
                    urlResult.environmentUnsafe = true;
                }
                if (typeof onTestFinalized === 'function') {
                    try {
                        const retained = await onTestFinalized(testResult, {
                            url, urlIndex: runnerState.results.length - 1,
                            testIndex, urlResult,
                        });
                        if (retained) urlResult.tests[testIndex] = retained;
                    } catch (error) {
                        // Do not start another heavy test when its predecessor
                        // could not be made disk-backed. The raw result remains
                        // available to onUrlFinalized for one recovery attempt.
                        environmentUnsafe = true;
                        environmentUnsafeReason = `Не удалось сохранить диагностику теста на диск: ${error?.message || String(error)}`;
                        urlResult.environmentUnsafe = true;
                        urlResult.spoolError = environmentUnsafeReason;
                    }
                }
                emitProgress();
            }

            // Not-run work is neither PASS nor legitimate SKIP. It is kept in
            // the artifact so planned coverage remains auditable after abort or
            // after an unsafe reset that could otherwise contaminate later tests.
            if (runnerState.aborted || environmentUnsafe) {
                const reason = environmentUnsafe
                    ? environmentUnsafeReason
                    : 'прогон прерван пользователем';
                recordNotRunTests(urlResult, suite, reason, { environmentUnsafe });
                emitProgress();
            }

        } catch (e) {
            const msg = `Ошибка обработки URL: ${e.message || String(e)}`;
            urlResult.probeError = msg;
            recordNotRunTests(urlResult, suite, msg);
            emitProgress();
        } finally {
            // Collect page evidence while the window still exists.
            try {
                const urlFinishedSnapshot = tabId !== null
                    ? await captureRuntimeDiagnostic(tabId, resolvePanelId({ probe }) || null, {
                        reuseVisualFrom: urlOpenedSnapshot,
                        captureMode: DIAGNOSTIC_CAPTURE_MODES.FORENSIC,
                        captureReason: 'url-finished-integration-proof',
                    })
                    : null;
                urlResult.diagnostic = {
                    collector: await readRuntimeDiagnosticEvents(tabId),
                    networkPayloadArchive: await readNetworkDiagnosticArchive(tabId),
                    panelId: resolvePanelId({ probe }) || null,
                    opened: urlOpenedSnapshot,
                    finished: urlFinishedSnapshot,
                    actionTimeline: [{
                        schema: 'dashbridge-e2e-action-event/v1',
                        sequence: 0,
                        action: 'url-lifecycle-envelope',
                        description: 'Полная вкладка Grafana: состояние после загрузки и probe → весь suite → состояние перед закрытием',
                        startedAt: urlResult.startedAt,
                        finishedAt: Date.now(),
                        durationMs: Date.now() - urlResult.startedAt,
                        input: { requestedUrl: url, keepTab, mode, plannedTests: suite.length },
                        output: {
                            actualUrl: urlFinishedSnapshot?.environment?.url || null,
                            probeOk: urlResult.probeOk,
                            probeError: urlResult.probeError,
                            capabilities: urlResult.capabilities || null,
                            completed: urlResult.completed,
                            abortedNotRun: urlResult.abortedNotRun,
                        },
                        snapshotRefs: {
                            afterPageLoadAndProbe: runtimeSnapshotRef('urlResult.diagnostic.opened', urlOpenedSnapshot),
                            beforeTabClose: runtimeSnapshotRef('urlResult.diagnostic.finished', urlFinishedSnapshot),
                        },
                        diffs: [{
                            phase: 'url-after-load-to-before-close',
                            ...buildRuntimeDiagnosticDiff(urlOpenedSnapshot, urlFinishedSnapshot),
                        }],
                    }],
                };
            } catch (_) { }
            // 7. Возвращаем исходный интервал перед закрытием; особенно важно в keepTab/debug.
            if (tabId !== null && autoRefreshState?.value) {
                try { await restoreAutoRefresh(tabId, autoRefreshState); } catch (_) { }
            }
            // 8. Закрыть окно целиком (не только вкладку)
            if (windowId !== null && !keepTab) {
                try { await chrome.windows.remove(windowId); } catch (_) { }
            } else if (tabId !== null && !keepTab && windowId === null) {
                try { await chrome.tabs.remove(tabId); } catch (_) { }
            }
            urlResult.finishedAt = Date.now();
            // urlResult уже в runnerState.results (добавлен до try) — не пушим повторно

            // A full diagnostic can contain gigabytes of DOM/network/image data.
            // Keep it live only while this URL is executing.  This belongs in
            // `finally`, rather than after it: a load-time `continue` still
            // runs finally but skips statements following the try/finally.
            // Awaiting prevents the next dashboard from overlapping this
            // result's disk write in the renderer heap.
            if (typeof onUrlFinalized === 'function') {
                const urlIndex = runnerState.results.indexOf(urlResult);
                try {
                    const retained = await onUrlFinalized(urlResult, urlIndex);
                    if (retained && urlIndex >= 0) runnerState.results[urlIndex] = retained;
                } catch (error) {
                    // Continuing while retaining the raw result is unsafe: a
                    // second dashboard can crash the renderer. Stop deterministically
                    // and keep this first URL available for troubleshooting.
                    runnerState.aborted = true;
                    urlResult.probeError = `${urlResult.probeError ? `${urlResult.probeError}; ` : ''}Не удалось выгрузить диагностику на диск: ${error?.message || String(error)}`;
                }
            }
            emitProgress();
        }
    }

    // Abort can happen between URL groups. Materialise every remaining group
    // so exported coverage still reconciles with `planned`.
    if (runnerState.aborted) {
        const processedUrls = runnerState.results.length;
        for (const url of urlList.slice(processedUrls)) {
            const suite = suiteForUrl(url);
            const urlResult = {
                url,
                grafanaVersion: null,
                engine: null,
                isFlot: null,
                probeOk: false,
                probeError: 'Прогон прерван до открытия окна',
                planned: suite.length,
                scheduled: 0,
                started: 0,
                completed: 0,
                abortedNotRun: 0,
                startedAt: null,
                finishedAt: Date.now(),
                tests: [],
            };
            runnerState.results.push(urlResult);
            recordNotRunTests(urlResult, suite, 'прогон прерван пользователем');
            if (typeof onUrlFinalized === 'function') {
                const urlIndex = runnerState.results.length - 1;
                try {
                    const retained = await onUrlFinalized(urlResult, urlIndex);
                    if (retained) runnerState.results[urlIndex] = retained;
                } catch (error) {
                    urlResult.probeError = `${urlResult.probeError}; Не удалось выгрузить NOT RUN диагностику: ${error?.message || String(error)}`;
                }
            }
        }
        emitProgress();
    }

    runnerState.running = false;
    runnerState.currentUrl = null;
    runnerState.finishedAt = Date.now();
    emitComplete();

    return getRunnerSnapshot();
}

// --- Экспорт ---

const DashBridgeTestRunner = {
    run: runTestsForUrls,
    abort: abortRunner,
    getSnapshot: getRunnerSnapshot,
    // Pure reporting helpers are intentionally exposed for Node contract tests.
    __test: { classifyRuntimeEvidence, makeNotRunTest },
};
