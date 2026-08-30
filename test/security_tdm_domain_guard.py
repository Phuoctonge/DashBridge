"""Regression guard for the TDM export domain check."""

from pathlib import Path
from support.smoke import CheckCollector


ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "pages/popup/popup-tdm.js").read_text(encoding="utf-8")


check = CheckCollector()


check(
    "TDM domain check does not use substring matching",
    "tabs[0].url.includes(settings.tdmDomain)" not in SOURCE,
)
check("Active tab URL is parsed", "activeUrl = new URL(tabs[0].url)" in SOURCE)
check("Configured TDM URL is parsed", "tdmUrl = new URL(" in SOURCE)
check(
    "TDM hostname must match exactly",
    "activeUrl.hostname.toLowerCase() !== tdmUrl.hostname.toLowerCase()" in SOURCE,
)
check.finish()
