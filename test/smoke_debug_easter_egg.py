"""Regression contract for the local debug-warning Easter egg."""

from pathlib import Path

from support.smoke import ROOT, read, run_popup_contract


if __name__ == "__main__":
    controller = read("js/popup/popup-debug-easter-egg.js")
    run_popup_contract(
        "debug Easter egg",
        html=[
            'id="debugFreshCodeEasterEgg"',
            'id="freshCodeNotice"',
            'id="freshCodeNoticeText"',
        ],
        sources={
            "js/popup/popup-debug-easter-egg.js": [
                "debugFreshCodeEasterEgg",
                "chrome.windows.create",
                "pages/debug-easter-egg/debug-easter-egg.html",
                "updateNoticeMode",
                "freshCodeNotice",
            ],
        },
    )
    window_html = read("pages/debug-easter-egg/debug-easter-egg.html")
    for marker in ('id="debugEasterEggClear"', 'id="debugEasterEggTarget"', 'id="debugEasterEggPortrait"', 'id="debugEasterEggFile"', 'id="debugEasterEggHint"', '.jpeg', '.avif'):
        if marker not in window_html:
            raise SystemExit(f"[FAIL] missing Easter egg window markup: {marker}")
    window_controller = read("pages/debug-easter-egg/debug-easter-egg.js")
    for marker in ("resetSplats", "requestAnimationFrame", "createImpactSplat", "animateProjectile", "spriteSources", "cache-", "throwGeneration", "poop.width = pixelSize", "poop.height = pixelSize", "randomAngle", "impactRotation", "flightRotation", "spriteBag", "shuffleSprites", "decodeAsset", "fetch(chrome.runtime.getURL", "URL.createObjectURL", "resizeWindowForImage", "chrome.windows.getCurrent", "screen.availWidth", "debugEasterEggFile", "debugEasterEggHint", "headerHeight", "imageScale", "portrait.draggable = false", "dragstart", "event.preventDefault", "requestedScale", "dataset.uiScale"):
        if marker not in window_controller:
            raise SystemExit(f"[FAIL] missing Easter egg window behavior: {marker}")
    for index in range(1, 10):
        if not (ROOT / f"pages/debug-easter-egg/assets/cache-{index:02d}.txt").is_file():
            raise SystemExit(f"[FAIL] missing disguised Easter egg asset {index}")
    if (ROOT / "pages/debug-easter-egg/assets/cache-00.txt").exists():
        raise SystemExit("[FAIL] default Easter egg portrait must not be packaged")
    if (ROOT / "assets/debug-easter-egg-portrait.png").exists() or list((ROOT / "assets").glob("new_poop_*.png")):
        raise SystemExit("[FAIL] unobscured Easter egg PNG assets must not remain")
    combined_code = controller + window_controller
    if "XMLHttpRequest" in combined_code or "chrome.storage" in combined_code or "localStorage" in combined_code:
        raise SystemExit("[FAIL] Easter egg must not use the network or persisted state")
    if "fetch(" in combined_code and "fetch(chrome.runtime.getURL" not in combined_code:
        raise SystemExit("[FAIL] Easter egg may fetch only its packaged local assets")
    if "portraitSource" in window_controller:
        raise SystemExit("[FAIL] Easter egg must not load a default portrait")
    if "document.documentElement.scrollHeight" in window_controller:
        raise SystemExit("[FAIL] image window must use explicit image dimensions, not unreliable document scroll height")
    styles = read("pages/debug-easter-egg/debug-easter-egg.css")
    for marker in (".debug-easter-egg-window", ".debug-easter-egg-target", ".debug-easter-egg-actions", "width: 40rem", "max-width: calc(100vw - 2rem)", "-webkit-user-drag: none", ".debug-easter-egg-target > img[hidden]", "display: none !important", "flex-direction: column", "flex-wrap: wrap"):
        if marker not in styles:
            raise SystemExit(f"[FAIL] missing Easter egg style: {marker}")
    popup_styles = read("css/popup.css")
    if "text-decoration: none" not in popup_styles:
        raise SystemExit("[FAIL] debug warning link must look like ordinary text")
    print("[OK] debug Easter egg stays local and isolated")
