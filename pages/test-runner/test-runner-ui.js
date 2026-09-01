// Test Runner page UI.
// UI-слой E2E тест-раннера DashBridge.
// Управляет страницей pages/test-runner/test-runner.html: ввод URL, запуск/стоп, таблица результатов,
// прогресс-бар, копирование отчёта.
// Зависит от: test-runner-core.js (DashBridgeTestRunner),
//             test-runner-suite.js (DASHBRIDGE_TEST_SUITE),
//             test-runner-probe.js (dashbridgeRunProbe — загружается core'ом),
//             operation-progress-window.js (DashBridgeOperationProgress)

'use strict';

// --- DOM-узлы (инициализируются в init()) ---

let elUrlInput = null;  // <textarea id="trUrlInput">
let elRunMode = null;  // <select id="trRunMode">
let elSelectTestsBtn = null;
let elSelectionSummary = null;
let elRunBtn = null;  // <button id="trRunBtn">
let elAbortBtn = null;  // <button id="trAbortBtn">
let elCopyBtn = null;  // <button id="trCopyBtn">
let elCopyFailBtn = null;  // <button id="trCopyFailBtn">
let elExportDiagnosticsBtn = null;  // <button id="trExportDiagnosticsBtn">
let elClearBtn = null;  // <button id="trClearBtn">
let elProgress = null;  // <div id="trProgress">
let elProgressBar = null;  // <div id="trProgressBar">
let elProgressText = null;  // <span id="trProgressText">
let elStatusLine = null;  // <div id="trStatusLine">
let elResultsTable = null;  // <tbody id="trResultsBody">
let elSummaryRow = null;  // <div id="trSummary">
let elEmptyState = null;  // <div id="trEmptyState">

// Последний снимок состояния для копирования отчёта
let lastSnapshot = null;
let testSelection = { scope: 'all', ids: [] };

// Always-on-top progress window shared with Batch/Recorder. The controller is
// optional: a browser without Document Picture-in-Picture keeps the in-page UI.
let operationProgressController = null;
let operationProgressTimer = null;
let operationProgressStartedAt = null;
let operationProgressSnapshot = null;

// Full per-test evidence is deliberately not retained in the renderer heap.
// A single Grafana dashboard can produce several GiB of diagnostics; keeping
// two completed dashboards in `lastSnapshot` caused Chrome Out of Memory.
// This store owns one private OPFS directory for a run and leaves the results
// table with only the fields it actually renders.
let diagnosticSpool = null;
let diagnosticViewer = null;
let exportController = null;

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function categoryLabel(cat) {
    const map = {
        F: 'Storage',
        A: 'Environment',
        H: 'H · Matrix Transitions',
    };
    return map[cat] || cat;
}

