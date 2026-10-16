// MAIN-world layout primitives shared by compact capture and its restoration.
(() => {
    if (window.DashBridgeGrafanaCompactLayout) return;
    const findUPlot = root => {
        if (!root) return null;
        // Grafana 12 can keep the plot outside the simple hook/ref chain below.
        // Reuse the visual engine lookup, but accept only this panel's renderer.
        const nativePlot = window.DashBridgeGrafanaVisualEngine?.findUPlot(root);
        if (nativePlot?.root && root.contains(nativePlot.root)) return nativePlot;
        for (const element of [root, ...root.querySelectorAll('*')]) {
            const fiberKey = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
            if (!fiberKey) continue;
            for (let node = element[fiberKey]; node; node = node.return) {
                for (let hook = node.memoizedState; hook; hook = hook.next) {
                    const value = hook.memoizedState;
                    const candidate = value && typeof value === 'object' && value.current ? value.current : value;
                    if (candidate?.setSize && candidate?.redraw) return candidate;
                }
            }
        }
        return null;
    };
    const restoreInlineSnapshot = (element, attribute) => {
        const raw = element.getAttribute(attribute);
        if (!raw) return false;
        Object.entries(JSON.parse(raw)).forEach(([prop, state]) => state.value
            ? element.style.setProperty(prop, state.value, state.priority || '')
            : element.style.removeProperty(prop));
        element.removeAttribute(attribute);
        return true;
    };
    const restoreSnapshotCollection = (selector, attribute) => {
        const restored = [];
        document.querySelectorAll(selector).forEach(element => {
            try {
                if (restoreInlineSnapshot(element, attribute)) restored.push(element);
            } catch (error) {
                console.error('Cannot restore compact layout snapshot:', error);
                element.removeAttribute(attribute);
            }
        });
        return restored;
    };
    const redrawFlot = (root, useCompactTicks = false) => {
        const $ = window.jQuery || window.$;
        if (!$ || !root) return;
        $(root).find('.graph-panel__chart, .flot-base, .flot-overlay, canvas')
            .addBack('.graph-panel__chart, .flot-base, .flot-overlay, canvas').each(function () {
                const plot = $(this).data('plot');
                if (!plot || typeof plot.resize !== 'function') return;
                if (useCompactTicks && typeof plot.getOptions === 'function' && typeof plot.getAxes === 'function') {
                    const options = plot.getOptions();
                    const xaxisOptions = options?.xaxes?.[0];
                    const xaxis = plot.getAxes().xaxis;
                    if (xaxisOptions?.mode === 'time' && xaxis && xaxis.max > xaxis.min) {
                        if (!Object.prototype.hasOwnProperty.call(plot, '__dashBridgeCompactTickSize')) {
                            plot.__dashBridgeCompactTickSize = Array.isArray(xaxisOptions.tickSize)
                                ? [...xaxisOptions.tickSize]
                                : xaxisOptions.tickSize;
                        }
                        const rangeMinutes = (xaxis.max - xaxis.min) / 60000;
                        const steps = [1, 2, 5, 10, 15, 30, 60, 120, 240, 720, 1440];
                        const tickStep = steps.find(step => step >= rangeMinutes / 6) || 1440;
                        xaxisOptions.tickSize = [tickStep, 'minute'];
                    }
                }
                plot.resize(); plot.setupGrid?.(); plot.draw?.();
            });
    };
    const rememberUPlotSize = (root, boundsElement = root) => {
        const uplot = findUPlot(root);
        const canvas = root && Array.from(root.querySelectorAll('canvas')).find(item => !item.classList.contains('flot-base') && !item.classList.contains('flot-overlay'));
        if (!uplot || !canvas) return null;
        if (!Object.prototype.hasOwnProperty.call(uplot, '__dashBridgeCompactSize')) {
            const panelBounds = boundsElement.getBoundingClientRect();
            const canvasBounds = canvas.getBoundingClientRect();
            uplot.__dashBridgeCompactSize = {
                width: uplot.width, height: uplot.height,
                horizontalChrome: Math.max(0, panelBounds.width - canvasBounds.width),
                verticalChrome: Math.max(0, panelBounds.height - canvasBounds.height),
                // Compact capture temporarily changes the plot width. Keep the
                // exact native X increment so restoring the size does not leave a
                // denser set of vertical time-grid lines behind.
                xAxisIncrement: Number.isFinite(uplot.axes?.[0]?._found?.[0])
                    ? uplot.axes[0]._found[0]
                    : null
            };
            const chartRoot = uplot.root;
            if (chartRoot?.style?.getPropertyValue && !uplot.__dashBridgeCompactInlineSize) {
                uplot.__dashBridgeCompactInlineSize = new Map(['width', 'height'].map(property => [property, {
                    value: chartRoot.style.getPropertyValue(property),
                    priority: chartRoot.style.getPropertyPriority(property)
                }]));
            }
        }
        return uplot;
    };
    const resizeUPlot = (root, boundsElement = root, retainedUPlot = null) => {
        const uplot = retainedUPlot || findUPlot(root);
        const savedSize = uplot && uplot.__dashBridgeCompactSize;
        if (!uplot || !savedSize) return;
        const panelBounds = boundsElement.getBoundingClientRect();
        const width = Math.max(1, Math.round(panelBounds.width - savedSize.horizontalChrome));
        const height = Math.max(1, Math.round(panelBounds.height - savedSize.verticalChrome));
        uplot.setSize({ width, height });
        uplot.redraw(true, true);
        const chartRoot = uplot.root;
        if (chartRoot?.style?.setProperty) {
            if (!uplot.__dashBridgeCompactInlineSize) {
                uplot.__dashBridgeCompactInlineSize = new Map(['width', 'height'].map(property => [property, {
                    value: chartRoot.style.getPropertyValue(property),
                    priority: chartRoot.style.getPropertyPriority(property)
                }]));
            }
            chartRoot.style.setProperty('width', `${width}px`, 'important');
            chartRoot.style.setProperty('height', `${height}px`, 'important');
            if (!uplot.__dashBridgeCompactNativeSetSize && typeof uplot.setSize === 'function') {
                const nativeSetSize = uplot.setSize;
                const guardedSetSize = size => {
                    nativeSetSize.call(uplot, { width, height });
                    chartRoot.style.setProperty('width', `${width}px`, 'important');
                    chartRoot.style.setProperty('height', `${height}px`, 'important');
                };
                uplot.__dashBridgeCompactNativeSetSize = { nativeSetSize };
                uplot.setSize = guardedSetSize;
            }
            uplot.__dashBridgeCompactSizePin?.disconnect?.();
            const applyPinnedSize = () => {
                const widthValue = `${width}px`;
                const heightValue = `${height}px`;
                const widthMatches = chartRoot.style.getPropertyValue('width') === widthValue
                    && chartRoot.style.getPropertyPriority('width') === 'important';
                const heightMatches = chartRoot.style.getPropertyValue('height') === heightValue
                    && chartRoot.style.getPropertyPriority('height') === 'important';
                if (widthMatches && heightMatches) return;
                chartRoot.style.setProperty('width', widthValue, 'important');
                chartRoot.style.setProperty('height', heightValue, 'important');
                if (uplot.width !== width || uplot.height !== height) {
                    uplot.setSize({ width, height });
                    uplot.redraw(true, true);
                }
            };
            const observer = typeof MutationObserver === 'function'
                ? new MutationObserver(applyPinnedSize)
                : null;
            observer?.observe(chartRoot, { attributes: true, attributeFilter: ['style'] });
            uplot.__dashBridgeCompactSizePin = { disconnect: () => observer?.disconnect() };
        }
    };
    const relaxInlineSizeConstraints = root => {
        const table = Array.from(root?.querySelectorAll('table, [role="table"], [role="grid"]') || []).find(candidate => {
            // Modern Grafana gives the table a generated class, while its rows
            // retain LegendRow. It is chart chrome, not a native Table panel.
            if (candidate.closest('.graph-legend, .u-legend, [class*="legend" i]')
                || candidate.querySelector('tr[class*="LegendRow"]')) return false;
            const data = window.DashBridgeGrafanaTableReport?.collectGrafanaTableData?.(candidate);
            return data?.columns?.length >= 2 && data.rows?.length > 0;
        });
        const uplot = table ? null : findUPlot(root);
        const legendRow = root?.querySelector('table tbody tr, .u-legend tr, tr[class*="LegendRow"], [data-testid^="data-testid VizLegend series "]');
        const legend = legendRow?.closest('table, [role="table"], .u-legend, ul') || legendRow;
        // A modern panel can legitimately show No data with no renderer/rows.
        // React still rewrites its measured wrapper and grid transform after
        // reparenting. Retain that known panel shell without guessing plugin internals.
        const shellOnly = !table && (!uplot || !legend)
            && ['timeseries', 'table'].includes(window.DashBridgeGrafanaDom?.getPanelPluginId(root));
        if (!table && (!uplot || !legend) && !shellOnly) return null;
        const chart = root.querySelector('.uplot');
        let common = table ? table.closest('section, .panel-container, [data-testid^="data-testid Panel header"]')
            : shellOnly ? root.querySelector('section, .panel-container') : chart;
        if (!table && !shellOnly) while (common && legend && !common.contains(legend)) common = common.parentElement;
        if (!common || !root.contains(common) || !table && !shellOnly && common === root) return null;
        const properties = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'];
        const snapshots = [];
        const touched = new Set();
        const touch = (element, full = true) => {
            if (!element || touched.has(element)) return;
            touched.add(element);
            snapshots.push({ element, full, values: properties.map(property => [
                property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)
            ]) });
            properties.forEach(property => {
                if (!full && property !== 'min-width') return;
                element.style.setProperty(property, property.startsWith('min-') ? '0px' : '100%', 'important');
            });
        };
        for (let element = common; element; element = element.parentElement) {
            touch(element);
            if (element === root) break;
        }
        if (!table && !shellOnly) Array.from(common.children).forEach(element => touch(element, false));
        const originalTransform = {
            value: root.style.getPropertyValue('transform'), priority: root.style.getPropertyPriority('transform'),
        };
        const originalColumns = table?.matches?.('[role="grid"]') ? {
            value: table.style.getPropertyValue('grid-template-columns'),
            priority: table.style.getPropertyPriority('grid-template-columns'),
        } : null;
        const columnWidths = originalColumns?.value.trim().split(/\s+/) || [];
        // Native grids can retain measured pixel columns after their panel is
        // resized. Fit only a complete explicit track list, preserving ratios.
        const fittedColumns = columnWidths.length === Number(table?.getAttribute?.('aria-colcount'))
            && columnWidths.every(width => /^\d+(?:\.\d+)?px$/.test(width) && parseFloat(width) > 0)
            ? columnWidths.map(width => `minmax(0px, ${parseFloat(width)}fr)`).join(' ') : null;
        // React grid and panel measurements can rewrite inline styles after
        // reparenting, including transform on the outer grid item. Pin the
        // selected table/chart ancestry until restoration, leaving renderer
        // children under the existing min-width-only contract.
        const pinLayout = () => {
            snapshots.forEach(({ element, full }) => properties.forEach(property => {
                if (!full && property !== 'min-width') return;
                const value = property.startsWith('min-') ? '0px' : '100%';
                if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') {
                    element.style.setProperty(property, value, 'important');
                }
            }));
            if (root.style.getPropertyValue('transform') !== 'none' || root.style.getPropertyPriority('transform') !== 'important') {
                root.style.setProperty('transform', 'none', 'important');
            }
            if (fittedColumns && (table.style.getPropertyValue('grid-template-columns') !== fittedColumns
                || table.style.getPropertyPriority('grid-template-columns') !== 'important')) {
                table.style.setProperty('grid-template-columns', fittedColumns, 'important');
            }
        };
        const observer = typeof MutationObserver === 'function' ? new MutationObserver(pinLayout) : null;
        pinLayout();
        observer?.observe(root, { subtree: true, attributes: true, attributeFilter: ['style'] });
        return {
            restore() {
                observer?.disconnect();
                snapshots.forEach(({ element, values }) => values.forEach(([property, value, priority]) => {
                    if (value) element.style.setProperty(property, value, priority);
                    else element.style.removeProperty(property);
                }));
                if (originalTransform) {
                    if (originalTransform.value) root.style.setProperty('transform', originalTransform.value, originalTransform.priority);
                    else root.style.removeProperty('transform');
                }
                if (fittedColumns) {
                    table.style.setProperty('grid-template-columns', originalColumns.value, originalColumns.priority);
                }
            }
        };
    };
    const restoreUPlot = (panels, retainedUPlot = null) => {
        const instances = new Set([
            ...(retainedUPlot ? [retainedUPlot] : []),
            ...panels.map(panel => findUPlot(panel)).filter(Boolean)
        ]);
        instances.forEach(uplot => {
            const savedSize = uplot && uplot.__dashBridgeCompactSize;
            if (!savedSize) return;
            const xAxis = uplot.axes?.[0];
            const originalXAxisIncrements = xAxis?._incrs;
            const restoreNativeTimeGrid = Number.isFinite(savedSize.xAxisIncrement)
                && typeof originalXAxisIncrements === 'function';
            const guardedSetSize = uplot.__dashBridgeCompactNativeSetSize;
            if (guardedSetSize) {
                uplot.setSize = guardedSetSize.nativeSetSize;
                delete uplot.__dashBridgeCompactNativeSetSize;
            }
            try {
                if (restoreNativeTimeGrid) xAxis._incrs = () => [savedSize.xAxisIncrement];
                try {
                    uplot.setSize({ width: savedSize.width, height: savedSize.height });
                    uplot.redraw(true, true);
                } finally {
                    if (restoreNativeTimeGrid) xAxis._incrs = originalXAxisIncrements;
                }
            } finally {
                const chartRoot = uplot.root;
                uplot.__dashBridgeCompactSizePin?.disconnect?.();
                delete uplot.__dashBridgeCompactSizePin;
                const inlineSize = uplot.__dashBridgeCompactInlineSize;
                inlineSize?.forEach(({ value, priority }, property) => {
                    if (value) chartRoot?.style?.setProperty(property, value, priority);
                    else chartRoot?.style?.removeProperty(property);
                });
                delete uplot.__dashBridgeCompactInlineSize;
                delete uplot.__dashBridgeCompactSize;
            }
        });
    };
    const restoreFlot = panels => {
        const $ = window.jQuery || window.$;
        if (!$) return;
        panels.forEach(panel => $(panel).find('.graph-panel__chart, .flot-base, .flot-overlay, canvas')
            .addBack('.graph-panel__chart, .flot-base, .flot-overlay, canvas').each(function () {
                const plot = $(this).data('plot');
                if (!plot || typeof plot.resize !== 'function') return;
                if (Object.prototype.hasOwnProperty.call(plot, '__dashBridgeCompactTickSize')) {
                    const options = plot.getOptions?.();
                    if (options?.xaxes?.[0]) options.xaxes[0].tickSize = plot.__dashBridgeCompactTickSize;
                    delete plot.__dashBridgeCompactTickSize;
                }
                plot.resize(); plot.setupGrid?.(); plot.draw?.();
            }));
    };
    window.DashBridgeGrafanaCompactLayout = {
        findUPlot, restoreInlineSnapshot, restoreSnapshotCollection,
        redrawFlot, rememberUPlotSize, resizeUPlot, relaxInlineSizeConstraints, restoreUPlot, restoreFlot
    };
})();
