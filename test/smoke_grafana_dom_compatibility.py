"""Behavioral regression checks for Grafana panel DOM variants."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent.parent
DOM = ROOT / "js/content/grafana-dom.js"
FIXTURE = ROOT / "test/fixtures/grafana-panel-viz-key.html"
FALLBACK_FILES = [
    ROOT / "js/shared/grafana-panel-capture.js",
    ROOT / "js/shared/grafana-legend-engine.js",
    ROOT / "js/content/grafana-panel-tools.js",
    ROOT / "js/content/grafana-visual-engine.js",
]
NODE = os.environ.get("DASHBRIDGE_NODE") or shutil.which("node")

if NODE is None:
    print("  SKIP Grafana DOM compatibility behavior (Node.js is unavailable)")
    raise SystemExit(0)

node_script = f"""
const fs = require('fs');
const vm = require('vm');
const pageRoot = {{ classList: {{ contains: () => false }}, hasAttribute: () => false, parentElement: null }};
const newPanel = {{
  offsetHeight: 520,
  dataset: {{ vizPanelKey: 'panel-137' }},
  querySelector: () => null,
  classList: {{ contains: () => false }},
  hasAttribute: name => name === 'data-viz-panel-key',
  parentElement: pageRoot
}};
const context = {{
  window: {{}},
  CSS: {{ escape: value => String(value) }},
  document: {{
    querySelector: selector => selector.includes('[data-viz-panel-key="panel-137"]') ? newPanel : null,
    querySelectorAll: () => []
  }}
}};
vm.createContext(context);
vm.runInContext(fs.readFileSync({json.dumps(str(DOM))}, 'utf8'), context);
const found = context.window.DashBridgeGrafanaDom.findPanelById('137');
const foundPrefixed = context.window.DashBridgeGrafanaDom.findPanelById('panel-137');
const outer = context.window.DashBridgeGrafanaDom.outerPanel(newPanel);
const key = context.window.DashBridgeGrafanaDom.panelKey(newPanel);
process.exit(found === newPanel && foundPrefixed === newPanel && outer === newPanel && key === 'panel-137' ? 0 : 1);
"""

with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as handle:
    handle.write(node_script)
    script_path = Path(handle.name)

try:
    result = subprocess.run([NODE, str(script_path)], capture_output=True, text=True)
finally:
    script_path.unlink(missing_ok=True)

fixture_ok = 'data-viz-panel-key="panel-137"' in FIXTURE.read_text(encoding="utf-8")
fallbacks_ok = all('DashBridgeGrafanaDom?.findPanel' in path.read_text(encoding="utf-8") for path in FALLBACK_FILES)
shared_contract_ok = (
    'const panelKey = panel =>' in DOM.read_text(encoding="utf-8")
    and 'window.DashBridgeGrafanaDom = { panelSelectors, visiblePanels, panelKey,' in DOM.read_text(encoding="utf-8")
)
visual_engine = (ROOT / "js/content/grafana-visual-engine.js").read_text(encoding="utf-8")
legend_layout_ok = (
    "legendRow?.closest(`table" in visual_engine
    and "const findFlexChild" in visual_engine
    and "const chartBranch = findFlexChild(chartHost);" in visual_engine
    and "const legendBranch = findFlexChild(legendElement);" in visual_engine
    and "const snapshotLegendLayout" in visual_engine
    and "const restoreLegendLayout" in visual_engine
    and "const resizeUPlotAfterLegendLayout" in visual_engine
    and "const sizeTarget = chartBranch || chartHost;" in visual_engine
    and "uplot.setSize({ width, height });" in visual_engine
)
passed = fixture_ok and fallbacks_ok and shared_contract_ok and legend_layout_ok and result.returncode == 0
print("  PASS" if passed else "  FAIL", "new Grafana panel key is resolved by the shared helper")
if result.stderr:
    print(result.stderr.strip())
raise SystemExit(0 if passed else 1)
