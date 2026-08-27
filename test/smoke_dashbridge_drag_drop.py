"""Regression checks for dashboard drag-and-drop with mixed card sizes."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
JS = (ROOT / "js/pages/dashbridge.js").read_text(encoding="utf-8")
RENDERER = (ROOT / "js/pages/dashbridge-renderer.js").read_text(encoding="utf-8")
CSS = (ROOT / "css/dashbridge.css").read_text(encoding="utf-8")


checks = {
    "container owns dragover handling": "container.addEventListener('dragover'" in JS,
    "target side is resolved from pointer position": "dragDropSide = e.clientX < target.getBoundingClientRect().left" in JS,
    "panel order is persisted from DOM": "function savePanelOrder(container)" in JS,
    "free grid behavior is removed": "getGridDropPosition" not in JS and "resolveGridDrop" not in JS,
    "iframe cannot swallow a drop": ".dashboard-container.is-dragging iframe" in CSS and "pointer-events: none" in CSS,
    "left marker exists": ".panel-card.drag-over-left::before" in CSS,
    "right marker exists": ".panel-card.drag-over-right::after" in CSS,
    "markers are inset from card edges": "left: 12px;" in CSS and "right: 12px;" in CSS,
    "markers preserve the inset visual style": "top: 12px;" in CSS and "border-radius: 999px;" in CSS,
    "card dimensions remain configurable": "card.dataset.panelSize" in RENDERER and "card.style.height = panel.height" in RENDERER,
    "child dragleave does not erase the marker": "if (e.target === container" in JS,
    "handle no longer cancels drag on mouseleave": "handle.addEventListener('mouseleave'" not in JS,
}

run_checks(checks)
