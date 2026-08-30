# -*- coding: utf-8 -*-
"""Contracts for eager DashBridge panels, pause and profile ZIP capture."""
import re
from pathlib import Path
from support.smoke import run_checks

ROOT = Path(__file__).parent.parent
src = (ROOT / 'pages/dashbridge/dashbridge.js').read_text(encoding='utf-8')
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
        re.search(r"if \(!panel\.paused\)\s*\{\s*navigateDashboardFrame\(iframeEl, iframeEl\.dataset\.src\)", src) is not None,
    'header contains current-profile ZIP button':
        'id="captureAllPanelsBtn"' in html and 'captureAllDashboardPanels' in src,
    'header compact toggle shares global panel state':
        'id="capturePreparedToggleBtn"' in html and 'btn-capture-toggle' in html
        and "setDashboardCapturePrepared(!defaultCapturePrepared)" in src,
    'DashBridge page loads ZIP dependencies before controller':
        html.index('vendor/jszip.min.js') < html.index('js/shared/archive-download.js') < html.index('dashbridge.js'),
    'archive capture is sequential':
        re.search(r"for \(let index = 0; index < activePanels\.length; index \+= 1\)[\s\S]+?await captureDashbridgePanel", src) is not None,
    'paused panels are excluded from archive':
        'panels.filter(panel => !panel.paused)' in src,
    'archive waits for a rendered Grafana panel':
        'waitForDashboardPanelRendered(iframe)' in src and "dataset.dashbridgeRendered = 'true'" in src,
    'archive uses the same prepared capture dimensions':
        "outputAction: 'archive'" in src
        and 'outputWidth: getCompactCaptureDimensions().width' in src
        and 'outputHeight: getCompactCaptureDimensions().height' in src,
    'archive is memory bounded':
        'DashBridgeArchiveBudget.create(64 * 1024 * 1024)' in src,
    'capture always restores its card':
        "card.classList.remove('dashbridge-panel-capture-active')" in src and 'window.scrollTo(scroll.x, scroll.y)' in src,
    'dashboard still batches card DOM insertion':
        'document.createDocumentFragment()' in src and 'container.appendChild(fragment)' in src,
}

run_checks(checks)
