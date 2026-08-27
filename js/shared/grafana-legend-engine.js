// Shared legend API for extension pages.  DOM changes stay in Grafana's MAIN
// world; callers only deal with stable keys and visible/hidden state.
async function getGrafanaLegendSeries({ tabId, panelId = null }) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            files: ['js/content/grafana-dom.js']
        });
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            args: [panelId],
            func: (targetPanelId) => {
                let panel = window.DashBridgeGrafanaDom?.findPanel({ panelId: targetPanelId });
                if (!panel) return [];
                panel = window.DashBridgeGrafanaDom?.outerPanel(panel) || panel;
                const items = window.DashBridgeGrafanaDom?.legendItems(panel) || panel.querySelectorAll('.graph-legend-series, [class*="legend-item" i], .u-legend tr, .u-legend-row, [class*="LegendRow"], [class*="Legend"] [role="button"], [class*="legend"] [role="button"]');
                const occurrences = new Map();
                return [...items].map(item => {
                    const label = item.querySelector('[class*="LegendLabel"], button, .graph-legend-alias, [class*="legend-label" i], [class*="legend-item-name" i], td, span') || item;
                    const name = (label.textContent || '').trim();
                    if (!name) return null;
                    const occurrence = occurrences.get(name) || 0;
                    occurrences.set(name, occurrence + 1);
                    const classes = `${item.className || ''} ${label.className || ''}`.toLowerCase();
                    const hidden = item.style.display === 'none' || classes.includes('hidden') || classes.includes('disabled') ||
                        Number.parseFloat(getComputedStyle(item).opacity || '1') < 0.6;
                    return { key: `${name}\u0000${occurrence}`, name, visible: !hidden };
                }).filter(Boolean);
            }
        });
        return results?.[0]?.result || [];
    } catch (error) {
        console.error('Cannot read Grafana legend:', error);
        return null;
    }
}

// Batch works with stable occurrence keys, so it keeps this small adapter on
// top of the shared panel-tools bridge.
async function setGrafanaLegendVisibility({ tabId, panelId = null, selectedKeys, mode = 'fast_click_toggle' }) {
    const selected = new Set(selectedKeys || []);
    const series = await getGrafanaLegendSeries({ tabId, panelId });
    if (!series) return { ok: false, reason: 'legend-unavailable' };
    const visibility = Object.fromEntries(series.map(seriesItem => [seriesItem.key, selected.has(seriesItem.key)]));
    return applySharedGrafanaPanelTools({
        legendFilter: [],
        legendVisibility: visibility,
        legendMode: mode,
        targetPanelId: panelId
    }, { tabId, refresh: false });
}
