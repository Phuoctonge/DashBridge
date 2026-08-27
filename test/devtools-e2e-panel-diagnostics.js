// Paste this whole script into Grafana DevTools Console on a page that has
// ?viewPanel=<id>. It performs no mutations: it only describes exactly which
// panel, chart, legend and DashBridge command path the E2E runner will use.
(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const dom = window.DashBridgeGrafanaDom;
    const visual = window.DashBridgeGrafanaVisualEngine;
    const query = new URLSearchParams(location.search);
    const rawViewPanel = query.get('viewPanel') || '';
    const requestedPanelId = rawViewPanel.startsWith('panel-') ? rawViewPanel : `panel-${rawViewPanel}`;
    const panel = dom?.findPanelById?.(requestedPanelId) || null;
    const root = dom?.outerPanel?.(panel) || panel || null;
    const titleNode = root?.querySelector?.('[data-testid*="Panel header"] h6[title], [data-testid*="Panel header"] h6, .panel-title, h6[title]');
    const legendItems = root
        ? (dom?.legendItems?.(panel) || [...root.querySelectorAll('.graph-legend-series, [class*="LegendRow"], [class*="legend-item" i], .u-legend tr, .u-legend-row, .u-off, [class*="legend"] [role="button"]')])
        : [];
    const getName = item => (item.querySelector?.('[class*="LegendLabel"], button, .graph-legend-alias, [class*="legend-label" i], [class*="legend-item-name" i], td, span') || item).textContent?.trim() || '';
    const before = [...root?.querySelectorAll?.('canvas') || []].map(canvas => {
        try { return canvas.toDataURL(); } catch (_) { return ''; }
    }).join('|');

    const requestId = `dashbridge-diagnostic-${Date.now()}`;
    const commandResult = await new Promise(resolve => {
        const handler = event => {
            if (event.origin !== location.origin || event.data?.action !== 'panelToolsApplied' || event.data?.requestId !== requestId) return;
            clearTimeout(timer);
            window.removeEventListener('message', handler);
            resolve({ acknowledged: true, elapsedMs: performance.now() - started });
        };
        const started = performance.now();
        const timer = setTimeout(() => {
            window.removeEventListener('message', handler);
            resolve({ acknowledged: false, elapsedMs: performance.now() - started });
        }, 1500);
        window.__dashbridgePanelToolsAllowTop = true;
        window.addEventListener('message', handler);
        window.postMessage({
            action: 'applyPanelTools',
            requestId,
            tools: {
                targetPanelId: requestedPanelId,
                panelId: requestedPanelId,
                visualSettings: { removeFill: false, thickenLines: false, thickenLinesValue: 0.5, invertLegend: false },
                transformSettings: { thresholdEnabled: false, seriesQueryFilterEnabled: false }
            },
            transformSettings: {
                grafanaIdleKeyword: 'idle', grafanaMemTotalKeyword: 'total', grafanaMemAvailKeyword: 'avail',
                grafanaTrimDomain: false, grafanaTrimDomainEnabled: false
            }
        }, location.origin);
    });
    await wait(100);

    const after = [...root?.querySelectorAll?.('canvas') || []].map(canvas => {
        try { return canvas.toDataURL(); } catch (_) { return ''; }
    }).join('|');
    console.table({
        requestedPanelId,
        panelFound: Boolean(panel),
        rootTag: root?.tagName || null,
        rootClass: root?.className || null,
        title: titleNode?.getAttribute('title') || titleNode?.textContent?.trim() || '',
        canvasCount: root?.querySelectorAll?.('canvas').length || 0,
        legendCount: legendItems.length,
        chartSeriesCount: visual?.getChartSeriesCount?.(root) ?? null,
        commandAcknowledged: commandResult.acknowledged,
        commandElapsedMs: Math.round(commandResult.elapsedMs),
        resetChangedCanvas: before !== after,
        toolsState: JSON.stringify(window.__dashbridgePanelToolsState || null)
    });
    console.log('Legend labels:', legendItems.map(getName).filter(Boolean));
    console.log('Resolved panel:', panel, 'Resolved root:', root);
})();
