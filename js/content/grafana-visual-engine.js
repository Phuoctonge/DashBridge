// Shared Grafana legend and visual engine. Source: verified Popup painter.
// Runs in MAIN world; both Popup and DashBridge call this adapter.
(() => {
    if (window.DashBridgeGrafanaVisualEngine) return;

    const grafanaUnit = window.DashBridgeGrafanaUnit;
    if (!grafanaUnit) {
        throw new Error('DashBridgeGrafanaUnit must load before DashBridgeGrafanaVisualEngine');
    }
    const {
        parseAxisUnitLabel,
        inferUnitFromAxisLabels,
        inferUnitFromAxisTicks,
        unitFromPanelDefinition,
        mergeAxisAndPanelUnit
    } = grafanaUnit;
    const panelDefinition = window.DashBridgeGrafanaPanelDefinition;
    if (!panelDefinition) {
        throw new Error('DashBridgeGrafanaPanelDefinition must load before DashBridgeGrafanaVisualEngine');
    }
    const {
        getCachedPanelDefinition,
        getPanelDefinition,
        getQuerySignature,
        getQueryScopeSignature,
        getPanelQuerySignaturesAsync
    } = panelDefinition;
    const tableReport = window.DashBridgeGrafanaTableReport;
    if (!tableReport) {
        throw new Error('DashBridgeGrafanaTableReport must load before DashBridgeGrafanaVisualEngine');
    }
    const { collectGrafanaTableData, collectGrafanaTableRecords } = tableReport;

    // Collects diagnostics in E2E environments
    const debugLog = (...args) => {
        if (window.__dashbridgeDebugLogs) {
            window.__dashbridgeDebugLogs.push(`[${new Date().toISOString()}] [VisualEngine] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
        }
    };

    const {
        applyPopupLegendAndVisuals,
        applyUPlotFastCompleteHide,
        applyUPlotNativeLegendVisibility,
        findUPlotForThreshold,
        getFlotPlot,
        getFlotRowLabel,
        getPaletteDebug,
        getUPlotLegendRuntime,
        installFlotVisibilityController,
        resetFlotSeriesVisibility,
        resetSeriesVisibility,
        stopLegacyVisualObservers,
    } = window.DashBridgeGrafanaLegendVisuals.create({ debugLog });
    const {
        getThresholdDebug,
        getThresholdUnit,
        getThresholdUnitAsync,
        getUPlotUnitDetails,
        getUPlotYScaleKey,
        scheduleThresholdHighlightRender,
        setSeriesThresholdHighlights,
        setThreshold,
    } = window.DashBridgeGrafanaThresholdVisuals.create({
        parseAxisUnitLabel,
        inferUnitFromAxisLabels,
        inferUnitFromAxisTicks,
        unitFromPanelDefinition,
        mergeAxisAndPanelUnit,
        getCachedPanelDefinition,
        getPanelDefinition,
        findUPlot: findUPlotForThreshold,
        getUPlotLegendRuntime,
        getFlotRowLabel,
    });
    const { collectPanelReportSnapshot } = window.DashBridgeGrafanaReportSnapshot.create({
        mergeAxisAndPanelUnit,
        inferUnitFromAxisTicks,
        getCachedPanelDefinition,
        unitFromPanelDefinition,
        collectGrafanaTableData,
        collectGrafanaTableRecords,
        findUPlot: findUPlotForThreshold,
        getUPlotYScaleKey,
        getUPlotUnitDetails,
    });
    const {
        applyLocalSeriesStyles,
        configureLocalSeriesStyleGuard,
        getLocalStyleDebug,
        reflowChart,
    } = window.DashBridgeGrafanaSeriesStyles.create({
        findUPlot: findUPlotForThreshold,
        getFlotPlot,
    });
    window.DashBridgeGrafanaVisualEngine = {
        async apply({ panelId = null, seriesConfig = null, mode = 'fast_click_toggle', removeFill = false, thickenLines = false, thickenLinesValue = 1.5, invertLegend = false } = {}) {
            const targetPanel = window.DashBridgeGrafanaDom?.findPanel?.({ panelId }) || document;
            const root = window.DashBridgeGrafanaDom?.outerPanel?.(targetPanel) || targetPanel || document;
            // Threshold highlights derive their width from the live renderer.
            // Always repaint them after a style command so toggle order cannot
            // leave an overlay calculated from the previous series width.
            const completeStyleApply = result => {
                scheduleThresholdHighlightRender(root);
                return result;
            };
            const completeLegacyStyleApply = legacyResult => {
                // Legend relocation/visibility can replace the Flot plot after
                // the legacy painter touched the previous instance. Reassert
                // only the independent fill/width state on the live renderer
                // and keep its narrow replacement guard active. This does not
                // repaint palette, legend layout or visibility.
                const localStyleResult = applyLocalSeriesStyles({
                    root, removeFill, thickenLines, thickenLinesValue,
                });
                configureLocalSeriesStyleGuard({
                    root, removeFill, thickenLines, thickenLinesValue,
                });
                return completeStyleApply(legacyResult || localStyleResult);
            };
            if (seriesConfig) {
                const result = await this.applySeriesVisibility({ root, seriesConfig, mode });
                // На Grafana 6-7 (Flot) installFlotVisibilityController возвращает null,
                // если Flot-плот ещё не инициализирован в момент вызова.
                // В этом случае result === null (falsy), но invertLegend, thickenLines и
                // removeFill всё равно должны применяться через applyPopupLegendAndVisuals —
                // эта функция сама повторно вызовет applySeriesVisibility внутри себя.
                // На uPlot (Grafana 9-11) result всегда truthy ('uplot-fast-complete-hide').
                // В обоих случаях вызов applyPopupLegendAndVisuals безопасен: он идемпотентен
                // (повторный вызов applySeriesVisibility просто обновляет seriesConfig
                // в уже существующем контроллере).
                const legacyResult = await applyPopupLegendAndVisuals(
                    panelId,
                    seriesConfig,
                    mode,
                    removeFill,
                    thickenLines,
                    thickenLinesValue,
                    invertLegend
                );
                return completeLegacyStyleApply(legacyResult);
            }
            resetSeriesVisibility({ root });
            const hasSavedLegendLayout = Array.from(root.querySelectorAll?.('*') || [])
                .some(element => Object.prototype.hasOwnProperty.call(element, '__dashBridgeLegendLayoutSnapshot'));
            if (!seriesConfig && !invertLegend) {
                // A previous legend relocation may still need the legacy
                // renderer once to restore its DOM styles.  Area fill itself
                // must nevertheless use the local uPlot instance afterwards:
                // the legacy renderer can resolve a stale chart branch.
                if (hasSavedLegendLayout) {
                    await applyPopupLegendAndVisuals(panelId, null, mode, removeFill, false, thickenLinesValue, false);
                }
                stopLegacyVisualObservers(root);
                const result = applyLocalSeriesStyles({ root, removeFill, thickenLines, thickenLinesValue });
                configureLocalSeriesStyleGuard({ root, removeFill, thickenLines, thickenLinesValue });
                return completeStyleApply(result);
            }
            const legacyResult = await applyPopupLegendAndVisuals(
                panelId,
                seriesConfig,
                mode,
                removeFill,
                thickenLines,
                thickenLinesValue,
                invertLegend
            );
            return completeLegacyStyleApply(legacyResult);
        },
        findUPlot(root = document) {
            return findUPlotForThreshold(root);
        },
        isChartReady(root = document) {
            const $ = window.jQuery || window.$;
            const hasFlot = !!$ && $(root).find('.graph-panel__chart').toArray()
                .some(element => !!$(element).data('plot'));
            return hasFlot || !!findUPlotForThreshold(root);
        },
        async applySeriesVisibility({ root = document, seriesConfig = {}, mode = 'fast_click_toggle' } = {}) {
            const uplot = findUPlotForThreshold(root);
            if (uplot?.batch && uplot?.setSeries) {
                // Use Grafana's handler here so React's legend state, canvas
                // and tooltip stay in sync after an iframe redraw.
                if (mode === 'fast_click_toggle') {
                    return applyUPlotNativeLegendVisibility({ root, seriesConfig });
                }
                return applyUPlotFastCompleteHide({ root, seriesConfig, mode });
            }
            // Grafana's Flot panel keeps additional React-managed visibility
            // state. Directly mutating getData() can corrupt stacked/fill
            // rendering, so Flot deliberately uses the compatibility path.
            return installFlotVisibilityController({ root, seriesConfig, mode });
        },
        applyFlotSeriesVisibility({ root = document, seriesConfig = {}, mode = 'fast_complete_hide' } = {}) {
            return installFlotVisibilityController({ root, seriesConfig, mode });
        },
        resetFlotSeriesVisibility({ root = document } = {}) {
            return resetFlotSeriesVisibility({ root });
        },
        getFlotSeriesLabels(root = document) {
            const plot = getFlotPlot(root);
            return Array.isArray(plot?.getData?.())
                ? plot.getData().map(series => String(series?.label || '').trim()).filter(Boolean)
                : null;
        },
        resetSeriesVisibility,
        getChartSeriesCount(root = document) {
            const $ = window.jQuery || window.$;
            const plotHost = $ && $(root).find('.graph-panel__chart').toArray()
                .find(element => !!$(element).data('plot'));
            const flotSeries = plotHost && $(plotHost).data('plot')?.getData?.();
            if (Array.isArray(flotSeries)) return flotSeries.length;
            const uplot = findUPlotForThreshold(root);
            return Array.isArray(uplot?.series) ? Math.max(0, uplot.series.length - 1) : null;
        },
        setSeriesThresholdHighlights,
        setThreshold,
        collectPanelReportSnapshot,
        collectGrafanaTableRecords,
        getThresholdUnit,
        getThresholdUnitAsync,
        getQuerySignature,
        getQueryScopeSignature,
        getPanelQuerySignaturesAsync,
        getThresholdDebug,
        getPaletteDebug,
        getLocalStyleDebug,
        reflowChart
    };
})();
