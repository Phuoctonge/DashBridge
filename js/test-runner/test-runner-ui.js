// test-runner-ui.js
// UI-слой E2E тест-раннера DashBridge.
// Управляет страницей test-runner.html: ввод URL, запуск/стоп, таблица результатов,
// прогресс-бар, копирование отчёта.
// Зависит от: test-runner-core.js (DashBridgeTestRunner),
//             test-runner-suite.js (DASHBRIDGE_TEST_SUITE),
//             test-runner-probe.js (dashbridgeRunProbe — загружается core'ом),
//             operation-progress-window.js (DashBridgeOperationProgress)

'use strict';

// --- DOM-узлы (инициализируются в init()) ---

let elUrlInput = null;  // <textarea id="trUrlInput">
let elRunMode = null;  // <select id="trRunMode">
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

class DiagnosticSpool {
    constructor() {
        this.root = null;
        this.baseDirectory = null;
        this.directory = null;
        this.entries = [];
        this.assets = new Map();
        this.assetsByCategory = {
            images: new Map(), domSnapshots: new Map(),
            diagnosticEvents: new Map(), performanceResources: new Map(),
        };
        this.visualStates = {};
        this.retainedImageBytes = 0;
        this.spoolBytes = 0;
        this.storageEstimate = null;
    }

    async begin(runId) {
        await this.clear();
        if (typeof navigator.storage?.getDirectory !== 'function') {
            throw new Error('Chrome не предоставляет OPFS — безопасный запуск нескольких дашбордов невозможен');
        }
        this.root = await navigator.storage.getDirectory();
        this.baseDirectory = await this.root.getDirectoryHandle('dashbridge-e2e-spool', { create: true });
        // OPFS survives closing the runner page. Remove stale *DashBridge-only*
        // sessions here so multi-gigabyte evidence from an interrupted old run
        // cannot silently consume the browser quota forever.
        for await (const [name] of this.baseDirectory.entries()) {
            await this.baseDirectory.removeEntry(name, { recursive: true });
        }
        const name = `dashbridge-e2e-run-${String(runId || Date.now()).replace(/[^a-z0-9_-]/gi, '-')}`;
        this.directory = await this.baseDirectory.getDirectoryHandle(name, { create: true });
        this.entries = [];
        this.assets.clear();
        Object.values(this.assetsByCategory).forEach(store => store.clear());
        this.visualStates = {};
        this.retainedImageBytes = 0;
        this.spoolBytes = 0;
        this.storageEstimate = typeof navigator.storage?.estimate === 'function'
            ? await navigator.storage.estimate().catch(() => null) : null;
    }

    static async clearStaleSessions() {
        if (typeof navigator.storage?.getDirectory !== 'function') return;
        const root = await navigator.storage.getDirectory();
        const base = await root.getDirectoryHandle('dashbridge-e2e-spool', { create: true });
        for await (const [name] of base.entries()) {
            await base.removeEntry(name, { recursive: true });
        }
    }

    async clear() {
        const root = this.root;
        const baseDirectory = this.baseDirectory;
        const directory = this.directory;
        this.root = null;
        this.baseDirectory = null;
        this.directory = null;
        this.entries = [];
        this.assets.clear();
        Object.values(this.assetsByCategory).forEach(store => store.clear());
        this.visualStates = {};
        this.retainedImageBytes = 0;
        this.spoolBytes = 0;
        this.storageEstimate = null;
        if (root && baseDirectory && directory) {
            await baseDirectory.removeEntry(directory.name, { recursive: true }).catch(() => {});
        }
    }

    async writeJson(name, value) {
        const handle = await this.directory.getFileHandle(name, { create: true });
        const previousSize = await handle.getFile().then(file => file.size).catch(() => 0);
        const writable = await handle.createWritable();
        try {
            await serializeJsonInChunks(value, chunk => writable.write(chunk));
            await writable.close();
            const nextSize = await handle.getFile().then(file => file.size).catch(() => previousSize);
            this.spoolBytes += Math.max(0, nextSize - previousSize);
        } catch (error) {
            await writable.abort?.(error).catch(() => {});
            throw error;
        }
    }

    static testSummary(test, ref) {
        // Keep only scalar/UI fields. In particular do not shallow-copy any
        // diagnostic sub-object: that would keep its entire object graph live.
        return {
            id: test.id, category: test.category, name: test.name,
            feature: test.feature || null, pass: !!test.pass, skip: !!test.skip,
            aborted: !!test.aborted, details: test.details || '',
            durationMs: Number(test.durationMs) || 0,
            timedOut: !!test.timedOut, environmentUnsafe: !!test.environmentUnsafe,
            error: test.error || null,
            outcome: test.outcome || null,
            reasonCode: test.reasonCode || null,
            shortReason: test.shortReason || null,
            visualAudit: test.visualAudit || null,
            analysisUnit: test.analysisUnit || null,
            diagnosticRef: ref,
        };
    }

    static networkPayloadRecord(url, diagnostic) {
        const archive = diagnostic?.networkPayloadArchive || {};
        const requests = Object.values(archive.requests || {});
        const responses = Object.values(archive.responses || {});
        const observations = responses.flatMap(response => response.observations || []);
        const payloads = [
            ...requests.map(request => request.body),
            ...observations.map(observation => observation.payload),
        ].filter(Boolean);
        return {
            url, schema: archive.schema || null,
            requests: requests.length, responses: responses.length, observations: observations.length,
            payloadBytes: payloads.reduce((sum, payload) => sum + (Number(payload.textBytes) || 0), 0),
            payloadErrors: payloads.filter(payload => payload.error).length,
            requestIds: requests.map(request => request.requestId).filter(Boolean),
        };
    }

    mergeVisualStates(states = {}) {
        for (const [ref, incoming] of Object.entries(states)) {
            const current = this.visualStates[ref];
            if (!current) {
                this.visualStates[ref] = incoming;
                continue;
            }
            current.uses = (current.uses || 0) + (incoming.uses || 0);
            for (const key of ['captureModes', 'reasons']) {
                for (const value of incoming[key] || []) {
                    if (!current[key].includes(value)) current[key].push(value);
                }
            }
            current.evidence.panelImageRef ||= incoming.evidence?.panelImageRef || null;
            current.evidence.viewportImageRef ||= incoming.evidence?.viewportImageRef || null;
            for (const imageRef of incoming.evidence?.canvasImageRefs || []) {
                if (!current.evidence.canvasImageRefs.includes(imageRef)) current.evidence.canvasImageRefs.push(imageRef);
            }
        }
    }

    async persistAssets(assets = {}) {
        const categories = ['images', 'domSnapshots', 'diagnosticEvents', 'performanceResources'];
        for (const category of categories) {
            for (const [ref, value] of Object.entries(assets[category] || {})) {
                if (this.assets.has(ref)) continue;
                const file = `asset-${category}-${ref}.json`;
                await this.writeJson(file, value);
                const record = { category, file };
                this.assets.set(ref, record);
                this.assetsByCategory[category].set(ref, record);
                if (category === 'images') this.retainedImageBytes += Number(value.bytes) || 0;
            }
        }
    }

