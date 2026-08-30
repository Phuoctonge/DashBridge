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
    const { collectGrafanaTableRecords } = tableReport;

    // Collects diagnostics in E2E environments
    const debugLog = (...args) => {
        if (window.__dashbridgeDebugLogs) {
            window.__dashbridgeDebugLogs.push(`[${new Date().toISOString()}] [VisualEngine] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
        }
    };

    const extensionOrigin = new URL(location.ancestorOrigins?.[0] || document.referrer || location.href).origin;
    const legacyVisualObserverOwners = new Set();
    let legacyObserverDocumentSweepCompleted = false;
    const legacyObserverDiagnostic = window.__dashbridgeLegacyVisualObserverDiagnostic
        || (window.__dashbridgeLegacyVisualObserverDiagnostic = {
            created: 0,
            disconnected: 0,
            pendingFramesCancelled: 0,
            documentSweeps: 0,
            activeOwners: 0,
            lastActionAt: null,
        });
    const getSeriesConfigState = (config, label) => {
        if (!config || !label) return true;
        if (config[label] !== undefined) return !!config[label];
        const lower = label.toLowerCase();
        if (lower.includes('(calc)')) {
            if (lower.includes('load % (calc)')) {
                const idle = label.replace(/load % \(calc\)/i, 'idle');
                const idleCap = label.replace(/load % \(calc\)/i, 'Idle');
                if (config[idle] !== undefined) return !!config[idle];
                if (config[idleCap] !== undefined) return !!config[idleCap];
            } else if (lower.includes('used % (calc)')) {
                const prefix = label.replace(/used % \(calc\)/i, '').trim();
                const fallback = Object.keys(config).find(k => k.startsWith(prefix) && (k.toLowerCase().includes('available') || k.toLowerCase().includes('free')));
                if (fallback) return !!config[fallback];
            }
        }
        return true;
    };

    const applyPopupLegendAndVisuals = async (panelIdArg, seriesConfigArg, modeArg, removeAreaFillArg, thickenLinesArg = false, thickenLinesValueArg = 1.5, invertLegendArg = false) => {
        debugLog('applyPopupLegendAndVisuals called', { panelIdArg, removeAreaFillArg, thickenLinesArg });

        const ensureResponsiveLegendStyles = () => {
            if (document.getElementById('dashbridge-responsive-legend-style')) return;
            const style = document.createElement('style');
            style.id = 'dashbridge-responsive-legend-style';
            style.textContent = `
                .dashbridge-legend-bottom { min-width:0 !important; width:100% !important; table-layout:auto !important; overflow-x:hidden !important; }
                .dashbridge-legend-bottom tr {
                    display:flex !important;
                    width:100% !important;
                    min-width:0 !important;
                    box-sizing:border-box !important;
                }
                /* Grafana table legends right-align the name cell by default.
                   Once a row becomes a flex row this leaves its label visually
                   centred between the colour marker and numeric columns. Keep
                   the series name anchored to the left edge of the panel. */
                .dashbridge-legend-bottom tr > :first-child {
                    width:auto !important;
                    flex:1 1 0% !important;
                    min-width:0 !important;
                    overflow:hidden !important;
                    text-align:left !important;
                    text-overflow:ellipsis !important;
                    white-space:nowrap !important;
                }
                .dashbridge-legend-bottom tr > :first-child [class*="LegendLabel"] {
                    display:inline-block !important;
                    max-width:100% !important;
                    text-align:left !important;
                    vertical-align:middle !important;
                }
                .dashbridge-legend-bottom tr > :not(:first-child) {
                    width:48px !important;
                    min-width:48px !important;
                    max-width:48px !important;
                    flex:0 0 48px !important;
                    box-sizing:border-box !important;
                    text-align:right !important;
                    white-space:nowrap !important;
                }
                .dashbridge-legend-bottom tr > .dashbridge-vcpu-legend-cell {
                    width:48px !important;
                    min-width:48px !important;
                    max-width:48px !important;
                    flex:0 0 48px !important;
                    box-sizing:border-box !important;
                }
                .dashbridge-legend-bottom [class*="LegendLabel"] {
                    flex:1 1 0% !important;
                    min-width:0 !important;
                    max-width:100% !important;
                    overflow:hidden !important;
                    text-overflow:ellipsis !important;
                    white-space:nowrap !important;
                }
            `;
            document.head.appendChild(style);
        };

        // Мы вызовем resize позже, после манипуляций с DOM

        const containerSelectors = '.react-grid-item, .panel-container, [data-testid^="data-testid Panel header"], [data-panelid], [data-viz-panel-key^="panel-"]';
        const findTarget = () => {
            if (panelIdArg) {
                const rawId = String(panelIdArg);
                const numericId = rawId.replace(/^panel-/, '');
                const vizKey = rawId.startsWith('panel-') ? rawId : `panel-${rawId}`;
                const panel = document.querySelector(
                    `[data-panelid="${rawId}"], [data-panelid="${numericId}"], [data-panel-id="${rawId}"], [data-panel-id="${numericId}"], #panel-${numericId}, [data-viz-panel-key="${vizKey}"]`
                );
                if (panel) return panel;
            }
            const fullscreen = document.querySelector('.react-grid-item--fullscreen, .panel-in-fullscreen, .panel-fullscreen, [class*="fullscreen"]');
            if (fullscreen) return fullscreen;

            const panels = Array.from(document.querySelectorAll(containerSelectors));
            const visiblePanels = panels.filter(p => p.offsetHeight > 100);
            if (visiblePanels.length === 1) return visiblePanels[0];
            return visiblePanels.find(p => p.querySelector('canvas')) || visiblePanels[0];
        };

        const targetPanel = findTarget();
        if (!targetPanel) return;

        // In Grafana 12 `data-viz-panel-key` belongs to an inner visualization
        // node while the canvas and legend can be siblings in the grid item.
        // Do not stop climbing at that inner key node: styling it made the
        // layout branch unable to find the legend on modern dashboards.
        let outerPanel = window.DashBridgeGrafanaDom?.outerPanel?.(targetPanel) || targetPanel;
        while (outerPanel && !outerPanel.classList.contains('react-grid-item') && !outerPanel.classList.contains('panel-container') && outerPanel.parentElement) {
            outerPanel = outerPanel.parentElement;
        }
        if (!outerPanel) outerPanel = targetPanel;

        const legendOriginalDirectionKey = '__dashBridgeLegendOriginalDirection';
        const legendOriginalXAxisIncrementKey = '__dashBridgeLegendOriginalXAxisIncrement';
        const legendAppliedLayoutKey = '__dashBridgeLegendAppliedLayout';
        const currentUPlot = findUPlotForThreshold(outerPanel);
        const currentXAxisIncrement = currentUPlot?.axes?.[0]?._found?.[0];
        // Moving a legend temporarily changes the plot width. uPlot can choose
        // a denser time increment during that resize and keep it when the
        // original layout is restored. Remember the native increment once per
        // ON lifecycle so OFF can reproduce the pre-DashBridge time grid.
        if (invertLegendArg
            && !Object.prototype.hasOwnProperty.call(outerPanel, legendOriginalXAxisIncrementKey)
            && Number.isFinite(currentXAxisIncrement)) {
            outerPanel[legendOriginalXAxisIncrementKey] = currentXAxisIncrement;
        }
        if (!invertLegendArg) delete outerPanel[legendOriginalDirectionKey];

        // --- Изменение позиции легенды ---
        const applyLegendLayout = () => {
            const chartHost = outerPanel.querySelector('.graph-panel__chart, .uplot');
            if (!chartHost) return null;

            let flexContainer = chartHost.parentElement;
            while (flexContainer && flexContainer !== outerPanel) {
                const style = getComputedStyle(flexContainer);
                if (style.display === 'flex' && style.flexDirection.match(/row|column/)) {
                    break;
                }
                flexContainer = flexContainer.parentElement;
            }

            if (!flexContainer || flexContainer === outerPanel) {
                // Flot fallback
                const graphPanel = outerPanel.querySelector('.graph-panel');
                if (graphPanel) flexContainer = graphPanel;
                else return null;
            }

            // Grafana 12 can mount the chart and its React legend in separate
            // descendants of the grid item.  Look across the whole panel and
            // derive the table from the actual legend row as a final fallback.
            // Restricting this search to chartHost's flex branch made H7 fail
            // on dashboards whose legend is a sibling of that branch.
            const legendRow = flexContainer.querySelector('tr[class*="LegendRow"], .u-legend tr, .u-legend-row')
                || outerPanel.querySelector('tr[class*="LegendRow"], .u-legend tr, .u-legend-row');
            const legendItems = Array.from(window.DashBridgeGrafanaDom?.legendItems?.(outerPanel) || []);
            const legendItem = legendItems[0];
            const legendSelectors = '.graph-legend, .legend-container, .u-legend, [class*="legend-container" i], [class*="LegendTable" i]';
            const containsAllLegendItems = candidate => candidate
                && legendItems.length > 0
                && legendItems.every(item => candidate.contains(item));
            const sharedLegendAncestor = () => {
                // A virtualized Grafana 12 legend may expose buttons without a
                // stable container class. Find the lowest common ancestor of all
                // visible entries instead of styling the first entry's wrapper.
                if (!legendItems.length) return null;
                let candidate = legendItem;
                while (candidate && candidate !== outerPanel) {
                    if (containsAllLegendItems(candidate)) return candidate;
                    candidate = candidate.parentElement;
                }
                return null;
            };
            const namedLegendElement = legendRow?.closest(`table, [role="table"], .u-legend, ${legendSelectors}`)
                || legendItem?.closest?.(`table, [role="table"], .u-legend, ${legendSelectors}`)
                || flexContainer.querySelector(legendSelectors)
                || outerPanel.querySelector(legendSelectors);
            const legendElement = (namedLegendElement && (!legendItems.length || containsAllLegendItems(namedLegendElement)))
                ? namedLegendElement
                : sharedLegendAncestor();
            const findFlexChild = element => {
                let child = element;
                while (child?.parentElement && child.parentElement !== flexContainer) child = child.parentElement;
                return child?.parentElement === flexContainer ? child : null;
            };
            const chartBranch = findFlexChild(chartHost);
            const legendBranch = findFlexChild(legendElement);
            const legendLayoutSnapshotKey = '__dashBridgeLegendLayoutSnapshot';
            const snapshotLegendLayout = element => {
                if (!element || Object.prototype.hasOwnProperty.call(element, legendLayoutSnapshotKey)) return;
                element[legendLayoutSnapshotKey] = element.getAttribute('style');
            };
            const restoreLegendLayout = element => {
                if (!element || !Object.prototype.hasOwnProperty.call(element, legendLayoutSnapshotKey)) return;
                const savedStyle = element[legendLayoutSnapshotKey];
                if (savedStyle === null) element.removeAttribute('style');
                else element.setAttribute('style', savedStyle);
                if (!invertLegendArg) delete element[legendLayoutSnapshotKey];
            };
            const layoutElements = [flexContainer, chartBranch, legendBranch, chartHost, legendElement];
            const previousAppliedLayout = outerPanel[legendAppliedLayoutKey];
            const savedOriginalDirection = outerPanel[legendOriginalDirectionKey];
            const expectedDirection = savedOriginalDirection === 'row' ? 'column'
                : (savedOriginalDirection === 'column' ? 'row' : null);
            const layoutAlreadyApplied = !!invertLegendArg && !!expectedDirection
                && previousAppliedLayout?.flexContainer === flexContainer
                && previousAppliedLayout?.chartHost === chartHost
                && previousAppliedLayout?.legendElement === legendElement
                && previousAppliedLayout?.direction === expectedDirection
                && flexContainer.isConnected && chartHost.isConnected
                && (!legendElement || legendElement.isConnected)
                && flexContainer.style.getPropertyValue('flex-direction') === expectedDirection
                && (expectedDirection !== 'column' || legendElement?.classList.contains('dashbridge-legend-bottom'));
            if (layoutAlreadyApplied) {
                return { chartHost, chartBranch, flexContainer, legendElement, layoutChanged: false };
            }
            const hadSavedLayout = layoutElements.some(element => element
                && Object.prototype.hasOwnProperty.call(element, legendLayoutSnapshotKey));
            layoutElements.forEach(snapshotLegendLayout);
            layoutElements.forEach(restoreLegendLayout);
            legendElement?.classList.remove('dashbridge-legend-bottom');

            if (!invertLegendArg) {
                delete outerPanel[legendAppliedLayoutKey];
                debugLog('legend layout restored', {
                    savedOriginalDirection: outerPanel[legendOriginalDirectionKey] || null,
                    flexClass: flexContainer.className,
                    legendClass: legendElement?.className || '',
                });
                return { chartHost, chartBranch, flexContainer, legendElement, layoutChanged: hadSavedLayout };
            }

            const currentStyle = getComputedStyle(flexContainer);
            const chartRect = chartHost.getBoundingClientRect();
            const legendRect = legendElement?.getBoundingClientRect();
            const legendIsBelow = !!(legendRect && legendRect.top >= chartRect.bottom - 2);
            const legendIsRight = !!(legendRect && legendRect.left >= chartRect.right - 2);
            const isRow = legendIsRight || (!legendIsBelow && (currentStyle.display === 'flex'
                ? currentStyle.flexDirection.includes('row')
                : (flexContainer.offsetWidth > flexContainer.offsetHeight * 1.5)));
            const grafanaLegendDirection = flexContainer.classList.contains('graph-panel--legend-right')
                ? 'row'
                : (flexContainer.classList.contains('graph-panel--legend-bottom') ? 'column' : null);
            // Capture the native direction only once per enabled lifecycle. A
            // repeated apply first restores the saved inline styles; overwriting
            // this value afterwards would make DashBridge's own layout the new
            // baseline and break both inversion and OFF restoration.
            if (!Object.prototype.hasOwnProperty.call(outerPanel, legendOriginalDirectionKey)) {
                outerPanel[legendOriginalDirectionKey] = grafanaLegendDirection || (isRow ? 'row' : 'column');
            }
            const originalDirection = outerPanel[legendOriginalDirectionKey];
            const moveToBottom = originalDirection === 'row';
            debugLog('legend layout decision', {
                originalDirection,
                targetDirection: moveToBottom ? 'column' : 'row',
                detected: { grafanaLegendDirection, legendIsBelow, legendIsRight, isRow },
                geometry: { chart: chartRect.toJSON?.() || chartRect, legend: legendRect?.toJSON?.() || legendRect },
                nodes: {
                    flexClass: flexContainer.className,
                    legendClass: legendElement?.className || '',
                    chartBranch: !!chartBranch,
                    legendBranch: !!legendBranch,
                },
            });

            flexContainer.style.setProperty('display', 'flex', 'important');
            flexContainer.style.setProperty('flex-wrap', 'nowrap', 'important');
            flexContainer.style.setProperty('align-items', 'stretch', 'important');
            flexContainer.style.setProperty('padding', '0', 'important');
            flexContainer.style.setProperty('height', '100%', 'important');
            flexContainer.style.setProperty('max-height', '100%', 'important');
            flexContainer.style.setProperty('box-sizing', 'border-box', 'important');
            flexContainer.style.setProperty('overflow', 'hidden', 'important');

            const setChartBranch = () => {
                const branch = chartBranch || chartHost;
                branch.style.setProperty('flex', '1 1 0%', 'important');
                branch.style.setProperty('min-width', '0', 'important');
                branch.style.setProperty('min-height', '0', 'important');
                branch.style.setProperty('position', 'relative', 'important');
                branch.style.setProperty('overflow', 'hidden', 'important');
            };
            setChartBranch();

            if (moveToBottom) {
                ensureResponsiveLegendStyles();
                flexContainer.style.setProperty('flex-direction', 'column', 'important');
                (chartBranch || chartHost).style.setProperty('width', '100%', 'important');
                // In narrow DashBridge cards Grafana can leave the nested chart
                // host at its old horizontal width (zero).  The flex branch alone
                // is not enough: uPlot measures this element itself.
                chartHost.style.setProperty('width', '100%', 'important');
                if (legendElement) {
                    const branch = legendBranch || legendElement;
                    branch.style.setProperty('width', '100%', 'important');
                    branch.style.setProperty('max-width', 'none', 'important');
                    branch.style.setProperty('height', 'auto', 'important');
                    branch.style.setProperty('max-height', '35%', 'important');
                    branch.style.setProperty('min-height', '0', 'important');
                    branch.style.setProperty('flex', '0 1 35%', 'important');
                    branch.style.setProperty('overflow-y', 'auto', 'important');
                    branch.style.setProperty('overflow-x', 'hidden', 'important');
                    branch.style.setProperty('margin', '0', 'important');
                    branch.style.setProperty('position', 'relative', 'important');
                    legendElement.style.setProperty('width', '100%', 'important');
                    legendElement.style.setProperty('max-width', 'none', 'important');
                    legendElement.style.setProperty('height', 'auto', 'important');
                    legendElement.style.setProperty('max-height', '35%', 'important');
                    legendElement.style.setProperty('min-height', '0', 'important');
                    legendElement.style.setProperty('flex', '0 1 35%', 'important');
                    legendElement.style.setProperty('overflow-y', 'auto', 'important');
                    legendElement.style.setProperty('overflow-x', 'hidden', 'important');
                    legendElement.style.setProperty('margin', '0', 'important');
                    legendElement.style.setProperty('position', 'relative', 'important');
                    legendElement.classList.add('dashbridge-legend-bottom');
                    legendElement.querySelectorAll('[class*="LegendLabel"]').forEach(label => {
                        if (!label.getAttribute('title')) label.setAttribute('title', label.textContent?.trim() || '');
                    });
                }
            } else {
                flexContainer.style.setProperty('flex-direction', 'row', 'important');
                (chartBranch || chartHost).style.setProperty('height', '100%', 'important');
                if (legendElement) {
                    const branch = legendBranch || legendElement;
                    branch.style.setProperty('height', '100%', 'important');
                    branch.style.setProperty('max-height', 'none', 'important');
                    branch.style.setProperty('width', 'max-content', 'important');
                    branch.style.setProperty('max-width', '50%', 'important');
                    branch.style.setProperty('min-width', '150px', 'important');
                    branch.style.setProperty('flex', '0 0 auto', 'important');
                    branch.style.setProperty('overflow-y', 'auto', 'important');
                    branch.style.setProperty('overflow-x', 'auto', 'important');
                    branch.style.setProperty('margin', '0', 'important');
                    branch.style.setProperty('position', 'relative', 'important');
                    legendElement.style.setProperty('height', '100%', 'important');
                    legendElement.style.setProperty('max-height', 'none', 'important');
                    legendElement.style.setProperty('width', 'max-content', 'important');
                    legendElement.style.setProperty('max-width', '50%', 'important');
                    legendElement.style.setProperty('min-width', '150px', 'important');
                    legendElement.style.setProperty('flex', '0 0 auto', 'important');
                    legendElement.style.setProperty('overflow-y', 'auto', 'important');
                    legendElement.style.setProperty('overflow-x', 'auto', 'important');
                    legendElement.style.setProperty('margin', '0', 'important');
                    legendElement.style.setProperty('position', 'relative', 'important');
                }
            }
            outerPanel[legendAppliedLayoutKey] = {
                flexContainer, chartHost, legendElement,
                direction: moveToBottom ? 'column' : 'row',
            };
            return { chartHost, chartBranch, flexContainer, legendElement, layoutChanged: true };
        };
        const legendLayout = applyLegendLayout();
        const resizeUPlotAfterLegendLayout = async () => {
            if (!legendLayout) return false;
            if (legendLayout.layoutChanged) {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }
            const uplot = findUPlotForThreshold(outerPanel);
            const { chartHost, chartBranch } = legendLayout;
            const sizeTarget = chartBranch || chartHost;
            const rect = sizeTarget.getBoundingClientRect();
            const width = Math.max(1, Math.round(rect.width));
            const height = Math.max(1, Math.round(rect.height));
            if (!uplot?.setSize || width < 2 || height < 2) return false;
            if (Math.round(uplot.width || 0) === width && Math.round(uplot.height || 0) === height) return false;
            const xAxis = uplot.axes?.[0];
            const savedXAxisIncrement = outerPanel[legendOriginalXAxisIncrementKey];
            const originalXAxisIncrements = xAxis?._incrs;
            const restoreNativeTimeGrid = !invertLegendArg
                && Number.isFinite(savedXAxisIncrement)
                && typeof originalXAxisIncrements === 'function';
            if (restoreNativeTimeGrid) xAxis._incrs = () => [savedXAxisIncrement];
            try {
                uplot.setSize({ width, height });
                uplot.redraw?.(true, true);
            } finally {
                if (restoreNativeTimeGrid) xAxis._incrs = originalXAxisIncrements;
                if (!invertLegendArg) delete outerPanel[legendOriginalXAxisIncrementKey];
            }
            return true;
        };
        const uplotResizedAfterLegendLayout = await resizeUPlotAfterLegendLayout();
        // Grafana кэширует window.innerWidth и игнорирует resize, если он не изменился.
        // Единственный 100% рабочий способ - попросить родительский Dashbridge 
        // физически изменить ширину нашего iframe на 1px.
        if (legendLayout?.layoutChanged || uplotResizedAfterLegendLayout) {
            if (window.parent !== window) {
                window.parent.postMessage({ action: 'dashbridgeNeedsResize' }, extensionOrigin);
            } else {
                window.dispatchEvent(new Event('resize'));
            }
        }


        const legendItems = Array.from(outerPanel.querySelectorAll('.graph-legend-series, [class*="legend-item" i], .u-legend tr, .u-legend-row, [class*="LegendRow"]'));

        // --- Шаг 1: Восстанавливаем элементы, ранее физически скрытые bridge'ем ---
        for (let i = 0; i < legendItems.length; i++) {
            const item = legendItems[i];
            if (item.getAttribute('data-legend-hidden-by-bridge') === 'true') {
                const oldDisplay = item.getAttribute('data-old-display');
                if (!oldDisplay) item.style.removeProperty('display');
                else item.style.setProperty('display', oldDisplay);
                item.removeAttribute('data-old-display');
                item.removeAttribute('data-legend-hidden-by-bridge');
            }
        }

        const hasConfig = seriesConfigArg && Object.keys(seriesConfigArg).length > 0;
        let redrawSuccess = false;
        try {
            const findUPlot = (rootEl) => {
                return findUPlotForThreshold(rootEl);
            };

            const buildActivePalette = series => {
                const active = series.filter(item => item.active);
                if (active.length === series.length) return null;
                const palette = series.map(item => item.originalColour).filter(Boolean);
                return new Map(active.map((item, index) => [item.key, palette[index % palette.length]]));
            };

            const applyActivePalette = (key, originalColour, colours) => colours?.get(key) || originalColour;

            const getMarkerSeriesName = marker => {
                if (marker.nextElementSibling?.textContent) return marker.nextElementSibling.textContent.trim().replace(/:$/, '');
                if (marker.closest('tr')) {
                    const label = marker.closest('tr').querySelector('[class*="label" i], [class*="name" i], td:nth-child(2), td:first-child');
                    if (label) return label.textContent.trim().replace(/:$/, '');
                }
                if (marker.parentElement?.nextElementSibling) return marker.parentElement.nextElementSibling.textContent.trim().replace(/:$/, '');
                return marker.parentElement?.textContent?.trim().replace(/:$/, '') || '';
            };

            const repaintMarker = (marker, colour) => {
                if (!marker || marker.closest('[data-dashbridge-threshold-line]')) return;
                if (marker.tagName.toLowerCase() !== 'svg' && (marker.offsetWidth > 50 || marker.offsetHeight > 50)) return;
                if (marker.__dashbridgeOriginalStyle === undefined) marker.__dashbridgeOriginalStyle = marker.getAttribute('style');
                if (!colour) {
                    if (marker.__dashbridgeOriginalStyle === null) marker.removeAttribute('style');
                    else marker.setAttribute('style', marker.__dashbridgeOriginalStyle);
                    return;
                }
                marker.style.setProperty('background-color', colour, 'important');
                marker.style.setProperty('border-color', colour, 'important');
                marker.style.setProperty('color', colour, 'important');
            };

            const repaintDomLegend = (colours) => {
                const icons = outerPanel ? outerPanel.querySelectorAll(
                    '.graph-legend-icon, [class*="LegendIcon"], [data-testid="series-icon"], [class*="marker" i], span[style*="background"], div[style*="background"], svg'
                ) : [];
                icons.forEach((icon) => {
                    repaintMarker(icon, colours?.get(getMarkerSeriesName(icon)) || null);
                });
            };

            const repaintDomTooltip = (colours) => {
                const tooltipContainers = document.querySelectorAll('.u-tooltip, [class*="tooltip" i], [data-testid="tooltip"], .graph-tooltip');

                let allMarkers = [];
                tooltipContainers.forEach(tooltip => {
                    allMarkers = allMarkers.concat(Array.from(tooltip.querySelectorAll('[class*="marker" i], span[style*="background"], div[style*="background"], [class*="LegendIcon"], .legend-color, svg, [data-testid="series-icon"]')));
                });

                const extraIcons = document.querySelectorAll('[data-testid="series-icon"], [class*="css-"] > div > [style*="background"][style*="border-radius"]');
                extraIcons.forEach(icon => { if (!allMarkers.includes(icon)) allMarkers.push(icon); });

                allMarkers.forEach(marker => {
                    repaintMarker(marker, colours?.get(getMarkerSeriesName(marker)) || null);
                });
            };

            const applyColors = () => {
                const uplot = findUPlot(outerPanel);
                let needsRedraw = false;
                let paletteColours = null;

                if (uplot && uplot.series) {
                    const uplotEntries = uplot.series.slice(1).map((s, index) => {
                        if (!s._originalStroke) s._originalStroke = s.stroke;
                        if (s._evalStrokeStr === undefined) {
                            try { s._evalStrokeStr = typeof s._originalStroke === 'function' ? s._originalStroke() : s._originalStroke; }
                            catch (e) { s._evalStrokeStr = String(s._originalStroke); }
                        }
                        const name = s.label || s.name || '';
                        return {
                            key: index + 1,
                            name,
                            active: s.show !== false && (seriesConfigArg ? getSeriesConfigState(seriesConfigArg, name) : true),
                            originalColour: s._evalStrokeStr
                        };
                    });
                    // Full-hide can be applied after Grafana has already received its
                    // data. In that case uPlot's `show` state is the authoritative
                    // active-series list, so reindex both legend modes from it.
                    const activeColours = hasConfig ? buildActivePalette(uplotEntries) : null;
                    paletteColours = activeColours;
                    uplot.series.forEach((s, idx) => {
                        if (idx === 0) return;

                        if (!s._originalStroke) {
                            s._originalStroke = s.stroke;
                        }
                        const hasPublicOriginalFill = Object.prototype.hasOwnProperty.call(
                            s, '__dashbridgeOriginalAreaFill'
                        );
                        // The style-only route may already have replaced `fill`
                        // with a transparent callback. Never capture that live
                        // value as the legacy painter's native baseline.
                        if (!Object.prototype.hasOwnProperty.call(s, '_originalFill')) {
                            s._originalFill = hasPublicOriginalFill
                                ? s.__dashbridgeOriginalAreaFill
                                : s.fill;
                        }
                        // The local and legacy branches share this public
                        // baseline so diagnostics can prove both disable and
                        // restoration regardless of legend-layout routing.
                        if (!hasPublicOriginalFill) {
                            s.__dashbridgeOriginalAreaFill = s._originalFill;
                        } else if (s._originalFill !== s.__dashbridgeOriginalAreaFill) {
                            // Repair a private baseline poisoned before entering
                            // this route or retained by an older runtime.
                            s._originalFill = s.__dashbridgeOriginalAreaFill;
                        }
                        if (!Object.prototype.hasOwnProperty.call(s, '__dashbridgeOriginalLineWidth') && s.width !== undefined) {
                            s.__dashbridgeOriginalLineWidth = s.width;
                        }
                        // Keep the historical private alias in sync with the public
                        // baseline: a previous style-only apply may have created only
                        // the public field before this legacy route is entered.
                        if (s._originalWidth === undefined) {
                            s._originalWidth = s.__dashbridgeOriginalLineWidth;
                        }
                        const originalWidth = s.__dashbridgeOriginalLineWidth;
                        const targetWidth = thickenLinesArg
                            ? ((originalWidth || 1) + Number(thickenLinesValueArg || 0))
                            : originalWidth;

                        if (s._evalStrokeStr === undefined) {
                            try {
                                s._evalStrokeStr = typeof s._originalStroke === 'function' ? s._originalStroke() : s._originalStroke;
                            } catch (e) { s._evalStrokeStr = String(s._originalStroke); }
                        }
                        if (s._evalFillStr === undefined) {
                            try {
                                s._evalFillStr = typeof s._originalFill === 'function' ? s._originalFill() : s._originalFill;
                            } catch (e) { s._evalFillStr = String(s._originalFill); }
                        }

                        const origStrokeStr = s._evalStrokeStr;

                        if (origStrokeStr && typeof origStrokeStr === 'string') {
                            const name = s.label || s.name || '';
                            const isChecked = seriesConfigArg ? getSeriesConfigState(seriesConfigArg, name) : (s.show !== false);

                            const paletteColour = applyActivePalette(idx, origStrokeStr, activeColours);
                            s.__dashbridgePaletteColour = paletteColour;
                            let targetStroke = paletteColour;
                            // Grafana's bundled uPlot invokes `series.fill` as a
                            // callback during every redraw.  A literal false is
                            // not a valid uPlot fill value there (`fill is not a
                            // function`); use a transparent callback for the
                            // renderer and retain an explicit semantic flag for
                            // the command/state contract.
                            const fillDisabled = !!removeAreaFillArg;
                            let targetFill = fillDisabled ? 'rgba(0,0,0,0)' : s._originalFill;

                            if (s.points && !s.points._originalStroke) {
                                s.points._originalStroke = s.points.stroke;
                                s.points._originalFill = s.points.fill;
                            }
                            let targetPointsStroke = s.points ? s.points._originalStroke : undefined;
                            let targetPointsFill = s.points ? s.points._originalFill : undefined;
                            if (paletteColour && s.points) {
                                targetPointsStroke = paletteColour;
                                targetPointsFill = paletteColour;
                            }
                            // Grafana's uPlot build calls `fill` as a callback even
                            // when the original series did not define an area fill.
                            const makeFn = val => typeof val === 'function' ? val : () => val;
                            const fnStroke = makeFn(targetStroke);
                            const fnFill = makeFn(targetFill);
                            const fnPointsStroke = makeFn(targetPointsStroke);
                            const fnPointsFill = makeFn(targetPointsFill);

                            const matches = (sProp, fnProp) => sProp === fnProp || (typeof sProp === 'function' && typeof fnProp === 'function' && sProp() === fnProp());
                            s.__dashbridgeFillDisabled = fillDisabled;

                            if (
                                !matches(s.stroke, fnStroke) ||
                                !matches(s.fill, fnFill) ||
                                (s.points && (!matches(s.points.stroke, fnPointsStroke) || !matches(s.points.fill, fnPointsFill)))
                            ) {
                                s.stroke = fnStroke;
                                s.fill = fnFill;
                                if (s.points) {
                                    s.points.stroke = fnPointsStroke;
                                    s.points.fill = fnPointsFill;
                                }
                                needsRedraw = true;
                            }
                        }

                        // Width restoration must not depend on resolving the stroke.
                        // With an inverted legend the legacy painter can be invoked
                        // while Grafana replaces a series callback; still restore the
                        // one-time baseline when only the thickness toggle is turned off.
                        if (targetWidth !== undefined && s.width !== targetWidth) {
                            s.width = targetWidth;
                            needsRedraw = true;
                        }
                    });

                    if (needsRedraw) {
                        uplot.redraw(true, true);
                        redrawSuccess = true;
                    }
                } else {
                    const $ = window.jQuery || window.$;
                    if ($ && outerPanel) {
                        const charts = $(outerPanel).find('.graph-panel__chart, .flot-base, canvas').addBack('.graph-panel__chart');
                        charts.each(function () {
                            const plot = $(this).data('plot');
                            if (plot && typeof plot.getData === 'function') {
                                const seriesArray = plot.getData();
                                let needsFlotRedraw = false;

                                seriesArray.forEach((s) => {
                                    if (!s._originalColor) {
                                        s._originalColor = s.color;
                                        if (s.lines) {
                                            s._originalFill = s.lines.fill;
                                            s._originalLineWidth = s.lines.lineWidth;
                                            if (s.lines.lineWidth !== undefined) s.__dashbridgeOriginalLineWidth = s.lines.lineWidth;
                                        }
                                    }
                                });

                                const flotColours = hasConfig
                                    ? buildActivePalette(seriesArray.map((s, index) => ({
                                        key: index,
                                        name: s.label || '',
                                        active: s.show !== false && (seriesConfigArg ? getSeriesConfigState(seriesConfigArg, s.label || '') : true),
                                        originalColour: s._originalColor
                                    })))
                                    : null;
                                paletteColours = flotColours;

                                seriesArray.forEach((s, index) => {
                                    const name = s.label || "";
                                    const isChecked = seriesConfigArg ? getSeriesConfigState(seriesConfigArg, name) : true;
                                    let targetColor = applyActivePalette(index, s._originalColor, flotColours);
                                    let targetFill = removeAreaFillArg ? false : (s._originalFill !== undefined ? s._originalFill : true);
                                    let targetLineWidth = thickenLinesArg ? ((s._originalLineWidth || 1) + thickenLinesValueArg) : s._originalLineWidth;
                                    if (s.color !== targetColor) {
                                        s.color = targetColor;
                                        needsFlotRedraw = true;
                                    }
                                    if (s.lines) {
                                        if (s.lines.fill !== targetFill) {
                                            s.lines.fill = targetFill;
                                            needsFlotRedraw = true;
                                        }
                                        if (targetLineWidth !== undefined && s.lines.lineWidth !== targetLineWidth) {
                                            s.lines.lineWidth = targetLineWidth;
                                            needsFlotRedraw = true;
                                        }
                                    }
                                });

                                if (needsFlotRedraw) {
                                    if (typeof plot.setupGrid === 'function') {
                                        plot.setupGrid();
                                    }
                                    plot.draw();
                                    redrawSuccess = true;
                                }
                            }
                        });
                    }
                }
                return paletteColours;

            };

            const colours = applyColors();
            repaintDomLegend(colours);
            repaintDomTooltip(colours);

            // Форсируем перерисовку один раз сразу после инициализации
            const uplotInst = findUPlot(outerPanel);
            if (uplotInst) {
                uplotInst.redraw(true, true);
                redrawSuccess = true;
            }

            const $ = window.jQuery || window.$;
            if ($ && outerPanel) {
                const charts = $(outerPanel).find('.graph-panel__chart, .flot-base, canvas').addBack('.graph-panel__chart');
                charts.each(function () {
                    const plot = $(this).data('plot');
                    if (plot && typeof plot.draw === 'function') {
                        setTimeout(() => {
                            if (typeof plot.resize === 'function') plot.resize();

                            let grafanaRendered = false;
                            if (window.angular) {
                                try {
                                    const rootNode = document.querySelector('grafana-app, .grafana-app') || document.body || document;
                                    const injector = window.angular.element(rootNode).injector() || window.angular.element(document).injector();
                                    if (injector) {
                                        const $rootScope = injector.get('$rootScope');
                                        if ($rootScope) {
                                            $rootScope.$broadcast('render');
                                            $rootScope.$broadcast('panel-size-changed');
                                            grafanaRendered = true;
                                        }
                                    }
                                } catch (e) { }
                            }
                            if (!grafanaRendered) {
                                if (typeof plot.setupGrid === 'function') plot.setupGrid();
                                plot.draw();
                            }
                        }, 50);
                        redrawSuccess = true;
                    }
                });
            }

            // Останавливаем предыдущие наблюдатели
            if (window.__dashBridgeTooltipInterval) {
                clearInterval(window.__dashBridgeTooltipInterval);
                window.__dashBridgeTooltipInterval = null;
            }
            if (window.__dashBridgeTooltipObserver) {
                window.__dashBridgeTooltipObserver.disconnect();
            }
            let tooltipRafPending = false;
            // Троттлинг (ограничение частоты): мы используем связку setTimeout и requestAnimationFrame, 
            // чтобы перерисовка тултипов не вызывалась сотни раз в секунду при активном движении мыши.
            // Это существенно снижает фоновую нагрузку на CPU по сравнению с обычным setInterval.
            window.__dashBridgeTooltipObserver = new MutationObserver(() => {
                if (!tooltipRafPending) {
                    tooltipRafPending = true;
                    setTimeout(() => {
                        tooltipRafPending = false;
                        requestAnimationFrame(() => {
                            repaintDomTooltip();
                            repaintDomLegend();
                        });
                    }, 150);
                }
            });
            window.__dashBridgeTooltipObserver.observe(document.body, { childList: true, subtree: true });

            // MutationObserver: отслеживаем изменения размера и DOM-дерева Grafana (в т.ч. перестроение графика при кликах на легенду)
            if (outerPanel) {
                if (outerPanel.__dashBridgeObserver) {
                    outerPanel.__dashBridgeObserver.disconnect();
                }
                if (outerPanel.__dashBridgeObserverRaf) {
                    cancelAnimationFrame(outerPanel.__dashBridgeObserverRaf);
                    outerPanel.__dashBridgeObserverRaf = null;
                }
                let rafPending = false;
                outerPanel.__dashBridgeObserver = new MutationObserver(() => {
                    if (!rafPending) {
                        rafPending = true;
                        outerPanel.__dashBridgeObserverRaf = requestAnimationFrame(() => {
                            outerPanel.__dashBridgeObserverRaf = null;
                            rafPending = false;
                            applyColors();
                            repaintDomLegend();
                        });
                    }
                });
                outerPanel.__dashBridgeObserver.observe(outerPanel, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['width', 'height', 'class', 'style', 'd']
                });
                legacyVisualObserverOwners.add(outerPanel);
                legacyObserverDiagnostic.created += 1;
                legacyObserverDiagnostic.activeOwners = legacyVisualObserverOwners.size;
                legacyObserverDiagnostic.lastActionAt = Date.now();
            }
        } catch (e) {
            console.error("DashBridge: Error in universal painter:", e);
        }

        if (!redrawSuccess) {
            const canvasContainers = outerPanel ? outerPanel.querySelectorAll('.uplot, .panel-content, canvas') : [];
            canvasContainers.forEach(el => {
                const origWidth = el.style.width;
                const widthPx = el.offsetWidth;
                if (widthPx > 0) {
                    el.style.setProperty('width', `${widthPx - 30}px`, 'important');
                    setTimeout(() => {
                        if (origWidth) {
                            el.style.width = origWidth;
                        } else {
                            el.style.removeProperty('width');
                        }
                    }, 450);
                }
            });
            if (window.parent !== window) {
                window.parent.postMessage({ action: 'dashbridgeNeedsResize' }, extensionOrigin);
            } else {
                window.dispatchEvent(new Event('resize'));
            }
        }
    };
    const findUPlotForThreshold = root => {
        // [WARNING] Brittle Code: Данная функция использует внутренние свойства React (__reactFiber$).
        // У Grafana нет стабильного публичного API для доступа к экземплярам uPlot внутри панелей, 
        // поэтому расширение вынуждено рекурсивно искать объект plot в дереве компонентов React.
        // При любом серьезном обновлении Grafana или React этот код может сломаться.
        const candidates = root
            ? [root, ...(root.querySelectorAll?.('.uplot, .u-wrap, canvas') || [])]
            : [];
        const checkedFibers = new Set();
        const isUPlot = value => value && typeof value.setData === 'function'
            && typeof value.redraw === 'function' && value.scales && value.series;

        const findInFiber = fiber => {
            const seen = new WeakSet();
            const scan = (value, depth = 0) => {
                if (!value || typeof value !== 'object' || depth > 18 || seen.has(value)) return null;
                seen.add(value);
                if (isUPlot(value)) return value;
                for (const key of [
                    'memoizedState', 'memoizedProps', 'stateNode', 'child', 'sibling',
                    'return', 'next', 'current', 'plot', 'props', 'children'
                ]) {
                    const found = scan(value[key], depth + 1);
                    if (found) return found;
                }
                return null;
            };
            return scan(fiber);
        };

        for (const candidate of candidates) {
            // Some Grafana builds keep the plot on a DOM expando rather than in
            // an enumerable React fiber. Inspect all own keys first, including
            // non-enumerable dev/prod React keys, before walking the fiber.
            for (const key of Object.getOwnPropertyNames(candidate)) {
                let value;
                try { value = candidate[key]; } catch { continue; }
                if (isUPlot(value)) return value;
            }
            let element = candidate;
            for (let level = 0; element && level < 8; level += 1, element = element.parentElement) {
                const fiberKey = Object.getOwnPropertyNames(element)
                    .find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
                const fiber = fiberKey && element[fiberKey];
                if (!fiber || checkedFibers.has(fiber)) continue;
                checkedFibers.add(fiber);
                const plot = findInFiber(fiber);
                if (plot) return plot;
            }
        }
        return null;
    };

    const flotVisibilityControllers = new WeakMap();
    const uPlotFastVisibilityControllers = new WeakMap();
    let uPlotTooltipControllerSequence = 0;

    const getFlotPlot = root => {
        const $ = window.jQuery || window.$;
        if (!$ || !root) return null;
        const host = $(root).find('.graph-panel__chart, .flot-base, canvas').toArray()
            .find(element => !!$(element).data('plot'));
        return host ? $(host).data('plot') : null;
    };

    const getFlotRowLabel = row => {
        const label = row?.querySelector?.(
            '.graph-tooltip-series-name, [class*="LegendLabel"], button, .graph-legend-alias, [class*="legend-label" i]'
        );
        return (label?.textContent || '').trim().replace(/:\s*$/, '');
    };

    const installFlotVisibilityController = ({ root, seriesConfig, mode }) => {
        let controller = flotVisibilityControllers.get(root);
        if (!controller) {
            controller = {
                root,
                seriesConfig: {},
                mode: 'fast_click_toggle',
                plot: null,
                originalSetData: null,
                lastFullData: null,
                bindQueued: false,
                needsApply: true,
                observer: null,
                previousStyles: new Map()
            };
            flotVisibilityControllers.set(root, controller);
        }

        controller.seriesConfig = { ...seriesConfig };
        controller.mode = mode || 'fast_click_toggle';
        controller.needsApply = true;

        const isSelected = label => getSeriesConfigState(controller.seriesConfig, label) !== false;
        const filterData = data => Array.isArray(data)
            ? data.filter(series => isSelected(series?.label || ''))
            : data;

        const rememberStyle = row => {
            if (!controller.previousStyles.has(row)) {
                controller.previousStyles.set(row, {
                    display: row.style.display,
                    opacity: row.style.opacity
                });
            }
        };

        const syncLegend = () => {
            controller.root.querySelectorAll(
                '.graph-legend-series, [class*="legend-item" i], .u-legend tr, .u-legend-row, [class*="LegendRow"]'
            ).forEach(row => {
                const label = getFlotRowLabel(row);
                if (!label || !(label in controller.seriesConfig)) return;
                const selected = isSelected(label);
                rememberStyle(row);
                row.style.opacity = selected ? '1' : '0.35';
                row.style.display = controller.mode === 'fast_complete_hide' && !selected ? 'none' : '';
            });
        };

        const syncTooltipNode = node => {
            if (!(node instanceof Element)) return;
            const rows = new Set();
            const addRow = candidate => {
                const row = candidate?.closest?.('.graph-tooltip-list-item');
                if (row) rows.add(row);
            };
            addRow(node);
            node.querySelectorAll?.('.graph-tooltip-list-item').forEach(row => rows.add(row));
            rows.forEach(row => {
                const label = getFlotRowLabel(row);
                if (label in controller.seriesConfig) {
                    rememberStyle(row);
                    row.style.display = isSelected(label) ? '' : 'none';
                }
            });
        };

        const bindCurrentPlot = () => {
            controller.bindQueued = false;
            const plot = getFlotPlot(controller.root);
            if (!plot?.getData || !plot?.setData) return;

            if (plot !== controller.plot) {
                controller.plot = plot;
                const originalSetData = plot.setData;
                controller.originalSetData = originalSetData;
                controller.lastFullData = plot.getData();
                controller.needsApply = true;

                plot.setData = function (data, ...args) {
                    if (Array.isArray(data)) controller.lastFullData = data;
                    return originalSetData.call(this, filterData(data), ...args);
                };
            }

            if (controller.needsApply && Array.isArray(controller.lastFullData)) {
                plot.setData(controller.lastFullData);
                plot.setupGrid?.();
                plot.draw?.();
                controller.needsApply = false;
            }
            syncLegend();
        };

        if (!controller.observer) {
            controller.observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    mutation.addedNodes.forEach(syncTooltipNode);
                }
                if (!controller.bindQueued) {
                    controller.bindQueued = true;
                    queueMicrotask(bindCurrentPlot);
                }
            });
            controller.observer.observe(document.body, { childList: true, subtree: true });
        }

        bindCurrentPlot();
        return controller.plot ? 'flot' : null;
    };

    const resetSeriesVisibility = ({ root = document } = {}) => {
        const controller = flotVisibilityControllers.get(root);
        let changed = false;
        if (controller) {
            changed = true;
            controller.observer?.disconnect();
            if (controller.plot && controller.originalSetData) {
                controller.plot.setData = controller.originalSetData;
                if (Array.isArray(controller.lastFullData)) {
                    controller.originalSetData.call(controller.plot, controller.lastFullData);
                    controller.plot.setupGrid?.();
                    controller.plot.draw?.();
                }
            }
            controller.previousStyles.forEach((style, row) => {
                row.style.display = style.display;
                row.style.opacity = style.opacity;
            });
            flotVisibilityControllers.delete(root);
        }
        const uPlotController = uPlotFastVisibilityControllers.get(root);
        if (uPlotController) {
            changed = true;
            uPlotController.observer?.disconnect();
            uPlotController.unbindPlot?.();
            uPlotController.tooltipHookRestore?.();
            if (uPlotController.applyFrame) {
                cancelAnimationFrame(uPlotController.applyFrame);
                uPlotController.applyFrame = 0;
            }
            if (uPlotController.tooltipFrame) {
                cancelAnimationFrame(uPlotController.tooltipFrame);
                uPlotController.tooltipFrame = 0;
            }
            if (uPlotController.uplot?.batch && uPlotController.uplot?.setSeries) {
                uPlotController.uplot.batch(() => {
                    uPlotController.uplot.series.slice(1).forEach((series, offset) => {
                        const index = offset + 1;
                        const hasOriginalStroke = uPlotController.originalSeriesStrokes?.has(index);
                        const originalStroke = uPlotController.originalSeriesStrokes?.get(index);
                        if (series.show === false || hasOriginalStroke) {
                            uPlotController.uplot.setSeries(index, {
                                show: true,
                                ...(hasOriginalStroke ? { stroke: originalStroke } : {})
                            });
                        }
                    });
                });
            }
            root.querySelectorAll?.('.dashbridge-uplot-fast-hidden, .dashbridge-uplot-fast-dimmed')
                .forEach(row => row.classList.remove('dashbridge-uplot-fast-hidden', 'dashbridge-uplot-fast-dimmed'));
            document.querySelectorAll?.(`.${uPlotController.tooltipHiddenClass}`)
                .forEach(row => row.classList.remove('dashbridge-uplot-fast-tooltip-hidden', uPlotController.tooltipHiddenClass));
            uPlotFastVisibilityControllers.delete(root);
        }
        return changed;
    };

    // BUG-E fix: внешний лимит обхода fiber увеличен с 16 до 32 для совместимости с Grafana 11+.
    const getUPlotLegendRuntime = root => {
        const buttons = Array.from(root?.querySelectorAll?.('button') || [])
            .filter(button => String(button.className || '').includes('LegendLabel'));

        for (const button of buttons) {
            const fiberKey = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
            let fiber = fiberKey && button[fiberKey];

            for (let depth = 0; fiber && depth < 32; depth += 1, fiber = fiber.return) {
                const props = fiber.memoizedProps;
                if (!props?.item || typeof props.onLabelClick !== 'function') continue;

                for (let parent = fiber; parent && depth < 48; parent = parent.return) {
                    const parentProps = parent.memoizedProps;
                    if (Array.isArray(parentProps?.items) && typeof parentProps.onLabelClick === 'function') {
                        return { items: parentProps.items, onLabelClick: parentProps.onLabelClick };
                    }
                }
            }
        }
        return null;
    };

    const applyUPlotNativeLegendVisibility = async ({ root, seriesConfig }) => {
        const isWantedVisible = item => getSeriesConfigState(seriesConfig, item.label) !== false;
        const isVisible = item => item?.disabled !== true;
        const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const findRuntime = () => getUPlotLegendRuntime(root);
        const findItem = label => findRuntime()?.items.find(item => item?.label === label);

        const waitForVisibility = async (label, visible) => {
            for (let frame = 0; frame < 60; frame += 1) {
                if (isVisible(findItem(label)) === visible) return true;
                await nextFrame();
            }
            return false;
        };

        const invoke = (label, ctrlKey) => {
            const runtime = findRuntime();
            const item = runtime?.items.find(candidate => candidate?.label === label);
            if (!item || typeof runtime?.onLabelClick !== 'function') return false;
            runtime.onLabelClick(item, {
                type: 'click',
                ctrlKey,
                metaKey: false,
                shiftKey: false,
                currentTarget: null,
                target: null,
                nativeEvent: { ctrlKey, metaKey: false, shiftKey: false },
                preventDefault() { },
                stopPropagation() { }
            });
            return true;
        };

        const runtime = findRuntime();
        if (!runtime?.items?.length) return null;

        const items = runtime.items.filter(item => typeof item?.label === 'string' && item.label);
        const selected = items.filter(isWantedVisible);
        const mismatched = items.filter(item => isVisible(item) !== isWantedVisible(item));
        if (!mismatched.length) return 'uplot-native';

        // BUG-J fix: solo-путь (Ctrl-клик) применяем только если хотим показать ровно 1 серию
        // и при этом хотя бы одна из остальных сейчас видима (есть что скрывать одним кликом).
        const soloItem = selected.length === 1 ? selected[0] : null;
        const soloWitness = soloItem && items.find(item =>
            item !== soloItem && isVisible(item)
        );

        try {
            if (soloItem && soloWitness) {
                if (!invoke(soloItem.label, false)
                    || !await waitForVisibility(soloWitness.label, false)) {
                    return null;
                }

                for (const item of selected.slice(1)) {
                    if (!invoke(item.label, true)
                        || !await waitForVisibility(item.label, true)) {
                        return null;
                    }
                }
            } else {
                for (const item of mismatched) {
                    const desired = isWantedVisible(item);
                    if (!invoke(item.label, true)
                        || !await waitForVisibility(item.label, desired)) {
                        return null;
                    }
                }
            }
            return 'uplot-native';
        } catch (error) {
            console.warn('[DashBridge] Native uPlot legend visibility failed', error);
            return null;
        }
    };

    // BUG-E fix: увеличена глубина обхода React fiber с 16 до 32 для совместимости с Grafana 11+,
    // где дополнительные обёртки (StrictMode, Context, ErrorBoundary) увеличивают глубину дерева.
    const getUPlotLegendItem = button => {
        const fiberKey = Object.keys(button || {}).find(key => key.startsWith('__reactFiber$'));
        let fiber = fiberKey && button[fiberKey];
        for (let depth = 0; fiber && depth < 32; depth += 1, fiber = fiber.return) {
            const props = fiber.memoizedProps;
            if (props?.item && typeof props.onLabelClick === 'function') return props.item;
        }
        return null;
    };

    const applyUPlotFastCompleteHide = ({ root, seriesConfig, mode = 'fast_complete_hide' }) => {
        const uplot = findUPlotForThreshold(root);
        const runtime = getUPlotLegendRuntime(root);
        if (!uplot?.batch || !uplot?.setSeries || !runtime?.items?.length) return null;

        let controller = uPlotFastVisibilityControllers.get(root);
        if (!controller) {
            controller = {
                root,
                seriesConfig: {},
                uplot: null,
                originalSetData: null,
                observer: null,
                unbindPlot: null,
                tooltipHookRestore: null,
                tooltipFrame: 0,
                hiddenSeries: new Set(),
                hiddenLabels: new Set(),
                tooltipHiddenClass: `dashbridge-uplot-tooltip-${++uPlotTooltipControllerSequence}`,
                originalSeriesStrokes: new Map(),
                runtime: null,
                refreshRuntime: true,
                applyFrame: 0
            };
            uPlotFastVisibilityControllers.set(root, controller);
        }
        controller.seriesConfig = { ...seriesConfig };
        controller.mode = mode;
        controller.runtime = runtime;
        controller.refreshRuntime = false;

        const isVisible = item => getSeriesConfigState(controller.seriesConfig, item.label) !== false;
        // Grafana exposes a frame-local field index. uPlot flattens the
        // frames by placing their time field at each frame boundary, so the
        // matching uPlot index is the sum of frame and field positions.
        const getSeriesIndex = item => {
            const fieldIndex = item?.fieldIndex;
            if (!fieldIndex || typeof fieldIndex !== 'object'
                || !Number.isInteger(fieldIndex.frameIndex)
                || !Number.isInteger(fieldIndex.fieldIndex)) return null;
            return fieldIndex.frameIndex + fieldIndex.fieldIndex;
        };

        const syncLegendRows = (node, currentRuntime = null) => {
            currentRuntime ||= getUPlotLegendRuntime(root);
            const isGrafanaInControl = currentRuntime?.items?.some(item => item.disabled === true);

            const buttons = [];
            if (node instanceof Element && node.matches('button')) buttons.push(node);
            node?.querySelectorAll?.('button').forEach(button => buttons.push(button));
            buttons.filter(button => String(button.className || '').includes('LegendLabel')).forEach(button => {
                const item = getUPlotLegendItem(button);
                const row = button.closest('tr, [class*="LegendRow"]');
                if (!item || !row) return;

                let hidden;
                if (isGrafanaInControl) {
                    hidden = item.disabled === true;
                } else {
                    hidden = !isVisible(item);
                }

                row.classList.toggle('dashbridge-uplot-fast-hidden', controller.mode === 'fast_complete_hide' && hidden);
                row.classList.toggle('dashbridge-uplot-fast-dimmed', controller.mode === 'fast_click_toggle' && hidden);
            });
        };

        // BUG-I fix: ищем тултипы от document.body, а не от root панели —
        // Grafana рендерит оверлеи в Portal за пределами панели. Но используем
        // body вместо document чтобы исключить <head> и снизить число узлов.
        const getTooltipOverlays = () => Array.from((document.body || document).querySelectorAll('div')).filter(element => {
            const style = getComputedStyle(element);
            const text = (element.innerText || '').trim();
            return style.position === 'fixed'
                && Number(style.zIndex || 0) >= 1000
                && /^\d{4}-\d{2}-\d{2}\s/.test(text);
        });

        const syncTooltipRows = () => {
            document.querySelectorAll(`.${controller.tooltipHiddenClass}`).forEach(row => {
                row.classList.remove('dashbridge-uplot-fast-tooltip-hidden', controller.tooltipHiddenClass);
            });
            if (!controller.hiddenLabels.size) return;
            getTooltipOverlays().forEach(overlay => {
                overlay.querySelectorAll('div').forEach(label => {
                    const seriesName = (label.innerText || '').trim();
                    if (!controller.hiddenLabels.has(seriesName)) return;
                    label.parentElement?.classList.add(
                        'dashbridge-uplot-fast-tooltip-hidden', controller.tooltipHiddenClass
                    );
                });
            });
        };

        const scheduleTooltipRows = () => {
            if (controller.tooltipFrame) return;
            controller.tooltipFrame = requestAnimationFrame(() => {
                controller.tooltipFrame = 0;
                syncTooltipRows();
            });
        };

        const installTooltipRowFilter = plot => {
            controller.tooltipHookRestore?.();
            controller.tooltipHookRestore = null;
            const hooks = plot.hooks?.setLegend || plot.opts?.hooks?.setLegend;
            if (!Array.isArray(hooks) || !hooks.length) return;
            const originals = hooks.slice();
            hooks.forEach((hook, index) => {
                hooks[index] = function (u, ...args) {
                    const result = hook.call(this, u, ...args);
                    scheduleTooltipRows();
                    return result;
                };
            });
            controller.tooltipHookRestore = () => hooks.splice(0, hooks.length, ...originals);
        };

        const scheduleApply = (refreshRuntime = false) => {
            controller.refreshRuntime ||= refreshRuntime;
            if (controller.applyFrame) return;
            controller.applyFrame = requestAnimationFrame(() => {
                controller.applyFrame = 0;
                applyToPlot();
            });
        };

        const applyToPlot = () => {
            const currentPlot = findUPlotForThreshold(root);
            const currentRuntime = controller.refreshRuntime || !controller.runtime
                ? getUPlotLegendRuntime(root)
                : controller.runtime;
            if (!currentPlot?.batch || !currentRuntime?.items?.length) return;
            controller.runtime = currentRuntime;
            controller.refreshRuntime = false;

            if (currentPlot !== controller.uplot) {
                controller.unbindPlot?.();
                controller.tooltipHookRestore?.();
                controller.tooltipHookRestore = null;
                controller.uplot = currentPlot;
                controller.originalSeriesStrokes.clear();
                controller.originalSetData = currentPlot.setData;
                currentPlot.setData = function (data, ...args) {
                    const result = controller.originalSetData.call(this, data, ...args);
                    scheduleApply();
                    return result;
                };
                controller.unbindPlot = () => {
                    if (currentPlot.setData === controller.originalSetData || !controller.originalSetData) return;
                    currentPlot.setData = controller.originalSetData;
                };
            }

            const isGrafanaInControl = currentRuntime.items.some(item => item.disabled === true);

            syncLegendRows(root, currentRuntime);

            controller.hiddenSeries = new Set(currentRuntime.items
                .filter(item => {
                    if (isGrafanaInControl) return item.disabled === true;
                    return !isVisible(item);
                })
                .map(getSeriesIndex)
                .filter(Number.isInteger));
            controller.hiddenLabels = new Set(currentRuntime.items
                .filter(item => isGrafanaInControl ? item.disabled === true : !isVisible(item))
                .map(item => item.label));
            if (!controller.tooltipHookRestore) installTooltipRowFilter(currentPlot);
            currentPlot.batch(() => currentRuntime.items.forEach(item => {
                const index = getSeriesIndex(item);
                if (!Number.isInteger(index) || index <= 0 || index >= currentPlot.series.length) return;

                let wanted;
                if (isGrafanaInControl) {
                    wanted = item.disabled !== true;
                } else {
                    wanted = isVisible(item);
                }

                if (currentPlot.series[index]?.show !== wanted) {
                    if (!controller.originalSeriesStrokes.has(index)) {
                        controller.originalSeriesStrokes.set(index, currentPlot.series[index]?.stroke);
                    }
                    currentPlot.setSeries(index, { show: wanted, stroke: item.color });
                } else if (item.color && currentPlot.series[index]?.stroke !== item.color) {
                    if (!controller.originalSeriesStrokes.has(index)) {
                        controller.originalSeriesStrokes.set(index, currentPlot.series[index]?.stroke);
                    }
                    currentPlot.setSeries(index, { stroke: item.color });
                }
            }));
        };

        if (!document.getElementById('dashbridge-uplot-fast-visibility-style')) {
            const style = document.createElement('style');
            style.id = 'dashbridge-uplot-fast-visibility-style';
            style.textContent = '.dashbridge-uplot-fast-hidden,.dashbridge-uplot-fast-tooltip-hidden{display:none!important;}.dashbridge-uplot-fast-dimmed{opacity:.35!important;}';
            document.head.appendChild(style);
        }

        if (!controller.observer) {
            controller.observer = new MutationObserver(mutations => {
                let chartWasReplaced = false;
                mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
                    if (!(node instanceof Element)) return;
                    const hasCanvas = node.matches('canvas') || !!node.querySelector('canvas');
                    const hasLegendRow = String(node.className || '').includes('LegendLabel')
                        || !!node.querySelector('[class*="LegendLabel"]');
                    if (hasLegendRow) {
                        controller.refreshRuntime = true;
                        syncLegendRows(node);
                    }
                    chartWasReplaced ||= hasCanvas;
                }));
                if (chartWasReplaced) scheduleApply(true);
            });
            controller.observer.observe(root, { childList: true, subtree: true });
        }

        syncLegendRows(root);
        applyToPlot();
        return 'uplot-fast-complete-hide';
    };

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
        const uplot = findUPlotForThreshold(root);
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
        const uplot = findUPlotForThreshold(root);
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
        const uplot = findUPlotForThreshold(root);
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

    const collectPanelReportSnapshot = ({ root = document, sla = {} } = {}) => {
        const evaluation = ['period_max', 'latest', 'period_min', 'period_avg', 'period_sum'].includes(sla.evaluation)
            ? sla.evaluation : 'period_max';
        const operator = ['gt', 'gte', 'lt', 'lte'].includes(sla.operator) ? sla.operator : 'gt';
        const source = ['graph', 'custom', 'cpu_capacity', 'none'].includes(sla.source) ? sla.source : 'none';
        let engine = 'unknown';
        let unit = '';
        let factor = 1;
        let records = [];
        const responseDataStatus = window.__dashbridgePanelToolsVisualMetadata?.responseDataStatus
            || { kind: 'unknown', text: '' };
        const parseLegendCalculation = value => {
            const normalized = String(value || '').replace(/[\u00a0\u202f\s]/g, '').replace(',', '.');
            const match = normalized.match(/[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i);
            const parsed = match ? Number(match[0]) : null;
            return Number.isFinite(parsed) ? parsed : null;
        };
        const legendMaxByName = () => {
            const result = new Map();
            const rows = Array.from(window.DashBridgeGrafanaDom?.legendItems?.(root) || []);
            for (const row of rows) {
                const label = window.DashBridgeGrafanaDom?.legendLabel?.(row);
                const name = String(label?.textContent || '').trim();
                if (!name || /^(?:name|series|имя|серия)$/i.test(name)) continue;
                let valueCell = row.querySelector?.(
                    'td.graph-legend-value.max, [data-field="max"], [data-testid*="max" i]'
                );
                if (!valueCell) {
                    const table = row.closest?.('table');
                    const headers = Array.from(table?.querySelectorAll?.('thead th, thead td') || []);
                    const maxIndex = headers.findIndex(header => /^(?:max|maximum|макс\.?)$/i.test(String(header.textContent || '').trim()));
                    const cells = Array.from(row.cells || row.querySelectorAll?.(':scope > td, :scope > th') || []);
                    if (maxIndex >= 0) valueCell = cells[maxIndex];
                }
                const value = parseLegendCalculation(valueCell?.textContent);
                if (value !== null && !result.has(name)) result.set(name, value);
            }
            return result;
        };
        const legendMaximums = evaluation === 'period_max' ? legendMaxByName() : new Map();
        const reportLegendNames = expectedCount => {
            const names = window.DashBridgeGrafanaDom?.legendSeriesNames?.(root, { unique: false });
            // A complete legend is still only a fallback for series whose
            // native label is missing. Grafana can sort legend rows by a
            // calculation (for example Max) without reordering plot data, so
            // positional legend names must never replace native series labels.
            return Array.isArray(names) && names.length === expectedCount ? names : [];
        };
        const isGenericSeriesName = value => /^(?:value|series|metric|значение|серия|метрика)$/iu
            .test(String(value || '').trim());
        const reportSeriesName = (nativeName, legendName, index) => {
            const native = String(nativeName || '').trim();
            const legend = String(legendName || '').trim();
            return !native || isGenericSeriesName(native)
                ? (legend || native || `Серия ${index + 1}`)
                : native;
        };
        const $ = window.jQuery || window.$;
        const plotHost = $ && $(root).find('.graph-panel__chart').toArray().find(el => !!$(el).data('plot'));
        if (plotHost) {
            engine = 'flot';
            const plot = $(plotHost).data('plot');
            const details = mergeAxisAndPanelUnit(inferUnitFromAxisTicks(plot.getAxes?.().yaxis?.ticks), getCachedPanelDefinition());
            unit = details.unit || '';
            factor = Number(details.factor) || 1;
            const plotSeries = plot.getData?.() || [];
            const legendNames = reportLegendNames(plotSeries.length);
            records = plotSeries.map((item, index) => ({
                name: reportSeriesName(item.label, legendNames[index], index),
                visible: item.lines?.show !== false || item.points?.show !== false,
                values: (item.data || []).map(point => Number(point?.[1])).filter(Number.isFinite),
                legendMaximum: legendMaximums.get(reportSeriesName(item.label, legendNames[index], index))
            }));
        } else {
            const uplot = findUPlotForThreshold(root);
            if (uplot) {
                engine = 'uplot';
                const yScaleKey = getUPlotYScaleKey(uplot);
                const details = mergeAxisAndPanelUnit(getUPlotUnitDetails(uplot, yScaleKey, uplot.scales?.[yScaleKey]), getCachedPanelDefinition());
                unit = details.unit || '';
                factor = Number(details.factor) || 1;
                const plotSeries = (uplot.series || []).slice(1);
                const legendNames = reportLegendNames(plotSeries.length);
                records = plotSeries.map((item, offset) => ({
                    name: reportSeriesName(item.label, legendNames[offset], offset),
                    visible: item.show !== false,
                    values: Array.from(uplot.data?.[offset + 1] || []).map(Number).filter(Number.isFinite),
                    legendMaximum: legendMaximums.get(reportSeriesName(item.label, legendNames[offset], offset))
                }));
            } else {
                const responseTableRecords = Array.isArray(window.__dashbridgePanelToolsVisualMetadata?.responseTableRecords)
                    ? window.__dashbridgePanelToolsVisualMetadata.responseTableRecords : [];
                const tableRecords = responseTableRecords.length
                    ? responseTableRecords.map(item => ({
                        name: String(item?.name || ''), visible: true,
                        values: [Number(item?.value)].filter(Number.isFinite)
                    })).filter(item => item.name && item.values.length)
                    : collectGrafanaTableRecords(root);
                if (!records.length && tableRecords.length) {
                    engine = responseTableRecords.length ? 'table-response' : 'table-dom';
                    const details = unitFromPanelDefinition(getCachedPanelDefinition());
                    unit = details.unit || '';
                    factor = 1;
                    records = tableRecords;
                }
            }
        }
        const summarizeValues = values => {
            let count = 0;
            let min = Infinity;
            let max = -Infinity;
            let sum = 0;
            let latest = null;
            for (const rawValue of values || []) {
                const value = Number(rawValue);
                if (!Number.isFinite(value)) continue;
                count += 1;
                min = Math.min(min, value);
                max = Math.max(max, value);
                sum += value;
                latest = value;
            }
            return count ? { count, min, max, sum, latest } : null;
        };
        records = records.map(record => ({ ...record, stats: record.stats || summarizeValues(record.values) }))
            .filter(record => record.visible && record.stats?.count > 0);
        if (!records.length) {
            const visualMetadata = window.__dashbridgePanelToolsVisualMetadata;
            const dataStatus = visualMetadata?.responseDataStatus || { kind: 'unknown', text: '' };
            if (visualMetadata?.responseFilterEmptyIsNormal === true) {
                const configuredValue = sla.value !== null && sla.value !== '' && Number.isFinite(Number(sla.value))
                    ? Number(sla.value) : null;
                const configuredRawValue = sla.rawValue !== null && sla.rawValue !== '' && Number.isFinite(Number(sla.rawValue))
                    ? Number(sla.rawValue) : null;
                return {
                    state: 'ok', source, evaluation, operator, engine,
                    unit: String(sla.unit || unit || '').slice(0, 64),
                    threshold: configuredValue ?? (configuredRawValue === null ? null : configuredRawValue / factor),
                    criticalThreshold: configuredValue ?? (configuredRawValue === null ? null : configuredRawValue / factor),
                    warningThreshold: sla.warningValue !== null && sla.warningValue !== '' && Number.isFinite(Number(sla.warningValue))
                        ? Number(sla.warningValue) : null,
                    aggregateValue: null,
                    series: [],
                    filteredEmpty: true,
                    dataStatus: 'filtered_empty',
                    dataStatusText: dataStatus.text || 'Нет превышений по заданному фильтру'
                };
            }
            const failureKinds = new Set(['http_error', 'network_error', 'decode_error', 'aborted']);
            const isFailure = failureKinds.has(dataStatus.kind);
            const failureText = dataStatus.text || (isFailure
                ? (dataStatus.kind === 'aborted' ? 'Запрос Grafana был отменён' : 'Ошибка при получении данных')
                : 'Источник вернул пустой набор данных');
            return {
                state: isFailure ? 'error' : 'no_data',
                source, evaluation, operator, engine, unit, series: [],
                dataStatus: dataStatus.kind === 'unknown' ? 'empty_source' : dataStatus.kind,
                dataStatusText: failureText,
                error: failureText
            };
        }
        const configuredValue = sla.value !== null && sla.value !== '' && Number.isFinite(Number(sla.value))
            ? Number(sla.value) : null;
        const configuredRawValue = sla.rawValue !== null && sla.rawValue !== '' && Number.isFinite(Number(sla.rawValue))
            ? Number(sla.rawValue) : null;
        const configuredWarningValue = sla.warningValue !== null && sla.warningValue !== '' && Number.isFinite(Number(sla.warningValue))
            ? Number(sla.warningValue) : null;
        const configuredWarningRawValue = sla.warningRawValue !== null && sla.warningRawValue !== '' && Number.isFinite(Number(sla.warningRawValue))
            ? Number(sla.warningRawValue) : null;
        if (!['none', 'cpu_capacity'].includes(source) && configuredValue === null && configuredRawValue === null) {
            return {
                state: 'configuration_error', source, evaluation, operator, engine, unit, series: [],
                dataStatus: 'configuration_error',
                dataStatusText: 'Не задан порог SLA для панели',
                error: 'Не задан порог SLA для панели'
            };
        }
        const rawThreshold = source === 'cpu_capacity' ? null : (configuredRawValue ?? (configuredValue * factor));
        const threshold = ['none', 'cpu_capacity'].includes(source) ? null : rawThreshold / factor;
        const rawWarningThreshold = configuredWarningRawValue ?? (configuredWarningValue === null ? null : configuredWarningValue * factor);
        const warningThreshold = source === 'none' || rawWarningThreshold === null ? null : rawWarningThreshold / factor;
        const compare = (value, target) => !['none', 'cpu_capacity'].includes(source) && Number.isFinite(target) && ({
            gt: value > target, gte: value >= target,
            lt: value < target, lte: value <= target
        })[operator];
        const evaluateStats = stats => {
            if (evaluation === 'latest') return stats.latest;
            if (evaluation === 'period_min') return stats.min;
            if (evaluation === 'period_avg') return stats.sum / stats.count;
            if (evaluation === 'period_sum') return stats.sum;
            return stats.max;
        };
        const allSeries = records.map(record => {
            const rawValue = evaluateStats(record.stats);
            const hasLegendMaximum = evaluation === 'period_max' && Number.isFinite(record.legendMaximum);
            const value = hasLegendMaximum ? record.legendMaximum : (rawValue === null ? null : rawValue / factor);
            const critical = value !== null && !!compare(
                hasLegendMaximum ? value : rawValue,
                hasLegendMaximum ? threshold : rawThreshold
            );
            const warning = !critical && value !== null && !!compare(
                hasLegendMaximum ? value : rawValue,
                hasLegendMaximum ? warningThreshold : rawWarningThreshold
            );
            return {
                name: record.name.slice(0, 500),
                value,
                exceeded: critical,
                level: critical ? 'critical' : (warning ? 'warning' : 'normal')
            };
        }).filter(record => record.value !== null);
        const series = allSeries.slice(0, 5000);
        const omittedSeries = allSeries.length - series.length;
        const evaluated = allSeries.map(record => record.value).filter(Number.isFinite);
        const totalCount = records.reduce((sum, record) => sum + record.stats.count, 0);
        const totalSum = records.reduce((sum, record) => sum + record.stats.sum, 0);
        const rawMinimum = Math.min(...records.map(record => record.stats.min));
        const rawMaximum = Math.max(...records.map(record => record.stats.max));
        const lastValues = records.map(record => record.stats.latest / factor).filter(Number.isFinite);
        const aggregateValue = evaluation === 'period_min' ? Math.min(...evaluated)
            : evaluation === 'period_avg' ? evaluated.reduce((sum, value) => sum + value, 0) / evaluated.length
                : evaluation === 'period_sum' ? evaluated.reduce((sum, value) => sum + value, 0)
                    : Math.max(...evaluated);
        const resolvedUnit = String(sla.unit || unit || '').slice(0, 64);
        const hasCritical = allSeries.some(record => record.level === 'critical');
        const hasWarning = allSeries.some(record => record.level === 'warning');
        return {
            state: ['none', 'cpu_capacity'].includes(source) ? 'no_threshold' : (hasCritical ? 'critical' : (hasWarning ? 'warning' : 'ok')),
            source, evaluation, operator, engine, unit: resolvedUnit, threshold,
            criticalThreshold: threshold, warningThreshold,
            aggregateValue,
            maxValue: evaluation === 'period_max' ? Math.max(...evaluated) : rawMaximum / factor,
            minValue: rawMinimum / factor,
            lastValue: lastValues.length ? Math.max(...lastValues) : null,
            averageValue: totalCount ? totalSum / totalCount / factor : null,
            sumValue: totalSum / factor,
            series,
            omittedSeries
        };
    };

    const getThresholdDebug = () => {
        const root = document;
        const uplot = findUPlotForThreshold(root);
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

    const getPaletteDebug = () => {
        const uplot = findUPlotForThreshold(document);
        if (!uplot) return { engine: 'unknown', tools: window.__dashbridgePanelToolsState || null, series: [] };
        const evaluateColour = (value, index) => {
            try { return typeof value === 'function' ? value(uplot, index) : value; }
            catch { return '[cannot evaluate]'; }
        };
        return {
            engine: 'uplot',
            tools: window.__dashbridgePanelToolsState || null,
            series: (uplot.series || []).map((series, index) => ({
                index,
                label: series.label,
                show: series.show,
                stroke: evaluateColour(series.stroke, index),
                originalStroke: evaluateColour(series._originalStroke, index),
                assignedColour: series.__dashbridgePaletteColour || null
            }))
        };
    };

    // Keep a style-only command completely separate from the legacy visual
    // painter. uPlot hover uses its own point/cursor state; touching colours,
    // legend DOM or observers just to remove an area fill can desynchronise it.
    const applyLocalSeriesStyles = ({ root = document, removeFill = false, thickenLines = false, thickenLinesValue = 1.5 } = {}) => {
        const uplot = findUPlotForThreshold(root);
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
        const uplot = findUPlotForThreshold(root);
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
        const uplot = findUPlotForThreshold(root);
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

    // The older universal painter owns a MutationObserver which repaints the
    // captured visual state.  After a legend layout reset it can still carry
    // the old fill setting and undo a style-only area-fill change one frame
    // later.  Disconnect only observers associated with this panel branch.
    const stopLegacyVisualObservers = root => {
        const nodes = new Set(root ? [root, ...(root.querySelectorAll?.('*') || [])] : []);
        for (let parent = root?.parentElement, depth = 0; parent && depth < 8; parent = parent.parentElement, depth += 1) {
            nodes.add(parent);
        }
        legacyVisualObserverOwners.forEach(owner => nodes.add(owner));
        // A content-script reload creates a fresh module registry while an
        // observer installed by the previous runtime can remain attached to a
        // panel outside the newly resolved root. Sweep the document once, then
        // rely on the explicit owner registry for observers created here.
        if (!legacyObserverDocumentSweepCompleted) {
            legacyObserverDocumentSweepCompleted = true;
            legacyObserverDiagnostic.documentSweeps += 1;
            document.querySelectorAll?.('*').forEach(node => nodes.add(node));
        }
        nodes.forEach(node => {
            if (!node) return;
            if (node.__dashBridgeObserverRaf) {
                cancelAnimationFrame(node.__dashBridgeObserverRaf);
                node.__dashBridgeObserverRaf = null;
                legacyObserverDiagnostic.pendingFramesCancelled += 1;
            }
            if (node.__dashBridgeObserver) {
                legacyObserverDiagnostic.disconnected += 1;
            }
            node.__dashBridgeObserver?.disconnect?.();
            node.__dashBridgeObserver = null;
            legacyVisualObserverOwners.delete(node);
        });
        legacyObserverDiagnostic.activeOwners = legacyVisualObserverOwners.size;
        legacyObserverDiagnostic.lastActionAt = Date.now();
    };

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
                return completeStyleApply(await applyPopupLegendAndVisuals(
                    panelId,
                    seriesConfig,
                    mode,
                    removeFill,
                    thickenLines,
                    thickenLinesValue,
                    invertLegend
                ));
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
            configureLocalSeriesStyleGuard({ root, removeFill: false, thickenLines: false, thickenLinesValue });
            return completeStyleApply(await applyPopupLegendAndVisuals(
                panelId,
                seriesConfig,
                mode,
                removeFill,
                thickenLines,
                thickenLinesValue,
                invertLegend
            ));
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
            const controller = flotVisibilityControllers.get(root);
            if (!controller) return false;
            controller.observer?.disconnect();
            if (controller.plot && controller.originalSetData) {
                controller.plot.setData = controller.originalSetData;
                if (Array.isArray(controller.lastFullData)) {
                    controller.originalSetData.call(controller.plot, controller.lastFullData);
                    controller.plot.setupGrid?.();
                    controller.plot.draw?.();
                }
            }
            controller.previousStyles.forEach((style, row) => {
                row.style.display = style.display;
                row.style.opacity = style.opacity;
            });
            flotVisibilityControllers.delete(root);
            return true;
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
