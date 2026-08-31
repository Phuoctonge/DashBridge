"""Regression contract for Grafana iframe theme selection in DashBridge."""
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = (ROOT / "pages" / "dashbridge" / "dashbridge.js").read_text(encoding="utf-8")
TIME_CONTROLLER = (ROOT / "pages" / "dashbridge" / "dashbridge-time-controller.js").read_text(encoding="utf-8")
THEME_RUNTIME = (ROOT / "pages" / "shared" / "theme.js").read_text(encoding="utf-8")

for required in (
    "const resolveTheme = panel =>",
    "panel?.grafanaTheme || 'follow'",
    "id=\"iframeSettingsTheme\"",
    "value=\"follow\"",
    "Как в DashBridge",
    "value=\"light\"",
    "value=\"dark\"",
    "panel.grafanaTheme = overlay.querySelector('#iframeSettingsTheme').value",
    "url.searchParams.set('theme', resolveTheme(panel))",
    "windowRef.addEventListener('dashbridge-theme-change'",
):
    assert required in DASHBOARD + TIME_CONTROLLER, f"missing iframe theme contract: {required}"

assert "new CustomEvent('dashbridge-theme-change'" in THEME_RUNTIME, "theme runtime does not notify DashBridge"
print("PASS DashBridge iframe theme contract")
