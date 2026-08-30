"""Regression contract for shared extension visual styles."""
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent.parent
THEME = (ROOT / "css" / "theme.css").read_text(encoding="utf-8")
DASHBRIDGE_CSS = (ROOT / "pages" / "dashbridge" / "dashbridge.css").read_text(encoding="utf-8")

for token in (
    "--font-size-page-title: 1.375rem;",
    "--font-weight-page-title: 800;",
    "--font-size-section-title: 1rem;",
    "--font-weight-section-title: 700;",
    "--tab-hover-bg:",
    "--tab-active-bg:",
    "--tab-active-text:",
):
    assert token in THEME, f"missing shared token {token}"

for stylesheet in ("css/popup.css", "pages/batch/batch.css"):
    css = (ROOT / stylesheet).read_text(encoding="utf-8")
    assert "var(--tab-hover-bg)" in css, f"{stylesheet} misses tab hover token"
    assert "var(--tab-active-bg)" in css, f"{stylesheet} misses tab active token"

popup = (ROOT / "css" / "popup.css").read_text(encoding="utf-8")
popup_html = (ROOT / "html/popup.html").read_text(encoding="utf-8")
assert "#f8fafc" not in popup, "Popup retains a light-only hover surface"
assert "#f1f6ff" not in popup, "Popup retains a light-only active surface"

assert popup_html.count('class="subnav-row"') == 1, "Grafana subtabs must remain in one compact row"
grafana_subnav_rule = re.search(r"\.grafana-subnav\s*\{(?P<body>.*?)\n\s*\}", popup, re.DOTALL)
assert grafana_subnav_rule, "Popup must define the Grafana subtab bar"
assert "background: transparent" in grafana_subnav_rule.group("body"), (
    "Grafana subtabs must not regain a separate card surface"
)
assert "border: 0" in grafana_subnav_rule.group("body"), (
    "Grafana subtabs must not regain an outer card border"
)

tab_button_rule = re.search(r"\.tab-btn\s*\{(?P<body>.*?)\n\s*\}", popup, re.DOTALL)
assert tab_button_rule, "Popup must define the main tab button style"
assert "cursor: pointer" in tab_button_rule.group("body"), "Popup tabs must use a pointer cursor"

dashbridge = (ROOT / "pages" / "dashbridge" / "dashbridge.css").read_text(encoding="utf-8")
assert ":root" not in dashbridge, "DashBridge retains a page-local token root"

options = (ROOT / "pages/options/options.html").read_text(encoding="utf-8")
assert 'style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;"' not in options, (
    "Options retains visual inline layout"
)

light_theme = THEME[THEME.index(":root {"):THEME.index('[data-theme="dark"]')]
assert "--header-bg: #ffffff;" in light_theme, "Light header surface must be opaque"
assert "header {" in DASHBRIDGE_CSS and "background-color: var(--header-bg);" in DASHBRIDGE_CSS, (
    "DashBridge header must use the dedicated header surface"
)

fullscreen_actions = re.search(r"\.panel-card\.fullscreen \.panel-actions\s*\{(?P<body>.*?)\n\}", DASHBRIDGE_CSS, re.DOTALL)
assert fullscreen_actions, "Fullscreen actions must have a dedicated style"
assert "background-color: var(--bg-color);" in fullscreen_actions.group("body"), (
    "Fullscreen actions must use the same theme surface as normal panel actions"
)
assert "rgba(0, 0, 0, 0.55)" not in fullscreen_actions.group("body"), (
    "Fullscreen actions must not force a dark-only background"
)

print("PASS visual style contract")
