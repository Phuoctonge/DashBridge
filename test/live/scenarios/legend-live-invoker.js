'use strict';

function createLegendLiveInvoker(page) {
    if (!page || typeof page.evaluate !== 'function') throw new TypeError('Playwright page is required');
    return {
        apply({ panelId, labels, hidden }) {
            const args = { operation: 'apply', panelId: String(panelId), labels: labels.slice(0, 100), hidden: hidden.slice(0, 100) };
            return page.evaluate(({ panelId: id, labels: names, hidden: hiddenNames }) => {
                const engine = window.DashBridgeGrafanaVisualEngine;
                if (!engine?.apply) throw new Error('Grafana visual engine is unavailable');
                const hiddenSet = new Set(hiddenNames);
                const seriesConfig = Object.fromEntries(names.map(name => [name, !hiddenSet.has(name)]));
                return engine.apply({ panelId: id, seriesConfig, mode: 'fast_complete_hide' });
            }, args);
        },
        reset({ panelId }) {
            const args = { operation: 'reset', panelId: String(panelId) };
            return page.evaluate(({ panelId: id }) => {
                const engine = window.DashBridgeGrafanaVisualEngine;
                if (!engine?.resetSeriesVisibility) throw new Error('Grafana visual engine reset is unavailable');
                return engine.resetSeriesVisibility({ root: window.DashBridgeGrafanaDom?.findPanel?.({ panelId: id }) || document });
            }, args);
        },
    };
}
module.exports = { createLegendLiveInvoker };
