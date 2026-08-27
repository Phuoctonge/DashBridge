// Paste into Grafana DevTools Console after reloading the extension.
// Diagnoses H1/H4 OFF→ON→OFF→ON idempotence and baseline restoration for viewPanel.
(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rawViewPanel = new URLSearchParams(location.search).get('viewPanel') || '';
    const panelId = rawViewPanel.startsWith('panel-') ? rawViewPanel : `panel-${rawViewPanel}`;
    const dom = window.DashBridgeGrafanaDom;
    const visual = window.DashBridgeGrafanaVisualEngine;
    const panel = dom?.findPanelById?.(panelId);
    const root = dom?.outerPanel?.(panel) || panel;

    if (!root || !visual) {
        console.error('DashBridge panel or visual engine was not found.', { panelId, panel, visual });
        return;
    }

    const shortValue = value => {
        if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
        if (value === undefined) return '[undefined]';
        if (value === null) return null;
        if (typeof value === 'object') return `[${value.constructor?.name || 'object'}]`;
        return value;
    };

    const chartState = () => {
        const uplot = root.querySelector('.uplot') ? visual.getThresholdDebug?.(root)?.renderer === 'uplot'
            ? (() => {
                const canvas = root.querySelector('.uplot canvas');
                const candidates = [canvas?.__uplot, root.querySelector('.uplot')?.__uplot, root.__uplot];
                return candidates.find(candidate => candidate?.series) || null;
            })()
            : null : null;
        const findUplot = () => {
            if (uplot) return uplot;
            const fromDebug = visual.getThresholdDebug?.(root);
            if (fromDebug?.uplot?.series) return fromDebug.uplot;
            const chart = root.querySelector('.uplot');
            const fiber = Object.keys(chart || {}).find(key => key.startsWith('__reactFiber$'));
            let node = fiber ? chart[fiber] : null;
            for (let depth = 0; node && depth < 12; depth += 1, node = node.return) {
                const props = node.memoizedProps || node.pendingProps || {};
                for (const value of Object.values(props)) {
                    if (value?.series && typeof value.redraw === 'function') return value;
                }
            }
            return null;
        };
        const plot = (() => {
            const host = root.querySelector('.flot-base, .flot-overlay, .flot-placeholder') || root;
            try { return window.jQuery?.plot?.getPlot?.(host) || window.$?.plot?.getPlot?.(host) || null; } catch (_) { return null; }
        })();
        const activeUplot = findUplot();
        if (activeUplot?.series) {
            return {
                renderer: 'uplot',
                series: activeUplot.series.slice(1).map((series, index) => ({
                    index: index + 1,
                    label: series.label,
                    fill: shortValue(series.fill),
                    originalFill: shortValue(series.__dashbridgeOriginalAreaFill),
                    width: shortValue(series.width),
                    originalWidth: shortValue(series.__dashbridgeOriginalLineWidth),
                    show: shortValue(series.show),
                })),
            };
        }
        if (plot?.getData) {
            return {
                renderer: 'flot',
                series: plot.getData().map((series, index) => ({
                    index,
                    label: series.label,
                    fill: shortValue(series.lines?.fill),
                    originalFill: shortValue(series.__dashbridgeOriginalAreaFill),
                    width: shortValue(series.lines?.lineWidth),
                    originalWidth: shortValue(series.__dashbridgeOriginalLineWidth),
                    show: shortValue(series.lines?.show),
                })),
            };
        }
        return { renderer: 'unknown', series: [] };
    };

    const canvas = () => [...root.querySelectorAll('canvas')].map(element => {
        try { return element.toDataURL(); } catch (_) { return ''; }
    }).join('|');
    const signature = state => JSON.stringify(state.series);
    const snapshot = label => {
        const state = chartState();
        return {
            label,
            canvas: canvas(),
            tools: JSON.stringify(window.__dashbridgePanelToolsState || null),
            renderer: state.renderer,
            series: state.series,
            seriesSignature: signature(state),
            thresholdCount: root.querySelectorAll('[data-dashbridge-threshold-line]').length,
            legendBottom: !!root.querySelector('.dashbridge-legend-bottom'),
        };
    };

    const command = tools => new Promise(resolve => {
        const requestId = `dashbridge-idempotence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const started = performance.now();
        const flattened = { ...tools, ...(tools.visualSettings || {}), ...(tools.transformSettings || {}) };
        delete flattened.visualSettings;
        delete flattened.transformSettings;
        const finish = acknowledged => {
            clearTimeout(timer);
            window.removeEventListener('message', handler);
            resolve({ acknowledged, elapsedMs: Math.round(performance.now() - started) });
        };
        const handler = event => {
            if (event.origin === location.origin && event.data?.action === 'panelToolsApplied' && event.data?.requestId === requestId) finish(true);
        };
        const timer = setTimeout(() => finish(false), 1500);
        window.__dashbridgePanelToolsAllowTop = true;
        window.addEventListener('message', handler);
        window.postMessage({
            action: 'applyPanelTools',
            requestId,
            tools: { targetPanelId: panelId, panelId, ...flattened },
            transformSettings: {
                grafanaIdleKeyword: 'idle',
                grafanaMemTotalKeyword: 'total',
                grafanaMemAvailKeyword: 'avail',
                grafanaTrimDomain: false,
                grafanaTrimDomainEnabled: false,
            },
        }, location.origin);
    });

    const defaults = {
        visualSettings: { removeFill: false, thickenLines: false, thickenLinesValue: 0.5, invertLegend: false },
        transformSettings: { thresholdEnabled: false, seriesQueryFilterEnabled: false },
    };
    const styleSettings = (key, value) => ({
        visualSettings: {
            removeFill: key === 'removeFill' ? value : false,
            thickenLines: key === 'thickenLines' ? value : false,
            thickenLinesValue: 4,
            invertLegend: false,
        },
        transformSettings: { thresholdEnabled: false, seriesQueryFilterEnabled: false },
    });
    const records = [];
    const stage = async (label, settings) => {
        const before = snapshot(`${label}: before`);
        const applied = await command(settings);
        await wait(850);
        const after = snapshot(`${label}: after`);
        records.push({
            label,
            acknowledged: applied.acknowledged,
            elapsedMs: applied.elapsedMs,
            canvasChanged: before.canvas !== after.canvas,
            seriesChanged: before.seriesSignature !== after.seriesSignature,
            thresholdChanged: before.thresholdCount !== after.thresholdCount,
            before,
            after,
        });
        return after;
    };

    try {
        await stage('initial reset', defaults);
        for (const key of ['removeFill', 'thickenLines']) {
            const baseline = snapshot(`${key}: baseline`);
            const firstOn = await stage(`${key}: OFF→ON (1)`, styleSettings(key, true));
            const off = await stage(`${key}: ON→OFF`, styleSettings(key, false));
            const secondOn = await stage(`${key}: OFF→ON (2)`, styleSettings(key, true));
            const finalOff = await stage(`${key}: final OFF`, defaults);
            records.push({
                label: `${key}: comparison`,
                baselineEqualsOff: baseline.canvas === off.canvas,
                firstOnChangedFromBaseline: baseline.canvas !== firstOn.canvas,
                secondOnChangedFromOff: off.canvas !== secondOn.canvas,
                finalOffEqualsBaseline: baseline.canvas === finalOff.canvas,
                firstOnSeriesChanged: baseline.seriesSignature !== firstOn.seriesSignature,
                secondOnSeriesChanged: off.seriesSignature !== secondOn.seriesSignature,
            });
        }
        console.table(records.map(record => ({
            label: record.label,
            acknowledged: record.acknowledged,
            elapsedMs: record.elapsedMs,
            canvasChanged: record.canvasChanged,
            seriesChanged: record.seriesChanged,
            baselineEqualsOff: record.baselineEqualsOff,
            firstOnChangedFromBaseline: record.firstOnChangedFromBaseline,
            secondOnChangedFromOff: record.secondOnChangedFromOff,
            finalOffEqualsBaseline: record.finalOffEqualsBaseline,
        })));
        console.log('Full E2E idempotence diagnostic:', { panelId, root, records });
    } finally {
        await command(defaults);
        await wait(850);
        console.log('Restored defaults.', snapshot('restored defaults'));
    }
})();
