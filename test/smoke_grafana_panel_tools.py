"""Smoke test for the shared Grafana MAIN-world implementation."""
from pathlib import Path
import json
from support.smoke import run_checks

ROOT = Path(__file__).resolve().parent.parent
COMMON = (ROOT / "js/content/grafana-panel-tools.js").read_text(encoding="utf-8")
PANEL_STATE = (ROOT / "js/content/grafana-panel-state.js").read_text(encoding="utf-8")
VISUAL_ENGINE = (ROOT / "js/content/grafana-visual-engine.js").read_text(encoding="utf-8")
PANEL_DEFINITION = (ROOT / "js/content/grafana-panel-definition.js").read_text(encoding="utf-8")
CPU_CAPACITY_FILTER = (ROOT / "js/content/grafana-cpu-capacity-filter.js").read_text(encoding="utf-8")
DASHBOARD = (ROOT / "js/pages/dashbridge.js").read_text(encoding="utf-8")
IFRAME = (ROOT / "js/content/grafana-iframe.js").read_text(encoding="utf-8")
POPUP = (ROOT / "popup.html").read_text(encoding="utf-8")
OPTIONS = (ROOT / "js/pages/options.js").read_text(encoding="utf-8")
LEGEND_ENGINE = (ROOT / "js/shared/grafana-legend-engine.js").read_text(encoding="utf-8")
BRIDGE = (ROOT / "js/shared/grafana-panel-tools-bridge.js").read_text(encoding="utf-8")
COMMAND = (ROOT / "js/shared/grafana-command.js").read_text(encoding="utf-8")
PANEL_SETTINGS = (ROOT / "js/shared/grafana-panel-settings-modal.js").read_text(encoding="utf-8")
LEGEND_SELECTION = (ROOT / "js/shared/grafana-legend-selection.js").read_text(encoding="utf-8")
CONTENT = (ROOT / "js/content/content.js").read_text(encoding="utf-8")
DEBUG = (ROOT / "js/popup/popup-grafana-debug.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
main_content = next(entry["js"] for entry in MANIFEST["content_scripts"] if "js/content/content.js" in entry["js"])
BACKGROUND = (ROOT / "js/background.js").read_text(encoding="utf-8")
NATIVE_PANEL_SETTINGS = COMMON.split("const openPanelSettings", 1)[1] if "const openPanelSettings" in COMMON else ""
NATIVE_THRESHOLD_TOAST = COMMON.split("const showNativeThresholdToast", 1)[1].split("const renderNativeThresholdFeedback", 1)[0] if "const showNativeThresholdToast" in COMMON else ""
LEGEND_DATA_FILTER = COMMON.split("const filterLegendData", 1)[1].split("const calculatedTitleOriginalText", 1)[0] if "const filterLegendData" in COMMON else ""
SERIES_THRESHOLD_FILTER = COMMON.split("const filterSeriesByThreshold", 1)[1].split("const getFieldLegendNames", 1)[0] if "const filterSeriesByThreshold" in COMMON else ""
UPLOT_FAST_FILTER = VISUAL_ENGINE.split("const applyUPlotFastCompleteHide", 1)[1].split("const getUPlotYScaleKey", 1)[0] if "const applyUPlotFastCompleteHide" in VISUAL_ENGINE else ""

checks = {
    "shared CPU transformation": "const transformCpuData" in COMMON,
    "shared RAM transformation": "const transformMemData" in COMMON,
    "RAM conversion reset restores byte units": "const restoreMemByteUnit" in COMMON
        and "unit: 'bytes'" in COMMON
        and "if (!tools.convertMemToUsed && tools.forceMemByteUnit) restoreMemByteUnit(scopedData);" in COMMON,
    "existing disabled Memory panels migrate to byte units": "const isMemoryPanel" in DASHBOARD
        and "(!saved.convertMemToUsed && isMemoryPanel)" in DASHBOARD,
    "complete-hide filters query data before render": "const filterLegendData" in COMMON
        and "legendSelection.filterDataFrames(data, tools, getFrameLegendNames)" in COMMON
        and "state?.legendMode === 'fast_complete_hide'" in LEGEND_SELECTION,
    "complete-hide interceptor runs for a legend-only filter": "const hasDataTransform" in COMMON
        and "hasDataTransform()" in COMMON,
    "DashBridge serializes the complete-hide filter before iframe navigation": "applyPanelLegendFilterToUrl" in DASHBOARD
        and "dashbridgeLegendFilter" in DASHBOARD,
    "DashBridge keeps the complete-hide filter out of request URLs": "url.hash = hashParams.toString();" in DASHBOARD
        and "url.searchParams.set(DASHBRIDGE_LEGEND_FILTER_PARAM" not in DASHBOARD
        and "new URLSearchParams(url.hash.slice(1)).get('dashbridgeLegendFilter')" in COMMON,
    "Dashboard refresh regenerates the iframe URL with the filter": "new URL(applyPanelParamsToUrl(panel, iframe.src))" in DASHBOARD,
    "Grafana reads the serialized filter at document start": "readBootstrapLegendFilter" in COMMON
        and "installDataInterceptor();" in COMMON,
    "complete-hide filter preserves time and drops empty frames": "field.type === 'time' || field.name === 'Time'" in COMMON
        and "fields.length > 1" in LEGEND_SELECTION,
    "complete-hide leaves Grafana variable responses intact": "if (!hasTimeField) return frame;" in LEGEND_SELECTION
        and "!hasTimeField || fields.length > 1" in LEGEND_SELECTION,
    "complete-hide filter can match legend labels": "getFrameLegendNames" in LEGEND_DATA_FILTER
        and "Object.values(field.labels || {})" in COMMON,
    "complete-hide filter can match frame-level legend names": "getFrameLegendNames" in LEGEND_DATA_FILTER,
    "shared Popup legend engine": "applyPopupLegendAndVisuals" in VISUAL_ENGINE,
    "shared Popup visual styling": "removeAreaFillArg" in VISUAL_ENGINE,
    "universal series threshold filter runs in the query pipeline": "const filterSeriesByThreshold" in COMMON
        and "filterSeriesByThreshold(scopedData).metrics;" in COMMON,
    "single response-level series filter has one state": "seriesQueryFilterEnabled" in COMMON
        and "seriesQueryFilterEnabled" in DASHBOARD,
    "response-level filter reads its own state": "tools.seriesQueryFilterEnabled" in SERIES_THRESHOLD_FILTER
        and "tools.seriesFilterEnabled" not in SERIES_THRESHOLD_FILTER,
    "legacy visual series filter is removed": "seriesFilterEnabled" not in COMMON
        and "seriesFilterEnabled" not in DASHBOARD
        and "seriesFilterEnabled" not in PANEL_SETTINGS,
    "native series filtering uses an exact selected-panel query scope": "const hasSourceSeriesFilterScope" in COMMON
        and "if (hasSourceSeriesFilterScope(targetRefIds)) {" in COMMON
        and "filterSeriesByThreshold(scopedData).metrics;" in COMMON,
    "native query scope survives Grafana template-variable substitution": "expressionMatchesTargetTemplate" in COMMON
        and "queryMatchesConfiguredTarget(configured, query.raw)" in COMMON
        and "'expr', 'datasource'" in PANEL_DEFINITION,
    "Grafana View scopes its first query without delayed retries": "const isTargetPanelView" in COMMON
        and "if (isTargetPanelView())" in COMMON
        and "setTimeout(() => controller.schedule()" not in VISUAL_ENGINE,
    "computed vCPU metadata binds before the native Flot data commit":
        "visualMetadata.seriesCpuCapacityEntries = collectCpuCapacityEntries(scopedData);" in COMMON
        and "syncResponseFilterPresentation(visualRoot);" in COMMON
        and "const cpuRows = syncCpuCapacityLegend(root, state);" in COMMON
        and "return syncThresholdHighlightState(root, state);" in COMMON,
    "source threshold evaluation does not allocate a filtered copy per field": ".filter(value => typeof value === 'number'" not in SERIES_THRESHOLD_FILTER,
    "source-filtered frames preserve native colours and mark exceedances without adding fields":
        "markThresholdHighlights" in SERIES_THRESHOLD_FILTER
        and "sourceFilterPalette" not in SERIES_THRESHOLD_FILTER,
    "threshold exceedances use a renderer overlay instead of Grafana companion series":
        "setSeriesThresholdHighlights" in VISUAL_ENGINE
        and "data-dashbridge-threshold-highlights" in VISUAL_ENGINE
        and "appendThresholdHighlightRuns" in VISUAL_ENGINE
        and "· превышение" not in COMMON,
    "threshold overlay survives Grafana renderer commits and follows viewport geometry":
        "(document.body || document.documentElement).appendChild(svg)" in VISUAL_ENGINE
        and "position:fixed" in VISUAL_ENGINE
        and "controller.mutationObserver.observe(document.documentElement" in VISUAL_ENGINE
        and "window.addEventListener('scroll', controller.viewportListener, true)" in VISUAL_ENGINE
        and "controller.stats.resizeEvents += 1" in VISUAL_ENGINE
        and "controller.schedule?.()" in VISUAL_ENGINE,
    "threshold overlay preserves series colours and follows native visibility":
        "series.lines?.show === false" in VISUAL_ENGINE
        and "series.show === false" in VISUAL_ENGINE
        and "appendThresholdHighlightRuns(svg, samples, color, strokeWidth)" in VISUAL_ENGINE
        and "dashbridgeThresholdDataUpdated" in VISUAL_ENGINE
        and "сохраняя цвет серии" in PANEL_SETTINGS,
    "threshold overlay remains thicker than the currently rendered series":
        "THRESHOLD_HIGHLIGHT_WIDTH_INCREMENT = 2" in VISUAL_ENGINE
        and "series.lines?.lineWidth" in VISUAL_ENGINE
        and "getThresholdHighlightStrokeWidth(series.width)" in VISUAL_ENGINE
        and "String(resolvedStrokeWidth)" in VISUAL_ENGINE
        and "const completeStyleApply = result =>" in VISUAL_ENGINE
        and "scheduleThresholdHighlightRender(root)" in VISUAL_ENGINE,
    "threshold overlay begins and ends at interpolated crossings between samples":
        "const buildThresholdHighlightSamples" in VISUAL_ENGINE
        and "(threshold - left.y) / delta" in VISUAL_ENGINE
        and "append(crossing(previous, current))" in VISUAL_ENGINE
        and VISUAL_ENGINE.count("buildThresholdHighlightSamples(") == 2,
    "uPlot threshold overlay includes the native plot-area offset":
        "getUPlotThresholdPlotOffset" in VISUAL_ENGINE
        and "overRect.left - rootRect.left" in VISUAL_ENGINE
        and "plotOffset.left + uplot.valToPos(time, xScaleKey, false)" in VISUAL_ENGINE
        and "plotOffset.top + uplot.valToPos(value, yScaleKey, false)" in VISUAL_ENGINE,
    "threshold overlay follows Grafana Solo selection from the painted legend":
        "getThresholdHighlightLegendVisibility" in VISUAL_ENGINE
        and "runtimeItem?.disabled === true" in VISUAL_ENGINE
        and "opacity < 0.6" in VISUAL_ENGINE
        and "thresholdHighlightLabelIsVisible" in VISUAL_ENGINE
        and "legendClickListener" in VISUAL_ENGINE
        and "changedNodes.some(touchesLifecycleRoot)" in VISUAL_ENGINE
        and "relevantMutationBatches" in VISUAL_ENGINE,
    "native Grafana scopes data filtering to the selected panel queries": "getPanelQuerySignaturesAsync" in PANEL_DEFINITION
        and "getTargetQueryRefIds" in COMMON and "getTargetLegendRefIds" in COMMON,
    "native Grafana legend scope ignores frame-level fallback names": "fieldNames: getFieldLegendNames(field)" in COMMON
        and "field.fieldNames.some(name => targetNames.has(name))" in COMMON,
    "visual uPlot and Flot threshold controllers are removed": "const applySeriesThreshold" not in VISUAL_ENGINE
        and "applySeriesThreshold" not in COMMON,
    "remounted target panel restores saved visual state and active query signatures":
        "const state = normalizePanelLegendState(panelVisualState?.get(panel))" in COMMON
        and "panel.__dashbridgeVisualState = state;" in COMMON
        and "const signatures = new Set(tools.targetQuerySignatures || []);" in COMMON
        and "getSourceFilterSignatures" not in COMMON,
    "source-filtered native panels do not repaint uPlot colours without visual work": "if (hasVisualWork(state))" in COMMON
        and "const hasVisualWork = (state = tools) =>" in COMMON,
    "temporary datasource debug globals are not shipped": "__dashbridgeLegendFilterDebug" not in COMMON
        and "__dashbridgeQueryScopeDebug" not in COMMON and "__dashbridgeLegendScopeDebug" not in COMMON,
    "universal series threshold is strictly greater than the entered value": "return value > threshold;" in SERIES_THRESHOLD_FILTER,
    "series filter converts its displayed unit to Grafana raw values": "seriesQueryFilterRawValue" in PANEL_SETTINGS
        and "seriesQueryFilterValue * factor" in PANEL_SETTINGS,
    "domain toggle is applied": "trimDomainEnabled" in COMMON,
    "calculated title covers CPU, RAM and Load Average and is restored":
        "tools.invertIdle || tools.convertMemToUsed || tools.cpuCapacityFilterEnabled" in COMMON
        and "const calculatedTitleOriginalText = new WeakMap()" in COMMON
        and "calculatedTitleOriginalText.delete(title)" in COMMON,
    "Dashboard sends shared command": "action: 'applyPanelTools'" in DASHBOARD,
    "Full reset restores canonical Grafana defaults": "chrome.storage.sync.set(getGrafanaSettingsDefaults())" in DEBUG,
    "Grafana menu scope falls back to canonical domains": "chrome.storage.sync.get(getGrafanaSettingsStorageKeys()" in CONTENT
        and "normalizeGrafanaSettings(data)" in CONTENT,
    "Content script loads canonical defaults first": "js/shared/grafana-settings.js" in main_content
        and main_content.index("js/shared/grafana-settings.js") < main_content.index("js/content/content.js"),
    "Dashboard exposes one response-level series filter": "key: 'seriesQueryFilter'" in PANEL_SETTINGS
        and "${key}Value" in PANEL_SETTINGS
        and "Фильтр отображаемых серий" in PANEL_SETTINGS
        and "Фильтр отображаемых серий (на уровне запросов)" not in PANEL_SETTINGS,
    "Both threshold filters expose independent persisted highlight switches":
        "seriesQueryFilterHighlightEnabled" in PANEL_SETTINGS
        and "cpuCapacityFilterHighlightEnabled" in PANEL_SETTINGS
        and PANEL_SETTINGS.count("Утолщать участки превышения") == 2
        and "seriesQueryFilterHighlightEnabled" in DASHBOARD
        and "cpuCapacityFilterHighlightEnabled" in DASHBOARD
        and "isSeriesThresholdHighlightEnabled" in COMMON
        and "highlightKind: 'series-query-filter'" in COMMON
        and "highlightKind: 'cpu-capacity-filter'" in CPU_CAPACITY_FILTER
        and "getEnabledSeriesThresholdHighlightRules" in COMMON,
    "vCPU filter exposes capacity in a dedicated legend column without renaming series":
        "__dashbridgeCpuCapacity" in CPU_CAPACITY_FILTER
        and "collectCpuCapacityEntries" in COMMON
        and "dashbridge-vcpu-legend-cell" in COMMON
        and "syncCpuCapacityLegend" in COMMON
        and "insertCpuCapacityLegendCell(headerRow, headerAnchor, 'vCPU', true)" in COMMON,
    "Dashboard exposes maximum and last-value series filter modes": "name=\"${key}Mode\" value=\"max\"" in PANEL_SETTINGS
        and "name=\"${key}Mode\" value=\"last\"" in PANEL_SETTINGS,
    "series threshold filter displays the detected unit": "panel-series-filter-unit" in PANEL_SETTINGS,
    "RAM percent conversion overrides the series filter unit": "const getSeriesFilterUnitText" in PANEL_SETTINGS
        and "'Единица: %'" in PANEL_SETTINGS,
    "Dashboard serializes the response-level series filter before iframe navigation": "dashbridgeSeriesQueryFilter" in DASHBOARD
        and "const bootstrapSeriesQueryFilter = readBootstrapSeriesFilter();" in COMMON
        and "dashbridgeSeriesFilter'" not in DASHBOARD,
    "Threshold settings expose an enabled-by-default notifications switch": "name=\"thresholdNotifyEnabled\"" in PANEL_SETTINGS
        and "Порог на графике" in PANEL_SETTINGS
        and "Уведомлять о превышении" in PANEL_SETTINGS
        and "notifyInput.disabled = !thresholdEnabled" in PANEL_SETTINGS
        and "thresholdNotifyEnabled: saved.thresholdNotifyEnabled !== false" in DASHBOARD,
    "Grafana and DashBridge refresh a threshold after the iframe layout changes": "refreshPanelThresholdLayout" in COMMON and "refreshPanelThresholdLayout" in DASHBOARD,
    "Both graph settings hosts use one panel-specific explanation": "Применяются только к этому графику." in PANEL_SETTINGS
        and "Применяются только к этому графику и сохраняются в текущем профиле." not in DASHBOARD,
    "DashBridge uses the shared visual engine": "DashBridgeGrafanaVisualEngine" in COMMON,
    "Popup CPU/RAM reports were removed after panel migration": "popup-grafana-cpu.js" not in POPUP
        and "popup-grafana-mem.js" not in POPUP
        and not (ROOT / "js/popup/popup-grafana-cpu.js").exists()
        and not (ROOT / "js/popup/popup-grafana-mem.js").exists(),
    "MAIN-world runtime is installed once": "__dashbridgePanelToolsRuntimeLoaded" in COMMON,
    "Panel tools do not install on non-Grafana pages": "const isGrafanaDashboardRoute" in COMMON
        and "if (!isGrafanaDashboardRoute && !isDashboardIframe) return;" in COMMON,
    "Shared command waits for the runtime": "panelToolsApplied" in COMMAND and "apply-timeout" in COMMAND,
    "Bridge contains no unreachable legacy command path": "Legacy implementation retained below" not in BRIDGE
        and BRIDGE.count("async function applySharedGrafanaPanelTools") == 1
        and "let targetTabId = tabId;" not in BRIDGE,
    "Shared command owns MAIN-world dispatch": "async function runGrafanaCommand" in COMMAND and "requestId" in COMMAND,
    "Visual engine classifies active work": "const hasVisualWork" in COMMON,
    "style-only work does not install a legend visibility controller": "const hasLegendVisibilityWork" in COMMON
        and COMMON.count("seriesConfig: hasLegendVisibilityWork(tools) ? seriesConfig : null") == 2
        and "seriesConfig: hasLegendVisibilityWork(nextState) ? seriesConfig : null" in COMMON,
    "Visual engine ignores an empty filter": "tools.legendFilter?.length" in COMMON,

    "Visual engine has structural readiness": "const isVisualEngineReady" in COMMON,
    "Visual engine waits for a non-zero canvas": "const canvasRect = canvas?.getBoundingClientRect?.();" in COMMON
        and "if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return false;" in COMMON,
    "Legend relocation breaks the zero-width canvas readiness cycle": "const isLegendLayoutReady = root =>" in COMMON
        and "if (!isVisualEngineReady(targetPanel, root)) {" in COMMON
        and "await applyLegendLayoutBeforeChart(targetPanel);" in COMMON,
    "Visual readiness observer avoids style-churn retries": "attributeFilter: ['class', 'width', 'height']" in COMMON,
    "Visual engine compares legend and chart series": "legendSeriesCount === chartSeriesCount" in COMMON,
    "Dashboard legend does not truncate after 500 series": ".slice(0, 500)" not in COMMON,


    "uPlot fast path uses Grafana native legend callback": "const applyUPlotNativeLegendVisibility" in VISUAL_ENGINE,
    "uPlot native path reads React legend items": "const getUPlotLegendRuntime" in VISUAL_ENGINE,
    "uPlot native path waits for committed legend state": "requestAnimationFrame" in VISUAL_ENGINE,
    "uPlot native path uses Solo plus selection": "nativeEvent: { ctrlKey" in VISUAL_ENGINE,

    "uPlot has an explicit fast complete-hide adapter": "const applyUPlotFastCompleteHide" in VISUAL_ENGINE,
    "uPlot fast click-toggle has a direct adapter": "mode === 'fast_click_toggle'" in VISUAL_ENGINE,
    "uPlot fast click-toggle dims instead of removing legend rows": "dashbridge-uplot-fast-dimmed" in VISUAL_ENGINE,
    "uPlot fast complete-hide preserves hover events": "event.stopImmediatePropagation()" not in UPLOT_FAST_FILTER,
    "uPlot fast complete-hide leaves cursor state under uPlot control": "cursor.idxs" not in UPLOT_FAST_FILTER,
    "uPlot lower legend filtering does not scan table rows": "querySelectorAll('tbody tr')" not in UPLOT_FAST_FILTER,
    "uPlot tooltip filter targets only the fixed timestamp overlay": "position === 'fixed'" in UPLOT_FAST_FILTER
        and "dashbridge-uplot-fast-tooltip-hidden" in UPLOT_FAST_FILTER,
    "uPlot filter keeps visible line colours aligned with the Grafana legend": "stroke: item.color" in VISUAL_ENGINE
        and "originalSeriesStrokes" in VISUAL_ENGINE,
    "uPlot series filter observes only its panel, not the entire page": "controller.observer.observe(root," in UPLOT_FAST_FILTER
        and "controller.observer.observe(document.body" not in UPLOT_FAST_FILTER,
    "uPlot data refreshes are coalesced to one animation frame": "controller.applyFrame = requestAnimationFrame" in UPLOT_FAST_FILTER,
    "uPlot reset cancels a pending filtered refresh": "cancelAnimationFrame(uPlotController.applyFrame)" in VISUAL_ENGINE,
    "series threshold evaluation does not allocate a filtered copy per series": "const finite = (values || []).filter" not in VISUAL_ENGINE,
    "uPlot fast complete-hide restores every line on reset": "uPlotController.uplot.setSeries" in VISUAL_ENGINE,
    "uPlot fast click-toggle restores dimmed legend rows": "dashbridge-uplot-fast-dimmed'))" in VISUAL_ENGINE,
    "Panel settings expose no legend-mode selector": 'name="legendMode"' not in PANEL_SETTINGS
        and "Режим отображения" not in PANEL_SETTINGS and "Выключение неактивных серий" not in PANEL_SETTINGS,
    "Dashboard uses complete-hide as its sole user mode": "legendMode: 'fast_complete_hide'" in DASHBOARD,
    "Dashboard ignores removed click-toggle selections": "const keepCompleteHideSelection = saved.legendMode === 'fast_complete_hide'" in DASHBOARD
        and "keepCompleteHideSelection && Array.isArray(saved.legendFilter)" in DASHBOARD,
    "Native Grafana ignores every non-complete user legend state": "tools.legendMode !== 'fast_complete_hide' && !tools.legendVisibility" in COMMON
        and "tools.legendSelectionVersion = null" in COMMON,
    "Popup has no visual legend controls": "grafanaEnableLegendFilter" not in POPUP
        and "grafanaRemoveAreaFill" not in POPUP and "grafanaThickenLines" not in POPUP
        and "grafanaInvertLegend" not in POPUP,
    "Batch keeps its internal key-aware click adapter": "mode = 'fast_click_toggle'" in LEGEND_ENGINE,
    "Grafana panels expose the DashBridge hover menu": "dashbridge-panel-menu-trigger" in COMMON and "installPanelMenu" in COMMON,
    "Grafana Stat panels omit the DashBridge hover menu": "const panelMenuExcludedPluginIds = new Set(['stat', 'michaeldmoore-multistat-panel']);" in COMMON
        and "const getPanelPluginId = (panel, header = null) =>" in COMMON
        and "panelMenuExcludedPluginIds.has(getPanelPluginId(panel, header))" in COMMON
        and "existingHost?.remove();" in COMMON,
    "Grafana Multistat panels omit the DashBridge hover menu": "michaeldmoore-multistat-panel" in COMMON,
    "unknown Grafana panel types keep the DashBridge hover menu": "return pluginIds.find(id => panelMenuExcludedPluginIds.has(id)) || pluginIds[0] || '';" in COMMON,
    "Shared settings preserve the expandable line-width control": "thicken-lines-container" in PANEL_SETTINGS and "thicken-lines-display" in PANEL_SETTINGS,
    "Shared settings bind visual fields in both host formats": 'const field = name => overlay.querySelector(`[name="${name}"], [data-key="${name}"]`);' in PANEL_SETTINGS,
    "Shared settings own the panel-tools visual styles": ".panel-tools-option" in PANEL_SETTINGS and ".panel-tools-legend-list" in PANEL_SETTINGS,
    "Panel settings reserve space between controls and the scrollbar": "scrollbar-gutter:stable" in PANEL_SETTINGS
        and "padding-right:16px" in PANEL_SETTINGS,
    "Panel settings preserve baseline geometry and add host-independent adaptive scaling": ".panel-tools-hint { margin:0 0 4px" in PANEL_SETTINGS
        and "padding:10px 0" in PANEL_SETTINGS
        and "font:400 13px/1.35 system-ui !important" in PANEL_SETTINGS
        and "const getInterfaceScale = () =>" in PANEL_SETTINGS
        and "overlay.style.fontSize = `${13 * getInterfaceScale()}px`;" in PANEL_SETTINGS
        and "max-height:calc(100dvh - 2.4616em)" in PANEL_SETTINGS,
    "Shared settings define controls outside DashBridge CSS": ".switch input" in PANEL_SETTINGS and ".panel-tools-modal .btn" in PANEL_SETTINGS,
    "Panel settings cannot close on a backdrop click": "event.target.closest('.cancel')" in PANEL_SETTINGS and "event.target === overlay ||" not in PANEL_SETTINGS,
    "Shared Grafana settings keep actions visible while content scrolls": ".panel-tools-footer { flex:0 0 auto" in PANEL_SETTINGS
        and '<div class="panel-tools-scroll">' in PANEL_SETTINGS,
    "Shared settings own advanced control bindings": "const bindAdvancedControls" in PANEL_SETTINGS,
    "Shared Grafana settings expose an accessible header reset action": 'aria-labelledby="dashbridge-panel-settings-title"' in PANEL_SETTINGS
        and 'id="dashbridge-panel-settings-title">Настройки графика</h3>' in PANEL_SETTINGS
        and 'panel-tools-reset-all">Сбросить всё</button></div>' in PANEL_SETTINGS,
    "Shared Grafana settings are isolated from host header and theme CSS": '<header class="panel-tools-modal-header">' not in PANEL_SETTINGS
        and "--bg-color:#f8fafc" in PANEL_SETTINGS
        and "dashbridge-panel-settings-dark" in PANEL_SETTINGS,
    "DashBridge uses the same settings shell and advanced handlers as native Grafana": "DashBridgePanelSettingsModal.open({" in DASHBOARD
        and "advanced: {" in DASHBOARD
        and "DashBridgePanelSettingsModal.create({" not in DASHBOARD,
    "Grafana panel menu exposes the shared legend filter": "legendFields(state.legendMode, state)" in COMMON and "getLegendSeries: () => getPanelLegendSeries(panel)" in COMMON,
    "legend pattern fields have safe defaults in both panel hosts": "legendSelectFilter: ''" in NATIVE_PANEL_SETTINGS
        and "legendIgnoreFilter: ''" in NATIVE_PANEL_SETTINGS
        and "keepCompleteHideSelection && typeof saved.legendSelectFilter === 'string'" in DASHBOARD
        and "keepCompleteHideSelection && typeof saved.legendIgnoreFilter === 'string'" in DASHBOARD,
    "Grafana panel menu exposes transform and threshold controls": "transformFields(state, { panelKind })" in COMMON and "thresholdFields(state)" in COMMON,
    "panel-specific data transforms use the configured exact title scope":
        "const panelSettings = readPanelAnalysisSettings();" in COMMON
        and "classifyPanelTitle(panelTitle, panelSettings)" in COMMON
        and "panelKind === 'cpu'" in PANEL_SETTINGS
        and "panelKind === 'ram'" in PANEL_SETTINGS
        and "panelKind === 'load'" in PANEL_SETTINGS,
    "Grafana panel menu saves advanced panel state": "Object.assign(tools, nextState)" in COMMON and "applyThresholdWhenChartReady()" in COMMON,
    "Native Grafana transform settings install the data interceptor": "installDataInterceptor();" in NATIVE_PANEL_SETTINGS,
    "Native Grafana transform settings refresh only the selected panel data":
        "findPanelSceneQueryRunner" in COMMON
        and "sceneRunner.runQueries()" in COMMON
        and "refreshSelectedPanelData(panel)" in NATIVE_PANEL_SETTINGS
        and "uplot-runner-unavailable" in COMMON,
    "Threshold highlight visibility changes do not issue Grafana queries":
        "const thresholdHighlightVisibilityChanged" in NATIVE_PANEL_SETTINGS
        and "else if (thresholdHighlightVisibilityChanged)" in NATIVE_PANEL_SETTINGS
        and "syncThresholdHighlightState(thresholdRoot)" in NATIVE_PANEL_SETTINGS,
    "visual styles are reapplied after transformed data renders": "const reapplyVisualStylesAfterDataTransform" in COMMON
        and "reapplyVisualStylesAfterDataTransform();" in COMMON
        and "requestAnimationFrame(() => requestAnimationFrame" in COMMON
        and "const delays = [0, 80, 180, 350]" in COMMON
        and "generation !== visualStyleReapplyGeneration" in COMMON
        and "getLocalStyleDebug?.({" in COMMON
        and "getLocalStyleDebug" in VISUAL_ENGINE
        and "visualReapplyDiagnostic.pending = true" in COMMON
        and "recordVisualReapply('command-post-resize'" in COMMON,
    "Local styles cancel a queued legacy painter frame":
        "outerPanel.__dashBridgeObserverRaf = requestAnimationFrame" in VISUAL_ENGINE
        and "cancelAnimationFrame(node.__dashBridgeObserverRaf)" in VISUAL_ENGINE,
    "Legend restoration keeps the original vertical time-grid density":
        "__dashBridgeLegendOriginalXAxisIncrement" in VISUAL_ENGINE
        and "xAxis._incrs = () => [savedXAxisIncrement]" in VISUAL_ENGINE
        and "xAxis._incrs = originalXAxisIncrements" in VISUAL_ENGINE,
    "visual styles reapply directly after each observed query": "const consumeVisualStylesAfterQuery" in COMMON
        and "if (!transformActive)" in COMMON
        and "reapplyVisualStylesAfterDataTransform();" in COMMON
        and "visualStyleReapplyAfterNextQuery" not in COMMON,
    "legend-only layout has no redundant second visual pass": "if (tools.invertLegend) reapplyVisualStylesAfterDataTransform();" not in COMMON,
    "legend relocation has no ineffective stale-canvas retry": "const needsLegendChartReapply" not in COMMON
        and "if (tools.invertLegend && needsLegendChartReapply(root)) reapplyVisualStylesAfterDataTransform();" not in COMMON,
    "legend relocation does not wait on a second legend probe": "if (tools.invertLegend && !getLegendItems().length) return false;" not in COMMON,
    "Native Grafana keeps the full visual restore path": "const visualSettingsChanged" not in NATIVE_PANEL_SETTINGS and "await window.DashBridgeGrafanaVisualEngine?.apply" in NATIVE_PANEL_SETTINGS,
    "Grafana threshold targets the panel that opened the menu": "tools.targetPanelId = panelKey" in COMMON,
    "Grafana 12 visual commands retain the normalized panel key": COMMON.count("panelId: getPanelStateKey(targetPanel) || tools.targetPanelId || null") >= 4
        and "panelId: targetPanel?.getAttribute?.('data-panelid') || targetPanel?.dataset?.panelid || null" not in COMMON,
    "Threshold unit lookup accepts the selected panel root": "const getThresholdUnit = (root = document) =>" in VISUAL_ENGINE,
    "Solo panels do not call the dashboard API that is unavailable to public embeds": "location.pathname.startsWith('/d-solo/')" in PANEL_DEFINITION,
    "Threshold calculation accepts the selected panel root": "const setThreshold = ({ root = document," in VISUAL_ENGINE,
    "Flot threshold uses the drawable plot area": "plot.getPlotOffset?.()" in VISUAL_ENGINE and "plot.height?.()" in VISUAL_ENGINE,
    "Flot threshold follows View layout changes": "const watchThresholdLayoutChanges" in VISUAL_ENGINE and "watchThresholdLayoutChanges(plotHost)" in VISUAL_ENGINE,
    "Flot threshold keeps line-only series eligible": "item.lines?.show !== false || item.points?.show !== false" in VISUAL_ENGINE,
    "Panel tools pass the selected panel root to threshold work": "root: thresholdRoot" in COMMON,
    "Grafana panel menu requests the selected panel threshold unit": "getThresholdStatus: () => window.DashBridgeGrafanaVisualEngine?.getThresholdUnitAsync?.({ root: thresholdRoot, panelId: panelKey })" in COMMON,
    "Native Grafana threshold feedback tracks a panel transition": "const nativeThresholdAlerts = new Map()" in COMMON and "previous?.wasExceeded" in COMMON,
    "Native Grafana threshold feedback has no redundant panel status": "data-dashbridge-threshold-status" not in COMMON,
    "Native Grafana threshold feedback renders a page toast": "dashbridge-threshold-toast" in COMMON,
    "Native Grafana toast matches the Dashboard card and stays until dismissed": "#dashbridge-threshold-toast strong" in COMMON and "toast.remove(), 5000" not in COMMON and "toast-close" in COMMON,
    "Native Grafana toast omits volatile current values": "status.currentValue" not in NATIVE_THRESHOLD_TOAST,
    "Grafana trigger reads the vector DashBridge mark": "dashbridgeIconUrl" in COMMON,
    "Grafana trigger has no theme-specific background": "background:#eeeeef" not in COMMON
        and ".dashbridge-panel-menu-trigger:hover { background:" not in COMMON,
    "Grafana trigger keeps its width while matching native height": "width:28px; height:32px" in COMMON,
    "Vector DashBridge mark is packaged for Grafana": (ROOT / "icons/dashbridge-mark.svg").exists() and "<svg" in (ROOT / "icons/dashbridge-mark.svg").read_text(encoding="utf-8"),
    "Vector DashBridge mark has a thin shared outline": (ROOT / "icons/dashbridge-mark.svg").exists() and "stroke=\"#334155\"" in (ROOT / "icons/dashbridge-mark.svg").read_text(encoding="utf-8") and "stroke-width=\"1.25\"" in (ROOT / "icons/dashbridge-mark.svg").read_text(encoding="utf-8"),
    "Vector DashBridge mark is web accessible": "icons/dashbridge-mark.svg" in (ROOT / "manifest.json").read_text(encoding="utf-8"),
    "Grafana panel menu applies its legend filter through the visual engine": (
        "const visualLegendFilter = getVisualLegendFilter(nextState);" in COMMON
        and "getPanelLegendSeries(panel).map(name => [name, !visualLegendFilter.includes(name)])" in COMMON
    ),
    "Grafana panel settings keep capture controls in the dedicated tools": "capture: requestPanelCapture" not in COMMON and "advanced?.capture" not in PANEL_SETTINGS,
    "Grafana panel settings survive virtualized panel remounts": "DashBridgeGrafanaPanelState" in COMMON and "restorePanelVisualState" in COMMON and "__dashbridgeVisualPanelStates" in PANEL_STATE,
    "Flot vCPU highlights migrate from dashboard panel to View root":
        "syncResponseFilterPresentation(thresholdRoot, state)" in COMMON
        and "key === tools.targetPanelId" in COMMON
        and "let seriesThresholdHighlightRoot = null" in COMMON
        and "seriesThresholdHighlightRoot !== root" in COMMON
        and "root: seriesThresholdHighlightRoot" in COMMON,
    "Native Grafana refreshes when complete-hide selection changes": "legendDataFilterChanged" in COMMON,

    "DashBridge applies fast visibility even when visual styles are enabled": "const fastLegend = visualLegendFilter?.length\n                && await" in COMMON,
    "DashBridge right legends use only a minimal width constraint": "dashbridge-right-legend-style" in COMMON
        and "max-width:50% !important" in COMMON
        and "flex:0 1 auto !important" in COMMON
        and "flex:0 1 50% !important" not in COMMON
        and ".graph-panel--legend-right .graph-legend tr {" not in COMMON,
    "Early right-legend styling does not require document.head": "const styleRoot = document.head || document.documentElement;" in COMMON
        and "styleRoot?.appendChild(style);" in COMMON,
    "DashBridge leaves complete-hide colours to native Grafana": "state?.legendMode !== 'fast_complete_hide'" in COMMON,

    "Visual engine does not poll Grafana every 50 ms": "setInterval(" not in VISUAL_ENGINE,
    "Flot fast path installs a persistent setData controller": "const installFlotVisibilityController" in VISUAL_ENGINE,
    "Flot fast path preserves Grafana source data": "originalSetData" in VISUAL_ENGINE,

    "Flot refresh work is microtask-coalesced": "queueMicrotask" in VISUAL_ENGINE,
    "Flot redraw is requested only when visibility changes": "controller.needsApply" in VISUAL_ENGINE,
    "Visual engine can restore a previous Flot controller": "resetSeriesVisibility" in VISUAL_ENGINE,
    "Visibility OFF actively restores Grafana-native legend selection": "const legendVisibilityRequested = Object.prototype.hasOwnProperty.call(commandTools, 'legendVisibility');" in COMMON
        and "const visibility = tools.legendVisibility && typeof tools.legendVisibility === 'object'" in COMMON
        and "await applyLegendVisibilityByKey(visibility);" in COMMON,
    "Visibility reset remains independent from other visual work": "if (!tools.legendVisibility) {\n            window.DashBridgeGrafanaVisualEngine?.resetSeriesVisibility?.({ root });\n        }\n        if (hasVisualWork())" in COMMON,
    "Dashboard clears a fast filter when the legend filter is empty": "resetSeriesVisibility?.({ root })" in COMMON,

}

readiness_section = COMMON.split("const applyPopupVisualEngineWhenReady", 1)
if len(readiness_section) == 2:
    readiness_section = readiness_section[1].split("const isQueryUrl", 1)[0]
else:
    readiness_section = ""
checks["Visual engine readiness has bounded table-aware lifecycle"] = (
    "setTimeout(finish, 18_000)" in readiness_section
    and "renderedTable && !chartSurface" in readiness_section
    and "window.__dashbridgeChartReadyCancel = finish" in readiness_section
)

run_checks(checks)
