"""Regression checks for cleanup of long-lived browser resources."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
INJECT = (ROOT / "js/content/inject.js").read_text(encoding="utf-8")
PANEL_TOOLS = (ROOT / "js/content/grafana-panel-tools.js").read_text(encoding="utf-8")
COMMAND = (ROOT / "js/shared/grafana-command.js").read_text(encoding="utf-8")


checks = {
    "panel-tools runtime is singleton": "__dashbridgePanelToolsRuntimeLoaded" in PANEL_TOOLS,
    "threshold listener keeps one stable reference":
        "window.__dashbridgeThresholdDataListener = reportThreshold;" in PANEL_TOOLS
        and "window.addEventListener('dashbridgeThresholdDataUpdated', window.__dashbridgeThresholdDataListener);" in PANEL_TOOLS,
    "shared command waits for apply acknowledgement": "panelToolsApplied" in COMMAND and "apply-timeout" in COMMAND,
    "shared command has no unreachable legacy command path":
        "Legacy implementation retained below" not in COMMAND,
    "Confluence observer has start function": "const startObserver = () =>" in INJECT,
    "Confluence observer has stop function": "const stopObserver = () =>" in INJECT,
    "Confluence observer stops when disabled": "else stopObserver();" in INJECT,
}

run_checks(checks)