    async persistTest(test, urlIndex, testIndex, url = '') {
        if (!this.directory) throw new Error('Дисковое хранилище диагностики не инициализировано');
        const artifact = DashBridgeTestReport.createTestArtifact(test, { url });
        await this.persistAssets(artifact.assets);
        this.mergeVisualStates(artifact.visualStates);
        const file = `url-${String(urlIndex).padStart(4, '0')}-test-${String(testIndex).padStart(4, '0')}.json`;
        await this.writeJson(file, artifact.value);
        const entry = this.entries[urlIndex] || (this.entries[urlIndex] = { metadataFile: null, testFiles: [] });
        entry.testFiles[testIndex] = file;
        return DiagnosticSpool.testSummary({ ...artifact.value, analysisUnit: artifact.analysisUnit },
            { urlIndex, testIndex, file });
    }

    async persistUrl(urlResult, urlIndex) {
        if (!this.directory) throw new Error('Дисковое хранилище диагностики не инициализировано');
        const prefix = `url-${String(urlIndex).padStart(4, '0')}`;
        const { tests = [], ...metadata } = urlResult;
        const metadataFile = `${prefix}-metadata.json`;
        const metadataArtifact = DashBridgeTestReport.createUrlMetadataArtifact(metadata);
        await this.persistAssets(metadataArtifact.assets);
        this.mergeVisualStates(metadataArtifact.visualStates);
        await this.writeJson(metadataFile, metadataArtifact.value);
        const entry = this.entries[urlIndex] || (this.entries[urlIndex] = { metadataFile: null, testFiles: [] });
        entry.metadataFile = metadataFile;
        const summaries = [];
        for (let index = 0; index < tests.length; index += 1) {
            const existingFile = entry.testFiles[index];
            if (tests[index]?.diagnosticRef && existingFile) summaries.push(tests[index]);
            else summaries.push(await this.persistTest(tests[index], urlIndex, index, metadata.url || ''));
            // Yield between tests so Chromium can collect the just-serialized
            // temporary strings before the next large diagnostic is handled.
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        // The compact URL metadata is on disk. Keep only non-diagnostic fields
        // and a tiny aggregate used by the global analysis in renderer memory.
        const { diagnostic, ...uiMetadata } = metadata;
        return {
            ...uiMetadata,
            tests: summaries,
            analysisNetworkPayloadRecord: DiagnosticSpool.networkPayloadRecord(metadata.url, diagnostic),
            diagnosticSpool: { urlIndex, persisted: true },
        };
    }

    async readTest(ref) {
        if (!ref?.file || !this.directory) return null;
        const handle = await this.directory.getFileHandle(ref.file);
        const test = JSON.parse(await (await handle.getFile()).text());
        return this.hydrateValue(test, new Map());
    }

    async readAsset(ref) {
        const record = this.assets.get(ref);
        if (!record) return null;
        const handle = await this.directory.getFileHandle(record.file);
        return JSON.parse(await (await handle.getFile()).text());
    }

    async hydrateValue(value, cache = new Map()) {
        if (value === null || value === undefined || typeof value !== 'object') return value;
        if (Array.isArray(value)) return Promise.all(value.map(item => this.hydrateValue(item, cache)));
        if (value.assetRef && Object.keys(value).length === 1) {
            if (!cache.has(value.assetRef)) cache.set(value.assetRef, this.readAsset(value.assetRef));
            const asset = await cache.get(value.assetRef);
            return asset?.value ?? value;
        }
        const output = {};
        for (const [key, child] of Object.entries(value)) output[key] = await this.hydrateValue(child, cache);
        if (value.imageRef && !output.dataUrl) {
            if (!cache.has(value.imageRef)) cache.set(value.imageRef, this.readAsset(value.imageRef));
            const image = await cache.get(value.imageRef);
            if (image?.dataUrl) output.dataUrl = image.dataUrl;
        }
        if (value.outerHTMLRef && !output.outerHTML) {
            if (!cache.has(value.outerHTMLRef)) cache.set(value.outerHTMLRef, this.readAsset(value.outerHTMLRef));
            const dom = await cache.get(value.outerHTMLRef);
            if (typeof dom?.value === 'string') output.outerHTML = dom.value;
        }
        return output;
    }

    async streamFile(name, writeChunk, start = 0, end = undefined) {
        const handle = await this.directory.getFileHandle(name);
        const file = await handle.getFile();
        const reader = file.slice(start, end).stream().getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                await writeChunk(value);
            }
        } finally {
            reader.releaseLock();
        }
    }

    async streamUrl(urlIndex, writeChunk) {
        const entry = this.entries[urlIndex];
        if (!entry) throw new Error(`Нет дискового сегмента для URL #${urlIndex + 1}`);
        const metadata = await (await this.directory.getFileHandle(entry.metadataFile)).getFile();
        if (metadata.size < 2) throw new Error(`Повреждён метаданный сегмент URL #${urlIndex + 1}`);
        await writeChunk('{');
        await this.streamFile(entry.metadataFile, writeChunk, 1, metadata.size - 1);
        await writeChunk(',"tests":[');
        for (let index = 0; index < entry.testFiles.length; index += 1) {
            if (index) await writeChunk(',');
            await this.streamFile(entry.testFiles[index], writeChunk);
        }
        await writeChunk(']}');
    }

    async streamAssets(writeChunk) {
        const counts = Object.fromEntries(Object.entries(this.assetsByCategory)
            .map(([category, store]) => [category, store.size]));
        await writeChunk('{"policy":"all-snapshots-deduplicated/v1"');
        await writeChunk(`,"retainedImageBytes":${this.retainedImageBytes}`);
        await writeChunk(`,"retainedImages":${counts.images},"omittedImages":0`);
        for (const category of ['images', 'domSnapshots', 'diagnosticEvents', 'performanceResources']) {
            const label = category === 'domSnapshots' ? 'retainedDomSnapshots'
                : category === 'diagnosticEvents' ? 'retainedDiagnosticEvents'
                    : category === 'performanceResources' ? 'retainedPerformanceResources' : null;
            if (label) await writeChunk(`,"${label}":${counts[category]}`);
            await writeChunk(`,"${category}":{`);
            let index = 0;
            for (const [ref, record] of this.assetsByCategory[category]) {
                if (index++) await writeChunk(',');
                await writeChunk(`${JSON.stringify(ref)}:`);
                await this.streamFile(record.file, writeChunk);
            }
            await writeChunk('}');
        }
        await writeChunk('}');
    }
}

// --- Утилиты ---

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function categoryLabel(cat) {
    const map = {
        G: 'G · Auto-refresh',
        F: 'Storage',
        A: 'Environment',
        B: 'Visuals',
        C: 'Series Filter',
        D: 'Combinatorial',
        E: 'Data Pipeline',
        H: 'H · Matrix Transitions',
    };
    return map[cat] || cat;
}

