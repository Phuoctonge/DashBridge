# -*- coding: utf-8 -*-
"""Contracts for eager DashBridge panels, pause and profile ZIP capture."""
import re
from pathlib import Path
from support.smoke import run_checks

ROOT = Path(__file__).parent.parent
src = (ROOT / 'pages/dashbridge/dashbridge.js').read_text(encoding='utf-8')
page_ui = (ROOT / 'pages/dashbridge/dashbridge-page-ui-controller.js').read_text(encoding='utf-8')
messages = (ROOT / 'pages/dashbridge/dashbridge-iframe-message-controller.js').read_text(encoding='utf-8')
cards = (ROOT / 'pages/dashbridge/dashbridge-panel-card-controller.js').read_text(encoding='utf-8')
capture = (ROOT / 'pages/dashbridge/dashbridge-capture.js').read_text(encoding='utf-8')
renderer = (ROOT / 'pages/dashbridge/dashbridge-renderer.js').read_text(encoding='utf-8')
html = (ROOT / 'pages/dashbridge/dashbridge.html').read_text(encoding='utf-8')

checks = {
    'custom lazy-load setting is removed':
        'dashbridgeLazyLoadEnabled' not in src and 'dashbridgeLazyLoadToggle' not in html,
    'custom lazy observer is removed':
        'new IntersectionObserver' not in src and 'ensureLazyObserver' not in src,
    'live Grafana iframe is eager':
        "iframe.loading = 'eager'" in renderer,
    'paused card does not create an iframe':
        "panel.paused ? this.createPausedPanelBody(panel) : this.createLivePanelBody" in renderer,
    'active iframe enters bounded startup queue during render':
        re.search(r"if \(!panel\.paused\)\s*\{\s*scheduleFrameLoad\(iframe, iframe\.dataset\.src\)", cards) is not None,
    'header omits the removed current-profile ZIP button':
        'id="captureAllPanelsBtn"' not in html and 'captureAllDashboardPanels' not in src,
    'header compact toggle shares global panel state':
        'id="capturePreparedToggleBtn"' in html and 'btn-capture-toggle' in html
        and "setCapturePrepared(!getCapturePrepared())" in page_ui,
    'archive is memory bounded':
        'bytes > 64 * 1024 * 1024' in capture,
    'capture always restores its card':
        "card.classList.remove('dashbridge-panel-capture-active')" in capture and 'window.scrollTo(scroll.x, scroll.y)' in capture,
    'dashboard still batches card DOM insertion':
        'documentRef.createDocumentFragment()' in cards and 'container.appendChild(fragment)' in cards,
}

run_checks(checks)
