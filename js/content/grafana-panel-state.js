// Temporary per-panel state for the current Grafana document. The map handles
// React remounts, but is intentionally recreated after a page refresh.
(() => {
    if (window.DashBridgeGrafanaPanelState) return;

    const states = window.__dashbridgeVisualPanelStates
        || (window.__dashbridgeVisualPanelStates = new Map());
    const storageKey = panel => {
        const key = keyFor(panel);
        if (!key) return null;
        const current = globalThis.location;
        const route = String(current?.pathname || '').match(/^(.*?)\/d(?:-solo)?\/([^/]+)/);
        const org = new URLSearchParams(current?.search || '').get('orgId') || '';
        return JSON.stringify([current?.origin || '', route?.[1] || '', route?.[2] || '', org, key]);
    };
    const keyFor = panel => window.DashBridgeGrafanaDom?.panelKey(panel)
        || panel?.dataset?.vizPanelKey
        || panel?.dataset?.panelid
        || panel?.getAttribute?.('data-panelid')
        || window.DashBridgeGrafanaDom?.panelKey(panel?.querySelector?.('[data-viz-panel-key],[data-panelid],[data-panel-id]'))
        || null;

    window.DashBridgeGrafanaPanelState = {
        get: panel => {
            const key = storageKey(panel);
            return key ? states.get(key) : undefined;
        },
        set: (panel, state) => {
            const key = storageKey(panel);
            if (key) {
                states.delete(key);
                states.set(key, state);
                while (states.size > 500) states.delete(states.keys().next().value);
            }
            return keyFor(panel);
        },
        keyFor,
        states
    };
})();
