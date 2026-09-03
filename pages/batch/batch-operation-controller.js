(function initBatchOperationController(root) {
    'use strict';
    function create({ mainActionArea, startButton, startSeriesButton, cancelButton, showToast, logMessage,
        lifecycle, progressFactory, captureWindowRunner, loadPanel }) {
        let processing = false;
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
            const runId = lifecycle.begin(); setProcessing(true);
            await progress.openPictureInPicture({ title, phase, width: 390, height: 300 }); return runId;
        };
        const isActive = runId => processing && lifecycle.isActive(runId);
        const finish = async runId => {
            if (!lifecycle.finish(runId)) return false;
            progress.finish(); await releaseWindow(); setProcessing(false); return true;
        };
        const capturePanelToZip = async (win, tabId, panelId, filename, archive, captureOptions = {}) => {
            const captured = await captureGrafanaPanelImage({ tabId, windowId: win.id, panelId, settleMs: 300, ...captureOptions });
            if (!captured) { logMessage(`Unable to capture panel: ${filename}`, true); return false; }
            const bytes = BatchCaptureUtils.base64ToUint8Array(captured.dataUrl.split(',')[1]);
            await archive.add(filename, bytes, bytes.byteLength); logMessage(`Saved: ${filename} (${bytes.length} bytes)`); return true;
        };
        const getCaptureOptions = async toggleId => {
            if (document.getElementById(toggleId)?.checked !== true) return { prepared: false };
            const stored = await chrome.storage.sync.get(['grafanaCompactExportWidth', 'grafanaCompactExportHeight']);
            const settings = normalizeGrafanaSettings(stored);
            return { prepared: true, outputWidth: settings.grafanaCompactExportWidth, outputHeight: settings.grafanaCompactExportHeight };
        };
        const addArchiveReport = async (archive, report) => {
            const manifestBytes = new TextEncoder().encode(`${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
            await archive.add('manifest.json', manifestBytes, manifestBytes.byteLength);
            if (report.errors?.length) {
                const errorBytes = new TextEncoder().encode(`${report.errors.map(item => `${item.file}: ${item.reason}`).join('\n')}\n`);
                await archive.add('errors.txt', errorBytes, errorBytes.byteLength);
            }
        };
        cancelButton.addEventListener('click', cancel);
        window.addEventListener('pagehide', () => { void progress.release(); });
        setProcessing(false);
        return Object.freeze({ progress, loadPanel, updateActionVisibility, acquireWindow, releaseWindow,
            capturePanelToZip, getCaptureOptions, addArchiveReport, begin, isActive, finish,
            get processing() { return processing; } });
    }
    root.BatchOperationController = Object.freeze({ create });
})(globalThis);
