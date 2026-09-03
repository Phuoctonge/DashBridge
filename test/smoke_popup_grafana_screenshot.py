"""Smoke test for panel-local Grafana screenshot controls."""
from html.parser import HTMLParser

from support.smoke import read, run_checks


class DivBalanceParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.minimum_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "div":
            self.depth += 1

    def handle_endtag(self, tag):
        if tag == "div":
            self.depth -= 1
            self.minimum_depth = min(self.minimum_depth, self.depth)


if __name__ == "__main__":
    popup = read("pages/popup/popup.html")
    tools = read("js/content/grafana-panel-tools.js") + read("js/content/grafana-panel-capture-runtime.js") \
        + read("js/content/grafana-panel-menu-runtime.js")
    dashboard = read("pages/dashbridge/dashbridge.js") + read("pages/dashbridge/dashbridge-iframe-message-controller.js")
    dashboard_capture = read("pages/dashbridge/dashbridge-capture.js")
    content = read("js/content/content.js")
    background = read("js/background.js")
    output = read("js/shared/grafana-capture-output.js")
    layout = read("js/content/grafana-compact-layout.js")
    manifest = read("manifest.json")
    checks = {
        "legacy popup screenshot entry is removed": 'data-sub="grafana-panel-screenshot"' not in popup
            and 'popup-grafana-capture.js' not in popup,
    "panels expose download and clipboard buttons": tools.count("dashbridge-panel-capture-action") >= 3
            and "runPanelCapture(panel, 'download'" in tools and "runPanelCapture(panel, 'copy'" in tools,
    "panel screenshots retain threshold highlight overlays":
            "data-dashbridge-threshold-highlights" in tools
            and "syncThresholdHighlightState(captureFrame, captureVisualState)" in tools
            and "syncThresholdHighlightState(outer, captureVisualState)" in tools,
        "prepared size is a global synchronized toolbar toggle": 'capturePrepared' in tools
            and 'dashbridge-panel-capture-toggle' in tools
            and "host.append(preparedToggle, download, copy)" in tools
            and "host.append(trigger)" in tools
            and 'dashbridgeCapturePreparedChanged' in dashboard
            and 'grafanaCompactScreenshot' in dashboard
            and 'syncAllPanelCaptureToggles' in tools
            and 'grafanaCompactExportWidth' in read("js/shared/grafana-settings.js")
            and 'panelCaptureDimensions' in tools
            and 'getCompactCaptureDimensions' in dashboard
            and 'Подготовить снимок 1000×520' not in read("js/shared/grafana-panel-settings-modal.js"),
        "native Grafana uses a bounded temporary layout": "const prepareNativePanelCapture" in tools
            and "fitPreparedSize" in tools and "session?.restore?.()" in tools,
        "DashBridge expands and restores its exact card": "const capturePanel = async" in dashboard_capture
            and "captureSnapshot?.forEach" in dashboard_capture and "dashbridgePanelCaptureResult" in dashboard_capture,
        "iframe is explicitly reflowed around capture": "dashbridgeCaptureLayoutChanged" in dashboard_capture
            and "dashbridgeCaptureLayoutChanged" in read("js/content/grafana-iframe.js"),
        "capture output crops at device pixel ratio": "const crop = async" in output
            and "rect?.dpr" in output and "drawImage" in output,
        "native capture uses the background tab authority": "dashbridge-capture-visible-tab" in content
            and "dashbridge-capture-visible-tab" in background,
        "clipboard writes from the focused Grafana document": "captureOutput.copy(image.blob)" in content
            and '"clipboardWrite"' in manifest and '"offscreen"' not in manifest
            and "copyPanelCaptureInOffscreenDocument" not in background,
        "uPlot and Flot retain explicit resize restoration": "restoreUPlot" in layout and "restoreFlot" in layout,
    }
    parser = DivBalanceParser()
    parser.feed(popup)
    checks["popup HTML has balanced div containers"] = parser.depth == 0 and parser.minimum_depth >= 0
    run_checks(checks)
