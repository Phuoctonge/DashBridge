"""Data-driven wiring contracts for Popup sections and report modules."""

from support.smoke import run_popup_contracts


CASES = [
    {
        "name": "Grafana Batch section",
        "html": ['id="grafana-batch"', 'id="openBatchCaptureBtn"'],
        "sources": {"js/popup/popup-grafana-router.js": ["openBatchCaptureBtn", "html/batch.html"]},
    },
    {
        "name": "Grafana links section",
        "html": [
            'id="grafana-links"', 'id="openDashBridgeBtn"', 'id="customButtonsContainer"', 'id="openAddModal"',
            'id="grafanaTimestampReadBtn"', 'id="grafanaTimestampFrom"', 'id="grafanaTimestampTo"',
        ],
        "sources": {
            "js/popup/popup-grafana-router.js": ["openDashBridgeBtn", "html/dashbridge.html"],
            "js/popup/popup-grafana-links.js": [
                "function renderButtons()", "function openGrafana(baseUrl)", "customButtons",
                "setupGrafanaTimestampTool", "parseGrafanaUrlTimeRange", "navigator.clipboard.writeText",
            ],
        },
    },
    {
        "name": "Traffic Recorder section",
        "html": [
            'data-tab="tab-recorder"', 'id="tab-recorder"', 'id="openTrafficRecorderBtn"',
            'Открыть Traffic Recorder', '<rect x="3" y="5" width="18" height="14" rx="3" />',
        ],
        "sources": {
            "js/popup/popup-core.js": [
                'module_recorder: true', '"tab-recorder": modules.module_recorder',
                "openTrafficRecorderBtn", "html/recorder.html",
            ],
            "js/popup/popup-grafana-router.js": ["!openTrafficRecorderBtn"],
        },
    },
    {
        "name": "Jira section",
        "html": ['data-tab="tab-jira"', 'id="tab-jira"', 'id="openJiraPage"', 'id="transferWorklogBtn"'],
        "sources": {"js/popup/popup-jira.js": ["openJiraPage", "transferWorklogBtn", "html/worklog.html"]},
    },
    {
        "name": "TDM export section",
        "html": [
            'data-tab="tab-tdm"', 'id="tab-tdm"', 'id="tdmExportStart"',
            'id="tdmExportEnd"', 'id="tdmExportFormat"', 'id="tdmExportPhotos"',
            'id="tdmExcludeUserCheckbox"', 'id="tdmExportBtn"',
        ],
        "sources": {"js/popup/popup-tdm.js": ["tdmExportBtn", "async function tdmExport()", "tdmExportFormat"]},
    },
    {
        "name": "Grafana diagnostics section",
        "html": [
            'id="grafana-debug"', 'id="grafanaDebugFullBtn"',
            'id="grafanaDebugGuiCaptureBtn"', 'id="grafanaDebugStatus"',
            '!id="grafanaDebugEnvironmentBtn"', '!id="grafanaDebugActivePanelBtn"',
            '!id="grafanaDebugDashboardBtn"', '!id="grafanaDebugGraphBtn"',
        ],
        "sources": {
            "js/popup/popup-grafana-debug.js": [
                "const fullReportButton", "const collectDiagnostics = async ()",
                "chrome.scripting.executeScript", "navigator.clipboard.writeText",
                "const safeUrl", "[redacted]", "reportType: 'full'",
                "!grafanaDebugEnvironmentBtn", "!grafanaDebugActivePanelBtn",
                "!grafanaDebugDashboardBtn", "!grafanaDebugGraphBtn",
                "const graphStructure", "const dashboard", "[data-viz-panel-key]",
                "function collectGuiScreenshots", "dashbridge-capture-gui",
                "chrome.runtime.sendMessage", "guiCaptureStatus",
            ],
        },
    },
    {
        "name": "Grafana navigation",
        "html": [
            'data-tab="tab-grafana"', 'id="tab-grafana"',
            '!data-tab="tab-settings"', '!id="tab-settings"', '!id="confluenceScrollFix"',
            '!popup-settings.js',
            'data-sub="grafana-links"', '!data-sub="grafana-panel-screenshot"',
            '!data-sub="grafana-cpu"', '!data-sub="grafana-mem"',
            '!id="grafana-cpu"', '!id="grafana-mem"',
            'data-sub="grafana-batch"', 'data-sub="grafana-debug"',
            'id="grafana-debug"', 'id="grafana-no-subtabs"',
            "!popup-grafana-cpu.js", "!popup-grafana-mem.js", "!grafana-metric-ui.js",
        ],
        "sources": {
            "js/popup/popup-core.js": ['"tab-grafana"', '"tab-recorder"', "lastActiveTab"],
            "js/popup/popup-grafana-router.js": [
                'const subBtns = document.querySelectorAll(".grafana-sub-btn")',
                'const subContents = document.querySelectorAll(".grafana-sub-content")',
                "lastActiveGrafanaSubTab", "dashbridge-popup-capture-size",
                "!module_grafana_cpu", "!module_grafana_mem",
            ],
        },
    },
]


if __name__ == "__main__":
    run_popup_contracts(CASES)