function formatDuration(ms) {
    if (!ms && ms !== 0) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

// --- Рендеринг таблицы ---

/**
 * Строит HTML одной строки результата теста.
 */
function diagnosticSummary(test) {
    const diagnostic = test.diagnostic;
    if (!diagnostic || diagnostic.notRun) return '';
    const captureErrors = diagnostic.captureErrors
        ? Object.values(diagnostic.captureErrors).filter(Boolean).length
        : 0;
    // Keep the result table compact. The diagnostic viewer exposes transition,
    // runtime, and canvas details; here we surface only capture problems.
    return captureErrors ? `ошибок снимка: ${captureErrors}` : '';
}

function formatElapsedDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} МБ`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

function statusIcon(test) {
    const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    if (test.aborted) return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="m8 8 8 8"/></svg>`;
    if (test.skip) return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>`;
    if (test.pass) return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>`;
    return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>`;
}

function buildTestRow(test, urlIndex, testIndex) {
    const rowClass = test.aborted ? 'tr-skip' : (test.skip ? 'tr-skip' : (test.pass ? 'tr-pass' : 'tr-fail'));
    const icon = statusIcon(test);
    const dur = test.durationMs ? formatDuration(test.durationMs) : '';
    const feature = test.feature;
    const displayName = feature?.label || test.name;
    const sourceReference = feature?.sourceFile
        ? `<div class="tr-feature-source" title="${esc(feature.description || '')}">${esc(feature.sourceFile)}${feature.sourceSymbol ? ` · ${esc(feature.sourceSymbol)}` : ''}</div>`
        : '';
    const technicalName = feature?.technicalName
        ? `<div class="tr-technical-name" title="Техническое имя теста">${esc(feature.technicalName)}</div>`
        : '';
    const infoButton = feature?.description
        ? `<button class="tr-test-info-btn" data-url-index="${urlIndex}" data-test-index="${testIndex}" title="Показать назначение и шаги сценария">Что проверяет?</button>`
        : '';
    const diagnosticButton = (test.diagnostic || test.diagnosticRef)
        ? `<button class="tr-diagnostic-btn" data-url-index="${urlIndex}" data-test-index="${testIndex}" title="Показать собранную диагностику"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v5m0-8h.01"/></svg>Диагностика</button>`
        : '';
    return `<tr class="tr-test-row ${rowClass}" data-url-index="${urlIndex}">
  <td class="tr-td-id"><span class="tr-badge tr-badge-${test.category.toLowerCase()}">${esc(test.id)}</span></td>
  <td class="tr-td-cat">${esc(categoryLabel(test.category))}</td>
  <td class="tr-td-name"><div class="tr-feature-name">${esc(displayName)}</div>${sourceReference}${technicalName}${infoButton}</td>
  <td class="tr-td-status"><span class="tr-status-icon ${rowClass}" aria-label="${test.aborted ? 'Не запущен' : (test.skip ? 'Пропущен' : (test.pass ? 'Пройден' : 'Провален'))}">${icon}</span></td>
  <td class="tr-td-details">${esc(test.details)}${diagnosticButton ? `<div class="tr-diagnostic-summary">${diagnosticSummary(test) ? `${esc(diagnosticSummary(test))} ` : ''}${diagnosticButton}</div>` : ''}</td>
  <td class="tr-td-dur">${esc(dur)}</td>
</tr>`;
}

/**
 * Строит HTML заголовка URL-группы.
 */
function buildUrlHeader(urlResult, index) {
    const total = urlResult.planned ?? urlResult.tests.length;
    const skipped = urlResult.tests.filter(t => t.skip).length;
    const aborted = urlResult.tests.filter(t => t.aborted).length;
    const passed = urlResult.tests.filter(t => !t.skip && !t.aborted && t.pass).length;
    const failed = urlResult.tests.filter(t => !t.skip && !t.aborted && !t.pass).length;
    const engine = urlResult.engine || '—';
    const version = urlResult.grafanaVersion ? `v${urlResult.grafanaVersion}` : '—';
    const dur = urlResult.finishedAt && urlResult.startedAt
        ? formatDuration(urlResult.finishedAt - urlResult.startedAt)
        : '';
    const statusClass = failed > 0 ? 'tr-url-fail' : (aborted > 0 ? 'tr-url-warn' : 'tr-url-ok');
    const probeErr = urlResult.probeError
        ? `<span class="tr-probe-error" title="${esc(urlResult.probeError)}">⚠ probe</span>`
        : '';

    return `<tr class="tr-url-header ${statusClass}" data-url-index="${index}">
  <td colspan="6">
    <span class="tr-url-toggle" data-url-index="${index}" title="Свернуть/развернуть">▾</span>
    <span class="tr-url-label">${esc(urlResult.url)}</span>
    <span class="tr-url-meta">${esc(engine)} ${esc(version)}</span>
    ${probeErr}
    <span class="tr-url-counts">
      <span class="tr-count-pass">✓ ${passed}</span>
      <span class="tr-count-fail">✗ ${failed}</span>
      ${skipped > 0 ? `<span class="tr-count-skip">◌ ${skipped}</span>` : ''}
      ${aborted > 0 ? `<span class="tr-count-skip">⊘ ${aborted} не запущено</span>` : ''}
      <span class="tr-count-total">/ ${total}</span>
      ${dur ? `<span class="tr-count-dur">${esc(dur)}</span>` : ''}
    </span>
  </td>
</tr>`;
}

