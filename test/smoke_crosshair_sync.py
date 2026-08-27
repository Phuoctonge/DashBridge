"""Regression checks for smart-crosshair synchronization."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = (ROOT / "js/pages/dashbridge.js").read_text(encoding="utf-8")
CROSSHAIR = (ROOT / "js/pages/dashbridge-crosshair.js").read_text(encoding="utf-8")
IFRAME = (ROOT / "js/content/grafana-iframe.js").read_text(encoding="utf-8")
HTML = (ROOT / "dashbridge.html").read_text(encoding="utf-8")
MANIFEST = (ROOT / "manifest.json").read_text(encoding="utf-8")


checks = {
    "parent throttles broadcasts with requestAnimationFrame": "createDashBridgeCrosshair" in DASHBOARD and "requestAnimationFrame(flush)" in CROSSHAIR,
    "parent skips source iframe": "frame !== event.source" in CROSSHAIR,
    "hide cancels an outstanding broadcast": "cancelAnimationFrame(animationFrame)" in CROSSHAIR,
    "iframe throttles outgoing messages": "let outgoingCrosshairFrame = null;" in IFRAME,
    "iframe cancels a pending message before hiding": "cancelAnimationFrame(outgoingCrosshairFrame)" in IFRAME,
    "tooltip emulation is removed": "new MouseEvent('mousemove'" not in IFRAME,
    "only smart cursor and off modes remain": "crosshairMode = event.data.mode === 'line' ? 'line' : 'off';" in IFRAME,
    "cursor checkbox exposes its selected state": 'id="crosshairToggleCheckbox"' in HTML
    and "toggle.checked = crosshairMode === 'line';" in DASHBOARD,
    "cursor button is synchronized on startup": "updateCrosshairBtn();" in DASHBOARD
    and DASHBOARD.index("setupEventListeners();") < DASHBOARD.index("updateCrosshairBtn();"),
    "iframe loads the time helper before its own script": 0 <= MANIFEST.find('"js/shared/grafana-time.js"') < MANIFEST.find('"js/content/grafana-iframe.js"'),
    "iframe parses ISO and epoch ranges": "parseGrafanaAbsoluteTime(url.searchParams.get('from'))" in IFRAME,
}

run_checks(checks)
