// Paste into Grafana DevTools Console after reloading the extension.
// It temporarily tests removeFill, thickenLines and threshold on the selected
// viewPanel, records observable changes, then restores all three settings.
(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const query = new URLSearchParams(location.search);
    const rawViewPanel = query.get('viewPanel') || '';
    const panelId = rawViewPanel.startsWith('panel-') ? rawViewPanel : `panel-${rawViewPanel}`;
    const dom = window.DashBridgeGrafanaDom;
    const visual = window.DashBridgeGrafanaVisualEngine;
    const panel = dom?.findPanelById?.(panelId);
    const root = dom?.outerPanel?.(panel) || panel;
    if (!root || !visual) {
        console.error('DashBridge panel or visual engine was not found.', { panelId, panel, visual });
        return;
    }

    const snapshot = () => ({
        canvas: [...root.querySelectorAll('canvas')].map(canvas => {
            try { return canvas.toDataURL(); } catch (_) { return ''; }
        }).join('|'),
        threshold: root.querySelectorAll('[data-dashbridge-threshold-line]').length,
        state: JSON.stringify(window.__dashbridgePanelToolsState || null),
    });
    const command = tools => new Promise(resolve => {
        const requestId = `dashbridge-visual-diagnostic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const started = performance.now();
        const handler = event => {
            if (event.origin !== location.origin || event.data?.action !== 'panelToolsApplied' || event.data?.requestId !== requestId) return;
            clearTimeout(timer);
            window.removeEventListener('message', handler);
            resolve({ acknowledged: true, elapsedMs: Math.round(performance.now() - started) });
        };
        const timer = setTimeout(() => {
            window.removeEventListener('message', handler);
            resolve({ acknowledged: false, elapsedMs: Math.round(performance.now() - started) });
        }, 1500);
        window.__dashbridgePanelToolsAllowTop = true;
        window.addEventListener('message', handler);
        const flattened = {
            ...tools,
            ...(tools.visualSettings || {}),
            ...(tools.transformSettings || {}),
        };
        delete flattened.visualSettings;
        delete flattened.transformSettings;
        window.postMessage({
            action: 'applyPanelTools', requestId,
            tools: { targetPanelId: panelId, panelId, ...flattened },
            transformSettings: {
                grafanaIdleKeyword: 'idle', grafanaMemTotalKeyword: 'total', grafanaMemAvailKeyword: 'avail',
                grafanaTrimDomain: false, grafanaTrimDomainEnabled: false,
            },
        }, location.origin);
    });
    const applyAndCapture = async (name, tools) => {
        const before = snapshot();
        const applied = await command(tools);
        await wait(250);
        const after = snapshot();
        return {
            name,
            acknowledged: applied.acknowledged,
            elapsedMs: applied.elapsedMs,
            canvasChanged: before.canvas !== after.canvas,
            thresholdBefore: before.threshold,
            thresholdAfter: after.threshold,
            stateChanged: before.state !== after.state,
        };
    };

    const reset = {
        visualSettings: { removeFill: false, thickenLines: false, thickenLinesValue: 0.5, invertLegend: false },
        transformSettings: { thresholdEnabled: false, seriesQueryFilterEnabled: false },
    };
    const results = [];
    try {
        await command(reset);
        await wait(100);
        results.push(await applyAndCapture('removeFill', {
            visualSettings: { removeFill: true, thickenLines: false, thickenLinesValue: 0.5, invertLegend: false },
            transformSettings: { thresholdEnabled: false, seriesQueryFilterEnabled: false },
        }));
        results.push(await applyAndCapture('thickenLines', {
            visualSettings: { removeFill: false, thickenLines: true, thickenLinesValue: 4, invertLegend: false },
            transformSettings: { thresholdEnabled: false, seriesQueryFilterEnabled: false },
        }));
        results.push(await applyAndCapture('thresholdEnabled', {
            visualSettings: { removeFill: false, thickenLines: false, thickenLinesValue: 0.5, invertLegend: false },
            transformSettings: { thresholdEnabled: true, thresholdValue: 0, seriesQueryFilterEnabled: false },
        }));
        console.table(results);
        console.log('Visual engine / panel:', { panelId, root, chartSeriesCount: visual.getChartSeriesCount?.(root) });
    } finally {
        await command(reset);
        await wait(100);
        console.log('Restored defaults.', snapshot());
    }
})();