/**
 * Полная перерисовка таблицы результатов из snapshot.results.
 */
function renderResultsTable(snapshot) {
    if (!elResultsTable) return;

    if (!snapshot.results.length) {
        elResultsTable.innerHTML = '';
        if (elEmptyState) elEmptyState.style.display = 'flex';
        return;
    }

    if (elEmptyState) elEmptyState.style.display = 'none';

    let html = '';
    snapshot.results.forEach((urlResult, index) => {
        html += buildUrlHeader(urlResult, index);
        urlResult.tests.forEach((test, testIndex) => {
            html += buildTestRow(test, index, testIndex);
        });
    });

    elResultsTable.innerHTML = html;

    // Навешиваем toggle-коллапс на заголовки
    elResultsTable.querySelectorAll('.tr-url-toggle').forEach(btn => {
        btn.addEventListener('click', e => {
            const idx = btn.dataset.urlIndex;
            const rows = elResultsTable.querySelectorAll(`.tr-test-row[data-url-index="${idx}"]`);
            const collapsed = btn.textContent === '▸';
            btn.textContent = collapsed ? '▾' : '▸';
            rows.forEach(r => { r.style.display = collapsed ? '' : 'none'; });
        });
    });

    elResultsTable.querySelectorAll('.tr-diagnostic-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const urlResult = lastSnapshot?.results?.[Number(button.dataset.urlIndex)];
            const test = urlResult?.tests?.[Number(button.dataset.testIndex)];
            const fullTest = test?.diagnosticRef ? await diagnosticSpool?.readTest(test.diagnosticRef) : test;
            if (fullTest?.diagnostic) diagnosticViewer?.showDiagnostic(fullTest, urlResult);
        });
    });
    elResultsTable.querySelectorAll('.tr-test-info-btn').forEach(button => {
        button.addEventListener('click', () => {
            const urlResult = lastSnapshot?.results?.[Number(button.dataset.urlIndex)];
            const test = urlResult?.tests?.[Number(button.dataset.testIndex)];
            if (test) diagnosticViewer?.showTestDescription(test);
        });
    });
}

// --- Прогресс-бар и статусная строка ---

function renderProgress(snapshot) {
    if (!elProgressBar || !elProgressText) return;

    const planned = snapshot.planned ?? snapshot.total;
    const completed = snapshot.completed ?? snapshot.done;
    const pct = planned > 0 ? Math.round((completed / planned) * 100) : 0;
    elProgressBar.style.width = `${pct}%`;

    const parts = [];
    if (snapshot.running) {
        parts.push(`⏳ завершено ${completed} / ${planned}; начато ${snapshot.started ?? completed}`);
        if (snapshot.currentUrl) parts.push(snapshot.currentUrl);
    } else if (snapshot.aborted) {
        parts.push(`⛔ Прервано: завершено ${completed} / ${planned}; не запущено ${snapshot.abortedNotRun || 0}`);
    } else if (snapshot.total > 0) {
        parts.push(`✓ ${snapshot.passed} пройдено, ✗ ${snapshot.failed} провалено`);
    }

    elProgressText.textContent = parts.join('  —  ');
}

function renderSummary(snapshot) {
    if (!elSummaryRow) return;
    if (snapshot.running || !snapshot.total) {
        elSummaryRow.style.display = 'none';
        return;
    }
    const active = (snapshot.completed ?? snapshot.done) - (snapshot.skipped || 0);
    const pct = active > 0 ? Math.round((snapshot.passed / active) * 100) : 0;
    const incomplete = (snapshot.abortedNotRun || 0) > 0 || snapshot.aborted;
    const statusClass = snapshot.failed > 0
        ? 'tr-summary-fail'
        : (incomplete ? 'tr-summary-warn' : 'tr-summary-ok');
    const skipPart = snapshot.skipped > 0
        ? `&nbsp;|&nbsp; ◌ ${snapshot.skipped} пропущено`
        : '';
    const abortedPart = snapshot.abortedNotRun > 0
        ? `&nbsp;|&nbsp; ⊘ ${snapshot.abortedNotRun} не запущено`
        : '';
    elSummaryRow.className = `tr-summary ${statusClass}`;
    elSummaryRow.innerHTML = `
      <span class="tr-summary-pct">${pct}%</span>
      <span class="tr-summary-detail">
        ✓ ${snapshot.passed} / ${active} завершённых тестов  &nbsp;|&nbsp;
        ✗ ${snapshot.failed} провалено${skipPart}${abortedPart}  &nbsp;|&nbsp;
        ${snapshot.results.length} URL
      </span>`;
    elSummaryRow.style.display = 'flex';
}

