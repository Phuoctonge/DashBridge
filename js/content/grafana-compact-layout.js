// MAIN-world layout primitives shared by compact capture and its restoration.
(() => {
    if (window.DashBridgeGrafanaCompactLayout) return;
    const findUPlot = root => {
        if (!root) return null;
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
        if (!uplot || !canvas || Object.prototype.hasOwnProperty.call(uplot, '__dashBridgeCompactSize')) return;
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
    };
    const resizeUPlot = (root, boundsElement = root) => {
        const uplot = findUPlot(root);
        const savedSize = uplot && uplot.__dashBridgeCompactSize;
        if (!uplot || !savedSize) return;
        const panelBounds = boundsElement.getBoundingClientRect();
        const width = Math.max(1, Math.round(panelBounds.width - savedSize.horizontalChrome));
        const height = Math.max(1, Math.round(panelBounds.height - savedSize.verticalChrome));
        uplot.setSize({ width, height });
        uplot.redraw(true, true);
    };
    const restoreUPlot = panels => {
        panels.forEach(panel => {
            const uplot = findUPlot(panel);
            const savedSize = uplot && uplot.__dashBridgeCompactSize;
            if (!savedSize) return;
            const xAxis = uplot.axes?.[0];
            const originalXAxisIncrements = xAxis?._incrs;
            const restoreNativeTimeGrid = Number.isFinite(savedSize.xAxisIncrement)
                && typeof originalXAxisIncrements === 'function';
            if (restoreNativeTimeGrid) xAxis._incrs = () => [savedSize.xAxisIncrement];
            try {
                uplot.setSize({ width: savedSize.width, height: savedSize.height });
                uplot.redraw(true, true);
            } finally {
                if (restoreNativeTimeGrid) xAxis._incrs = originalXAxisIncrements;
            }
            delete uplot.__dashBridgeCompactSize;
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
        redrawFlot, rememberUPlotSize, resizeUPlot, restoreUPlot, restoreFlot
    };
})();
