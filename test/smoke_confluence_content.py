"""Smoke test for the Confluence content-script to MAIN-world bridge."""
from support.smoke import read, require_all


if __name__ == "__main__":
    try:
        manifest = read("manifest.json")
        content = read("js/content/content.js")
        inject = read("js/content/inject.js")
        require_all(manifest, ['"js/content/content.js"', '"js/content/inject.js"'], "manifest.json")
        require_all(content, ['confluenceScrollFixEnabled', 'SET_CONFLUENCE_FIX', 'INJECT_READY'], "js/content/content.js")
        require_all(inject, ['SET_CONFLUENCE_FIX', 'INJECT_READY', 'function(options)'], "js/content/inject.js")
    except AssertionError as error:
        raise SystemExit(f"[FAIL] Confluence content bridge: {error}")
    print("[OK] Confluence content bridge")
