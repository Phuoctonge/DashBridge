"""Smoke tests for shared Grafana legend filtering in MAIN world."""
from pathlib import Path
from support.smoke import run_checks

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "js/content/grafana-visual-engine.js").read_text(encoding="utf-8")
DASHBOARD = (ROOT / "js/pages/dashbridge.js").read_text(encoding="utf-8")
PANEL_SETTINGS = (ROOT / "js/shared/grafana-panel-settings-modal.js").read_text(encoding="utf-8")

checks = {
    "finds Grafana legend rows": "const legendItems = Array.from" in SRC,
    "uses per-series visibility config": "getSeriesConfigState" in SRC,
    "restores complete-hide rows": "data-old-display" in SRC,
    "removes the redundant legend list search": "panel-tools-search" not in PANEL_SETTINGS
        and "const search = overlay.querySelector('.panel-tools-search')" not in PANEL_SETTINGS
        and "refreshVisible" not in PANEL_SETTINGS,
    "supports include and ignore mass-selection patterns": "selectLegendSeriesByPatterns" in PANEL_SETTINGS
        and "legendSelectFilter" in PANEL_SETTINGS and "legendIgnoreFilter" in PANEL_SETTINGS
        and "Выбрать серии" in PANEL_SETTINGS and "Игнорировать серии" in PANEL_SETTINGS,
    "pattern fields have readable labels and full-width styling": "panel-tools-pattern-input" in PANEL_SETTINGS
        and "panel-tools-pattern-label" in PANEL_SETTINGS
        and ".panel-tools-pattern-input { width:100%;" in PANEL_SETTINGS
        and "box-sizing:border-box;" in PANEL_SETTINGS
        and "panel-tools-legend-patterns" in PANEL_SETTINGS
        and "panel-tools-legend-section-title" in PANEL_SETTINGS,
    "legend list can show only enabled series without changing selection": "name=\"legendShowActiveOnly\"" in PANEL_SETTINGS
        and "const updateLegendVisibility" in PANEL_SETTINGS
        and "row.hidden = !!showActiveOnly?.checked && !checkbox?.checked;" in PANEL_SETTINGS
        and ".panel-tools-legend-row[hidden] { display:none; }" in PANEL_SETTINGS,
    "uses fast uPlot complete hide": "applyUPlotFastCompleteHide" in SRC,
    "retains Grafana's native legend state only for internal Batch toggling": "if (mode === 'fast_click_toggle')" in SRC
        and "return applyUPlotNativeLegendVisibility({ root, seriesConfig });" in SRC,
    "uses flot visibility controller": "installFlotVisibilityController" in SRC,
    "removes fill through the chart series rather than Canvas globals": "CanvasRenderingContext2D.prototype" not in SRC
        and "let targetFill = fillDisabled ? 'rgba(0,0,0,0)' : s._originalFill" in SRC,
}

run_checks(checks)
