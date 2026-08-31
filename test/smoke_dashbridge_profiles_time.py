"""Regression checks for DashBridge profiles, import/export and time controls."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
PROFILE = (ROOT / "pages/dashbridge/dashbridge-profile-controller.js").read_text(encoding="utf-8")
JS = (ROOT / "pages/dashbridge/dashbridge.js").read_text(encoding="utf-8") + PROFILE
PANEL_URL = (ROOT / "pages/dashbridge/dashbridge-panel-url.js").read_text(encoding="utf-8")
PANEL_TRANSFER = (ROOT / "pages/dashbridge/dashbridge-panel-transfer.js").read_text(encoding="utf-8")
PROFILE_STORE = (ROOT / "js/shared/dashbridge-profile-store.js").read_text(encoding="utf-8")
TIME_STATE = (ROOT / "pages/dashbridge/dashbridge-time-state.js").read_text(encoding="utf-8")
TIME_CONTROLLER = (ROOT / "pages/dashbridge/dashbridge-time-controller.js").read_text(encoding="utf-8")
MIGRATION = (ROOT / "pages/dashbridge/dashbridge-data-migration.js").read_text(encoding="utf-8")
HTML = (ROOT / "pages/dashbridge/dashbridge.html").read_text(encoding="utf-8")


checks = {
    "profiles load from local storage": "profileStore.load" in PROFILE and "chrome.storage.local.get" in PROFILE_STORE and "dashbridge_profiles" in PROFILE_STORE,
    "active profile is persisted": "profileStore.save" in PROFILE and "dashbridge_activeProfileId" in PROFILE_STORE and "const saveProfiles" in PROFILE,
    "active profile selection is isolated per tab": "TAB_ACTIVE_PROFILE_KEY" in PROFILE
        and "sessionStorage.setItem(TAB_ACTIVE_PROFILE_KEY" in PROFILE
        and "nextProfiles.some(profile => profile.id === activeProfileId)" in JS,
    "open DashBridge reloads externally changed profiles": "syncProfilesFromStorage" in JS
        and "changes.dashbridge_profiles" in JS and "activeProfileChanged" in JS
        and "await renderDashboard()" in JS,
    "profile switch saves current panels": "const switchProfile = async" in PROFILE and "currentProfile.panels = getPanels()" in PROFILE,
    "profile CRUD entry points exist": all(token in PROFILE for token in ["const createProfile", "const renameActiveProfile", "const deleteProfile = async"]),
    "panel export uses a JSON blob": "new Blob([JSON.stringify(data, null, 2)]" in JS,
    "panel import validates JSON before use": "JSON.parse(text)" in PANEL_TRANSFER and "Array.isArray(data?.panels)" in PANEL_TRANSFER,
    "time range updates unloaded and loaded frames": "iframe.dataset.src" in TIME_CONTROLLER and "postToDashboardFrame(iframe" in TIME_CONTROLLER,
    "time state belongs to each profile": "profile.timeState = getState()" in TIME_CONTROLLER
        and "loadActiveProfileTimeState();" in JS,
    "legacy global time uses an isolated one-shot migration": "dashbridge_dataSchemaVersion" in MIGRATION
        and "migrateProfiles" in MIGRATION and "clearLegacyTimeState" in MIGRATION
        and 'src="dashbridge-data-migration.js"' in HTML,
    "dashboard loads the Grafana time helper": 'src="../../js/shared/grafana-time.js"' in HTML,
    "panel URLs retain their time format": "timeState.applyToUrl" in TIME_CONTROLLER
        and "detectGrafanaTimeFormat(urlValue)" in TIME_STATE,
    "time controls are present": all(token in HTML for token in ['id="absTimeFrom"', 'id="absTimeTo"', 'id="applyAbsoluteTime"']),
    "crosshair mode is stored": "dashbridge_crosshairMode" in JS,
    "active panels load eagerly and paused panels remain excluded": "navigateDashboardFrame(iframeEl, iframeEl.dataset.src)" in JS
        and "if (!panel.paused)" in JS and "dashbridgeLazyLoadEnabled" not in JS,
    "quick panel addition UI is present": all(token in HTML for token in ['id="quickAddPanelsBtn"', 'id="quickAddDashboardUrl"', 'id="quickAddPanelIds"']),
    "quick panel addition builds d-solo URLs": "function buildDashBridgeSoloPanelUrl" in PANEL_URL and "url.searchParams.set('panelId', panelId)" in PANEL_URL,
    "quick panel addition validates and deduplicates IDs": "function parseQuickPanelIds" in PANEL_URL and "new Set(tokens)" in PANEL_URL,
    "all panel addition paths use canonical duplicate checks": "const getCurrentProfilePanelIdentities" in PROFILE
        and "currentProfileHasPanel(url)" in JS
        and JS.count("getCurrentProfilePanelIdentities()") >= 4
        and 'src="../../js/shared/grafana-panel-identity.js"' in HTML,
    "dashboard panel picker reuses Batch inventory without replacing quick add": all(token in HTML for token in [
        'id="quickAddPanelsBtn"', 'id="discoverDashboardPanelsBtn"', 'id="dashboardPanelPickerOverlay"',
        'src="../../js/shared/grafana-dashboard-api.js"'
    ]) and "fetchGrafanaDashboardPanels(dashboardUrl)" in JS,
}

run_checks(checks)
