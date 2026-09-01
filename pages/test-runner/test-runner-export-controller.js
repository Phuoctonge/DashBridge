'use strict';

(function initTestExportController(root) {
function create({
    getSnapshot,
    getSpool,
    elCopyBtn,
    elCopyFailBtn,
    elExportDiagnosticsBtn,
    elStatusLine,
    categoryLabel,
    formatDuration,
    serializeSpoolArtifact,
    localExportTimestamp,
    localIsoTimestamp,
}) {
    if (typeof getSnapshot !== 'function' || typeof getSpool !== 'function'
        || typeof categoryLabel !== 'function' || typeof formatDuration !== 'function'
        || typeof serializeSpoolArtifact !== 'function' || typeof localExportTimestamp !== 'function'
        || typeof localIsoTimestamp !== 'function') {
        throw new Error('DashBridgeTestExportController requires snapshot, spool, formatting, and serialization dependencies');
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
    const snapshot = getSnapshot();
    if (!snapshot) return;
    await copyTextToClipboard(buildTextReport(snapshot), elCopyBtn);
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
    const snapshot = getSnapshot();
    if (!snapshot) return;
    await copyTextToClipboard(buildFailureReport(snapshot), elCopyFailBtn);
}

async function exportDiagnostics() {
    const snapshot = getSnapshot();
    if (!snapshot?.results?.length) return;
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
            progress = await serializeSpoolArtifact(snapshot, getSpool(), exportMetadata,
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

    return Object.freeze({
        buildFailureReport,
        buildTextReport,
        copyFailureReport,
        copyReport,
        copyTextToClipboard,
        exportDiagnostics,
    });
}

root.DashBridgeTestExportController = Object.freeze({ create });
})(globalThis);
