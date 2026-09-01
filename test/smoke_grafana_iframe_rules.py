"""Regression checks for the scoped Grafana iframe DNR allowlist."""

from pathlib import Path
from support.smoke import CheckCollector


ROOT = Path(__file__).resolve().parent.parent
OPTIONS_HTML = (ROOT / "pages/options/options.html").read_text(encoding="utf-8")
OPTIONS_JS = (ROOT / "pages/options/options.js").read_text(encoding="utf-8")
BACKGROUND = (ROOT / "js/background.js").read_text(encoding="utf-8")
INFRASTRUCTURE = (ROOT / "js/background-grafana-infrastructure.js").read_text(encoding="utf-8")
MANIFEST = (ROOT / "manifest.json").read_text(encoding="utf-8")
CONTENT = (ROOT / "js/content/content.js").read_text(encoding="utf-8")
PANEL_TOOLS = (ROOT / "js/content/grafana-panel-tools.js").read_text(encoding="utf-8")
DNR_RULES = (ROOT / "js/shared/dnr-rules.js").read_text(encoding="utf-8")


check = CheckCollector()


check("Options exposes the Grafana iframe allowlist", 'id="settingGrafanaIframeDomains"' in OPTIONS_HTML)
check("Options explain the shared Grafana domain scope", "Укажите домены корпоративных Grafana для встраивания в <strong>Единый дашборд Grafana</strong> и использования инструментов DashBridge на панелях." in OPTIONS_HTML)
check("Options stores normalized Grafana hosts", "parseGrafanaIframeDomains" in OPTIONS_JS and "grafanaIframeDomains:" in OPTIONS_JS)
check("Content publishes Grafana menu scope from the allowlist", "dashbridgeGrafanaMenuEnabled" in CONTENT and "grafanaIframeDomains" in CONTENT)
check("Content exposes the extension icon only inside the Grafana allowlist", "syncGrafanaIconUrl(allowed)" in CONTENT
      and "if (allowed) document.documentElement.dataset.dashbridgeIconUrl" in CONTENT)
check("Grafana menu honors the published domain scope", "document.documentElement.dataset.dashbridgeGrafanaMenuEnabled === 'true'" in PANEL_TOOLS)
check("Background builds session rules from the allowlist", "const syncRules = async () =>" in INFRASTRUCTURE and "updateSessionRules" in INFRASTRUCTURE)
check("Background serializes DNR rule sync requests", "const queueRulesSync = () =>" in INFRASTRUCTURE)
check("Unchanged MAIN registration is not torn down", "return { matchCount: matches.length, unchanged: true };" in INFRASTRUCTURE)
check("Install, startup and settings changes synchronize runtime before DNR", BACKGROUND.count("grafanaInfrastructure.sync({ backfillOpenFrames: true })") == 3
      and "const registration = await queueRegistrationSync();" in INFRASTRUCTURE
      and "const backfill = shouldBackfill" in INFRASTRUCTURE
      and "const rules = await queueRulesSync();" in INFRASTRUCTURE)
check("Failed GUI capture removes its temporary window", "await chromeRef.windows.remove(captureWindow.id).catch(() => undefined);" in (ROOT / "js/background-gui-capture.js").read_text(encoding="utf-8"))
check("Rules are scoped to subframes", "resourceTypes: ['sub_frame']" in DNR_RULES)
check("Rules use a host anchor instead of a global filter", "urlFilter: `||${host}/`" in DNR_RULES)
check("Rules are restricted to DashBridge tab IDs", "tabIds: [tabId]" in DNR_RULES)
check("Manifest has no static DNR rule resource", '"declarative_net_request"' not in MANIFEST)
check.finish()
