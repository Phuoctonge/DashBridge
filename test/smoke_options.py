"""Smoke test for the extension options page."""
from support.smoke import run_page_contract


if __name__ == "__main__":
    run_page_contract(
        "extension options",
        page="pages/options/options.html",
        html=[
            'id="saveBtn"', 'id="exportBtn"', 'id="importBtn"', 'id="importFile"',
            'id="maintenanceStatus"', 'id="settingModuleGrafanaDebug"', 'id="settingModuleRecorder"',
            'Подключение', 'Метрики и имена серверов', 'metric-settings-group-cpu',
            'metric-settings-group-ram', 'metric-settings-group-servers', 'Анализ CPU/RAM',
            'metric-settings-group-capture', 'id="settingGrafanaCompactExportWidth"',
            'id="settingGrafanaCompactExportHeight"',
            'id="settingGrafanaMemCalcMode"', 'Total + Available', 'Total + Used',
            'id="settingGrafanaMemFormula"',
            'id="settingGrafanaMemSecondKeywordLabel"',
            'названиях серий всех панелей Grafana',
            'id="settingConfluenceScrollFixEnabled"', 'id="settingTdmSavePhotosDefault"',
            'id="settingGrafanaCpuPanelTitle"', 'id="settingGrafanaMemPanelTitle"', 'id="settingGrafanaLoadPanelTitle"',
            'id="settingTdmRememberDate"', 'id="settingTdmExcludeUserDefault"',
            'id="settingTdmExcludeUserTextDefault"',
            '!data-options-tab=', '!data-options-panel=',
            '!id="settingModuleGrafanaCpu"', '!id="settingModuleGrafanaMem"',
            '!id="settingModuleConfluence"',
            '!id="settingModuleGrafanaLegend"', '!id="settingGrafanaScreenshotTitle"',
            '!id="settingGrafanaMemScreenshotTitle"'
        ],
        sources={
            "pages/options/options.js": [
                "document.getElementById('saveBtn').addEventListener", "document.getElementById('exportBtn').addEventListener",
                "importBtn.addEventListener", "function showMaintStatus(text, color)",
                "module_grafana_debug", "function validateImportedConfig(config)",
                "URL.revokeObjectURL(url)", "importFile.value = ''",
                "const IMPORT_SCHEMA_VERSION = 3", "const MAX_IMPORT_BYTES = 16 * 1024 * 1024",
                "grafanaMemCalcMode", "syncMemCalcFields", "normalizeMemCalcMode",
                "grafanaCpuPanelTitle", "grafanaMemPanelTitle", "grafanaLoadPanelTitle",
                "Некорректный способ расчёта RAM",
                "syncTdmExcludeUserField",
                "tdmSavePhotosDefault", "tdmRememberDate", "tdmExcludeUserDefault",
                "tdmExcludeUserTextDefault", "confluenceScrollFixEnabled",
                "!settingJiraDefaultTimeSpent", "!settingJiraDefaultComment",
                "'customButtons', 'globalTheme'", "'batchState', 'batchPanelToolRules'",
                "const exportSync = pickImportKeys(syncData, SYNC_IMPORT_KEYS", "if (blob.size > MAX_IMPORT_BYTES)",
                "!const activateOptionsTab", "!window.addEventListener('hashchange'",
                "!module_grafana_cpu", "!module_grafana_mem", "!module_grafana_legend",
                "!module_confluence",
            ],
        },
    )