function formatDuration(ms) {
    if (!ms && ms !== 0) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
    const technicalName = feature && feature.label !== test.name
        ? `<div class="tr-technical-name" title="Техническое имя теста">${esc(test.name)}</div>`
        : '';
    const diagnosticButton = (test.diagnostic || test.diagnosticRef)
        ? `<button class="tr-diagnostic-btn" data-url-index="${urlIndex}" data-test-index="${testIndex}" title="Показать собранную диагностику"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v5m0-8h.01"/></svg>Диагностика</button>`
        : '';
    return `<tr class="tr-test-row ${rowClass}" data-url-index="${urlIndex}">
  <td class="tr-td-id"><span class="tr-badge tr-badge-${test.category.toLowerCase()}">${esc(test.id)}</span></td>
  <td class="tr-td-cat">${esc(categoryLabel(test.category))}</td>
  <td class="tr-td-name"><div class="tr-feature-name">${esc(displayName)}</div>${sourceReference}${technicalName}</td>
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
            if (fullTest?.diagnostic) showDiagnostic(fullTest, urlResult);
        });
    });
}

/**
 * Инкрементальное добавление строк теста в конец таблицы
 * (вызывается из onProgress для живого обновления).
 */
function appendLatestTestRow(snapshot) {
    if (!elResultsTable) return;
    if (!snapshot.results.length) return;

    // Текущий URL — последний в results (добавляется до запуска тестов)
    const urlIndex = snapshot.results.length - 1;
    const urlResult = snapshot.results[urlIndex];
    if (!urlResult) return;

    if (!urlResult.tests.length) {
        // Первый вызов для этого URL — добавляем заголовок
        if (elEmptyState) elEmptyState.style.display = 'none';
        elResultsTable.insertAdjacentHTML('beforeend', buildUrlHeader(urlResult, urlIndex));
        return;
    }

    // Если заголовок ещё не добавлен — добавим
    if (!elResultsTable.querySelector(`[data-url-index="${urlIndex}"].tr-url-header`)) {
        elResultsTable.insertAdjacentHTML('beforeend', buildUrlHeader(urlResult, urlIndex));
    } else {
        // Обновляем счётчики в заголовке
        const headerRow = elResultsTable.querySelector(`.tr-url-header[data-url-index="${urlIndex}"]`);
        if (headerRow) {
            // Replace the complete header so a newly encountered SKIP or
            // aborted/not-run count gets its own element during live updates.
            headerRow.outerHTML = buildUrlHeader(urlResult, urlIndex);
        }
    }

    // Добавляем последнюю строку теста
    const lastTest = urlResult.tests[urlResult.tests.length - 1];
    const testIndex = urlResult.tests.length - 1;
    elResultsTable.insertAdjacentHTML('beforeend', buildTestRow(lastTest, urlIndex, testIndex));
    const row = elResultsTable.lastElementChild;
    row?.querySelector('.tr-diagnostic-btn')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const test = lastSnapshot?.results?.[Number(button.dataset.urlIndex)]?.tests?.[Number(button.dataset.testIndex)];
        const fullTest = test?.diagnosticRef ? await diagnosticSpool?.readTest(test.diagnosticRef) : test;
        if (fullTest?.diagnostic) showDiagnostic(fullTest, urlResult);
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
}

// --- Отчёт (текстовый / Markdown) ---

function buildTextReport(snapshot) {
    if (!snapshot || !snapshot.results.length) return '(нет результатов)';

    const lines = [];
    const skipped = snapshot.skipped || 0;
    const aborted = snapshot.abortedNotRun || 0;
    const completed = snapshot.completed ?? snapshot.done;
    const active = completed - skipped;
    lines.push('# DashBridge E2E Test Report');
    lines.push(`Дата: ${new Date().toLocaleString('ru-RU')}`);
    lines.push(`План: ${snapshot.planned ?? snapshot.total}; начато: ${snapshot.started ?? completed}; завершено: ${completed}; не запущено: ${aborted}`);
    lines.push(`Итого: ✓ ${snapshot.passed} / ${active}   ✗ ${snapshot.failed}${skipped > 0 ? `   ◌ ${skipped} пропущено` : ''}${aborted > 0 ? `   ⊘ ${aborted} не запущено` : ''}`);
    lines.push('');

    snapshot.results.forEach(urlResult => {
        const total = urlResult.planned ?? urlResult.tests.length;
        const urlSkipped = urlResult.tests.filter(t => t.skip).length;
        const urlAborted = urlResult.tests.filter(t => t.aborted).length;
        const passed = urlResult.tests.filter(t => !t.skip && !t.aborted && t.pass).length;
        const failed = urlResult.tests.filter(t => !t.skip && !t.aborted && !t.pass).length;
        lines.push(`## ${urlResult.url}`);
        lines.push(`Engine: ${urlResult.engine || '—'}  Grafana: ${urlResult.grafanaVersion ? 'v' + urlResult.grafanaVersion : '—'}`);
        lines.push(`✓ ${passed} / ${urlResult.completed ?? urlResult.tests.length - urlSkipped - urlAborted}${urlSkipped > 0 ? `  ◌ ${urlSkipped} пропущено` : ''}${urlAborted > 0 ? `  ⊘ ${urlAborted} не запущено` : ''}${urlResult.probeError ? '  ⚠ ' + urlResult.probeError : ''}`);
        lines.push('');
        lines.push('| ID  | Категория     | Тест                                                  | Результат | Детали                                               |');
        lines.push('|-----|---------------|-------------------------------------------------------|-----------|------------------------------------------------------|');
        urlResult.tests.forEach(t => {
            const id = t.id.padEnd(4);
            const cat = categoryLabel(t.category).padEnd(13);
            const name = t.name.substring(0, 52).padEnd(53);
            const res = (t.aborted ? '⊘ NOT RUN' : (t.skip ? '◌ SKIP' : (t.pass ? '✓ PASS' : '✗ FAIL'))).padEnd(9);
            const det = (t.details || '').substring(0, 52);
            lines.push(`| ${id}| ${cat}| ${name}| ${res}| ${det.padEnd(52)} |`);
        });
        lines.push('');
    });

    return lines.join('\n');
}

async function copyReport() {
    if (!lastSnapshot) return;
    await copyTextToClipboard(buildTextReport(lastSnapshot), elCopyBtn);
}

