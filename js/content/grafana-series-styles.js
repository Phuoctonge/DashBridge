(function initGrafanaSeriesStyles(root) {
    'use strict';
    if (root.DashBridgeGrafanaSeriesStyles) return;

    function create({ findUPlot, getFlotPlot } = {}) {
        if (typeof findUPlot !== 'function' || typeof getFlotPlot !== 'function') {
            throw new TypeError('Grafana series styles dependencies are incomplete');
        }

        // Keep a style-only command completely separate from the legacy visual
        // painter. uPlot hover uses its own point/cursor state; touching colours,
        // legend DOM or observers just to remove an area fill can desynchronise it.
        const applyLocalSeriesStyles = ({ root = document, removeFill = false, thickenLines = false, thickenLinesValue = 1.5 } = {}) => {
            const uplot = findUPlot(root);
            if (uplot?.series?.length) {
                let changed = false;
                uplot.batch?.(() => {
                    uplot.series.slice(1).forEach(series => {
                        if (!Object.prototype.hasOwnProperty.call(series, '__dashbridgeOriginalAreaFill')) {
                            series.__dashbridgeOriginalAreaFill = series.fill;
                        }
                        // Grafana's uPlot fork always calls `fill`; assigning false
                        // throws during redraw.  Preserve its callable contract while
                        // making the disabled state explicit and verifiable.
                        const fillDisabled = !!removeFill;
                        const nextFill = fillDisabled
                            ? (() => 'rgba(0,0,0,0)')
                            : series.__dashbridgeOriginalAreaFill;
                        if (series.fill !== nextFill || series.__dashbridgeFillDisabled !== fillDisabled) {
                            series.fill = nextFill;
                            series.__dashbridgeFillDisabled = fillDisabled;
                            changed = true;
                        }
                        if (!Object.prototype.hasOwnProperty.call(series, '__dashbridgeOriginalLineWidth')) {
                            series.__dashbridgeOriginalLineWidth = series.width;
                        }
                        const nextWidth = thickenLines
                            ? ((series.__dashbridgeOriginalLineWidth || 1) + Number(thickenLinesValue || 0))
                            : series.__dashbridgeOriginalLineWidth;
                        if (nextWidth !== undefined && series.width !== nextWidth) {
                            series.width = nextWidth;
                            changed = true;
                        }
                    });
                });
                if (changed) uplot.redraw?.(true, true);
                return 'uplot';
            }
    
            const plot = getFlotPlot(root);
            if (plot?.getData?.()) {
                let changed = false;
                plot.getData().forEach(series => {
                    if (!series?.lines) return;
                    if (!Object.prototype.hasOwnProperty.call(series, '__dashbridgeOriginalAreaFill')) {
                        series.__dashbridgeOriginalAreaFill = series.lines.fill;
                    }
                    const nextFill = removeFill ? false : series.__dashbridgeOriginalAreaFill;
                    if (series.lines.fill !== nextFill) {
                        series.lines.fill = nextFill;
                        changed = true;
                    }
                    if (!Object.prototype.hasOwnProperty.call(series, '__dashbridgeOriginalLineWidth')) {
                        series.__dashbridgeOriginalLineWidth = series.lines.lineWidth;
                    }
                    const nextWidth = thickenLines
                        ? ((series.__dashbridgeOriginalLineWidth || 1) + Number(thickenLinesValue || 0))
                        : series.__dashbridgeOriginalLineWidth;
                    if (nextWidth !== undefined && series.lines.lineWidth !== nextWidth) {
                        series.lines.lineWidth = nextWidth;
                        changed = true;
                    }
                });
                if (changed) {
                    plot.setupGrid?.();
                    plot.draw?.();
                }
                return 'flot';
            }
            return null;
        };
    
        // A visual-only refresh can replace Flot/uPlot after the network response
        // has already resolved.  MutationObserver callbacks run before the browser
        // paints the committed DOM, so this small panel-scoped guard reapplies only
        // fill/width state without invoking the legacy colour/layout painter.
        const configureLocalSeriesStyleGuard = ({ root = document, removeFill = false, thickenLines = false, thickenLinesValue = 1.5 } = {}) => {
            const guardKey = '__dashBridgeLocalSeriesStyleGuard';
            const active = !!removeFill || !!thickenLines;
            const existing = root?.[guardKey];
            if (!active) {
                existing?.observer?.disconnect?.();
                if (existing?.frame) cancelAnimationFrame(existing.frame);
                if (root && existing) delete root[guardKey];
                return;
            }
            const guard = existing || { observer: null, frame: null, settings: null };
            guard.settings = { removeFill: !!removeFill, thickenLines: !!thickenLines, thickenLinesValue };
            if (!guard.observer) {
                const applyGuardedStyles = (allowFrameRetry = true) => {
                    guard.frame = null;
                    const result = applyLocalSeriesStyles({ root, ...guard.settings });
                    if (!result && allowFrameRetry && !guard.frame) {
                        guard.frame = requestAnimationFrame(() => applyGuardedStyles(false));
                    }
                };
                guard.observer = new MutationObserver(() => applyGuardedStyles());
                guard.observer.observe(root, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['width', 'height', 'class'],
                });
                root[guardKey] = guard;
            }
        };
    
        // A response-level series filter can collapse a long bottom legend from
        // dozens of rows to one row and later expand it again. Grafana may compute
        // its axes while the legend still has the previous height, then resize the
        // canvas without performing another autoscale pass. Reflow only after the
        // committed DOM size is observable; native uPlot/Flot remains responsible
        // for choosing the actual increments and ranges.
        const reflowChart = ({ root = document } = {}) => {
            const uplot = findUPlot(root);
            if (uplot?.setSize && uplot?.redraw) {
                const chartHost = root.querySelector?.('.uplot, .graph-panel__chart')
                    || root.querySelector?.('canvas')?.parentElement;
                const rect = chartHost?.getBoundingClientRect?.();
                const width = Math.max(1, Math.round(rect?.width || uplot.width || 1));
                const height = Math.max(1, Math.round(rect?.height || uplot.height || 1));
                const beforeAxes = (uplot.axes || []).map(axis => Array.isArray(axis._found)
                    ? [...axis._found] : axis._found ?? null);
                uplot.setSize({ width, height });
                uplot.redraw(true, true);
                return {
                    engine: 'uplot', width, height,
                    beforeAxes,
                    afterAxes: (uplot.axes || []).map(axis => Array.isArray(axis._found)
                        ? [...axis._found] : axis._found ?? null),
                };
            }
            const plot = getFlotPlot(root);
            if (plot?.resize) {
                plot.resize();
                plot.setupGrid?.();
                plot.draw?.();
                return { engine: 'flot' };
            }
            return { engine: 'none' };
        };
    
        let diagnosticUPlotSequence = 0;
        const getUPlotDiagnosticId = uplot => {
            if (!uplot) return null;
            if (!Object.prototype.hasOwnProperty.call(uplot, '__dashbridgeDiagnosticId')) {
                Object.defineProperty(uplot, '__dashbridgeDiagnosticId', {
                    configurable: false,
                    enumerable: false,
                    writable: false,
                    value: `uplot-${++diagnosticUPlotSequence}`,
                });
            }
            return uplot.__dashbridgeDiagnosticId;
        };
        const evaluateStyleValue = (value, uplot, index) => {
            try {
                const evaluated = typeof value === 'function' ? value(uplot, index) : value;
                return evaluated === undefined ? '[undefined]' : evaluated === null ? null : String(evaluated);
            } catch (error) {
                return `[error: ${error?.message || String(error)}]`;
            }
        };
    
        const getLocalStyleDebug = ({ root = document, removeFill = false, thickenLines = false } = {}) => {
            const uplot = findUPlot(root);
            if (uplot?.series?.length) {
                const series = uplot.series.slice(1);
                const fillDisabledCount = series.filter(item => item.__dashbridgeFillDisabled === true).length;
                const thickenedCount = series.filter(item => Number.isFinite(item.width)
                    && Number.isFinite(item.__dashbridgeOriginalLineWidth)
                    && item.width > item.__dashbridgeOriginalLineWidth).length;
                return {
                    engine: 'uplot',
                    rendererInstanceId: getUPlotDiagnosticId(uplot),
                    rendererRootConnected: uplot.root?.isConnected ?? null,
                    rendererRootClass: uplot.root?.className || '',
                    seriesCount: series.length,
                    fillDisabledCount,
                    thickenedCount,
                    fillMatchesExpected: series.length > 0 && (removeFill
                        ? fillDisabledCount === series.length : fillDisabledCount === 0),
                    widthMatchesExpected: series.length > 0 && (thickenLines
                        ? thickenedCount === series.length : thickenedCount === 0),
                    widthPairs: [...new Set(series.map(item => `${item.__dashbridgeOriginalLineWidth}->${item.width}`))],
                    fillValueTypes: [...new Set(series.map(item => typeof item.fill))],
                    evaluatedFillValues: [...new Set(series.map((item, index) => evaluateStyleValue(item.fill, uplot, index + 1)))],
                    evaluatedOriginalFillValues: [...new Set(series.map((item, index) => evaluateStyleValue(
                        item.__dashbridgeOriginalAreaFill, uplot, index + 1
                    )))],
                };
            }
            const plot = getFlotPlot(root);
            const series = plot?.getData?.() || [];
            if (series.length) {
                const fillDisabledCount = series.filter(item => item?.lines?.fill === false).length;
                const thickenedCount = series.filter(item => Number.isFinite(item?.lines?.lineWidth)
                    && Number.isFinite(item.__dashbridgeOriginalLineWidth)
                    && item.lines.lineWidth > item.__dashbridgeOriginalLineWidth).length;
                return {
                    engine: 'flot',
                    rendererInstanceId: 'flot',
                    rendererRootConnected: root?.isConnected ?? null,
                    seriesCount: series.length,
                    fillDisabledCount,
                    thickenedCount,
                    fillMatchesExpected: removeFill ? fillDisabledCount === series.length : fillDisabledCount === 0,
                    widthMatchesExpected: thickenLines ? thickenedCount === series.length : thickenedCount === 0,
                    widthPairs: [...new Set(series.map(item => `${item.__dashbridgeOriginalLineWidth}->${item?.lines?.lineWidth}`))],
                };
            }
            return {
                engine: 'unknown', rendererInstanceId: null, rendererRootConnected: root?.isConnected ?? null,
                seriesCount: 0, fillDisabledCount: 0, thickenedCount: 0,
                fillMatchesExpected: false, widthMatchesExpected: false, widthPairs: [],
                fillValueTypes: [], evaluatedFillValues: [], evaluatedOriginalFillValues: [],
            };
        };
    

        return Object.freeze({
            applyLocalSeriesStyles,
            configureLocalSeriesStyleGuard,
            getLocalStyleDebug,
            reflowChart,
        });
    }

    root.DashBridgeGrafanaSeriesStyles = Object.freeze({ create });
})(window);

