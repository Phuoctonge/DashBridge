"""Contract test for forwarding an authenticated iframe render event to GUI capture."""
from pathlib import Path
from support.smoke import CheckCollector


ROOT = Path(__file__).resolve().parent.parent
PAGE = (ROOT / 'pages/dashbridge/dashbridge.js').read_text(encoding='utf-8')
BACKGROUND = (ROOT / 'js/background.js').read_text(encoding='utf-8')
IFRAME = (ROOT / 'js/content/grafana-iframe.js').read_text(encoding='utf-8')


check = CheckCollector()


check('DashBridge handles the panel-rendered event', "e.data.action === 'dashbridgePanelRendered'" in PAGE)
check('DashBridge limits forwarding to GUI-capture mode', "has('guiCapture')" in PAGE)
check('DashBridge forwards the ready signal', "type: 'dashbridge-gui-capture-ready'" in PAGE)
check('iframe readiness supports chart and table surfaces',
      "'canvas, table, [role=\"table\"]" in IFRAME)
check('iframe readiness avoids document-wide mutation observers',
      'new MutationObserver' not in IFRAME
      and 'readinessTimer = setTimeout(inspectReadiness, delay)' in IFRAME)
check('background owns tab-scoped render waiters', 'waitForGuiCaptureReady' in BACKGROUND)
check('DashBridge GUI capture creates and awaits render readiness', "? waitForGuiCaptureReady(tabId)" in BACKGROUND and 'await dashbridgeReady;' in BACKGROUND)
check.finish()