function buildFailureReport(snapshot) {
    if (!snapshot || !snapshot.results.length) return '(нет результатов)';

    const skipped = snapshot.skipped || 0;
    const aborted = snapshot.abortedNotRun || 0;
    const active = (snapshot.completed ?? snapshot.done) - skipped;
    const lines = [
        '# DashBridge E2E — ошибки и пропуски',
        `Дата: ${new Date().toLocaleString('ru-RU')}`,
        `Провалено: ${snapshot.failed} из ${active}${skipped ? `; пропущено: ${skipped}` : ''}${aborted ? `; не запущено: ${aborted}` : ''}`,
        ''
    ];

    snapshot.results.forEach(urlResult => {
        const notable = urlResult.tests.filter(test => test.aborted || test.skip || !test.pass);
        if (!notable.length) return;

        lines.push(`## ${urlResult.url}`);
        lines.push(`Engine: ${urlResult.engine || '—'}; Grafana: ${urlResult.grafanaVersion ? `v${urlResult.grafanaVersion}` : '—'}`);
        notable.forEach(test => {
            const status = test.aborted ? 'NOT RUN' : (test.skip ? 'SKIP' : 'FAIL');
            const duration = formatDuration(test.durationMs) || '—';
            lines.push(`- [${status}] [${test.id}] ${test.name} (${duration})${test.details ? ` — ${test.details}` : ''}`);
        });
        lines.push('');
    });

    return lines.join('\n');
}

async function copyFailureReport() {
    if (!lastSnapshot) return;
    await copyTextToClipboard(buildFailureReport(lastSnapshot), elCopyFailBtn);
}

