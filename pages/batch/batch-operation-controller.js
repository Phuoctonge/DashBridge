(function initBatchOperationController(root) {
    'use strict';
    function create({ mainActionArea, startButton, startSeriesButton, cancelButton, showToast, logMessage,
        lifecycle, progressFactory, captureWindowRunner, loadPanel }) {
        let processing = false;
        const captureRecords = [];
        const failureDiagnostics = [];
        const createJournal = root.BatchDiagnosticJournal?.create || (() => ({
            enabled: false, record() {}, snapshot: () => [], toJsonl: () => '', clear() {},
        }));
        let diagnosticJournal = createJournal({ enabled: false });
        const progress = progressFactory.create({ onCancel: cancel });
        const updateActionVisibility = () => {
            const mainTab = document.querySelector('.tab-btn.active')?.dataset.tab === 'tab-main';
            mainActionArea.hidden = !mainTab && !processing; startButton.hidden = !mainTab && processing;
        };
        const setProcessing = active => {
            processing = active; startButton.disabled = active; startSeriesButton.disabled = active;
            cancelButton.hidden = !active; if (!active) cancelButton.style.display = ''; updateActionVisibility();
        };
        const acquireWindow = () => captureWindowRunner.acquire();
        const releaseWindow = () => captureWindowRunner.release();
        async function cancel() {
            if (!processing) return false;
            const featureId = document.querySelector('.tab-btn.active')?.dataset.tab === 'tab-series'
                ? 'batch.series_cancelled' : 'batch.main_cancelled';
            lifecycle.cancel(); processing = false; progress.cancel();
            logMessage('⛔ Сбор отменён пользователем.'); showToast('Сбор отменён', 'info');
            root.DashBridgeAnalytics?.outcome(featureId, 'cancelled');
            await releaseWindow(); setProcessing(false); return true;
        }
        const begin = async ({ title, phase }) => {
            captureRecords.length = 0;
            failureDiagnostics.length = 0;
            const runId = lifecycle.begin(); setProcessing(true);
            let detailedLoggingEnabled = true;
            try {
                const stored = await chrome.storage.sync.get(['batchDetailedLogging']);
                detailedLoggingEnabled = stored.batchDetailedLogging !== false;
            } catch { /* retain diagnostic default when storage is unavailable */ }
            diagnosticJournal = createJournal({ enabled: detailedLoggingEnabled, runId });
            diagnosticJournal.record({ stage: 'run', event: 'started', details: { title, phase, detailedLoggingEnabled } });
            await progress.openPictureInPicture({ title, phase, width: 390, height: 300 }); return runId;
        };
        const recordDiagnostic = event => diagnosticJournal.record(event);
        const loadPanelWithDiagnostics = (...args) => loadPanel(...args,
            diagnosticJournal.enabled ? recordDiagnostic : null);
        const isActive = runId => processing && lifecycle.isActive(runId);
        const finish = async runId => {
            if (!lifecycle.finish(runId)) return false;
            diagnosticJournal.record({ stage: 'run', event: 'finished', details: { runId } });
            progress.finish(); await releaseWindow(); setProcessing(false); return true;
        };
        const capturePanelToZip = async (win, tabId, panelId, filename, archive, captureOptions = {}, isActive = () => true, metadata = {}) => {
            if (!isActive()) return null;
            const captured = await captureGrafanaPanelImage({
                tabId, windowId: win.id, panelId,
                onEvent: detail => diagnosticJournal.record({
                    ...detail, jobId: filename, panelId: String(panelId),
                }),
                onDiagnostic: detail => {
                    failureDiagnostics.push({ file: filename, panelId: String(panelId), ...detail });
                    logMessage(`Причина ошибки снимка [${panelId}]: ${detail.stage}/${detail.reason}`
                        + (detail.error ? ` (${detail.error})` : ''), true);
                },
                ...captureOptions,
            });
            if (!isActive()) return null;
            if (!captured) { logMessage(`Unable to capture panel: ${filename}`, true); return false; }
            const bytes = BatchCaptureUtils.base64ToUint8Array(captured.dataUrl.split(',')[1]);
            if (!isActive()) return null;
            await archive.add(filename, bytes, bytes.byteLength);
            if (!isActive()) return null;
            diagnosticJournal.record({ stage: 'archive', event: 'png-added', jobId: filename,
                panelId: String(panelId), details: { bytes: bytes.byteLength } });
            // Metadata belongs to the captured job, not to the readable PNG name.
            captureRecords.push({ ...metadata, file: filename, panelId: String(panelId) });
            if (!isActive()) return null;
            logMessage(`Saved: ${filename} (${bytes.length} bytes)`);
            return true;
        };
        const getCaptureOptions = async toggleId => {
            if (document.getElementById(toggleId)?.checked !== true) return { prepared: false };
            const stored = await chrome.storage.sync.get(['grafanaCompactExportWidth', 'grafanaCompactExportHeight']);
            const settings = normalizeGrafanaSettings(stored);
            return { prepared: true, outputWidth: settings.grafanaCompactExportWidth, outputHeight: settings.grafanaCompactExportHeight };
        };
        const addArchiveReport = async (archive, report, isActive = () => true) => {
            if (!isActive()) return false;
            const manifest = { ...report, schemaVersion: 3, generatedAt: new Date().toISOString(), captures: captureRecords.slice() };
            if (failureDiagnostics.length) manifest.failureDiagnostics = failureDiagnostics.slice(0, 100);
            const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
            await archive.add('manifest.json', manifestBytes, manifestBytes.byteLength);
            const journalText = diagnosticJournal.toJsonl();
            if (journalText) {
                const journalBytes = new TextEncoder().encode(journalText);
                await archive.add('batch-debug.jsonl', journalBytes, journalBytes.byteLength);
            }
            if (!isActive()) return false;
            if (report.errors?.length) {
                const errorBytes = new TextEncoder().encode(`${JSON.stringify({ errors: report.errors, diagnostics: failureDiagnostics.slice(0, 100) }, null, 2)}\n`);
                await archive.add('errors.txt', errorBytes, errorBytes.byteLength);
                if (!isActive()) return false;
            }
            return true;
        };
        cancelButton.addEventListener('click', cancel);
        window.addEventListener('pagehide', () => { lifecycle.cancel(); void progress.release(); });
        setProcessing(false);
        return Object.freeze({ progress, loadPanel: loadPanelWithDiagnostics, recordDiagnostic,
            updateActionVisibility, acquireWindow, releaseWindow,
            capturePanelToZip, getCaptureOptions, addArchiveReport, begin, isActive, finish,
            get processing() { return processing; } });
    }
    root.BatchOperationController = Object.freeze({ create });
})(globalThis);
