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

    // Share bounded plugin discovery between hover controls and capture policy.
    const getPanelPluginId = (panel, header = null) => {
        header ||= panel?.querySelector?.('.panel-header, [data-testid*="Panel header"]');
        const panelMenuExcludedPluginIds = new Set(['stat', 'michaeldmoore-multistat-panel']);
        const candidates = [
            panel,
            header,
            ...Array.from(header?.querySelectorAll?.('button,[data-testid],h1,h2,h6') || []).slice(0, 40)
        ].filter(Boolean);
        const pluginIds = [];
        const add = value => {
            const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
            if (id && !pluginIds.includes(id)) pluginIds.push(id);
        };

        for (const element of candidates) {
            const fiberKey = Object.getOwnPropertyNames(element).find(key =>
                key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
            );
            for (let fiber = fiberKey && element[fiberKey], depth = 0;
                fiber && depth < 40; depth += 1, fiber = fiber.return) {
                const props = fiber.memoizedProps || fiber.pendingProps;
                if (!props || typeof props !== 'object') continue;
                add(props.panel?.type);
                add(props.panel?.pluginId);
                add(props.plugin?.meta?.id);
                add(props.panelPlugin?.meta?.id);
                add(props.model?.type);
                add(props.pluginId);
            }
        }
        return pluginIds.find(id => panelMenuExcludedPluginIds.has(id)) || pluginIds[0] || '';
    };

    const getCompactCaptureError = panel => {
        const pluginId = getPanelPluginId(panel);
        return pluginId === 'stat' || pluginId === 'michaeldmoore-multistat-panel'
            ? 'Компактный снимок Stat/Multistat не поддерживается. Выключите компактный режим и повторите снимок.'
            : '';
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
            `[data-panelid="${raw}"], [data-panelid="${numeric}"], [data-panel-id="${raw}"], [data-panel-id="${numeric}"], #panel-${numeric}, #${numeric}, [data-viz-panel-key="${vizKey}"]`
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

    // Owned by the calling panel-tools generation, independently of data transforms.
    const createNativeNoDataVisibility = () => {
        let resolveRoot = null, observer = null, frame = 0;
        const hidden = new Map();
        const restore = element => {
            const previous = hidden.get(element);
            if (!previous) return;
            if (element.style.getPropertyValue('visibility') === 'hidden'
                && element.style.getPropertyPriority('visibility') === 'important') {
                if (previous.value) element.style.setProperty('visibility', previous.value, previous.priority);
                else element.style.removeProperty('visibility');
            }
            delete element.dataset.dashbridgeNativeNoData;
            hidden.delete(element);
        };
        const matches = element => /^(?:No\s+data)$/i.test(String(element.textContent || '').trim())
            && !element.closest('button,a,[role="button"],h1,h2,h3,h4,h5,h6,.graph-legend-series,.u-legend')
            && !element.querySelector('canvas,svg,button,a,input,select,textarea');
        const sync = () => {
            frame = 0;
            const root = resolveRoot?.();
            const candidates = root?.querySelectorAll ? [root, ...root.querySelectorAll('div,span,p')]
                .filter(element => element.nodeType === 1 && matches(element)) : [];
            // Prefer the smallest text container; never hide the surrounding panel.
            const targets = new Set(candidates.filter(element => !candidates.some(other =>
                other !== element && element.contains(other))));
            for (const element of hidden.keys()) if (!targets.has(element) || !element.isConnected) restore(element);
            for (const element of targets) {
                if (!element.isConnected) continue;
                if (!hidden.has(element)) hidden.set(element, {
                    value: element.style.getPropertyValue('visibility'),
                    priority: element.style.getPropertyPriority('visibility')
                });
                element.dataset.dashbridgeNativeNoData = 'true';
                element.style.setProperty('visibility', 'hidden', 'important');
            }
        };
        const stop = () => {
            observer?.disconnect(); observer = null;
            if (frame) cancelAnimationFrame(frame);
            frame = 0; resolveRoot = null;
            for (const element of hidden.keys()) restore(element);
        };
        const update = resolver => {
            if (!resolver) { stop(); return; }
            resolveRoot = resolver;
            if (!observer) {
                observer = new MutationObserver(() => {
                    if (!frame) frame = requestAnimationFrame(sync);
                });
                // No attributes: writing visibility cannot trigger a feedback loop.
                observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
            }
            if (frame) cancelAnimationFrame(frame);
            sync();
        };
        return Object.freeze({ update, stop });
    };
    window.DashBridgeGrafanaDom = { panelSelectors, visiblePanels, panelKey, getPanelPluginId, getCompactCaptureError, findPanelById, findPanel, outerPanel, legendItems, legendLabel, legendSeriesNames, createNativeNoDataVisibility };
})();