function setButtonState(running) {
    if (elRunBtn) {
        elRunBtn.disabled = running;
        const label = elRunBtn.querySelector('.tr-btn-label');
        if (label) label.textContent = running ? 'Запуск…' : 'Запустить тесты';
    }
    if (elAbortBtn) { elAbortBtn.disabled = !running; }
    if (elCopyBtn) { elCopyBtn.disabled = running || !lastSnapshot?.results?.length; }
    if (elCopyFailBtn) {
        elCopyFailBtn.disabled = running || !(lastSnapshot?.failed || lastSnapshot?.skipped || lastSnapshot?.abortedNotRun);
    }
    if (elExportDiagnosticsBtn) {
        elExportDiagnosticsBtn.disabled = running || !lastSnapshot?.results?.length;
    }
    if (elUrlInput) { elUrlInput.disabled = running; }
    if (elSelectTestsBtn) elSelectTestsBtn.disabled = running;
    if (elRunMode) elRunMode.disabled = running;
    if (!running) updateSelectionSummary();
}



function stopOperationProgressTimer() {
    if (operationProgressTimer !== null) clearInterval(operationProgressTimer);
    operationProgressTimer = null;
}

function updateOperationProgressWindow(snapshot = operationProgressSnapshot) {
    if (!operationProgressController || !operationProgressStartedAt) return;
    if (snapshot) operationProgressSnapshot = snapshot;
    const current = operationProgressSnapshot || {};
    const planned = current.planned ?? current.total ?? 0;
    const completed = current.completed ?? current.done ?? 0;
    const profile = (current.mode || elRunMode?.value) === 'full' ? 'Полный профиль' : 'Быстрый профиль';
    const skipped = Number(current.skipped) || 0;
    const notRun = Number(current.abortedNotRun) || 0;
    const details = [`Общее время: ${formatElapsedDuration(Date.now() - operationProgressStartedAt)}`];
    if (skipped > 0) details.push(`пропущено: ${skipped}`);
    if (notRun > 0) details.push(`не запущено: ${notRun}`);
    operationProgressController.update({
        done: completed,
        total: planned,
        unit: 'тестов',
        success: Number(current.passed) || 0,
        failed: Number(current.failed) || 0,
        phase: current.aborted ? 'Аварийная остановка…' : `Выполнение тестов · ${profile}`,
        message: details.join(' · '),
    });
}

function openOperationProgressWindow(mode) {
    operationProgressStartedAt = Date.now();
    operationProgressSnapshot = { mode, planned: 0, completed: 0, passed: 0, failed: 0, skipped: 0 };
    stopOperationProgressTimer();
    // requestWindow is invoked inside the controller before its first await, so
    // this call must remain before handleRun's first await to retain user activation.
    const pendingWindow = operationProgressController?.openPictureInPicture({
        title: 'Автопроверка DashBridge',
        phase: 'Подготовка тестов',
        width: 390,
        height: 300,
    }) || Promise.resolve(false);
    operationProgressTimer = setInterval(() => updateOperationProgressWindow(), 1000);
    return pendingWindow;
}

