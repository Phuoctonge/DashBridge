"""Smoke test for the standalone Grafana batch-capture page."""
from support.smoke import run_page_contract


if __name__ == "__main__":
    run_page_contract(
        "batch capture",
        page="pages/batch/batch.html",
        html=['id="dashUrl"', 'id="timestamps"', 'id="startBtn"', 'id="getPanelsBtn"',
              'id="panelsModal"', 'id="selectAllPanelPickerBtn"', 'id="clearPanelPickerBtn"',
              'id="cancelPanelPickerBtn"', 'id="applyPanelPickerBtn"', 'id="seriesDashUrl"',
              'id="getSeriesPanelsBtn"', 'id="copyMainSettingsToSeriesBtn"', 'id="seriesPanelSelectionStatus"', 'id="loadSelectedSeriesBtn"', 'id="seriesIncludeFilter"', 'id="seriesIgnoreFilter"', 'id="captureThemeSeries"', 'id="startSeriesBtn"'],
        sources={
            "pages/batch/batch.js": [
                "function parseGrafanaUrl(url)",
                "const startBtn = document.getElementById('startBtn')",
                "startButton: startBtn",
                "const loadSelectedSeriesPanels = async () =>",
                "discoverSeriesForSlice",
                "BatchSeriesSelection.resolvePatterns",
                "includePattern",
                "ignorePattern",
            ],
            "pages/batch/batch-page-controller.js": ["copyMainSettingsToSeriesBtn", "normalizeTimeRangesField", "getCaptureTheme"],
            "pages/batch/batch-operation-controller.js": ["captureWindowRunner.acquire", "captureWindowRunner.release", "BatchCaptureUtils.base64ToUint8Array"],
            "pages/batch/batch-panel-picker.js": [
                "Открываю Grafana для авторизации. После входа список панелей загрузится автоматически.",
                "const recoverGrafanaDashboardSession = async",
                "chrome.tabs.create({ url: dashboardUrl, active: true })",
                "chrome.tabs.onUpdated.addListener(onUpdated)",
                "chrome.tabs.onRemoved.addListener(onRemoved)",
                "chrome.tabs.update(batchTab.id, { active: true })",
                "const open = async ({ dashboardUrl, context }) =>",
                "const applySelection = () =>",
            ],
            "js/shared/grafana-url.js": ["const orgId = url.searchParams.get('orgId')"],
            "js/shared/grafana-dashboard-api.js": ["apiUrl.searchParams.set('orgId', dashboard.orgId)"],
            "pages/batch/batch-panel-loader.js": ["function createBatchPanelLoader", "findPanelById(panelId)"],
            "pages/batch/batch-series-selection.js": ["resolveExact", "resolvePatterns", "resolveAll"],
            "pages/batch/batch-capture-utils.js": ["base64ToUint8Array(base64)"],
        },
    )
