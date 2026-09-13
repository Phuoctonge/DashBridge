(function initGrafanaLegendVisuals(root) {
    'use strict';
    if (root.DashBridgeGrafanaLegendVisuals) return;

    function create({ debugLog } = {}) {
        if (typeof debugLog !== 'function') {
            throw new TypeError('Grafana legend visuals dependencies are incomplete');
        }
        const rawColumnStats = window.DashBridgeGrafanaLegendColumns;
        if (window.name === 'dashbridge-iframe' && !document.getElementById('dashbridge-responsive-legend-style')) { const style = document.createElement('style'); style.id = 'dashbridge-responsive-legend-style'; style.textContent = 'table:has(th) { width:100% !important; max-width:100% !important; table-layout:fixed !important; } table:has(th) tr { display:flex !important; width:100% !important; min-width:0 !important; } table:has(th) td, table:has(th) th { min-width:0 !important; overflow:hidden !important; text-overflow:ellipsis !important; } table:has(th) tr > :first-child { flex:1 1 auto !important; min-width:0 !important; width:auto !important; } table:has(th) tr > :not(:first-child) { flex:0 0 auto !important; width:max-content !important; min-width:max-content !important; } .rdg { grid-template-columns:minmax(0,1fr) max-content !important; overflow-x:hidden !important; } .rdg .rdg-cell:first-child { display:block !important; min-width:0 !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; } .rdg .rdg-cell:first-child > * { min-width:0 !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }'; (document.head || document.documentElement).appendChild(style); }

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
                    .dashbridge-legend-bottom table,
                    .dashbridge-legend-bottom .u-legend,
                    .dashbridge-legend-bottom tbody { width:100% !important; max-width:100% !important; min-width:0 !important; table-layout:fixed !important; overflow-x:hidden !important; }
                    .dashbridge-legend-bottom td,
                    .dashbridge-legend-bottom th { min-width:0 !important; }
                    .dashbridge-legend-bottom * { box-sizing:border-box !important; min-width:0 !important; max-width:100% !important; }
                    .dashbridge-legend-bottom,
                    .dashbridge-legend-bottom * {
                        overflow-x:hidden !important;
                    }
                    .dashbridge-legend-bottom [class*="LegendLabel"],
                    .dashbridge-legend-bottom [class*="legend-label"] {
                        display:block !important;
                        width:100% !important;
                        overflow:hidden !important;
                        text-overflow:ellipsis !important;
                        white-space:nowrap !important;
                    }
                `;
                (document.head || document.documentElement).appendChild(style);
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
            const legendLayout = window.name === 'dashbridge-iframe'
                ? applyLegendLayout()
                : { chartHost, chartBranch, flexContainer, legendElement, layoutChanged: false };
            if (window.name === 'dashbridge-iframe' && legendLayout.legendElement) { ensureResponsiveLegendStyles(); legendLayout.legendElement.classList.add('dashbridge-legend-bottom'); }
            if (window.name === 'dashbridge-iframe' && legendLayout.legendElement) { const legend = legendLayout.legendElement; ['width','max-width'].forEach(p => legend.style.setProperty(p, '100%', 'important')); legend.style.setProperty('overflow-x', 'hidden', 'important'); legend.querySelectorAll('table').forEach(table => { ['width','max-width'].forEach(p => table.style.setProperty(p, '100%', 'important')); table.style.setProperty('table-layout', 'fixed', 'important'); const rows = [...table.rows]; const count = rows[0]?.cells.length || 0; rows.forEach(row => { const cell = row.cells[0]; if (cell && !cell.title) cell.title = cell.innerText.trim(); }); const widths = Array.from({ length: count }, (_, i) => i ? Math.max(...rows.map(row => row.cells[i]?.scrollWidth || 0), 0) + 12 : 0); const numericTotal = widths.reduce((sum, width) => sum + width, 0); rows.forEach(row => { row.cells[0]?.style.setProperty('width', `max(0px, calc(100% - ${numericTotal}px))`, 'important'); for (let i = 1; i < count; i++) row.cells[i]?.style.setProperty('width', `${widths[i]}px`, 'important'); }); }); }
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
            if (legendLayout?.layoutChanged || uplotResizedAfterLegendLayout) {
                if (window.parent === window) {
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
                if (window.parent === window) {
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
    
        const visibilityAdapters = root.DashBridgeGrafanaLegendVisibilityAdapters?.create({
            debugLog, getSeriesConfigState, findUPlotForThreshold
        });
        if (!visibilityAdapters) throw new Error('Grafana legend visibility adapters are unavailable');
        const {
            applyUPlotFastCompleteHide, applyUPlotNativeLegendVisibility,
            getFlotPlot, getFlotRowLabel, getUPlotLegendRuntime,
            installFlotVisibilityController, resetFlotSeriesVisibility, resetSeriesVisibility
        } = visibilityAdapters;
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

        const applyLegendColumns = ({ root = document, columns = {} } = {}) => {
            const formatLast = (value, row) => {
                const unitText = Array.from(row.querySelectorAll('td')).map(cell => cell.textContent).join(' ');
                if (/\b(?:ms|s|sec|min|mins)\b/i.test(unitText)) {
                    const absolute = Math.abs(value);
                    if (absolute >= 60_000) return `${Number((value / 60_000).toPrecision(3))} mins`;
                    if (absolute >= 1_000) return `${Number((value / 1_000).toPrecision(3))} s`;
                    return `${Number(value.toPrecision(3))} ms`;
                }
                return String(Number(value.toPrecision(4)));
            };
            const tables = Array.from(root.querySelectorAll?.('table') || []).filter(table => table.querySelector('th, [role="columnheader"]'));
            const requested = columns && typeof columns === 'object' ? columns : {};
            let changed = 0;
            for (const table of tables) {
                const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
                const headers = Array.from(headerRow?.querySelectorAll?.(':scope > th, :scope > td, :scope > [role="columnheader"]') || []);
                if (!headers.length) continue;
                const names = headers.map(cell => String(cell.textContent || '').trim());
                const lastIndex = names.findIndex(name => /^last$/i.test(name));
                const hide = (name, index) => requested[name.toLowerCase()] === false || requested[name] === false
                    ? index : -1;
                const hidden = new Set(names.map((name, index) => hide(name, index)).filter(index => index >= 0));
                if (requested.last === true && lastIndex < 0) {
                    const cell = headers[headers.length - 1].cloneNode(false);
                    cell.textContent = 'Last'; cell.dataset.dashbridgeSummaryColumn = 'last';
                    headerRow.appendChild(cell);
                    const rows = Array.from(table.querySelectorAll('tbody tr'));
                    const chart = findUPlotForThreshold(root);
                    const series = chart?.data || getFlotPlot(root)?.getData?.() || [];
                    const rawSeries = chart ? (chart.series || []).slice(1).map((item, index) => ({ label: String(item?.label || ''), values: series[index + 1] })) : series.map(item => ({ label: String(item?.label || ''), values: item?.data?.map(point => point?.[1]) }));
                    const computed = rawColumnStats?.compute({ series: rawSeries, columns: { last: true } }) || [];
                    const colorKey = value => { const text = String(value || '').replace(/\s+/g, '').toLowerCase(); const hex = text.match(/^#([0-9a-f]{6})$/); return hex ? `rgb(${parseInt(hex[1].slice(0, 2), 16)},${parseInt(hex[1].slice(2, 4), 16)},${parseInt(hex[1].slice(4), 16)})` : text; };
                    const byColor = chart ? new Map((chart.series || []).slice(1).map((item, offset) => [colorKey(typeof item.stroke === 'function' ? item.stroke(chart, offset + 1) : item.stroke), computed[offset]])) : null;
                    const normalizeLabel = value => String(value || '').replace(/\s+/g, ' ').trim();
                    const computedByLabel = new Map(computed.map(item => [normalizeLabel(item.label), item]));
                    rows.forEach((row, index) => {
                        const valueCell = headers[headers.length - 1].cloneNode(false);
                        const labelElement = row.querySelector('button[title],[class*="LegendLabel"]');
                        const label = normalizeLabel(labelElement?.getAttribute('title') || labelElement?.textContent || row.textContent);
                        const value = computedByLabel.get(label)?.stats?.last ?? byColor?.get(colorKey(row.querySelector('[data-testid="series-icon"]')?.style?.background))?.stats?.last ?? computed[index]?.stats?.last;
                        valueCell.textContent = Number.isFinite(value) ? formatLast(value, row) : '-';
                        valueCell.dataset.dashbridgeSummaryColumn = 'last'; row.appendChild(valueCell);
                    });
                    changed += 1;
                }
                if (requested.last === true) {
                    const lastHeader = Array.from(headerRow.children).find(cell => /^last$/i.test(String(cell.textContent || '').trim()));
                    const lastColumnIndex = lastHeader ? Array.from(headerRow.children).indexOf(lastHeader) : -1;
                    if (lastColumnIndex >= 0) {
                        const rows = Array.from(table.querySelectorAll('tbody tr'));
                        const chart = findUPlotForThreshold(root);
                        const data = chart?.data || getFlotPlot(root)?.getData?.() || [];
                        const normalizeColor = value => {
                            const text = String(value || '').replace(/\s+/g, '').toLowerCase();
                            const hex = text.match(/^#([0-9a-f]{6})$/i);
                            if (hex) return `rgb(${parseInt(hex[1].slice(0, 2), 16)},${parseInt(hex[1].slice(2, 4), 16)},${parseInt(hex[1].slice(4, 6), 16)})`;
                            return text.replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/, 'rgb($1,$2,$3)');
                        };
                        const seriesByColor = chart ? new Map((chart.series || []).slice(1).map((item, offset) => {
                            let color = '';
                            try { color = typeof item.stroke === 'function' ? item.stroke(chart, offset + 1) : item.stroke; } catch { /* fallback to row order */ }
                            return [normalizeColor(color), data[offset + 1]];
                        }).filter(([color]) => color)) : null;
                        rows.forEach((row, index) => {
                            const cell = row.children[lastColumnIndex];
                            if (!cell) return;
                            const iconColor = row.querySelector('[data-testid="series-icon"]')?.style?.background || '';
                            const values = chart ? (seriesByColor?.get(normalizeColor(iconColor)) || data[index + 1]) : data[index]?.data?.map(point => point?.[1]);
                            const finite = Array.from(values || []).map(Number).filter(Number.isFinite);
                            const value = finite.length ? finite[finite.length - 1] : null;
                            const text = Number.isFinite(value) ? formatLast(value, row) : '-';
                            if (cell.textContent !== text) { cell.textContent = text; changed += 1; }
                        });
                    }
                }
                const allHeaders = Array.from(headerRow.children);
                allHeaders.forEach((cell, index) => {
                    const name = String(cell.textContent || '').trim().toLowerCase();
                    const shouldHide = requested[name] === false;
                    if (cell.hidden !== shouldHide) { cell.hidden = shouldHide; changed += 1; }
                    table.querySelectorAll(`tbody tr`).forEach(row => {
                        const target = row.children[index];
                        if (target && target.hidden !== shouldHide) { target.hidden = shouldHide; changed += 1; }
                    });
                });
            }
            return changed;
        };
    


        return Object.freeze({
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
            applyLegendColumns,
        });
    }

    root.DashBridgeGrafanaLegendVisuals = Object.freeze({ create });
})(window);
