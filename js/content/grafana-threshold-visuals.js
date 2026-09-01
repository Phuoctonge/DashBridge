(function initGrafanaThresholdVisuals(root) {
    'use strict';
    if (root.DashBridgeGrafanaThresholdVisuals) return;

    function create({ parseAxisUnitLabel, inferUnitFromAxisLabels, inferUnitFromAxisTicks,
        unitFromPanelDefinition, mergeAxisAndPanelUnit, getCachedPanelDefinition,
        getPanelDefinition, findUPlot, getUPlotLegendRuntime, getFlotRowLabel } = {}) {
        const dependencies = [
            parseAxisUnitLabel, inferUnitFromAxisLabels, inferUnitFromAxisTicks,
            unitFromPanelDefinition, mergeAxisAndPanelUnit, getCachedPanelDefinition,
            getPanelDefinition, findUPlot, getUPlotLegendRuntime, getFlotRowLabel,
        ];
        if (dependencies.some(dependency => typeof dependency !== 'function')) {
            throw new TypeError('Grafana threshold visuals dependencies are incomplete');
        }

        const getUPlotYScaleKey = uplot => {
            const seriesScale = (uplot?.series || []).slice(1)
                .map(series => series.scale)
                .find(scale => scale && uplot.scales?.[scale]);
            return seriesScale || Object.keys(uplot?.scales || {}).find(scale => scale !== 'x') || 'y';
        };
    
        const getUPlotAxisLabels = (uplot, yScaleKey, yScale) => {
            const axis = (uplot.axes || []).find(item => item.scale === yScaleKey) || uplot.axes?.[1];
            try {
                return typeof axis?.values === 'function'
                    ? axis.values(uplot, [yScale?.min, yScale?.max], uplot.bbox?.height || 0, 1)
                    : [];
            } catch (e) {
                return [];
            }
        };
    
        const getUPlotUnitDetails = (uplot, yScaleKey, yScale) => {
            const axisLabels = getUPlotAxisLabels(uplot, yScaleKey, yScale);
            const axisUnit = inferUnitFromAxisLabels(axisLabels, yScale);
            if (axisUnit) return { ...axisUnit, axisLabels };
    
            // Grafana may omit the percent sign from compact axis labels such as
            // "90,721". The scale identity still carries the unambiguous unit.
            if (/^percent(?:\/|$)/i.test(yScaleKey || '')) {
                return { unit: '%', factor: 1, axisLabels };
            }
    
            // Do not guess from arbitrary page text: a dashboard can contain a
            // different panel with "s" or "GiB", which would corrupt this panel.
            return { unit: '', factor: 1, axisLabels };
        };
    
        const drawThresholdLine = (root, value, min, max, unit, position = null, displayValue = value) => {
            root?.querySelectorAll?.('[data-dashbridge-threshold-line]').forEach(el => el.remove());
            if (!root || !Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
            const chart = root.querySelector?.('.graph-panel__chart, .uplot') || root;
            const canvas = chart.querySelector('canvas') || chart;
            const parent = canvas.parentElement || chart;
            if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
            const ratio = Math.max(0, Math.min(1, (max - value) / (max - min)));
            const aboveScale = value > max;
            const belowScale = value < min;
            const line = document.createElement('div');
            line.setAttribute('data-dashbridge-threshold-line', 'true');
            line.setAttribute('data-dashbridge-threshold-scale', aboveScale ? 'above' : belowScale ? 'below' : 'inside');
            const thresholdText = `Порог: ${displayValue}${unit ? ` ${unit}` : ''}`;
            line.title = aboveScale
                ? `${thresholdText} (выше текущей шкалы)`
                : belowScale
                    ? `${thresholdText} (ниже текущей шкалы)`
                    : thresholdText;
            const positionedTop = position && Number.isFinite(position.topMin) && Number.isFinite(position.topMax)
                ? Math.max(position.topMin, Math.min(position.topMax, position.top))
                : position?.top;
            const horizontal = position
                ? `left:${position.left}px;width:${position.width}px;top:${positionedTop}px;`
                : `left:0;right:0;top:${ratio * 100}%;`;
            line.style.cssText = `position:absolute;${horizontal}border-top:2px dashed #e24d42;z-index:20;pointer-events:none;`;
            const label = document.createElement('span');
            label.textContent = `${aboveScale ? '↑ ' : belowScale ? '↓ ' : ''}${thresholdText}`;
            const labelVerticalPosition = aboveScale ? 'top:3px;' : 'bottom:3px;';
            label.style.cssText = `position:absolute;right:4px;${labelVerticalPosition}padding:1px 4px;border-radius:3px;background:#e24d42;color:#fff;font:600 11px/1.3 sans-serif;`;
            line.appendChild(label);
            parent.appendChild(line);
        };
    
        const watchThresholdDataChanges = chart => {
            if (!chart?.setData || chart.__dashbridgeThresholdDataHooked) return;
            const originalSetData = chart.setData;
            chart.__dashbridgeThresholdDataHooked = true;
            chart.setData = function (...args) {
                const result = originalSetData.apply(this, args);
                queueMicrotask(() => window.dispatchEvent(new Event('dashbridgeThresholdDataUpdated')));
                return result;
            };
        };
    
        const watchThresholdLayoutChanges = chartHost => {
            if (!chartHost || chartHost.__dashbridgeThresholdLayoutObserver) return;
            let firstFrame = 0;
            let secondFrame = 0;
            const schedule = () => {
                if (firstFrame) cancelAnimationFrame(firstFrame);
                if (secondFrame) cancelAnimationFrame(secondFrame);
                firstFrame = requestAnimationFrame(() => {
                    firstFrame = 0;
                    secondFrame = requestAnimationFrame(() => {
                        secondFrame = 0;
                        window.dispatchEvent(new Event('dashbridgeThresholdDataUpdated'));
                    });
                });
            };
            const isThresholdNode = node => node?.nodeType === Node.ELEMENT_NODE
                && (node.matches?.('[data-dashbridge-threshold-line]') || node.closest?.('[data-dashbridge-threshold-line]'));
            const observer = new MutationObserver(records => {
                const hasChartChange = records.some(record => {
                    if (isThresholdNode(record.target)) return false;
                    if (record.type !== 'childList') return true;
                    return [...record.addedNodes, ...record.removedNodes].some(node => !isThresholdNode(node));
                });
                if (hasChartChange) schedule();
            });
            observer.observe(chartHost, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'width', 'height']
            });
            const resizeObserver = typeof ResizeObserver === 'function'
                ? new ResizeObserver(schedule)
                : null;
            resizeObserver?.observe(chartHost);
            chartHost.__dashbridgeThresholdLayoutObserver = {
                observer,
                resizeObserver,
                cancelScheduledFrames() {
                    if (firstFrame) cancelAnimationFrame(firstFrame);
                    if (secondFrame) cancelAnimationFrame(secondFrame);
                    firstFrame = 0;
                    secondFrame = 0;
                }
            };
        };
    
        const stopThresholdLayoutChanges = chartHost => {
            const controller = chartHost?.__dashbridgeThresholdLayoutObserver;
            if (!controller) return;
            controller.observer?.disconnect();
            controller.resizeObserver?.disconnect();
            controller.cancelScheduledFrames?.();
            delete chartHost.__dashbridgeThresholdLayoutObserver;
        };
    
        const stopThresholdLayoutChangesInRoot = root => {
            if (root?.matches?.('.graph-panel__chart')) stopThresholdLayoutChanges(root);
            root?.querySelectorAll?.('.graph-panel__chart').forEach(stopThresholdLayoutChanges);
        };
    
        // Reading a unit must not enable the alert or draw a temporary threshold
        // line. The Dashboard settings dialog uses this while the user is editing.
        const getThresholdUnit = (root = document) => {
            const $ = window.jQuery || window.$;
            const plotHost = $ && $(root).find('.graph-panel__chart').toArray().find(el => !!$(el).data('plot'));
            if (plotHost) {
                const plot = $(plotHost).data('plot');
                const axis = plot.getAxes?.().yaxis;
                const axisUnit = inferUnitFromAxisTicks(axis?.ticks);
                const { unit, factor, source, code } = mergeAxisAndPanelUnit(axisUnit, getCachedPanelDefinition());
                return { unit, factor, source, code, engine: 'flot' };
            }
            const uplot = findUPlot(root);
            if (uplot) {
                const yScaleKey = getUPlotYScaleKey(uplot);
                const yScale = uplot.scales?.[yScaleKey];
                return {
                    ...mergeAxisAndPanelUnit(getUPlotUnitDetails(uplot, yScaleKey, yScale), getCachedPanelDefinition()),
                    engine: 'uplot'
                };
            }
            return { unit: '', factor: 1, engine: 'unknown' };
        };
    
        const getThresholdUnitAsync = async ({ root = document, panelId = '' } = {}) => {
            await getPanelDefinition({ root, panelId });
            return getThresholdUnit(root);
        };
    
        const thresholdHighlightControllers = new WeakMap();
        const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
        const removeThresholdHighlightOverlays = () => {
            document.querySelectorAll?.('[data-dashbridge-threshold-highlights]')
                .forEach(element => element.remove());
        };
        const isThresholdHighlightRootActive = root => root === document || (
            root?.isConnected === true
            && (typeof root.getClientRects !== 'function' || root.getClientRects().length > 0)
        );
        const isThresholdHighlightOverlayNode = node => node?.nodeType === 1
            && (node.matches?.('[data-dashbridge-threshold-highlights]')
                || node.closest?.('[data-dashbridge-threshold-highlights]'));
        const normalizeHighlightName = value => String(value || '').trim().toLowerCase();
        const matchThresholdHighlightRule = (label, rules) => {
            const normalizedLabel = normalizeHighlightName(label);
            if (!normalizedLabel) return null;
            const exact = rules.find(rule => (rule.sourceNames || [])
                .some(name => normalizeHighlightName(name) === normalizedLabel));
            if (exact) return exact;
            return rules.find(rule => (rule.sourceNames || []).some(name => {
                const candidate = normalizeHighlightName(name);
                return candidate.length >= 4
                    && (normalizedLabel.includes(candidate) || candidate.includes(normalizedLabel));
            })) || null;
        };
        const createThresholdHighlightSvg = host => {
            if (!host) return null;
            const rect = host.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.height <= 0) return null;
            const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
            svg.setAttribute('data-dashbridge-threshold-highlights', 'true');
            svg.setAttribute('width', String(rect.width));
            svg.setAttribute('height', String(rect.height));
            // Keep the overlay outside Grafana's React-managed chart subtree.
            // Graph/Flot replaces that subtree after every response commit and
            // would otherwise delete a correctly painted highlight a frame later.
            svg.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:999;overflow:hidden;pointer-events:none;`;
            (document.body || document.documentElement).appendChild(svg);
            return svg;
        };
        const THRESHOLD_HIGHLIGHT_WIDTH_INCREMENT = 2;
        const getThresholdHighlightStrokeWidth = (...widthCandidates) => {
            const renderedWidth = widthCandidates
                .map(Number)
                .find(width => Number.isFinite(width) && width > 0) || 1;
            return renderedWidth + THRESHOLD_HIGHLIGHT_WIDTH_INCREMENT;
        };
        const appendThresholdHighlightRuns = (svg, samples, color = '#e02f44', strokeWidth = 3) => {
            const resolvedStrokeWidth = Number.isFinite(Number(strokeWidth)) && Number(strokeWidth) > 0
                ? Number(strokeWidth)
                : getThresholdHighlightStrokeWidth();
            let drawn = 0;
            let run = [];
            const flush = () => {
                if (!run.length) return;
                if (run.length === 1) {
                    const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
                    circle.setAttribute('cx', String(run[0][0]));
                    circle.setAttribute('cy', String(run[0][1]));
                    circle.setAttribute('r', String(Math.max(4, resolvedStrokeWidth)));
                    circle.setAttribute('fill', color);
                    circle.setAttribute('stroke', '#ffffff');
                    circle.setAttribute('stroke-width', '1');
                    svg.appendChild(circle);
                } else {
                    const polyline = document.createElementNS(SVG_NAMESPACE, 'polyline');
                    polyline.setAttribute('points', run.map(point => `${point[0]},${point[1]}`).join(' '));
                    polyline.setAttribute('fill', 'none');
                    polyline.setAttribute('stroke', color);
                    polyline.setAttribute('stroke-width', String(resolvedStrokeWidth));
                    polyline.setAttribute('stroke-linecap', 'round');
                    polyline.setAttribute('stroke-linejoin', 'round');
                    polyline.setAttribute('vector-effect', 'non-scaling-stroke');
                    svg.appendChild(polyline);
                }
                drawn += 1;
                run = [];
            };
            for (const sample of samples) {
                if (!sample) flush();
                else run.push(sample);
            }
            flush();
            return drawn;
        };
        const buildThresholdHighlightSamples = (points, threshold, project) => {
            const samples = [];
            let previous = null;
            let runOpen = false;
            const append = point => {
                const projected = project(point.x, point.y);
                if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return false;
                samples.push(projected);
                return true;
            };
            const closeRun = () => {
                if (runOpen) samples.push(null);
                runOpen = false;
            };
            const crossing = (left, right) => {
                const delta = right.y - left.y;
                const ratio = delta === 0 ? 0 : (threshold - left.y) / delta;
                return {
                    x: left.x + (right.x - left.x) * Math.max(0, Math.min(1, ratio)),
                    y: threshold
                };
            };
            for (const point of points || []) {
                const current = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
                if (!current) {
                    closeRun();
                    previous = null;
                    continue;
                }
                if (!previous) {
                    if (current.y > threshold) runOpen = append(current);
                    previous = current;
                    continue;
                }
                const previousAbove = previous.y > threshold;
                const currentAbove = current.y > threshold;
                if (!previousAbove && currentAbove) {
                    runOpen = append(crossing(previous, current));
                    if (append(current)) runOpen = true;
                } else if (previousAbove && currentAbove) {
                    if (!runOpen) runOpen = append(previous);
                    if (append(current)) runOpen = true;
                } else if (previousAbove && !currentAbove) {
                    if (!runOpen) runOpen = append(previous);
                    append(crossing(previous, current));
                    closeRun();
                }
                previous = current;
            }
            closeRun();
            return samples;
        };
        const getThresholdHighlightLegendVisibility = root => {
            const rows = Array.from(window.DashBridgeGrafanaDom?.legendItems?.(root)
                || root?.querySelectorAll?.('.graph-legend-series, [class*="legend-item" i], .u-legend tr, .u-legend-row, [class*="LegendRow"]')
                || []);
            const runtime = getUPlotLegendRuntime(root);
            const runtimeItems = runtime?.items || [];
            const visibleLabels = new Set();
            let hiddenRows = 0;
            for (const row of rows) {
                const labelElement = window.DashBridgeGrafanaDom?.legendLabel?.(row) || row;
                const label = getFlotRowLabel(row) || (labelElement?.textContent || '').trim();
                if (!label) continue;
                const runtimeItem = runtimeItems.find(item => item?.label === label);
                const classes = `${row.className || ''} ${labelElement?.className || ''}`.toLowerCase();
                const rowStyle = getComputedStyle(row);
                const labelStyle = labelElement === row ? rowStyle : getComputedStyle(labelElement);
                const opacity = Math.min(
                    Number.parseFloat(rowStyle.opacity || '1'),
                    Number.parseFloat(labelStyle.opacity || '1')
                );
                const hidden = runtimeItem?.disabled === true
                    || rowStyle.display === 'none'
                    || rowStyle.visibility === 'hidden'
                    || opacity < 0.6
                    || /(?:^|[\s_-])(hidden|disabled|dimmed)(?:$|[\s_-])/.test(classes);
                if (hidden) hiddenRows += 1;
                else visibleLabels.add(normalizeHighlightName(label));
            }
            return {
                constrained: hiddenRows > 0,
                rowCount: rows.length,
                hiddenRows,
                visibleLabels
            };
        };
        const thresholdHighlightLabelIsVisible = (label, visibility) => {
            if (!visibility?.constrained) return true;
            const normalized = normalizeHighlightName(label);
            return visibility.visibleLabels.has(normalized);
        };
        const projectFlotThresholdPoint = (plot, series, x, y) => {
            if (typeof plot?.pointOffset !== 'function') return null;
            const point = { x, y };
            const xAxisNumber = Number(series?.xaxis?.n);
            const yAxisNumber = Number(series?.yaxis?.n);
            if (Number.isInteger(xAxisNumber) && xAxisNumber > 0) point.xaxis = xAxisNumber;
            if (Number.isInteger(yAxisNumber) && yAxisNumber > 0) point.yaxis = yAxisNumber;
            const projected = plot.pointOffset(point);
            const left = Number(projected?.left);
            const top = Number(projected?.top);
            return Number.isFinite(left) && Number.isFinite(top) ? [left, top] : null;
        };
        const renderFlotThresholdHighlights = (root, rules) => {
            const $ = window.jQuery || window.$;
            const plotHost = $ && $(root).find('.graph-panel__chart').toArray().find(element => !!$(element).data('plot'));
            const plot = plotHost && $(plotHost).data('plot');
            if (!plotHost || !plot?.getData) return null;
            watchThresholdDataChanges(plot);
            const svg = createThresholdHighlightSvg(plotHost);
            if (!svg) return null;
            const plotSeries = plot.getData() || [];
            const legendVisibility = getThresholdHighlightLegendVisibility(root);
            if (legendVisibility.rowCount > 0 && legendVisibility.rowCount < plotSeries.length) {
                legendVisibility.constrained = true;
            }
            let drawn = 0;
            for (const series of plotSeries) {
                if (series.lines?.show === false && series.points?.show !== true) continue;
                if (!thresholdHighlightLabelIsVisible(series.label, legendVisibility)) continue;
                const rule = matchThresholdHighlightRule(series.label, rules);
                if (!rule) continue;
                const samples = buildThresholdHighlightSamples(
                    (series.data || []).map(point => ({ x: point?.[0], y: point?.[1] })),
                    rule.threshold,
                    (x, y) => projectFlotThresholdPoint(plot, series, x, y)
                );
                const color = typeof series.color === 'string' && series.color ? series.color : '#e02f44';
                const strokeWidth = getThresholdHighlightStrokeWidth(
                    series.lines?.lineWidth,
                    series.lines?.width,
                    series.lineWidth
                );
                drawn += appendThresholdHighlightRuns(svg, samples, color, strokeWidth);
            }
            if (!drawn) svg.remove();
            return { engine: 'flot', host: plotHost, overlay: drawn ? svg : null, drawn };
        };
        const getUPlotThresholdPlotOffset = uplot => {
            const rootRect = uplot?.root?.getBoundingClientRect?.();
            const overRect = uplot?.over?.getBoundingClientRect?.();
            if (rootRect && overRect && overRect.width > 0 && overRect.height > 0) {
                return {
                    left: overRect.left - rootRect.left,
                    top: overRect.top - rootRect.top
                };
            }
    
            // uPlot stores bbox in device pixels, while valToPos(..., false) and
            // this fixed SVG overlay use CSS pixels. The DOM overlay is preferred
            // above; this fallback keeps older Grafana uPlot builds and DPR > 1
            // aligned as well.
            const canvas = uplot?.ctx?.canvas || uplot?.root?.querySelector?.('canvas');
            const canvasRect = canvas?.getBoundingClientRect?.();
            const ratioX = canvasRect?.width > 0 && Number(canvas?.width) > 0
                ? Number(canvas.width) / canvasRect.width
                : (window.devicePixelRatio || 1);
            const ratioY = canvasRect?.height > 0 && Number(canvas?.height) > 0
                ? Number(canvas.height) / canvasRect.height
                : (window.devicePixelRatio || 1);
            return {
                left: Number(uplot?.bbox?.left || 0) / ratioX,
                top: Number(uplot?.bbox?.top || 0) / ratioY
            };
        };
        const renderUPlotThresholdHighlights = (root, rules) => {
            const uplot = findUPlot(root);
            if (!uplot?.root || typeof uplot.valToPos !== 'function') return null;
            watchThresholdDataChanges(uplot);
            const svg = createThresholdHighlightSvg(uplot.root);
            if (!svg) return null;
            const times = uplot.data?.[0] || [];
            const xScaleKey = uplot.series?.[0]?.scale || Object.keys(uplot.scales || {}).find(key => key === 'x') || 'x';
            const plotOffset = getUPlotThresholdPlotOffset(uplot);
            const legendVisibility = getThresholdHighlightLegendVisibility(root);
            let drawn = 0;
            (uplot.series || []).slice(1).forEach((series, offset) => {
                if (series.show === false) return;
                if (!thresholdHighlightLabelIsVisible(series.label, legendVisibility)) return;
                const rule = matchThresholdHighlightRule(series.label, rules);
                if (!rule) return;
                const values = uplot.data?.[offset + 1] || [];
                const yScaleKey = series.scale || getUPlotYScaleKey(uplot);
                const samples = buildThresholdHighlightSamples(
                    times.map((time, index) => ({ x: time, y: values[index] })),
                    rule.threshold,
                    (time, value) => [
                        plotOffset.left + uplot.valToPos(time, xScaleKey, false),
                        plotOffset.top + uplot.valToPos(value, yScaleKey, false)
                    ]
                );
                let color = series.stroke;
                try { color = typeof color === 'function' ? color(uplot, offset + 1) : color; }
                catch { color = null; }
                const strokeWidth = getThresholdHighlightStrokeWidth(series.width);
                drawn += appendThresholdHighlightRuns(
                    svg,
                    samples,
                    typeof color === 'string' && color ? color : '#e02f44',
                    strokeWidth
                );
            });
            if (!drawn) svg.remove();
            return { engine: 'uplot', host: uplot.root, overlay: drawn ? svg : null, drawn };
        };
        const renderThresholdHighlights = (root, rules, controller) => {
            if (controller) controller.overlay = null;
            // Highlight SVGs live under document.body (outside Grafana's React
            // subtree). When a panel is remounted into View, its old root cannot
            // find that fixed overlay. Clear it globally before projecting points
            // against the newly mounted plot dimensions.
            removeThresholdHighlightOverlays();
            if (!isThresholdHighlightRootActive(root) || !rules.length) {
                return { engine: 'none', host: null, overlay: null, drawn: 0 };
            }
            const result = renderFlotThresholdHighlights(root, rules)
                || renderUPlotThresholdHighlights(root, rules)
                || { engine: 'unknown', host: null, overlay: null, drawn: 0 };
            if (controller) controller.overlay = result.overlay || null;
            return result;
        };
        const scheduleThresholdHighlightRender = root => {
            const controller = thresholdHighlightControllers.get(root);
            if (controller?.enabled) controller.schedule?.();
        };
        const stopThresholdHighlightController = (root, controller) => {
            if (!controller) return;
            controller.enabled = false;
            controller.lifecycleChecksRemaining = 0;
            if (controller.frame) cancelAnimationFrame(controller.frame);
            controller.frame = 0;
            controller.resizeObserver?.disconnect();
            controller.resizeObserver = null;
            controller.mutationObserver?.disconnect();
            controller.mutationObserver = null;
            window.removeEventListener('resize', controller.viewportListener);
            window.removeEventListener('scroll', controller.viewportListener, true);
            window.removeEventListener('dashbridgeThresholdDataUpdated', controller.dataListener);
            document.removeEventListener('click', controller.lifecycleClickListener, true);
            (root === document ? document.documentElement : root)?.removeEventListener?.('click', controller.legendClickListener, true);
            controller.overlay?.remove?.();
            controller.overlay = null;
            controller.host = null;
        };
        const setSeriesThresholdHighlights = ({ root = document, enabled = false, rules = [] } = {}) => {
            const normalizedRules = enabled ? rules.filter(rule => Number.isFinite(Number(rule?.threshold))).map(rule => ({
                threshold: Number(rule.threshold),
                sourceNames: [...new Set((rule.sourceNames || []).map(String).filter(Boolean))]
            })) : [];
            let controller = thresholdHighlightControllers.get(root);
            if (!controller) {
                controller = {
                    rules: [], enabled: false, host: null, overlay: null,
                    resizeObserver: null, mutationObserver: null, frame: 0,
                    schedule: null, viewportListener: null, dataListener: null,
                    legendClickListener: null, lifecycleClickListener: null,
                    lifecycleChecksRemaining: 0,
                    stats: { scheduleRequests: 0, renderedFrames: 0, mutationBatches: 0, relevantMutationBatches: 0, resizeEvents: 0 }
                };
                thresholdHighlightControllers.set(root, controller);
            }
            controller.rules = normalizedRules;
            controller.enabled = enabled && normalizedRules.length > 0;
            const render = () => {
                if (controller.enabled && !isThresholdHighlightRootActive(root)) {
                    stopThresholdHighlightController(root, controller);
                    window.dispatchEvent(new Event('dashbridgeThresholdHighlightRootDetached'));
                }
                const result = renderThresholdHighlights(root, controller.enabled ? controller.rules : [], controller);
                if (controller.host !== result.host) {
                    controller.resizeObserver?.disconnect();
                    controller.resizeObserver = null;
                    controller.host = result.host;
                    if (result.host && typeof ResizeObserver === 'function') {
                        controller.resizeObserver = new ResizeObserver(() => {
                            controller.stats.resizeEvents += 1;
                            controller.schedule?.();
                        });
                        controller.resizeObserver.observe(result.host);
                    }
                }
                const hostRect = result.host?.getBoundingClientRect?.();
                const overlayRect = result.overlay?.getBoundingClientRect?.();
                window.__dashbridgeThresholdHighlightDiagnostic = {
                    at: Date.now(),
                    enabled: controller.enabled,
                    engine: result.engine,
                    drawn: result.drawn,
                    rootConnected: root === document || root?.isConnected === true,
                    host: hostRect ? {
                        left: hostRect.left, top: hostRect.top,
                        width: hostRect.width, height: hostRect.height
                    } : null,
                    overlay: overlayRect ? {
                        left: overlayRect.left, top: overlayRect.top,
                        width: overlayRect.width, height: overlayRect.height
                    } : null,
                    overlayCount: document.querySelectorAll?.('[data-dashbridge-threshold-highlights]').length || 0,
                    lifecycle: { ...controller.stats },
                    url: location.href
                };
                return result;
            };
            controller.schedule ||= () => {
                controller.stats.scheduleRequests += 1;
                if (!controller.enabled || controller.frame) return;
                controller.frame = requestAnimationFrame(() => {
                    controller.frame = 0;
                    controller.stats.renderedFrames += 1;
                    render();
                    if (controller.enabled && controller.lifecycleChecksRemaining > 0) {
                        controller.lifecycleChecksRemaining -= 1;
                        controller.schedule();
                    }
                });
            };
            controller.viewportListener ||= () => controller.schedule();
            controller.dataListener ||= () => controller.schedule();
            // View close can be committed as either a DOM removal or a visibility
            // change. A page click gives both paths one paint-boundary lifecycle
            // check without observing Grafana's continuously changing attributes.
            controller.lifecycleClickListener ||= event => {
                let inView = false;
                try { inView = new URL(location.href).searchParams.has('viewPanel'); } catch { /* no-op */ }
                if (!inView || !event.target?.closest?.('button,a,[role="button"]')) return;
                controller.lifecycleChecksRemaining = 24;
                controller.schedule();
            };
            controller.legendClickListener ||= event => {
                if (!event.target?.closest?.('.graph-legend-series, [class*="legend-item" i], .u-legend, [class*="Legend"]')) return;
                controller.schedule();
            };
            if (controller.enabled) {
                if (!controller.mutationObserver && typeof MutationObserver === 'function') {
                    controller.mutationObserver = new MutationObserver(records => {
                        controller.stats.mutationBatches += 1;
                        const lifecycleRoot = root === document ? document.documentElement : root;
                        const touchesLifecycleRoot = node => node?.nodeType === Node.ELEMENT_NODE
                            && (node === lifecycleRoot
                                || node.contains?.(lifecycleRoot)
                                || lifecycleRoot?.contains?.(node));
                        const pageLayoutChanged = records.some(record => {
                            if (isThresholdHighlightOverlayNode(record.target)) return false;
                            const changedNodes = [...record.addedNodes, ...record.removedNodes]
                                .filter(node => !isThresholdHighlightOverlayNode(node));
                            if (!changedNodes.length) return false;
                            return lifecycleRoot?.contains?.(record.target)
                                || changedNodes.some(touchesLifecycleRoot);
                        });
                        if (pageLayoutChanged) {
                            controller.stats.relevantMutationBatches += 1;
                            controller.schedule();
                        }
                    });
                    // Grafana moves or remounts a panel outside its old root when
                    // opening View. Observe the page lifecycle so that the fixed
                    // body-level SVG is reprojected after that DOM transition.
                    // Observe only child-list changes touching this panel. Grafana
                    // updates unrelated class/style attributes every animation
                    // frame; treating those as panel layout changes caused a
                    // permanent threshold-overlay RAF loop and very high CPU.
                    controller.mutationObserver.observe(document.documentElement, {
                        subtree: true,
                        childList: true
                    });
                }
                window.addEventListener('resize', controller.viewportListener);
                window.addEventListener('scroll', controller.viewportListener, true);
                window.addEventListener('dashbridgeThresholdDataUpdated', controller.dataListener);
                document.addEventListener('click', controller.lifecycleClickListener, true);
                (root === document ? document.documentElement : root).addEventListener('click', controller.legendClickListener, true);
            } else {
                stopThresholdHighlightController(root, controller);
            }
            const result = render();
            return { enabled: controller.enabled, rules: normalizedRules.length, engine: result.engine, drawn: result.drawn };
        };
    
        const setThreshold = ({ root = document, enabled = false, value = 0, rawValue = null } = {}) => {
            root.querySelectorAll?.('[data-dashbridge-threshold-line]').forEach(el => el.remove());
            root?.removeAttribute?.('data-dashbridge-threshold-engine');
            if (!enabled || !Number.isFinite(Number(value))) {
                stopThresholdLayoutChangesInRoot(root);
                return { enabled: false, exceeded: false, unit: '' };
            }
            const threshold = Number(value);
            const hasRawValue = rawValue !== null && rawValue !== '' && Number.isFinite(Number(rawValue));
            const $ = window.jQuery || window.$;
            const plotHost = $ && $(root).find('.graph-panel__chart').toArray().find(el => !!$(el).data('plot'));
            if (plotHost) {
                const plot = $(plotHost).data('plot');
                watchThresholdDataChanges(plot);
                watchThresholdLayoutChanges(plotHost);
                const axis = plot.getAxes?.().yaxis;
                const series = plot.getData?.() || [];
                const candidates = series.map((item, index) => {
                    const points = (item.data || []).filter(point => Number.isFinite(point?.[1]));
                    const latest = points.length ? points[points.length - 1][1] : null;
                    return { name: item.label || `Серия ${index + 1}`, value: latest, visible: item.lines?.show !== false || item.points?.show !== false };
                }).filter(item => item.visible && Number.isFinite(item.value));
                const max = candidates.reduce((best, item) => !best || item.value > best.value ? item : best, null);
                const axisUnit = inferUnitFromAxisTicks(axis?.ticks);
                const { unit, factor } = mergeAxisAndPanelUnit(axisUnit, getCachedPanelDefinition());
                const rawThreshold = hasRawValue ? Number(rawValue) : threshold * factor;
                const displayThreshold = rawThreshold / factor;
                const plotOffset = plot.getPlotOffset?.();
                const plotWidth = plot.width?.();
                const plotHeight = plot.height?.();
                const position = Number.isFinite(axis?.min) && Number.isFinite(axis?.max) && axis.max > axis.min
                    && Number.isFinite(plotOffset?.left) && Number.isFinite(plotOffset?.top)
                    && Number.isFinite(plotWidth) && Number.isFinite(plotHeight)
                    ? {
                        left: plotOffset.left,
                        width: plotWidth,
                        top: plotOffset.top + ((axis.max - rawThreshold) / (axis.max - axis.min)) * plotHeight,
                        topMin: plotOffset.top,
                        topMax: plotOffset.top + plotHeight
                    }
                    : null;
                drawThresholdLine(root, rawThreshold, axis?.min, axis?.max, unit, position, displayThreshold);
                root?.setAttribute?.('data-dashbridge-threshold-engine', 'flot');
                return { enabled: true, exceeded: !!max && max.value > rawThreshold, seriesName: max?.name || '', currentValue: max ? max.value / factor : null, threshold: displayThreshold, rawThreshold, factor, unit, engine: 'flot' };
            }
            const uplot = findUPlot(root);
            if (uplot) {
                watchThresholdDataChanges(uplot);
                const yScaleKey = getUPlotYScaleKey(uplot);
                const yScale = uplot.scales?.[yScaleKey];
                const candidates = (uplot.series || []).slice(1).map((item, offset) => {
                    const values = uplot.data?.[offset + 1] || [];
                    // BUG-F fix: ищем последнее конечное значение, коррелируя с временным массивом.
                    // uPlot хранит data[0] = timestamps, data[i] = values; итерируем с конца,
                    // чтобы получить значение в последний момент времени, а не случайное.
                    const times = uplot.data?.[0] || [];
                    let latest;
                    for (let i = times.length - 1; i >= 0; i--) {
                        if (Number.isFinite(values[i])) { latest = values[i]; break; }
                    }
                    return { name: item.label || `Серия ${offset + 1}`, value: latest, visible: item.show !== false };
                }).filter(item => item.visible && Number.isFinite(item.value));
                const max = candidates.reduce((best, item) => !best || item.value > best.value ? item : best, null);
                const { unit, factor } = mergeAxisAndPanelUnit(
                    getUPlotUnitDetails(uplot, yScaleKey, yScale),
                    getCachedPanelDefinition()
                );
                const rawThreshold = hasRawValue ? Number(rawValue) : threshold * factor;
                const displayThreshold = rawThreshold / factor;
                const bbox = uplot.bbox;
                const pxRatio = uplot.pxRatio || window.devicePixelRatio || 1;
                const position = Number.isFinite(yScale?.min) && Number.isFinite(yScale?.max) && yScale.max > yScale.min && bbox
                    ? {
                        left: bbox.left / pxRatio,
                        width: bbox.width / pxRatio,
                        top: (bbox.top + ((yScale.max - rawThreshold) / (yScale.max - yScale.min)) * bbox.height) / pxRatio,
                        topMin: bbox.top / pxRatio,
                        topMax: (bbox.top + bbox.height) / pxRatio
                    }
                    : null;
                const thresholdRoot = uplot.root || root;
                drawThresholdLine(thresholdRoot, rawThreshold, yScale?.min, yScale?.max, unit, position, displayThreshold);
                root?.setAttribute?.('data-dashbridge-threshold-engine', 'uplot');
                return { enabled: true, exceeded: !!max && max.value > rawThreshold, seriesName: max?.name || '', currentValue: max ? max.value / factor : null, threshold: displayThreshold, rawThreshold, factor, unit, engine: 'uplot' };
            }
            return { enabled: true, exceeded: false, threshold, unit: '', engine: 'unknown' };
        };
    

        const getThresholdDebug = () => {
            const root = document;
            const uplot = findUPlot(root);
            if (!uplot) return { engine: 'unknown' };
            const yScaleKey = getUPlotYScaleKey(uplot);
            const yScale = uplot.scales?.[yScaleKey];
            const labels = getUPlotAxisLabels(uplot, yScaleKey, yScale);
            return {
                engine: 'uplot',
                yScaleKey,
                yScale,
                yAxisLabels: labels,
                series: (uplot.series || []).map((series, index) => ({ index, label: series.label, show: series.show })),
                lastValues: (uplot.data || []).map(values => Array.from(values || []).filter(Number.isFinite).slice(-1)[0] ?? null)
            };
        };
    

        return Object.freeze({
            getThresholdDebug,
            getThresholdUnit,
            getThresholdUnitAsync,
            getUPlotUnitDetails,
            getUPlotYScaleKey,
            scheduleThresholdHighlightRender,
            setSeriesThresholdHighlights,
            setThreshold,
        });
    }

    root.DashBridgeGrafanaThresholdVisuals = Object.freeze({ create });
})(window);
