"""Smoke tests for shared Canvas styling in MAIN world."""
from pathlib import Path
from support.smoke import run_checks

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "js/content/grafana-visual-engine.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-legend-visibility-adapters.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-legend-visuals.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-series-styles.js").read_text(encoding="utf-8")

checks = {
    "has contrast palette": "applyColors()" in SRC,
    "complete-hide colours are delegated to native Grafana": "const applyUPlotFastCompleteHide" in SRC,
    "native complete-hide adapter remains isolated from popup colouring": "const applyUPlotFastCompleteHide" in SRC
        and "const applyPopupLegendAndVisuals" in SRC,
    "normalizes nullable uPlot fill to a callback": "const makeFn = val => typeof val === 'function' ? val : () => val;" in SRC,
    "does not patch every Canvas on the page": "CanvasRenderingContext2D.prototype" not in SRC,
    "removes uPlot area fill locally": "const fillDisabled = !!removeAreaFillArg;" in SRC
        and "let targetFill = fillDisabled ? 'rgba(0,0,0,0)' : s._originalFill;" in SRC
        and "s.__dashbridgeFillDisabled = fillDisabled;" in SRC,
    "restores uPlot fill independently from line-colour state": "Object.prototype.hasOwnProperty.call(s, '_originalFill')" in SRC,
    "removes Flot area fill locally": "let targetFill = removeAreaFillArg ? false" in SRC,
    "style-only fill and width bypass the legacy visual painter": "const applyLocalSeriesStyles" in SRC
        and "configureLocalSeriesStyleGuard({ root, removeFill, thickenLines, thickenLinesValue });" in SRC,
    "style-only refresh repair runs before paint": "const configureLocalSeriesStyleGuard" in SRC
        and "new MutationObserver(() => applyGuardedStyles())" in SRC,
    "redraws after command": "window.dispatchEvent(new Event('resize'))" in SRC,
    "keeps bottom legend series names left-aligned": "text-align:left !important;" in SRC
        and ".dashbridge-legend-bottom tr > :first-child [class*=\"LegendLabel\"]" in SRC,
}

run_checks(checks)