function showDiagnostic(test, urlResult) {
    const visualAudit = DashBridgeTestReport.buildVisualAudit(test);
    const payload = {
        schema: 'dashbridge-e2e-diagnostic-view/v1',
        url: urlResult.url,
        engine: urlResult.engine,
        grafanaVersion: urlResult.grafanaVersion,
        test: {
            id: test.id,
            name: test.name,
            feature: test.feature || null,
            pass: test.pass,
            skip: test.skip,
            aborted: !!test.aborted,
            details: test.details,
            durationMs: test.durationMs,
            visualAudit,
            diagnostic: test.diagnostic,
        },
    };
    // noopener makes window.open() return null in Chromium, so the old code
    // always treated an already opened tab as blocked and left it at about:blank.
    const popup = window.open('', '_blank', 'width=1280,height=860');
    if (!popup) {
        const compactNotice = JSON.stringify({
            schema: payload.schema,
            url: payload.url,
            test: { id: test.id, name: test.name, details: test.details },
            notice: 'Полный объект слишком велик для буфера обмена; используйте экспорт JSON.',
        }, null, 2);
        void copyTextToClipboard(compactNotice, null);
        if (elStatusLine) {
            elStatusLine.textContent = 'Диагностика скопирована в буфер: браузер заблокировал окно просмотра';
            elStatusLine.className = 'tr-status tr-status-warn';
        }
        return;
    }

    const imagePool = new Map();
    const collectImages = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(collectImages); return; }
        if (obj.hash && obj.dataUrl) imagePool.set(obj.hash, obj.dataUrl);
        Object.values(obj).forEach(collectImages);
    };
    collectImages(payload);

    const addSnapshot = (host, title, snapshot, seenVisuals = null) => {
        const unique = (kind, image) => {
            if (!image?.dataUrl) return false;
            const key = `${kind}:${image.hash || image.dataUrl}`;
            if (seenVisuals?.has(key)) return false;
            seenVisuals?.add(key);
            return true;
        };
        const viewportImage = unique('viewport', snapshot?.viewportImage) ? snapshot.viewportImage : null;
        const panelImage = unique('panel', snapshot?.panelImage) ? snapshot.panelImage : null;
        const canvas = (snapshot?.canvas || []).filter(item => unique('canvas', item));
        if (!canvas.length && !panelImage && !viewportImage) return;
        const section = popup.document.createElement('section');
        section.className = 'snapshot';
        const heading = popup.document.createElement('h2');
        heading.textContent = title;
        section.appendChild(heading);

        const state = popup.document.createElement('div');
        state.className = 'snapshot-state';
        const markers = snapshot?.markers || {};
        const markerText = [
            markers.legendBottom ? 'легенда снизу' : '',
            markers.hidden ? `скрыто: ${markers.hidden}` : '',
            markers.dimmed ? `затемнено: ${markers.dimmed}` : '',
            markers.threshold ? `порог: ${markers.threshold}` : '',
        ].filter(Boolean);
        const series = (snapshot?.series || []).map(item => item.label).filter(Boolean);
        state.textContent = [
            snapshot?.renderer ? `Рендерер: ${snapshot.renderer}` : '',
            Number.isFinite(snapshot?.chartSeriesCount) ? `серий: ${snapshot.chartSeriesCount}` : '',
            markerText.join(' · '),
            series.length ? `ряды: ${series.slice(0, 8).join(', ')}${series.length > 8 ? '…' : ''}` : '',
            snapshot?.legend?.entries ? `легенда: ${snapshot.legend.bottomEntries}/${snapshot.legend.entries} строк в нижнем контейнере` : '',
        ].filter(Boolean).join('  | ');
        if (state.textContent) section.appendChild(state);

        if (snapshot?.logs && snapshot.logs.length > 0) {
            const logsBlock = popup.document.createElement('pre');
            logsBlock.className = 'snapshot-logs';
            logsBlock.textContent = snapshot.logs.join('\n');
            section.appendChild(logsBlock);
        }

        const images = popup.document.createElement('div');
        images.className = 'images';
        if (viewportImage?.dataUrl) {
            const figure = popup.document.createElement('figure');
            const image = popup.document.createElement('img');
            image.src = viewportImage.dataUrl;
            image.alt = `${title}, весь видимый экран вкладки`;
            image.title = 'Нажмите, чтобы открыть оригинал PNG в новой вкладке';
            image.addEventListener('click', () => window.open(viewportImage.dataUrl, '_blank', 'noopener,noreferrer'));
            const caption = popup.document.createElement('figcaption');
            caption.textContent = `Вся видимая вкладка · ${viewportImage.width}×${viewportImage.height} · ${viewportImage.hash}`;
            figure.append(image, caption);
            images.appendChild(figure);
        }
        if (panelImage?.dataUrl) {
            const figure = popup.document.createElement('figure');
            const image = popup.document.createElement('img');
            image.src = panelImage.dataUrl;
            image.alt = `${title}, панель вместе с легендой`;
            image.title = 'Нажмите, чтобы открыть оригинал PNG в новой вкладке';
            image.addEventListener('click', () => window.open(panelImage.dataUrl, '_blank', 'noopener,noreferrer'));
            const caption = popup.document.createElement('figcaption');
            caption.textContent = `Панель целиком (график + HTML-легенда) · ${panelImage.width}×${panelImage.height}`;
            figure.append(image, caption);
            images.appendChild(figure);
        }
        canvas.forEach((item, index) => {
            const figure = popup.document.createElement('figure');
            const caption = popup.document.createElement('figcaption');
            caption.textContent = `Canvas ${index + 1} · ${item.width}×${item.height} · ${item.hash} · ${item.bytes} B`;
            const url = item.dataUrl || imagePool.get(item.hash);
            if (url) {
                const image = popup.document.createElement('img');
                image.src = url;
                image.alt = `${title}, canvas ${index + 1}`;
                image.title = 'Нажмите, чтобы открыть оригинал PNG в новой вкладке';
                image.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));
                figure.appendChild(image);
            } else {
                const unavailable = popup.document.createElement('div');
                unavailable.className = 'unavailable';
                unavailable.textContent = 'Изображение отсутствует: этот отчёт создан до включения захвата PNG.';
                figure.appendChild(unavailable);
            }
            figure.appendChild(caption);
            images.appendChild(figure);
        });
        section.appendChild(images);
        host.appendChild(section);
    };

    const popupTheme = document.documentElement.getAttribute('data-theme') || 'light';
    try { popup.opener = null; } catch (_) { }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="ru" data-theme="${esc(popupTheme)}"><head><meta charset="utf-8"><title>Диагностика ${esc(test.id)}</title><style>
      :root{color-scheme:light;--primary:#2563eb;--success:#15803d;--danger:#ef4444;--warning:#f59e0b;--bg:#f1f5f9;--card:#fff;--surface:#f8fafc;--text:#0f172a;--muted:#64748b;--border:#cbd5e1;--shadow:0 4px 6px -1px rgba(0,0,0,.08)}
      [data-theme="dark"]{color-scheme:dark;--primary:#60a5fa;--success:#4ade80;--danger:#f87171;--warning:#fbbf24;--bg:#0f172a;--card:#1e293b;--surface:#334155;--text:#f1f5f9;--muted:#cbd5e1;--border:#475569;--shadow:0 4px 6px -1px rgba(0,0,0,.35)}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,-apple-system,system-ui,sans-serif}.page{max-width:1180px;margin:0 auto;padding:28px 32px 48px}h1{margin:0;font-size:28px;line-height:1.2;letter-spacing:-.02em}h2{margin:0 0 10px;font-size:18px}header{border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:24px}.meta{color:var(--primary);margin:8px 0 16px}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.fact{padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow)}.fact b{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}.fact span{display:block;margin-top:3px;font-weight:650}.pass{color:var(--success)}.fail{color:var(--danger)}.skip{color:var(--warning)}.result{margin:16px 0 0;padding:12px 14px;border-left:3px solid var(--primary);background:var(--card);border-radius:0 8px 8px 0;white-space:pre-wrap}.snapshot{margin:26px 0;padding-top:2px}.snapshot-state{margin:-3px 0 10px;color:var(--muted);font:12px/1.45 Consolas,monospace;overflow-wrap:anywhere}.snapshot-logs{margin:10px 0;padding:10px;border:1px solid color-mix(in srgb,var(--success) 35%,var(--border));border-left:3px solid var(--success);border-radius:6px;background:#071b13;color:#86efac;font:12px/1.45 Consolas,monospace;overflow-x:auto;white-space:pre-wrap}.images{display:grid;grid-template-columns:1fr;gap:16px}figure{margin:0;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--card);box-shadow:var(--shadow);min-width:0}img{display:block;width:100%;height:auto;background:#fff;cursor:zoom-in;border-radius:5px}figcaption{margin-top:8px;color:var(--muted);font:12px/1.4 Consolas,monospace}.unavailable{padding:16px;background:var(--surface);color:var(--warning);border-radius:6px}details{margin-top:28px;border-top:1px solid var(--border);padding-top:16px}summary{cursor:pointer;color:var(--primary);font-weight:650}pre{margin:12px 0 0;white-space:pre-wrap;word-break:break-word;color:var(--text);font:12px/1.45 Consolas,monospace}@media(max-width:600px){.page{padding:20px 16px}h1{font-size:23px}}</style></head><body><main class="page"></main></body></html>`);
    popup.document.close();
    const syncPopupTheme = event => {
        if (popup.closed) return;
        popup.document.documentElement.setAttribute('data-theme', event.detail?.theme || document.documentElement.getAttribute('data-theme') || 'light');
    };
    window.addEventListener('dashbridge-theme-change', syncPopupTheme);
    popup.addEventListener('unload', () => window.removeEventListener('dashbridge-theme-change', syncPopupTheme), { once: true });
    const body = popup.document.querySelector('.page');
    const header = popup.document.createElement('header');
    const heading = popup.document.createElement('h1');
    heading.textContent = `Диагностика ${test.id}: ${test.feature?.label || test.name}`;
    header.appendChild(heading);
    const meta = popup.document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${urlResult.engine || '—'} · Grafana ${urlResult.grafanaVersion || '—'}`;
    header.appendChild(meta);
    const facts = popup.document.createElement('div');
    facts.className = 'facts';
    const status = test.aborted ? 'NOT RUN' : (test.skip ? 'SKIP' : (test.pass ? 'PASS' : 'FAIL'));
    const verdict = test.diagnostic?.verdict || {};
    const runtime = verdict.runtime || {};
    const transitionFacts = (test.diagnostic?.transitions || []).map(step => {
        const outcome = step.verdict?.outcome || (step.invariant?.skip ? 'skip' : (step.invariant?.pass ? 'pass' : 'fail'));
        const persistence = step.persistence || step.command?.persistence;
        const persistenceFact = persistence?.required
            ? ` | persistence=${persistence.passed ? 'PROVEN' : 'FAILED'} (${persistence.reason || 'без причины'})`
            : '';
        return `${step.index || '—'}: ${outcome.toUpperCase()} — ${step.verdict?.reason || step.invariant?.reason || step.label}${persistenceFact}`;
    });
    const factValues = [
        ['Результат', status, status.toLowerCase()],
        ['Функциональная проверка', verdict.functionalPass === false ? 'FAIL' : (verdict.functionalPass === true ? 'PASS' : '—'), verdict.functionalPass === false ? 'fail' : (verdict.functionalPass === true ? 'pass' : '')],
        ['Ошибки DashBridge', String(runtime.dashBridgeErrorCount ?? 0), runtime.dashBridgeErrorCount ? 'fail' : 'pass'],
        ['Предупреждения Grafana', String(runtime.grafanaWarningCount ?? 0), runtime.grafanaWarningCount ? 'skip' : ''],
        ['console.warn', String(runtime.warningCount ?? 0), runtime.warningCount ? 'skip' : ''],
        ['Длительность', formatDuration(test.durationMs || 0), ''],
        ['Панель', test.diagnostic?.before?.panelId || test.diagnostic?.baseline?.panelId || '—', ''],
        ['Рендерер', test.diagnostic?.before?.renderer || test.diagnostic?.baseline?.renderer || urlResult.engine || '—', ''],
        ...(test.feature?.sourceFile ? [['Исходный код', `${test.feature.sourceFile}${test.feature.sourceSymbol ? ` · ${test.feature.sourceSymbol}` : ''}`, '']] : []),
    ];
    factValues.forEach(([label, value, className]) => {
        const fact = popup.document.createElement('div');
        fact.className = 'fact';
        fact.innerHTML = `<b>${esc(label)}</b><span class="${className}">${esc(value)}</span>`;
        facts.appendChild(fact);
    });
    header.appendChild(facts);
    if (test.feature?.description) {
        const featureDescription = popup.document.createElement('div');
        featureDescription.className = 'result';
        featureDescription.textContent = test.feature.description;
        header.appendChild(featureDescription);
    }
    if (test.details) {
        const result = popup.document.createElement('div');
        result.className = 'result';
        result.textContent = test.details;
        header.appendChild(result);
    }
    body.appendChild(header);
    if (visualAudit.transitions.length) {
        const visualSummary = popup.document.createElement('div');
        visualSummary.className = 'result';
        visualSummary.textContent = [
            `Visual audit: ${visualAudit.complete ? 'все обязательные доказательства собраны' : 'набор доказательств неполный'}`,
            ...visualAudit.transitions.map(transition => {
                const features = transition.activeFeatures.length ? transition.activeFeatures.join(' + ') : 'all-off';
                const pixel = transition.pixelDelta
                    ? `; histogram Δ=${transition.pixelDelta.histogramDistance}; luminance Δ=${transition.pixelDelta.luminanceMeanDelta}` : '';
                return `Шаг ${transition.index} [${features}]: imageChanged=${transition.imageChanged}; semanticChanged=${transition.semanticChanged}${pixel}; issues=${transition.issues.join(', ') || 'нет'}`;
            }),
        ].join('\n');
        body.appendChild(visualSummary);
    }
    if (visualAudit.issues.length || !visualAudit.complete) {
        const visualWarning = popup.document.createElement('div');
        visualWarning.className = 'result skip';
        visualWarning.textContent = [
            `Автоматический visual audit: ${visualAudit.suspicious ? 'ПОДОЗРИТЕЛЬНЫЙ PASS' : 'есть замечания'}`,
            visualAudit.missingPhases.length ? `Нет обязательных доказательств: ${visualAudit.missingPhases.join(', ')}` : '',
            ...visualAudit.issues.map(issue => `${issue.transition ? `Шаг ${issue.transition}: ` : ''}${issue.code}${issue.phase ? ` (${issue.phase})` : ''}`),
        ].filter(Boolean).join('\n');
        body.appendChild(visualWarning);
    }
    if (transitionFacts.length) {
        const transitionResult = popup.document.createElement('div');
        transitionResult.className = 'result';
        transitionResult.textContent = `Доказательства переходов:\n${transitionFacts.join('\n')}`;
        body.appendChild(transitionResult);
    }
    const actionTimeline = test.diagnostic?.actionTimeline || [];
    if (actionTimeline.length) {
        const actionResult = popup.document.createElement('div');
        actionResult.className = 'result';
        actionResult.textContent = `Журнал действий (${actionTimeline.length}):\n${actionTimeline.map(action => {
            const checkpoints = action.checkpoints?.filter(item => item.at).length || 0;
            const changes = (action.diffs || []).reduce((sum, diff) => sum + (diff.changeCount || 0), 0);
            const status = action.output?.status || (action.output?.pass === true ? 'pass' : 'observed');
            return `${action.sequence}. ${action.description || action.action} — ${status}; ${action.durationMs ?? '—'} мс; checkpoints=${checkpoints}; changedPaths=${changes}`;
        }).join('\n')}`;
        body.appendChild(actionResult);
    }
    const grafanaWarnings = runtime.grafanaWarnings || [];
    if (grafanaWarnings.length) {
        const warningResult = popup.document.createElement('div');
        warningResult.className = 'result skip';
        warningResult.textContent = `Предупреждения Grafana (не влияют на PASS/FAIL):\n${grafanaWarnings.map(event => (event.args || []).join(' ')).join('\n')}`;
        body.appendChild(warningResult);
    }
    const seenVisuals = new Set();
    const visualGalleryNote = popup.document.createElement('div');
    visualGalleryNote.className = 'result';
    visualGalleryNote.textContent = 'Уникальные визуальные доказательства: одинаковые viewport, panel и canvas повторно не показываются. Полный технический timeline остаётся в JSON.';
    body.appendChild(visualGalleryNote);
    const addUniqueSnapshot = (title, snapshot) => addSnapshot(body, title, snapshot, seenVisuals);
    addUniqueSnapshot('Страница при открытии сценария', test.diagnostic?.opened);
    addUniqueSnapshot('Внешний снимок: до запуска сценария', test.diagnostic?.before);
    if (test.diagnostic?.baseline) {
        addUniqueSnapshot('Базовое состояние сценария', test.diagnostic.baseline);
    }
    (test.diagnostic?.transitions || []).forEach(step => {
        const number = step.index ? `Шаг ${step.index}` : 'Шаг';
        addUniqueSnapshot(`${number}: ${step.label} — непосредственно до команды`, step.before);
        addUniqueSnapshot(`${number}: ${step.label} — после команды, до Refresh`, step.command?.afterCommandBeforeRefresh);
        const persistence = step.persistence || step.command?.persistence;
        if (persistence?.required) {
            addUniqueSnapshot(`${number}: ${step.label} — после первого refresh`, persistence.beforeRefresh);
            addUniqueSnapshot(`${number}: ${step.label} — после второго refresh без повторной команды`, step.after);
        } else {
            addUniqueSnapshot(`${number}: ${step.label} — состояние после команды и refresh`, step.after);
        }
    });
    addUniqueSnapshot('Внешний снимок: после завершения сценария', test.diagnostic?.after);
    addUniqueSnapshot('После команды гарантированного сброса, до Refresh', test.diagnostic?.reset?.command?.afterCommandBeforeRefresh);
    addUniqueSnapshot('После гарантированного сброса', test.diagnostic?.reset?.after);
    const details = popup.document.createElement('details');
    const summary = popup.document.createElement('summary');
    summary.textContent = 'Полная JSON-диагностика теста';
    const rawHint = popup.document.createElement('p');
    rawHint.textContent = 'Диагностика может быть слишком большой для отображения как один текстовый DOM-узел.';
    const rawDownload = popup.document.createElement('button');
    rawDownload.textContent = 'Скачать JSON этого теста';
    rawDownload.addEventListener('click', async () => {
        rawDownload.disabled = true;
        rawDownload.textContent = 'Сборка JSON частями…';
        try {
            const blob = await createChunkedJsonBlob(payload, progress => {
                rawDownload.textContent = `Сборка: ${(progress.characters / 1024 / 1024).toFixed(1)} МБ`;
            });
            const rawUrl = URL.createObjectURL(blob);
            const link = popup.document.createElement('a');
            link.href = rawUrl;
            link.download = `dashbridge-${test.id}-diagnostic.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(rawUrl), 60_000);
            rawDownload.textContent = `Скачивание начато: ${(blob.size / 1024 / 1024).toFixed(1)} МБ`;
        } catch (error) {
            rawDownload.textContent = `Ошибка: ${error?.message || String(error)}`;
        } finally {
            rawDownload.disabled = false;
        }
    });
    details.append(summary, rawHint, rawDownload);
    body.appendChild(details);
    popup.focus();
}

