"""Checks the shared theme runtime used by every extension page."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
THEME = (ROOT / "js/theme.js").read_text(encoding="utf-8")
PAGES = ["html/popup.html", "html/options.html", "html/dashbridge.html", "html/batch.html", "html/worklog.html"]


checks = {
    "theme applies to the document root": "document.documentElement.setAttribute('data-theme', theme)" in THEME,
    "theme preference is synchronized": "chrome.storage.sync.set({ [SYNC_KEY]: newTheme })" in THEME,
    "new installations default to the light theme": "let cached = 'light'" in THEME
        and "localStorage.getItem(STORAGE_KEY) || 'light'" in THEME,
    "theme reacts to changes from other pages": "chrome.storage.onChanged.addListener" in THEME,
    "theme button remains keyboard-native": "btn.addEventListener('click', toggleTheme)" in THEME,
    "all extension pages load the shared runtime": all(
        '<script src="../js/theme.js"></script>' in (ROOT / page).read_text(encoding="utf-8") for page in PAGES
    ),
}

run_checks(checks)
