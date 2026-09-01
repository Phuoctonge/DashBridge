# -*- coding: utf-8 -*-
"""Contracts for eager DashBridge panels, pause and profile ZIP capture."""
import re
from pathlib import Path
from support.smoke import run_checks

ROOT = Path(__file__).parent.parent
src = (ROOT / 'pages/dashbridge/dashbridge.js').read_text(encoding='utf-8')
page_ui = (ROOT / 'pages/dashbridge/dashbridge-page-ui-controller.js').read_text(encoding='utf-8')
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
    'active iframe starts during dashboard render':
        re.search(r"if \(!panel\.paused\)\s*\{\s*navigateDashboardFrame\(iframe, iframe\.dataset\.src\)", cards) is not None,
    'header contains current-profile ZIP button':
        'id="captureAllPanelsBtn"' in html and 'captureAllDashboardPanels' in src
        and 'captureAll' in capture,
    'header compact toggle shares global panel state':
        'id="capturePreparedToggleBtn"' in html and 'btn-capture-toggle' in html
        and "setCapturePrepared(!getCapturePrepared())" in page_ui,
    'DashBridge page loads ZIP dependencies before controller':
        html.index('vendor/jszip.min.js') < html.index('js/shared/archive-download.js')
        < html.index('dashbridge-capture.js') < html.index('dashbridge.js'),
    'archive capture is sequential':
        re.search(r"for \(let index = 0; index < activePanels\.length; index \+= 1\)[\s\S]+?await capturePanel", capture) is not None,
    'paused panels are excluded from archive':
        'panels.filter(panel => !panel.paused)' in capture,
    'archive waits for a rendered Grafana panel':
        'waitForPanelRendered(iframe)' in capture and "dataset.dashbridgeRendered = 'true'" in src,
    'archive uses the same prepared capture dimensions':
        "outputAction: 'archive'" in capture
        and 'const dimensions = getCompactCaptureDimensions()' in capture
        and 'outputWidth: dimensions.width' in capture
        and 'outputHeight: dimensions.height' in capture,
    'archive is memory bounded':
        'DashBridgeArchiveBudget.create(64 * 1024 * 1024)' in capture,
    'capture always restores its card':
        "card.classList.remove('dashbridge-panel-capture-active')" in capture and 'window.scrollTo(scroll.x, scroll.y)' in capture,
    'dashboard still batches card DOM insertion':
        'documentRef.createDocumentFragment()' in cards and 'container.appendChild(fragment)' in cards,
}

run_checks(checks)
