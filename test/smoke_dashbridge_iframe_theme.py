"""Regression contract for Grafana iframe theme selection in DashBridge."""
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = (ROOT / "pages" / "dashbridge" / "dashbridge.js").read_text(encoding="utf-8")
THEME_RUNTIME = (ROOT / "js" / "theme.js").read_text(encoding="utf-8")

for required in (
    "function resolveGrafanaTheme(panel)",
    "panel?.grafanaTheme || 'follow'",
    "id=\"iframeSettingsTheme\"",
    "value=\"follow\"",
    "Как в DashBridge",
    "value=\"light\"",
    "value=\"dark\"",
    "panel.grafanaTheme = overlay.querySelector('#iframeSettingsTheme').value",
    "url.searchParams.set('theme', resolveGrafanaTheme(panel))",
    "window.addEventListener('dashbridge-theme-change'",
):
    assert required in DASHBOARD, f"missing iframe theme contract: {required}"

assert "new CustomEvent('dashbridge-theme-change'" in THEME_RUNTIME, "theme runtime does not notify DashBridge"
print("PASS DashBridge iframe theme contract")