async function serializeJsonInChunks(value, writeChunk, onProgress = null) {
    const encoder = new TextEncoder();
    const targetCharacters = 1024 * 1024;
    let buffer = '';
    let nodes = 0;
    let characters = 0;
    let chunks = 0;
    let drainedChunks = 0;
    let maxPendingChunks = 0;
    let pendingWrite = Promise.resolve();
    const queueChunk = encoded => {
        pendingWrite = pendingWrite.then(() => writeChunk(encoded));
        chunks += 1;
        maxPendingChunks = Math.max(maxPendingChunks, chunks - drainedChunks);
    };
    const flush = () => {
        if (!buffer) return;
        const encoded = encoder.encode(buffer);
        buffer = '';
        queueChunk(encoded);
    };
    const append = text => {
        characters += text.length;
        if (text.length >= targetCharacters) {
            flush();
            let offset = 0;
            while (offset < text.length) {
                let end = Math.min(text.length, offset + targetCharacters);
                // Do not split a UTF-16 surrogate pair between TextEncoder calls.
                if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
                queueChunk(encoder.encode(text.slice(offset, end)));
                offset = end;
            }
            return;
        }
        if (buffer.length + text.length > targetCharacters) flush();
        buffer += text;
    };
    const checkpoint = () => {
        nodes += 1;
        // Direct file writes are asynchronous. Without chunk-level
        // backpressure a few thousand image nodes can enqueue several GB of
        // Uint8Arrays before the old 10k-node checkpoint is reached.
        if (nodes % 10_000 !== 0 && chunks - drainedChunks < 4) return null;
        return (async () => {
            flush();
            await pendingWrite;
            drainedChunks = chunks;
            onProgress?.({ nodes, characters, chunks, maxPendingChunks });
            await new Promise(resolve => setTimeout(resolve, 0));
        })();
    };
    const write = async item => {
        const pause = checkpoint();
        if (pause) await pause;
        if (item === null || item === undefined) { append('null'); return; }
        if (typeof item === 'string') { append(JSON.stringify(item)); return; }
        if (typeof item === 'number') { append(Number.isFinite(item) ? String(item) : 'null'); return; }
        if (typeof item === 'boolean') { append(item ? 'true' : 'false'); return; }
        if (Array.isArray(item)) {
            append('[');
            for (let index = 0; index < item.length; index += 1) {
                if (index) append(',');
                await write(item[index]);
            }
            append(']');
            return;
        }
        if (typeof item === 'object') {
            append('{');
            let written = 0;
            for (const [key, child] of Object.entries(item)) {
                if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
                if (written) append(',');
                append(JSON.stringify(key));
                append(':');
                await write(child);
                written += 1;
            }
            append('}');
            return;
        }
        append(JSON.stringify(`[${typeof item}]`));
    };
    await write(value);
    flush();
    await pendingWrite;
    drainedChunks = chunks;
    onProgress?.({ nodes, characters, chunks, maxPendingChunks, complete: true });
    return { nodes, characters, chunks, maxPendingChunks };
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

async function createChunkedJsonBlob(value, onProgress = null) {
    const parts = [];
    await serializeJsonInChunks(value, chunk => { parts.push(chunk); }, onProgress);
    return new Blob(parts, { type: 'application/json' });
}

async function serializeArtifactPlan(plan, writeChunk, onProgress = null) {
    const encoder = new TextEncoder();
    const totals = { nodes: 0, characters: 0, chunks: 0 };
    const report = (current = {}, complete = false) => onProgress?.({
        nodes: totals.nodes + (current.nodes || 0),
        characters: totals.characters + (current.characters || 0),
        chunks: totals.chunks + (current.chunks || 0),
        complete,
    });
    const writeRaw = async text => {
        const encoded = encoder.encode(text);
        await writeChunk(encoded);
        totals.characters += text.length;
        totals.chunks += 1;
    };
    const writeValue = async value => {
        const result = await serializeJsonInChunks(value, writeChunk, progress => report(progress));
        totals.nodes += result.nodes;
        totals.characters += result.characters;
        totals.chunks += result.chunks;
    };

    await writeRaw('{');
    let rootFields = 0;
    for (const [key, value] of Object.entries(plan.prelude || {})) {
        if (rootFields++) await writeRaw(',');
        await writeValue(key);
        await writeRaw(':');
        await writeValue(value);
    }
    if (rootFields++) await writeRaw(',');
    await writeValue('results');
    await writeRaw(':[');
    for (let urlIndex = 0; urlIndex < plan.sourceResults.length; urlIndex += 1) {
        if (urlIndex) await writeRaw(',');
        const urlResult = plan.sourceResults[urlIndex];
        const metadata = plan.compactUrlMetadata(urlResult);
        await writeRaw('{');
        let urlFields = 0;
        for (const [key, value] of Object.entries(metadata)) {
            if (urlFields++) await writeRaw(',');
            await writeValue(key);
            await writeRaw(':');
            await writeValue(value);
        }
        if (urlFields++) await writeRaw(',');
        await writeValue('tests');
        await writeRaw(':[');
        const tests = urlResult.tests || [];
        for (let testIndex = 0; testIndex < tests.length; testIndex += 1) {
            if (testIndex) await writeRaw(',');
            // Compact exactly one test, write it immediately, then let the
            // temporary object be collected before the next test. Holding the
            // compacted form of all screenshots at once crashes Chromium near
            // its per-tab heap limit on multi-gigabyte reports.
            const compactTest = plan.compactTest(tests[testIndex]);
            await writeValue(compactTest);
            report();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        await writeRaw(']}');
    }
    await writeRaw('],');
    if (typeof plan.visualStates === 'function') {
        await writeValue('visualStates');
        await writeRaw(':');
        await writeValue(plan.visualStates());
        await writeRaw(',');
    }
    await writeValue('assets');
    await writeRaw(':');
    await writeValue(plan.assets());
    await writeRaw('}');
    report({}, true);
    return { ...totals };
}

// Results and content-addressed assets are already in OPFS. Copy their JSON
// bytes straight to the destination without rebuilding a multi-GiB object.
async function serializeSpoolArtifact(snapshot, spool, metadata, writeChunk, onProgress = null) {
    const plan = DashBridgeTestReport.createArtifactStreamPlan(snapshot, metadata);
    const prelude = {
        ...plan.prelude,
        evidenceStorage: {
            mode: 'content-addressed-per-test-opfs/v2',
            reason: 'Compacted tests and unique assets are streamed from OPFS so dashboards do not accumulate in the renderer heap',
            lossless: true,
        },
    };
    const encoder = new TextEncoder();
    const totals = { nodes: 0, characters: 0, chunks: 0 };
    const report = (complete = false) => onProgress?.({ ...totals, complete });
    const writeText = async text => {
        await writeChunk(encoder.encode(text));
        totals.characters += text.length;
        totals.chunks += 1;
    };
    const writeValue = async value => {
        const result = await serializeJsonInChunks(value, writeChunk);
        totals.nodes += result.nodes;
        totals.characters += result.characters;
        totals.chunks += result.chunks;
    };
    await writeText('{');
    let rootFields = 0;
    for (const [key, value] of Object.entries(prelude)) {
        if (rootFields++) await writeText(',');
        await writeValue(key);
        await writeText(':');
        await writeValue(value);
    }
    if (rootFields++) await writeText(',');
    await writeValue('results');
    await writeText(':[');
    for (let index = 0; index < snapshot.results.length; index += 1) {
        if (index) await writeText(',');
        const result = snapshot.results[index];
        if (result?.diagnosticSpool?.persisted) {
            await spool.streamUrl(index, async chunk => {
                if (typeof chunk === 'string') await writeText(chunk);
                else {
                    await writeChunk(chunk);
                    totals.characters += chunk.byteLength;
                    totals.chunks += 1;
                }
            });
        } else {
            // Abort-before-open results contain only tiny NOT RUN records and
            // are safe to serialize directly.
            await writeValue(result);
        }
        report();
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    await writeText('],"visualStates":');
    await writeValue(spool.visualStates);
    await writeText(',"assets":');
    await spool.streamAssets(async chunk => {
        if (typeof chunk === 'string') await writeText(chunk);
        else {
            await writeChunk(chunk);
            totals.characters += chunk.byteLength;
            totals.chunks += 1;
        }
    });
    await writeText('}');
    report(true);
    return totals;
}

function localExportTimestamp(date = new Date()) {
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function localIsoTimestamp(date = new Date()) {
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
        + `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

async function exportDiagnostics() {
    if (!lastSnapshot?.results?.length) return;
    if (elExportDiagnosticsBtn) elExportDiagnosticsBtn.disabled = true;
    const exportDate = new Date();
    const filename = `dashbridge-e2e-diagnostics-${localExportTimestamp(exportDate)}.json`;
    let fileHandle = null;
    try {
        if (typeof window.showSaveFilePicker === 'function') {
            try {
                fileHandle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'JSON diagnostics', accept: { 'application/json': ['.json'] } }],
                });
            } catch (error) {
                if (error?.name === 'AbortError') return;
                console.warn('[TestRunner] Direct file picker unavailable, using Blob fallback', error);
            }
        }
        if (elStatusLine) {
            elStatusLine.textContent = 'Подготовка полного диагностического отчёта…';
            elStatusLine.className = 'tr-status tr-status-warn';
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        const manifest = chrome.runtime?.getManifest?.() || {};
        const exportMetadata = {
            exportedAt: exportDate.toISOString(),
            exportedAtLocal: localIsoTimestamp(exportDate),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
            extensionVersion: manifest.version || null,
            userAgent: navigator.userAgent,
            platform: navigator.platform || null,
        };
        const updateSerializationProgress = progress => {
            if (!elStatusLine) return;
            const sizeMb = (progress.characters / 1024 / 1024).toFixed(1);
            elStatusLine.textContent = progress.complete
                ? `JSON собран частями: ${sizeMb} МБ`
                : `Сборка JSON частями: ${sizeMb} МБ, узлов ${progress.nodes.toLocaleString('ru-RU')}`;
        };
        let temporaryRoot = null;
        let temporaryName = null;
        if (!fileHandle) {
            if (typeof navigator.storage?.getDirectory !== 'function') {
                throw new Error('Браузер не предоставляет потоковую запись на диск; Blob-экспорт отключён для защиты вкладки от Out of Memory');
            }
            temporaryRoot = await navigator.storage.getDirectory();
            temporaryName = `dashbridge-e2e-export-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
            fileHandle = await temporaryRoot.getFileHandle(temporaryName, { create: true });
        }
        const writable = await fileHandle.createWritable();
        let progress;
        try {
            progress = await serializeSpoolArtifact(lastSnapshot, diagnosticSpool, exportMetadata,
                chunk => writable.write(chunk), updateSerializationProgress);
            await writable.close();
        } catch (error) {
            await writable.abort?.(error).catch?.(() => { });
            if (temporaryRoot && temporaryName) await temporaryRoot.removeEntry(temporaryName).catch(() => { });
            throw error;
        }
        if (temporaryRoot && temporaryName) {
            const diskBackedFile = await fileHandle.getFile();
            const url = URL.createObjectURL(diskBackedFile);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
                void temporaryRoot.removeEntry(temporaryName).catch(() => { });
            // A multi-gigabyte browser download can legitimately take several
            // minutes. Keep the disk-backed source alive without retaining it
            // in JS heap, then reclaim the private temporary file.
            }, 30 * 60_000);
            if (elStatusLine) {
                elStatusLine.textContent = `Диагностика собрана во временный файл и передана браузеру: ${(progress.characters / 1024 / 1024).toFixed(1)} МБ`;
                elStatusLine.className = 'tr-status tr-status-ok';
            }
        } else {
            if (elStatusLine) {
                elStatusLine.textContent = `Диагностика записана на диск: ${(progress.characters / 1024 / 1024).toFixed(1)} МБ`;
                elStatusLine.className = 'tr-status tr-status-ok';
            }
        }
    } catch (error) {
        console.error('[TestRunner] Diagnostic export failed', error);
        if (elStatusLine) {
            elStatusLine.textContent = `Не удалось экспортировать диагностику: ${error?.message || String(error)}`;
            elStatusLine.className = 'tr-status tr-status-fail';
        }
    } finally {
        if (elExportDiagnosticsBtn) elExportDiagnosticsBtn.disabled = false;
    }
}