function finishOperationProgressWindow(snapshot, { error = null } = {}) {
    stopOperationProgressTimer();
    if (snapshot) operationProgressSnapshot = snapshot;
    const elapsed = formatElapsedDuration(Date.now() - (operationProgressStartedAt || Date.now()));
    const current = operationProgressSnapshot || {};
    updateOperationProgressWindow(current);
    const incomplete = current.aborted || (Number(current.abortedNotRun) || 0) > 0;
    const status = error ? 'error' : (incomplete ? 'cancelled' : ((Number(current.failed) || 0) > 0 ? 'partial' : 'complete'));
    const message = error
        ? `Ошибка запуска · общее время: ${elapsed}`
        : `${incomplete ? 'Прогон остановлен' : 'Прогон завершён'} · общее время: ${elapsed}`;
    operationProgressController?.finish({ status, message });
    operationProgressStartedAt = null;
}


// --- Запуск ---

function testsForProfile(mode = elRunMode?.value === 'full' ? 'full' : 'fast') {
    if (typeof DASHBRIDGE_TEST_SUITE === 'undefined') return [];
    return DASHBRIDGE_TEST_SUITE.filter(test => !Array.isArray(test.runModes) || test.runModes.includes(mode));
}

function selectedIdsForProfile(mode) {
    if (testSelection?.scope !== 'selected') return null;
    const allowed = new Set(testsForProfile(mode).map(test => test.id));
    return [...new Set((testSelection.ids || []).map(String))].filter(id => allowed.has(id));
}

function updateSelectionSummary() {
    if (!elSelectionSummary) return;
    const mode = elRunMode?.value === 'full' ? 'full' : 'fast';
    const profileTests = testsForProfile(mode);
    const ids = selectedIdsForProfile(mode);
    elSelectionSummary.textContent = ids === null
        ? `Все сценарии профиля: ${profileTests.length}`
        : `Выбрано: ${ids.length} из ${profileTests.length}`;
    if (elRunBtn) elRunBtn.disabled = !!DashBridgeTestRunner.getSnapshot().running || (Array.isArray(ids) && ids.length === 0);
}

async function openTestSelector() {
    const mode = elRunMode?.value === 'full' ? 'full' : 'fast';
    await chrome.storage.local.set({ trRunMode: mode }).catch(() => undefined);
    await chrome.windows.create({
        url: chrome.runtime.getURL(`pages/test-runner/test-selector.html?mode=${mode}`),
        type: 'popup',
        focused: true,
        width: 920,
        height: 820,
    });
}

function resultOutcome(test) {
    if (test.aborted) return 'not-run';
    if (test.skip) return 'skip';
    return test.pass ? 'pass' : 'fail';
}

async function persistCompactTestHistory(snapshot) {
    const stored = await chrome.storage.local.get('trTestHistory').catch(() => ({}));
    const previous = stored.trTestHistory && typeof stored.trTestHistory === 'object'
        ? stored.trTestHistory : { version: 1, tests: {}, runs: [] };
    const ranking = { fail: 4, 'not-run': 3, pass: 2, skip: 1 };
    const runTests = {};
    (snapshot.results || []).forEach(urlResult => (urlResult.tests || []).forEach(test => {
        const outcome = resultOutcome(test);
        if (!runTests[test.id] || ranking[outcome] > ranking[runTests[test.id].outcome]) {
            runTests[test.id] = {
                outcome,
                name: test.feature?.label || test.name,
                durationMs: Number(test.durationMs) || 0,
                details: String(test.details || '').slice(0, 500),
                at: snapshot.finishedAt || Date.now(),
            };
        }
    }));
    const run = {
        runId: snapshot.runId || null,
        at: snapshot.finishedAt || Date.now(),
        mode: snapshot.mode || 'fast',
        selection: snapshot.selection || { scope: 'all', ids: [] },
        planned: Number(snapshot.planned) || 0,
        passed: Number(snapshot.passed) || 0,
        failed: Number(snapshot.failed) || 0,
        skipped: Number(snapshot.skipped) || 0,
        notRun: Number(snapshot.abortedNotRun) || 0,
    };
    await chrome.storage.local.set({
        trTestHistory: {
            version: 1,
            updatedAt: run.at,
            tests: { ...(previous.tests || {}), ...runTests },
            runs: [run, ...(previous.runs || []).filter(item => item.runId !== run.runId)].slice(0, 20),
        },
    });
}

