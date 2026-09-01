"""Static audit for postMessage calls that can race iframe navigation."""
from pathlib import Path
from support.smoke import run_checks


ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "dashbridge": (ROOT / "pages/dashbridge/dashbridge.js").read_text(encoding="utf-8")
        + (ROOT / "pages/dashbridge/dashbridge-time-controller.js").read_text(encoding="utf-8")
        + (ROOT / "pages/dashbridge/dashbridge-iframe-message-controller.js").read_text(encoding="utf-8"),
    "iframe": (ROOT / "js/content/grafana-iframe.js").read_text(encoding="utf-8"),
    "content": (ROOT / "js/content/content.js").read_text(encoding="utf-8"),
    "inject": (ROOT / "js/content/inject.js").read_text(encoding="utf-8"),
}


checks = {
    "dashboard has one guarded postMessage wrapper": "function post(iframe, message)" in FILES["dashbridge"],
    "dashboard waits for iframe readiness": "iframe.dataset.dashbridgeLoaded !== 'true'" in FILES["dashbridge"],
    "dashboard has no wildcard origin fallback": "return '*';" not in FILES["dashbridge"],
    "dashboard clears ready state before navigation": "iframe.dataset.dashbridgeLoaded = 'false';" in FILES["dashbridge"],
    "dashboard handles a navigation race": "iframe.contentWindow.postMessage(message, targetOrigin);" in FILES["dashbridge"]
        and "catch" in FILES["dashbridge"],
    "dashboard waits for an iframe ready signal": "event.data.action === 'dashbridgeIframeReady'" in FILES["dashbridge"],
    "iframe sends a ready signal from the Grafana document": "action: 'dashbridgeIframeReady'" in FILES["iframe"],
    "iframe accepts time updates only from its extension origin": "if (event.origin !== extensionOrigin) return;" in FILES["iframe"],
    "iframe accepts commands only from its parent": FILES["iframe"].count("event.source !== window.parent") >= 2,
    "dashboard sends current time after readiness": "type: 'DASHBRIDGE_TIME_UPDATE'" in FILES["dashbridge"],
    "iframe posts only to the extension origin": "}, extensionOrigin);" in FILES["iframe"],
    "content script posts to its current origin": "}, window.location.origin);" in FILES["content"],
    "injected script posts to its current origin": "}, window.location.origin);" in FILES["inject"],
}

run_checks(checks)
