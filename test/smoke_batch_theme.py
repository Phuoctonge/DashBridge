"""Regression checks for the Batch page's theme-token based surfaces."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "batch.html").read_text(encoding="utf-8")
CSS = (ROOT / "css/batch.css").read_text(encoding="utf-8")
JS = (ROOT / "js/pages/batch.js").read_text(encoding="utf-8")


checks = {
    "form controls use theme surfaces": "background: var(--bg-elevated);" in CSS and "color: var(--text-main);" in CSS,
    "focus state uses the shared primary token": "rgba(var(--primary-rgb), 0.2)" in CSS,
    "log uses theme surfaces instead of forced black": ".log-container {\n    background: var(--bg-elevated);" in CSS,
    "toast uses the active theme surface": ".toast {\n    background: var(--card-bg);" in CSS,
    "inline URL fields are overridden with theme tokens": "#pasteUrl," in CSS and "#seriesTimestamps" in CSS,
    "parameters card has a dedicated themed class": "batch-parameters-card" in HTML,
    "dynamic series cards use themed classes": "card.className = 'batch-series-card';" in JS and ".batch-series-card {" in CSS,
    "dynamic panel titles do not force white": "batch-panel-title" in JS and "color:#fff" not in JS,
    "panel picker keeps checkbox, title and ID in fixed columns": ".panel-list-item {\n    display: grid;" in CSS
        and "grid-template-columns: auto minmax(0, 1fr) auto;" in CSS,
    "panel picker scrolls its list without hiding the apply action": ".batch-panel-picker-list {" in CSS
        and "max-height: 52vh;" in CSS and "overflow-y: auto;" in CSS,
    "Series capture controls are stacked": "class=\"series-capture-settings\"" in HTML
        and ".series-capture-settings {\n    display: flex;\n    flex-direction: column;" in CSS,
    "Series pattern fields use a responsive themed grid": ".batch-series-patterns {" in CSS
        and "grid-template-columns: repeat(2, minmax(0, 1fr));" in CSS
        and "seriesIncludeFilter" in HTML and "seriesIgnoreFilter" in HTML,
}

run_checks(checks)
