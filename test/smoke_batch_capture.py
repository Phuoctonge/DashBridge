"""Smoke test for the standalone Grafana batch-capture page."""
from support.smoke import run_page_contract


if __name__ == "__main__":
    run_page_contract(
        "batch capture",
        page="html/batch.html",
        html=['id="dashUrl"', 'id="timestamps"', 'id="startBtn"', 'id="getPanelsBtn"',
              'id="panelsModal"', 'id="selectAllPanelPickerBtn"', 'id="clearPanelPickerBtn"',
              'id="cancelPanelPickerBtn"', 'id="applyPanelPickerBtn"', 'id="seriesDashUrl"',
              'id="getSeriesPanelsBtn"', 'id="copyMainSettingsToSeriesBtn"', 'id="seriesPanelSelectionStatus"', 'id="loadSelectedSeriesBtn"', 'id="seriesIncludeFilter"', 'id="seriesIgnoreFilter"', 'id="captureThemeSeries"', 'id="startSeriesBtn"'],
        sources={
            "js/pages/batch.js": [
                "function parseGrafanaUrl(url)", "async function getOrCreateCaptureWindow()",
                "createBatchPanelLoader", "BatchCaptureUtils.base64ToUint8Array",
                "Открываю Grafana для авторизации. После входа список панелей загрузится автоматически.",
                "const recoverGrafanaDashboardSession = async",
                "chrome.tabs.create({ url: dashboardUrl, active: true })",
                "chrome.tabs.onUpdated.addListener(onUpdated)",
                "chrome.tabs.onRemoved.addListener(onRemoved)",
                "chrome.tabs.update(batchTab.id, { active: true })",
                "const openPanelPicker = async ({ dashboardUrl, context }) =>",
                "const applyPanelPickerSelection = () =>",
                "const loadSelectedSeriesPanels = async () =>",
                "discoverSeriesForSlice",
                "BatchSeriesSelection.resolvePatterns",
                "includePattern",
                "ignorePattern",
                "copyMainSettingsToSeriesBtn",
            ],
            "js/shared/grafana-url.js": ["const orgId = url.searchParams.get('orgId')"],
            "js/shared/grafana-dashboard-api.js": ["apiUrl.searchParams.set('orgId', dashboard.orgId)"],
            "js/pages/batch-panel-loader.js": ["function createBatchPanelLoader", "findPanelById(panelId)"],
            "js/pages/batch-series-selection.js": ["resolveExact", "resolvePatterns", "resolveAll"],
            "js/pages/batch-capture-utils.js": ["base64ToUint8Array(base64)"],
        },
    )
