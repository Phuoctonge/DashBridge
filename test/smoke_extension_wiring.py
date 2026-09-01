"""Checks that the manifest, pages and injected scripts stay connected."""
import json
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))


def exists(relative_path):
    return (ROOT / relative_path).is_file()


content_scripts = [path for entry in MANIFEST["content_scripts"] for path in entry["js"]]
resources = [path for entry in MANIFEST["web_accessible_resources"] for path in entry["resources"]]
pages = [MANIFEST["action"]["default_popup"], MANIFEST["options_ui"]["page"]]
icons = list(MANIFEST["icons"].values())

checks = {
    "Manifest is MV3": MANIFEST.get("manifest_version") == 3,
    "Service worker exists": exists(MANIFEST["background"]["service_worker"]),
    "Popup and options pages exist": all(exists(page) for page in pages),
    "All declared content scripts exist": all(exists(path) for path in content_scripts),
    "All web-accessible resources exist": all(exists(path) for path in resources),
    "All extension icons exist": all(exists(path) for path in icons),
    "Content bridge and Grafana defaults are injected at document start": any(
        "js/content/content.js" in entry["js"]
        and entry["js"].index("js/shared/grafana-settings.js") < entry["js"].index("js/content/content.js")
        and entry.get("run_at") == "document_start"
        for entry in MANIFEST["content_scripts"]
    ),
    "Grafana iframe bridge runs in all frames": any(
        entry["js"][-1:] == ["js/content/grafana-iframe.js"] and entry.get("all_frames")
        for entry in MANIFEST["content_scripts"]
    ),
    "Required Chrome capabilities are declared": {"storage", "tabs", "scripting", "downloads"}.issubset(MANIFEST["permissions"]),
    "Only Batch loads the shared Grafana command runner":
        'js/shared/grafana-command.js' in (ROOT / "pages/batch/batch.html").read_text(encoding="utf-8")
        and 'js/shared/grafana-command.js' not in (ROOT / "pages/popup/popup.html").read_text(encoding="utf-8"),
    "All interactive pages load canonical shared UI theme": all(
        '../shared/theme.css' in (ROOT / page).read_text(encoding="utf-8")
        for page in ("pages/popup/popup.html", "pages/batch/batch.html", "pages/dashbridge/dashbridge.html")
    ),
}

run_checks(checks)
