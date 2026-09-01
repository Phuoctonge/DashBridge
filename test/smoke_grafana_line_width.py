"""Ensures the shared MAIN-world visual engine owns fill/contrast rendering."""
from pathlib import Path
from support.smoke import run_checks

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "js/content/grafana-visual-engine.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-legend-visibility-adapters.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-legend-visuals.js").read_text(encoding="utf-8")

checks = {
    "shared visual engine is registered": "window.DashBridgeGrafanaVisualEngine" in SRC,
    "Flot fill is controlled by the shared remove-fill option": "let targetFill = removeAreaFillArg ? false : (s._originalFill !== undefined ? s._originalFill : true);" in SRC,
    "uPlot fill is controlled by the shared remove-fill option": "let targetFill = fillDisabled ? 'rgba(0,0,0,0)' : s._originalFill;" in SRC,
    "Flot width is controlled by the shared thicken option": "targetLineWidth = thickenLinesArg ?" in SRC,
    "uPlot width is controlled by the shared thicken option": "const targetWidth = thickenLinesArg" in SRC,
    "uPlot width restoration is independent of stroke resolution": "Width restoration must not depend on resolving the stroke." in SRC
        and "if (targetWidth !== undefined && s.width !== targetWidth)" in SRC,
    "contrast uses the shared palette": "applyColors()" in SRC,
}

run_checks(checks)
