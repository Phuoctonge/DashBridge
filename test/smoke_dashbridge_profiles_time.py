"""Regression checks for DashBridge profiles, import/export and time controls."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
JS = (ROOT / "js/pages/dashbridge.js").read_text(encoding="utf-8")
PROFILE_STORE = (ROOT / "js/shared/dashbridge-profile-store.js").read_text(encoding="utf-8")
TIME_STATE = (ROOT / "js/pages/dashbridge-time-state.js").read_text(encoding="utf-8")
HTML = (ROOT / "dashbridge.html").read_text(encoding="utf-8")


checks = {
    "profiles load from local storage": "DashBridgeProfileStore.load" in JS and "chrome.storage.local.get" in PROFILE_STORE and "dashbridge_profiles" in PROFILE_STORE,
    "active profile is persisted": "DashBridgeProfileStore.save" in JS and "dashbridge_activeProfileId" in PROFILE_STORE and "function saveProfiles()" in JS,
    "active profile selection is isolated per tab": "DASHBRIDGE_TAB_ACTIVE_PROFILE_KEY" in JS
        and "sessionStorage.setItem(DASHBRIDGE_TAB_ACTIVE_PROFILE_KEY" in JS
        and "nextProfiles.some(profile => profile.id === activeProfileId)" in JS,
    "open DashBridge reloads externally changed profiles": "syncProfilesFromStorage" in JS
        and "changes.dashbridge_profiles" in JS and "activeProfileChanged" in JS
        and "await renderDashboard()" in JS,
    "profile switch saves current panels": "function switchProfile(id)" in JS and "savePanels();" in JS,
    "profile CRUD entry points exist": all(token in JS for token in ["function createProfile", "function renameActiveProfile", "async function deleteProfile"]),
    "panel export uses a JSON blob": "new Blob([JSON.stringify(data, null, 2)]" in JS,
    "panel import validates JSON before use": "JSON.parse(e.target.result)" in JS and "Array.isArray(data.panels)" in JS,
    "time range updates unloaded and loaded frames": "iframe.dataset.src" in JS and "postToDashboardFrame(iframe" in JS,
    "time state belongs to each profile": "profile.timeState = { from: globalTimeFrom, to: globalTimeTo, refresh: globalRefresh }" in JS
        and "loadActiveProfileTimeState();" in JS,
    "legacy global time is migrated into profiles": "const legacyTimeState = DashBridgeTimeState.load();" in JS
        and "profile.timeState = { ...legacyTimeState };" in JS,
    "dashboard loads the Grafana time helper": 'src="js/shared/grafana-time.js"' in HTML,
    "panel URLs retain their time format": "DashBridgeTimeState.applyToUrl" in JS
        and "detectGrafanaTimeFormat(urlValue)" in TIME_STATE,
    "time controls are present": all(token in HTML for token in ['id="absTimeFrom"', 'id="absTimeTo"', 'id="applyAbsoluteTime"']),
    "crosshair mode is stored": "dashbridge_crosshairMode" in JS,
    "active panels load eagerly and paused panels remain excluded": "navigateDashboardFrame(iframeEl, iframeEl.dataset.src)" in JS
        and "if (!panel.paused)" in JS and "dashbridgeLazyLoadEnabled" not in JS,
    "quick panel addition UI is present": all(token in HTML for token in ['id="quickAddPanelsBtn"', 'id="quickAddDashboardUrl"', 'id="quickAddPanelIds"']),
    "quick panel addition builds d-solo URLs": "function buildGrafanaSoloPanelUrl" in JS and "url.searchParams.set('panelId', panelId)" in JS,
    "quick panel addition validates and deduplicates IDs": "function parseQuickPanelIds" in JS and "new Set(tokens)" in JS,
    "all panel addition paths use canonical duplicate checks": "function getCurrentProfilePanelIdentities()" in JS
        and "currentProfileHasPanel(url)" in JS
        and JS.count("getCurrentProfilePanelIdentities()") >= 4
        and 'src="js/shared/grafana-panel-identity.js"' in HTML,
    "dashboard panel picker reuses Batch inventory without replacing quick add": all(token in HTML for token in [
        'id="quickAddPanelsBtn"', 'id="discoverDashboardPanelsBtn"', 'id="dashboardPanelPickerOverlay"',
        'src="js/shared/grafana-dashboard-api.js"'
    ]) and "fetchGrafanaDashboardPanels(dashboardUrl)" in JS,
}

run_checks(checks)
