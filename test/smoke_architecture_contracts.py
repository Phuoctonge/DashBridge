"""Guards the dependency boundaries used by Grafana tools."""
from pathlib import Path
from support.smoke import run_checks

ROOT = Path(__file__).resolve().parent.parent
runtime = (ROOT / "js/shared/grafana-runtime.js").read_text(encoding="utf-8")
runtime_manifest = (ROOT / "js/shared/grafana-runtime-manifest.js").read_text(encoding="utf-8")
background = (ROOT / "js/background.js").read_text(encoding="utf-8")
background_infrastructure = (ROOT / "js/background-grafana-infrastructure.js").read_text(encoding="utf-8")
checks = {
    "MAIN-world dependencies load in order": runtime_manifest.index("js/content/grafana-dom.js") < runtime_manifest.index("js/content/grafana-panel-state.js") < runtime_manifest.index("js/content/grafana-panel-tools.js"),
    "Early MAIN runtime uses dynamic document-start registration": "background-grafana-infrastructure.js" in background and "registerContentScripts" in background_infrastructure and "runAt: 'document_start'" in background_infrastructure,
    "Panel-local capture uses the shared MAIN-world DOM adapter": "DashBridgeGrafanaDom?.outerPanel" in (ROOT / "js/content/grafana-panel-tools.js").read_text(encoding="utf-8"),
    "Command runner is shared by Popup and Batch": all("js/shared/grafana-command.js" in (ROOT / page).read_text(encoding="utf-8") for page in ("pages/popup/popup.html", "pages/batch/batch.html")),
}
run_checks(checks)