async function copyTextToClipboard(text, button) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }

    if (button) {
        const label = button.textContent;
        button.textContent = '✓ Скопировано';
        setTimeout(() => { button.textContent = label; }, 1800);
    }
}

// --- Запуск ---

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
    // Open the always-on-top view while the Run click still carries user
    // activation. All validation that can reject without async work is above.
    const progressWindowPromise = openOperationProgressWindow(mode);
    // Сохраняем ввод и выбранный профиль для следующего запуска.
    try { await chrome.storage.local.set({ trLastUrls: cleanedUrls, trRunMode: mode }); } catch (_) { }

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
        const stored = await chrome.storage.local.get(['trLastUrls', 'trRunMode']);
        if (stored.trLastUrls && elUrlInput && !elUrlInput.value.trim()) {
            elUrlInput.value = stored.trLastUrls;
        }
        if (elRunMode && stored.trRunMode === 'full') elRunMode.value = 'full';
    } catch (_) { }

    setButtonState(false);
    if (elProgress) elProgress.style.display = 'none';
    if (elSummaryRow) elSummaryRow.style.display = 'none';

    elRunBtn?.addEventListener('click', handleRun);
    elAbortBtn?.addEventListener('click', handleAbort);
    elCopyBtn?.addEventListener('click', copyReport);
    elCopyFailBtn?.addEventListener('click', copyFailureReport);
    elExportDiagnosticsBtn?.addEventListener('click', exportDiagnostics);
    elClearBtn?.addEventListener('click', handleClear);
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
}

document.addEventListener('DOMContentLoaded', initTestRunnerUI);