async function handleRun() {
    const rawUrls = elUrlInput ? elUrlInput.value : '';
    const urls = rawUrls.split('\n').map(u => u.trim()).filter(Boolean);

    if (!urls.length) {
        if (elStatusLine) {
            elStatusLine.textContent = '⚠ Введите хотя бы один URL Grafana дашборда';
            elStatusLine.className = 'tr-status tr-status-warn';
        }
        return;
    }

    // Удаляем refresh= из URL в textarea для наглядности
    const cleanedUrls = urls.map(u => {
        try {
            const url = new URL(u);
            url.searchParams.delete('refresh');
            return url.toString();
        } catch {
            return u;
        }
    }).join('\n');

    if (elUrlInput && cleanedUrls !== rawUrls) {
        elUrlInput.value = cleanedUrls;
    }

    const mode = elRunMode?.value === 'full' ? 'full' : 'fast';
    const selectedTestIds = selectedIdsForProfile(mode);
    if (Array.isArray(selectedTestIds) && !selectedTestIds.length) {
        if (elStatusLine) {
            elStatusLine.textContent = '⚠ В выбранном профиле не отмечено ни одного сценария';
            elStatusLine.className = 'tr-status tr-status-warn';
        }
        return;
    }
    // Open the always-on-top view while the Run click still carries user
    // activation. All validation that can reject without async work is above.
    const progressWindowPromise = openOperationProgressWindow(mode);
    // Сохраняем ввод и выбранный профиль для следующего запуска.
    try { await chrome.storage.local.set({ trLastUrls: cleanedUrls, trRunMode: mode, trTestSelection: testSelection }); } catch (_) { }

    // Очищаем таблицу
    if (elResultsTable) elResultsTable.innerHTML = '';
    if (elEmptyState) elEmptyState.style.display = 'none';
    if (elSummaryRow) elSummaryRow.style.display = 'none';
    if (elStatusLine) { elStatusLine.textContent = ''; elStatusLine.className = 'tr-status'; }
    lastSnapshot = null;

    // Do this before opening the first Grafana tab. If OPFS is unavailable we
    // fail early instead of starting a run that can OOM on dashboard #2.
    diagnosticSpool = new DiagnosticSpool();
    try {
        await diagnosticSpool.begin(`run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    } catch (error) {
        await progressWindowPromise;
        finishOperationProgressWindow(null, { error });
        diagnosticSpool = null;
        if (elStatusLine) {
            elStatusLine.textContent = `⚠ Невозможно подготовить безопасное хранилище диагностики: ${error?.message || String(error)}`;
            elStatusLine.className = 'tr-status tr-status-fail';
        }
        return;
    }

    setButtonState(true);
    if (elProgress) elProgress.style.display = 'flex';
    await progressWindowPromise;
    updateOperationProgressWindow();

    try {
        await DashBridgeTestRunner.run(urls, {
            mode,
            selectedTestIds,
            async onTestFinalized(testResult, context) {
                return diagnosticSpool.persistTest(testResult, context.urlIndex, context.testIndex, context.url);
            },
            async onUrlFinalized(urlResult, urlIndex) {
                if (elStatusLine) {
                    elStatusLine.textContent = `Сохранение полной диагностики дашборда ${urlIndex + 1} на диск…`;
                    elStatusLine.className = 'tr-status tr-status-warn';
                }
                const retained = await diagnosticSpool.persistUrl(urlResult, urlIndex);
                if (elStatusLine) {
                    elStatusLine.textContent = `Диагностика дашборда ${urlIndex + 1} сохранена; временно на диске ${formatBytes(diagnosticSpool.spoolBytes)}`;
                }
                return retained;
            },
            onProgress(snapshot) {
                lastSnapshot = snapshot;
                renderProgress(snapshot);
                updateOperationProgressWindow(snapshot);
                // A progress event can add several NOT RUN rows after an
                // abort or unsafe reset; redraw to keep DOM and snapshot equal.
                renderResultsTable(snapshot);
            },
            onComplete(snapshot) {
                lastSnapshot = snapshot;
                renderProgress(snapshot);
                renderResultsTable(snapshot);
                renderSummary(snapshot);
                setButtonState(false);
                finishOperationProgressWindow(snapshot);
                void persistCompactTestHistory(snapshot);
                if (elStatusLine) {
                    const incomplete = snapshot.aborted || (snapshot.abortedNotRun || 0) > 0;
                    const ok = snapshot.failed === 0 && !incomplete;
                    const modeLabel = snapshot.mode === 'full' ? 'Полный' : 'Быстрый';
                    elStatusLine.textContent = ok
                        ? `✓ ${modeLabel}: все ${snapshot.passed} тестов пройдены`
                        : (incomplete
                            ? `⚠ ${modeLabel}: прогон неполный — не запущено ${snapshot.abortedNotRun || 0}`
                            : `✗ ${modeLabel}: провалено ${snapshot.failed} из ${snapshot.total}`);
                    elStatusLine.className = `tr-status ${ok ? 'tr-status-ok' : (incomplete ? 'tr-status-warn' : 'tr-status-fail')}`;
                }
            },
        });
    } catch (e) {
        setButtonState(false);
        finishOperationProgressWindow(lastSnapshot, { error: e });
        if (elStatusLine) {
            elStatusLine.textContent = `⚠ Ошибка запуска: ${e.message || String(e)}`;
            elStatusLine.className = 'tr-status tr-status-warn';
        }
    }
}

function handleAbort() {
    DashBridgeTestRunner.abort();
    if (operationProgressSnapshot) {
        operationProgressSnapshot = { ...operationProgressSnapshot, aborted: true };
        updateOperationProgressWindow(operationProgressSnapshot);
    }
    if (elAbortBtn) elAbortBtn.disabled = true;
    if (elStatusLine) {
        elStatusLine.textContent = '⛔ Прерывание…';
        elStatusLine.className = 'tr-status tr-status-warn';
    }
}

function handleClear() {
    if (elResultsTable) elResultsTable.innerHTML = '';
    if (elEmptyState) elEmptyState.style.display = 'flex';
    if (elSummaryRow) elSummaryRow.style.display = 'none';
    if (elProgress) elProgress.style.display = 'none';
    if (elStatusLine) { elStatusLine.textContent = ''; elStatusLine.className = 'tr-status'; }
    lastSnapshot = null;
    void diagnosticSpool?.clear();
    diagnosticSpool = null;
    stopOperationProgressTimer();
    operationProgressStartedAt = null;
    operationProgressSnapshot = null;
    void operationProgressController?.release();
    setButtonState(false);
}

// --- Инициализация ---

async function initTestRunnerUI() {
    elUrlInput = document.getElementById('trUrlInput');
    elRunMode = document.getElementById('trRunMode');
    elSelectTestsBtn = document.getElementById('trSelectTestsBtn');
    elSelectionSummary = document.getElementById('trSelectionSummary');
    elRunBtn = document.getElementById('trRunBtn');
    elAbortBtn = document.getElementById('trAbortBtn');
    elCopyBtn = document.getElementById('trCopyBtn');
    elCopyFailBtn = document.getElementById('trCopyFailBtn');
    elExportDiagnosticsBtn = document.getElementById('trExportDiagnosticsBtn');
    elClearBtn = document.getElementById('trClearBtn');
    elProgress = document.getElementById('trProgress');
    elProgressBar = document.getElementById('trProgressBar');
    elProgressText = document.getElementById('trProgressText');
    elStatusLine = document.getElementById('trStatusLine');
    elResultsTable = document.getElementById('trResultsBody');
    elSummaryRow = document.getElementById('trSummary');
    elEmptyState = document.getElementById('trEmptyState');
    operationProgressController = globalThis.DashBridgeOperationProgress?.create({
        onCancel: handleAbort,
        closeDelayMs: 6000,
    }) || null;
    exportController = globalThis.DashBridgeTestExportController?.create({
        getSnapshot: () => lastSnapshot,
        getSpool: () => diagnosticSpool,
        elCopyBtn,
        elCopyFailBtn,
        elExportDiagnosticsBtn,
        elStatusLine,
        categoryLabel,
        formatDuration,
        serializeSpoolArtifact,
        localExportTimestamp,
        localIsoTimestamp,
    }) || null;
    diagnosticViewer = globalThis.DashBridgeTestDiagnosticViewer?.create({
        report: DashBridgeTestReport,
        createChunkedJsonBlob,
        copyTextToClipboard: exportController?.copyTextToClipboard,
        setStatus: (text, className) => {
            if (!elStatusLine) return;
            elStatusLine.textContent = text;
            elStatusLine.className = className;
        },
        esc,
        formatDuration,
    }) || null;
    if (!exportController || !diagnosticViewer) {
        throw new Error('Test Runner UI controllers are unavailable');
    }

    // The report cannot be resumed after this page is closed (the UI snapshot
    // is intentionally memory-only), so reclaim an interrupted run's private
    // OPFS data as soon as the runner is opened again.
    try { await DiagnosticSpool.clearStaleSessions(); } catch (error) {
        console.warn('[TestRunner] Cannot clear stale diagnostic spool', error);
    }

    // Обновляем число тестов в заголовке
    const headerSub = document.getElementById('trHeaderSub');
    if (headerSub && typeof DASHBRIDGE_TEST_SUITE !== 'undefined') {
        const testCount = DASHBRIDGE_TEST_SUITE.length;
        headerSub.textContent = `Grafana v10 (Flot) · v12 (uPlot) · ${testCount} ${testCount === 1 ? 'тест' : testCount < 5 ? 'теста' : 'тестов'}`;
    }

    // Восстанавливаем последний список URL
    try {
        const stored = await chrome.storage.local.get(['trLastUrls', 'trRunMode', 'trTestSelection']);
        if (stored.trLastUrls && elUrlInput && !elUrlInput.value.trim()) {
            elUrlInput.value = stored.trLastUrls;
        }
        if (elRunMode && stored.trRunMode === 'full') elRunMode.value = 'full';
        if (stored.trTestSelection?.scope === 'selected' && Array.isArray(stored.trTestSelection.ids)) {
            testSelection = { scope: 'selected', ids: [...new Set(stored.trTestSelection.ids.map(String))] };
        }
    } catch (_) { }

    setButtonState(false);
    if (elProgress) elProgress.style.display = 'none';
    if (elSummaryRow) elSummaryRow.style.display = 'none';

    elRunBtn?.addEventListener('click', handleRun);
    elSelectTestsBtn?.addEventListener('click', openTestSelector);
    elRunMode?.addEventListener('change', () => {
        void chrome.storage.local.set({ trRunMode: elRunMode.value });
        updateSelectionSummary();
    });
    elAbortBtn?.addEventListener('click', handleAbort);
    elCopyBtn?.addEventListener('click', exportController.copyReport);
    elCopyFailBtn?.addEventListener('click', exportController.copyFailureReport);
    elExportDiagnosticsBtn?.addEventListener('click', exportController.exportDiagnostics);
    elClearBtn?.addEventListener('click', handleClear);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.trTestSelection) return;
        const next = changes.trTestSelection.newValue;
        testSelection = next?.scope === 'selected' && Array.isArray(next.ids)
            ? { scope: 'selected', ids: [...new Set(next.ids.map(String))] }
            : { scope: 'all', ids: [] };
        updateSelectionSummary();
    });
    window.addEventListener('pagehide', () => {
        stopOperationProgressTimer();
        void operationProgressController?.release();
        void diagnosticSpool?.clear();
    }, { once: true });

    // Ctrl+Enter в textarea → запуск
    elUrlInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleRun();
        }
    });
    document.documentElement.dataset.dashbridgeTestRunnerReady = 'true';
}

document.addEventListener('DOMContentLoaded', initTestRunnerUI);
