"""Behavioral regression checks for Grafana URL time formats."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "js/shared/grafana-time.js"
NODE = os.environ.get("DASHBRIDGE_NODE") or shutil.which("node")

if NODE is None:
    print("  SKIP Grafana time format behavior (Node.js is unavailable)")
    raise SystemExit(0)

node_script = f"""
const fs = require('fs');
const vm = require('vm');
const context = {{ URL, Date, Number, String, RegExp }};
vm.createContext(context);
vm.runInContext(fs.readFileSync({json.dumps(str(HELPER))}, 'utf8'), context);
const cases = [
  context.parseGrafanaAbsoluteTime('1745578080000') === 1745578080000,
  context.parseGrafanaAbsoluteTime('2025-04-25T10:48:00.000Z') === 1745578080000,
  context.detectGrafanaTimeFormat('https://grafana.example/d/abc?from=2025-04-25T10%3A48%3A00.000Z&to=2025-04-25T12%3A49%3A00.000Z') === 'iso',
  context.detectGrafanaTimeFormat('https://grafana.example/d/abc?from=1745578080000&to=1745585340000') === 'milliseconds',
  context.serializeGrafanaAbsoluteTime(1745578080000, 'iso') === '2025-04-25T10:48:00.000Z',
  context.serializeGrafanaAbsoluteTime(1745578080000, 'milliseconds') === '1745578080000',
];
process.exit(cases.every(Boolean) ? 0 : 1);
"""

with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as handle:
    handle.write(node_script)
    script_path = Path(handle.name)

try:
    result = subprocess.run([NODE, str(script_path)], capture_output=True, text=True)
finally:
    script_path.unlink(missing_ok=True)

print("  PASS" if result.returncode == 0 else "  FAIL", "Grafana time format behavior")
if result.stderr:
    print(result.stderr.strip())
raise SystemExit(result.returncode)
