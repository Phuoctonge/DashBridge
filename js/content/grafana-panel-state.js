// Temporary per-panel state for the current Grafana document. The map handles
// React remounts, but is intentionally recreated after a page refresh.
(() => {
    if (window.DashBridgeGrafanaPanelState) return;

    const states = window.__dashbridgeVisualPanelStates
        || (window.__dashbridgeVisualPanelStates = new Map());
    const keyFor = panel => window.DashBridgeGrafanaDom?.panelKey(panel)
        || panel?.dataset?.vizPanelKey
        || panel?.dataset?.panelid
        || panel?.getAttribute?.('data-panelid')
        || window.DashBridgeGrafanaDom?.panelKey(panel?.querySelector?.('[data-viz-panel-key],[data-panelid],[data-panel-id]'))
        || null;

    window.DashBridgeGrafanaPanelState = {
        get: panel => {
            const key = keyFor(panel);
            return key ? states.get(key) : undefined;
        },
        set: (panel, state) => {
            const key = keyFor(panel);
            if (key) states.set(key, state);
            return key;
        },
        keyFor,
        states
    };
})();
