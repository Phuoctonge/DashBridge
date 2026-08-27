// Shared Grafana DOM contract.  It runs in Grafana's MAIN world and is used
// by capture, legend and panel-tools code before their local fallbacks.
(() => {
    const panelSelectors = '.react-grid-item, .panel-container, [data-testid^="data-testid Panel header"], [data-panelid], [data-viz-panel-key^="panel-"]';
    const visiblePanels = () => [...document.querySelectorAll(panelSelectors)].filter(panel => panel.offsetHeight > 100);

    // Older Grafana versions expose a numeric id; newer ones use `panel-N`.
    // Keep one normalized key for temporary visual state across both DOM forms.
    const panelKey = panel => {
        const raw = panel?.dataset?.vizPanelKey
            || panel?.dataset?.panelid
            || panel?.getAttribute?.('data-panel-id')
            || panel?.getAttribute?.('data-panelid');
        if (raw === null || raw === undefined || raw === '') return null;
        const value = String(raw);
        return value.startsWith('panel-') ? value : `panel-${value}`;
    };

    const findPanelById = panelId => {
        if (panelId === null || panelId === undefined || panelId === '') return null;
        const escape = window.CSS?.escape || (value => String(value).replace(/["\\]/g, '\\$&'));
        const rawId = String(panelId);
        const numericId = rawId.replace(/^panel-/, '');
        const raw = escape(rawId);
        const numeric = escape(numericId);
        const vizKey = escape(rawId.startsWith('panel-') ? rawId : `panel-${rawId}`);
        return document.querySelector(
            `[data-panelid="${raw}"], [data-panelid="${numeric}"], [data-panel-id="${raw}"], [data-panel-id="${numeric}"], #panel-${numeric}, [data-viz-panel-key="${vizKey}"]`
        );
    };

    const findPanel = ({ panelId = null, title = '', type = 'active' } = {}) => {
        if (panelId) {
            const panel = findPanelById(panelId);
            if (panel) return panel;
        }
        const fullscreen = document.querySelector('.react-grid-item--fullscreen, .panel-in-fullscreen, .panel-fullscreen, [class*="fullscreen"]');
        if (fullscreen) return fullscreen;
        const panels = visiblePanels();
        if (type !== 'active') {
            const exact = title && panels.find(panel => panel.innerText?.includes(title));
            if (exact) return exact;
            const markers = type === 'mem' ? ['mem', 'ram', 'memory', 'память'] : ['load', 'idle', 'cpu'];
            const marker = panels.find(panel => markers.some(value => panel.innerText?.toLowerCase().includes(value)));
            if (marker) return marker;
        }
        return panels.length === 1 ? panels[0] : (panels.find(panel => panel.querySelector('canvas')) || panels[0] || null);
    };

    const outerPanel = panel => {
        if (!panel) return panel;
        // In modern Grafana the keyed element is only an inner visualization
        // node; legend and canvas siblings live in the surrounding grid item.
        // In Flot they are usually siblings inside .panel-container.
        return panel.closest?.('.react-grid-item, .panel-container, .panel-wrapper, [class*="panel-wrapper"]') || panel;
    };

    const legendItems = panel => [...outerPanel(panel).querySelectorAll(
        '.graph-legend-series, [class*="legend-item" i], .u-legend tr, .u-legend-row, [class*="LegendRow"], [class*="Legend"] [role="button"], [class*="legend"] [role="button"]'
    )];

    // A Grafana legend row can include calculated values beside its series label.
    // All occurrence-aware visibility keys must use this label node, not row text.
    const legendLabel = item => item?.querySelector(
        '[class*="LegendLabel"], .graph-legend-alias, [class*="legend-label" i], [class*="legend-item-name" i]'
    ) || item?.querySelector('button') || item?.querySelector('td, span') || item;

    const genericSeriesName = name => /^(?:value|series|metric|значение|серия|метрика)$/iu
        .test(String(name || '').trim());

    const legendSeriesNames = (panel, { unique = true } = {}) => {
        const domNames = legendItems(panel)
            .map(item => String(legendLabel(item)?.textContent || '').trim())
            // Table legends can expose their header row through the same
            // selectors as data rows. It is not a chart series.
            .filter(name => name && !/^(?:name|series|имя|серия)$/i.test(name))
        const responseNames = Array.isArray(window.__dashbridgePanelToolsVisualMetadata?.responseSeriesNames)
            ? window.__dashbridgePanelToolsVisualMetadata.responseSeriesNames
                .map(name => String(name || '').trim()).filter(Boolean)
            : [];
        // Grafana often exposes every uPlot field as the technical `Value`
        // before (or even instead of) painting its human-readable legend. The
        // response metadata is captured in the same field order and lets this
        // shared contract serve both the series picker and report collector.
        let names = domNames;
        if (!domNames.length && responseNames.length) names = responseNames;
        else if (responseNames.length === domNames.length) {
            names = domNames.map((name, index) => genericSeriesName(name) && !genericSeriesName(responseNames[index])
                ? responseNames[index] : name);
        }
        const seen = new Set();
        return names.filter(name => !unique || (!seen.has(name) && seen.add(name)));
    };

    window.DashBridgeGrafanaDom = { panelSelectors, visiblePanels, panelKey, findPanelById, findPanel, outerPanel, legendItems, legendLabel, legendSeriesNames };
})();
