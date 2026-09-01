"""Smoke checks for the non-popup batch capture and WorkLog workflows."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
BATCH = (ROOT / "pages/batch/batch.js").read_text(encoding="utf-8") \
    + (ROOT / "pages/batch/batch-page-controller.js").read_text(encoding="utf-8") \
    + (ROOT / "pages/batch/batch-operation-controller.js").read_text(encoding="utf-8")
BATCH_PICKER = (ROOT / "pages/batch/batch-panel-picker.js").read_text(encoding="utf-8")
BATCH_STATE = (ROOT / "pages/batch/batch-state.js").read_text(encoding="utf-8")
BATCH_UTILS = (ROOT / "pages/batch/batch-capture-utils.js").read_text(encoding="utf-8")
BATCH_LOADER = (ROOT / "pages/batch/batch-panel-loader.js").read_text(encoding="utf-8")
BATCH_RUNNER = (ROOT / "pages/batch/batch-capture-runner.js").read_text(encoding="utf-8")
HTML = (ROOT / "pages/batch/batch.html").read_text(encoding="utf-8")
WORKLOG = (ROOT / "pages/worklog/worklog.js").read_text(encoding="utf-8")
DASHBOARD_API = (ROOT / "js/shared/grafana-dashboard-api.js").read_text(encoding="utf-8")
SERIES_CAPTURE = (ROOT / "js/content/grafana-series-capture.js").read_text(encoding="utf-8")
ARCHIVE = (ROOT / "js/shared/archive-download.js").read_text(encoding="utf-8")
URLS = (ROOT / "js/shared/grafana-url.js").read_text(encoding="utf-8")
RUNTIME = (ROOT / "js/shared/grafana-runtime.js").read_text(encoding="utf-8")


checks = {
    "batch saves and restores its form state": "pageState: BatchPageState" in BATCH and "pageState.restore()" in BATCH and "async restore()" in BATCH_STATE and "batchState" in BATCH_STATE,
    "batch validates Grafana URLs": "function parseGrafanaUrl(url)" in BATCH,
    "batch dashboard API requests include the Grafana session": "credentials: 'include'" in DASHBOARD_API,
    "batch API can retrieve a dashboard definition": "async function fetchGrafanaDashboardDefinition(dashboardUrl)" in DASHBOARD_API,
    "batch API can find nested dashboard panels": "function findGrafanaDashboardPanel(dashboard, panelId)" in DASHBOARD_API,
    "batch identifies native queries for the requested panel": "function getGrafanaPanelQuerySignatures(panel)" in DASHBOARD_API
        and "function getGrafanaQuerySignature(query)" in DASHBOARD_API,
    "batch isolates capture in a dedicated window": "captureWindowRunner.acquire" in BATCH and "captureWindowRunner.release" in BATCH,
    "batch waits for the requested panel": "createBatchPanelLoader" in BATCH_LOADER and "loadBatchPanel" in BATCH,
    "batch uses the shared panel lookup": "files: ['js/content/grafana-dom.js']" in BATCH_LOADER
        and "window.DashBridgeGrafanaDom?.findPanelById(panelId)" in BATCH_LOADER,
    "batch never falls back to an arbitrary panel": '[class*="panel-container"]' not in BATCH_LOADER,
    "batch fails safely when panel loading times out": "setTimeout(() => finish(null), 30_000)" in BATCH_LOADER
        and "observer = new MutationObserver(schedule)" in BATCH_LOADER,
    "batch crops captured screenshots": "captureGrafanaPanelImage" in BATCH and "drawImage(image, x, y, width, height" in (ROOT / "js/shared/grafana-panel-capture.js").read_text(encoding="utf-8"),
    "batch crop stays within the captured image": "image.naturalWidth - x" in (ROOT / "js/shared/grafana-panel-capture.js").read_text(encoding="utf-8")
        and "image.naturalHeight - y" in (ROOT / "js/shared/grafana-panel-capture.js").read_text(encoding="utf-8"),
    "batch Series flow applies its own capture theme": "getCaptureTheme('captureThemeSeries')" in BATCH
        and "buildGrafanaPanelUrl(dashboardUrl, panelId, { theme: getCaptureTheme('captureThemeSeries') })" in BATCH,
    "batch offers synchronized Grafana theme radio controls": 'id="captureThemeMain"' in HTML and 'id="captureThemeSeries"' in HTML and 'type="radio"' in HTML and "const setCaptureTheme" in BATCH,
    "batch offers independent compact capture switches": 'id="compactCaptureMain"' in HTML
        and 'id="compactCaptureSeries"' in HTML
        and "getBatchCaptureOptions('compactCaptureMain')" in BATCH
        and "getBatchCaptureOptions('compactCaptureSeries')" in BATCH,
    "batch compact capture uses the shared prepared panel layout": "DashBridgeGrafanaBatchCapture?.prepare" in (ROOT / "js/shared/grafana-panel-capture.js").read_text(encoding="utf-8")
        and "const batchCaptureApi = Object.freeze" in (ROOT / "js/content/grafana-panel-tools.js").read_text(encoding="utf-8")
        and "window.DashBridgeGrafanaBatchCapture = batchCaptureApi" in (ROOT / "js/content/grafana-panel-tools.js").read_text(encoding="utf-8"),
    "batch defaults Grafana capture theme to light without persistence": 'value="light" checked' in HTML and "state.captureTheme" not in BATCH,
    "batch keeps current Grafana theme URL-neutral": "url.searchParams.delete('theme')" in URLS,
    "batch applies explicit Grafana themes to capture URLs": "theme === 'light' || theme === 'dark'" in URLS,
    "batch builds d-solo URLs for native Series loading": "function buildGrafanaSoloPanelUrl" in URLS
        and "url.searchParams.set('panelId', panelId)" in URLS
        and "seriesPanelIdFormatCache" in BATCH
        and "seriesPanelIdCandidates" in BATCH,
    "full-dashboard action is hidden outside collection settings": "mainActionArea.hidden = !mainTab && !processing" in BATCH,
    "batch captures dynamically rendered series cards": "#seriesPanelsContainer .batch-series-card" in BATCH,
    "grouped Batch installs complete-hide before the first panel render":
        "applyGrafanaCompleteHideSelection(" in BATCH
        and "selection.matches.map(series => series.name)" in BATCH
        and "dashbridgeTargetQuerySignatures" in URLS
        and "ensureEarlyGrafanaRuntimeForUrl(targetUrl.toString())" in BATCH_LOADER,
    "standalone Batch keeps the occurrence-aware native legend path":
        "selectedKeys: [series.key]" in BATCH
        and "prevSeriesName" in BATCH,
    "batch Series cards show the selected panel title": "appendSeriesPanelCard(panelId, panel.title, panelUrl, signatures)" in BATCH
        and "Панель ID: ${escapeHtml(panelId)} — ${escapeHtml(panelTitle)}" in BATCH,
    "batch reads Series legends from Grafana's native response": "waitForCapturedSeries(nextTabId, capture.token, 15000, signal)" in BATCH
        and "getGrafanaPanelQuerySignatures(panel)" in BATCH
        and "triggerGrafanaSeriesRefresh" not in BATCH,
    "batch reports Series success only for loaded legends": "let loadedCards = 0" in BATCH
        and "if (loadedCards)" in BATCH,
    "batch Series API temporarily foregrounds Grafana for native data": "const navigateGrafanaSeriesCaptureTab" in BATCH
        and "url: captureUrl" in BATCH and "active: true" in BATCH
        and "chrome.tabs.update(batchTab.id, { active: true })" in BATCH_PICKER
        and "waitForCapturedSeries" in BATCH,
    "batch Series does not wait for Grafana tab completion": "await waitForTabComplete(tabId)" not in BATCH,
    "Grafana captures native Series API responses at document start": "grafana-series-capture.js" in (ROOT / "js/shared/grafana-runtime-manifest.js").read_text(encoding="utf-8")
        and "runAt: 'document_start'" in RUNTIME
        and "ensureEarlyGrafanaRuntimeForUrl(captureUrl)" in BATCH
        and (ROOT / "js/content/grafana-series-capture.js").is_file(),
    "native Series capture reports request and signature diagnostics": "requests: 0" in SERIES_CAPTURE
        and "matched: 0" in SERIES_CAPTURE and "capture?.debug" in BATCH,
    "native Series capture accepts Grafana relative datasource URLs": "includes('api/ds/query')" in SERIES_CAPTURE
        and "includes('/api/ds/query')" not in SERIES_CAPTURE,
    "native Series capture matches Grafana queries after variable interpolation": "const identity = query" in SERIES_CAPTURE
        and "expectedIdentities" in SERIES_CAPTURE,
    "batch downloads collected output": "chrome.downloads.download" in ARCHIVE,
    "batch waits for download before reporting success": "await chrome.downloads.download" in ARCHIVE,
    "batch releases generated ZIP URLs": "URL.revokeObjectURL(blobUrl)" in ARCHIVE,
    "WorkLog persists rows and sorting": "function saveToStorage()" in WORKLOG and "jiraSortOrder" in WORKLOG,
    "WorkLog supports undo and redo": "function undo()" in WORKLOG and "function redo()" in WORKLOG,
    "WorkLog validates Jira authorization": "async function checkJiraAuth()" in WORKLOG,
    "WorkLog escapes rendered values": "function escapeHtml(value)" in WORKLOG and "function getRowHtml(log)" in WORKLOG,
    "WorkLog sends accumulated entries": "sendAllBtn.onclick = async" in WORKLOG,
    "WorkLog confirms before clearing sent entries": "clearSentBtn.onclick = async" in WORKLOG
        and "await confirmWorklogAction" in WORKLOG and "if (!confirmed) return" in WORKLOG,
}

run_checks(checks)
