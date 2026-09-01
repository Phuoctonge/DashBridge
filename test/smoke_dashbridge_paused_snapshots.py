from pathlib import Path
from support.smoke import CheckCollector

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'pages/dashbridge/dashbridge.html').read_text(encoding='utf-8')
PAGE = (ROOT / 'pages/dashbridge/dashbridge.js').read_text(encoding='utf-8')
CARD = (ROOT / 'pages/dashbridge/dashbridge-panel-card-controller.js').read_text(encoding='utf-8')
RENDERER = (ROOT / 'pages/dashbridge/dashbridge-renderer.js').read_text(encoding='utf-8')


check = CheckCollector()


check('paused cards render a clear non-live placeholder', 'paused-placeholder' in RENDERER and 'На паузе' in RENDERER)
check('paused cards do not render a snapshot image', 'paused-snapshot' not in RENDERER)
check('dashboard no longer loads snapshot helper', 'dashbridge-paused-snapshots.js' not in HTML)
pause_start = PAGE.index('async function togglePanelPause(id)')
pause_end = PAGE.index('function bindDashboardPanelActions')
pause_body = PAGE[pause_start:pause_end]
check('pause changes state without waiting for or capturing a frame', 'panel.paused = !panel.paused;' in pause_body and 'waitForDashboardFrameLoad' not in pause_body and 'captureCard' not in pause_body)
check('pause implementation contains no retired snapshot runtime', 'DashBridgePausedSnapshots' not in PAGE and 'pausedSnapshots' not in PAGE and 'pausedPanelRenderWaiters' not in PAGE)
check('global refresh does not process paused panels', 'refreshPausedPanels' not in PAGE)
check('ordinary rendering eagerly loads only active panels', 'if (!panel.paused)' in CARD and 'navigateDashboardFrame(iframe, iframe.dataset.src)' in CARD)

IFRAME = (ROOT / 'js/content/grafana-iframe.js').read_text(encoding='utf-8')
CSS = (ROOT / 'pages/dashbridge/dashbridge.css').read_text(encoding='utf-8')
check('iframe reports Grafana panel title', "action: 'dashbridgePanelTitle'" in IFRAME)
check('iframe waits for Grafana React title after page load',
      'readinessTimer = setTimeout(inspectReadiness, delay)' in IFRAME
      and 'reportPanelTitle()' in IFRAME)
check('iframe recognizes Grafana panel-header h2 titles', '[data-testid*="Panel header"] h2' in IFRAME)
check('iframe ignores the transient Grafana startup failure text as a title', 'isGrafanaStartupFailureTitle' in IFRAME)
check('paused card renders stored panel title', 'panel.title' in RENDERER and 'paused-panel-title' in RENDERER)
check('paused label is prominent', '.paused-badge' in CSS and 'font-size: 1rem' in CSS)
check.finish()
