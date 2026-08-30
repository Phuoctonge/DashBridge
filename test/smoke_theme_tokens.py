"""Guard the shared light/dark token contract for extension UI pages."""
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent.parent
THEME = (ROOT / "css" / "theme.css").read_text(encoding="utf-8")

TOKENS = [
    "--surface",
    "--surface-raised",
    "--text-on-primary",
    "--status-danger-bg",
    "--status-warning-bg",
    "--status-success-bg",
]

for token in TOKENS:
    root_index = THEME.find(":root")
    dark_index = THEME.find('[data-theme="dark"]')
    assert root_index >= 0 and token in THEME[root_index:dark_index], f"missing light token {token}"
    assert dark_index >= 0 and token in THEME[dark_index:], f"missing dark token {token}"
    print(f"  PASS {token} exists in both themes")

for stylesheet in ("css/popup.css", "pages/options/options.css", "pages/worklog/worklog.css", "pages/batch/batch.css", "pages/dashbridge/dashbridge.css"):
    css = (ROOT / stylesheet).read_text(encoding="utf-8")
    assert not re.search(r"background(?:-color)?\s*:\s*#fff(?:\s*!important)?\s*;", css), (
        f"{stylesheet} still hard-codes a white surface"
    )
    assert not re.search(r"background\s*:\s*white\s*;", css), f"{stylesheet} still hard-codes a white surface"
    print(f"  PASS {stylesheet} uses tokenized surfaces")
