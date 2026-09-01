"""Regression guards for remount-safe Grafana state and observer ownership."""
from pathlib import Path
from support.smoke import run_checks

ROOT = Path(__file__).resolve().parent.parent
tools = (ROOT / "js/content/grafana-panel-tools.js").read_text(encoding="utf-8")
state = (ROOT / "js/content/grafana-panel-state.js").read_text(encoding="utf-8")
dashboard = (ROOT / "pages/dashbridge/dashbridge.js").read_text(encoding="utf-8") + (ROOT / "pages/dashbridge/dashbridge-profile-controller.js").read_text(encoding="utf-8")
dashboard_capture = (ROOT / "pages/dashbridge/dashbridge-capture.js").read_text(encoding="utf-8")
renderer = (ROOT / "pages/dashbridge/dashbridge-renderer.js").read_text(encoding="utf-8")
batch = (ROOT / "pages/batch/batch.js").read_text(encoding="utf-8") \
    + (ROOT / "pages/batch/batch-page-controller.js").read_text(encoding="utf-8") \
    + (ROOT / "pages/batch/batch-main-run-controller.js").read_text(encoding="utf-8") \
    + (ROOT / "pages/batch/batch-series-discovery-controller.js").read_text(encoding="utf-8") \
    + (ROOT / "pages/batch/batch-series-run-controller.js").read_text(encoding="utf-8") \
    + (ROOT / "pages/batch/batch-operation-controller.js").read_text(encoding="utf-8")
runner = (ROOT / "pages/batch/batch-capture-runner.js").read_text(encoding="utf-8")
layout = (ROOT / "js/content/grafana-compact-layout.js").read_text(encoding="utf-8")
visual_engine = (ROOT / "js/content/grafana-visual-engine.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-legend-visuals.js").read_text(encoding="utf-8") \
    + (ROOT / "js/content/grafana-series-styles.js").read_text(encoding="utf-8")
checks = {
    "Panel state is keyed independently of DOM node": "const states" in state and "keyFor" in state,
    "Remounted canvas reapplies saved visual state": "restorePanelVisualState" in tools and "__dashbridgeVisualCanvas" in tools,
    "Dashboard archive capture has a single sequential owner": "let archiveCaptureInProgress" in dashboard_capture
        and "for (let index = 0; index < activePanels.length; index += 1)" in dashboard_capture,
    "Iframe resize jiggle is disabled for the layout experiment": "jiggleDashboardFrameWidth" not in dashboard
        and "dashbridgeJiggle" not in dashboard,
    "Batch capture window has an owner": "createBatchCaptureWindowRunner" in runner and "captureWindowRunner.acquire" in batch and "captureWindowRunner.release" in batch,
    "DashBridge has a rendering boundary": "const DashBridgeRenderer" in renderer and "renderProfileList" in renderer and "renderer.renderProfileList" in dashboard,
    "Panel-local capture shares layout restoration": "const layout = window.DashBridgeGrafanaCompactLayout;" in tools
        and "restoreFlot" in layout and "restoreUPlot" in layout,
    "Panel-local capture delegates Flot and uPlot layout work": "redrawFlot" in layout
        and "rememberUPlotSize" in layout and "layout?.redrawFlot" in tools and "layout?.resizeUPlot" in tools,
    "Batch page has no unreachable capture-window fallback": "captureWindowId" not in batch,
    "Batch page has no local legacy panel loader": "async function loadUrlAndWaitForPanel" not in batch,
    "Batch state persistence has a dedicated module": (ROOT / "pages/batch/batch-state.js").exists()
        and "pageState: BatchPageState" in batch and "pageState.restore()" in batch,
    "Visual toggles always run restoration after a fast legend update": "if (result && !removeFill && !thickenLines && !invertLegend) return result;" not in visual_engine,
    "Legend position restores after the toggle is disabled": "hasSavedLegendLayout" in visual_engine
        and "delete element[legendLayoutSnapshotKey];" in visual_engine,
    "Fill removal uses the local uPlot path after legend restoration": "if (hasSavedLegendLayout) {\n                    await applyPopupLegendAndVisuals" in visual_engine
        and "stopLegacyVisualObservers(root);\n                const result = applyLocalSeriesStyles({ root, removeFill, thickenLines, thickenLinesValue });" in visual_engine,
    "Style-only fill changes remove stale visual observers": "const stopLegacyVisualObservers = root =>" in visual_engine
        and "node.__dashBridgeObserver?.disconnect?.();" in visual_engine,
    "Line thickness bypasses layout resize when legend is unchanged": "const applyLocalSeriesStyles = ({ root = document, removeFill = false, thickenLines = false" in visual_engine
        and "if (!seriesConfig && !invertLegend) {" in visual_engine
        and "configureLocalSeriesStyleGuard({ root, removeFill, thickenLines, thickenLinesValue });" in visual_engine,
    "Narrow lower legends preserve graph height and metrics": "branch.style.setProperty('min-height', '0', 'important');" in visual_engine
        and "branch.style.setProperty('flex', '0 1 35%', 'important');" in visual_engine
        and "legendElement.style.setProperty('overflow-x', 'hidden', 'important');" in visual_engine,
    "Narrow lower legends give the chart host an explicit usable width": "chartHost.style.setProperty('width', '100%', 'important');" in visual_engine,
    "Narrow lower legends make names yield to metric columns": ".dashbridge-legend-bottom tr > :first-child" in visual_engine
        and ".dashbridge-legend-bottom tr > :not(:first-child)" in visual_engine
        and "display:flex !important" in visual_engine
        and "flex:1 1 0% !important" in visual_engine
        and "flex:0 0 48px !important" in visual_engine
        and "text-align:right !important" in visual_engine,
    "Legend-only layout has no persistent size observer": "const watchLegendLayoutSize" not in visual_engine
        and "__dashbridgeLegendLayoutObserver" not in visual_engine,
    "Legend relocation retains its original direction across reapplies": "__dashBridgeLegendOriginalDirection" in visual_engine,
    "Grafana right-legend panels always relocate below": "graph-panel--legend-right" in visual_engine,
    "Legend relocation waits for two committed frames before sizing uPlot": "await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));" in visual_engine
        and "const uplotResizedAfterLegendLayout = await resizeUPlotAfterLegendLayout();" in visual_engine,
    "Persistent legend refresh avoids redundant iframe resize": "layoutAlreadyApplied" in visual_engine
        and "layoutChanged: false" in visual_engine
        and "if (legendLayout?.layoutChanged || uplotResizedAfterLegendLayout)" in visual_engine,
    "Visual engine has an origin for parent resize messages": "const extensionOrigin = new URL(location.ancestorOrigins?.[0] || document.referrer || location.href).origin;" in visual_engine,
}
run_checks(checks)
