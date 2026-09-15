'use strict';

function detectRenderer({ uplotCount = 0, flotCount = 0 } = {}) {
    const uplot = Number(uplotCount) > 0;
    const flot = Number(flotCount) > 0;
    return uplot && flot ? 'mixed' : uplot ? 'uplot' : flot ? 'flot' : 'unknown';
}
function summarizePanelFacts(value = {}) {
    return Object.freeze({
        id: String(value.id || '').slice(0, 96),
        title: String(value.title || '').slice(0, 256),
        renderer: ['uplot', 'flot', 'mixed', 'unknown'].includes(value.renderer) ? value.renderer : 'unknown',
        labels: (Array.isArray(value.labels) ? value.labels : []).slice(0, 100).map(label => String(label).slice(0, 256)),
        legendAdapterReady: value.legendAdapterReady === true,
        width: Number.isFinite(Number(value.width)) ? Math.max(0, Math.min(10_000, Number(value.width))) : 0,
        height: Number.isFinite(Number(value.height)) ? Math.max(0, Math.min(10_000, Number(value.height))) : 0,
    });
}
module.exports = { detectRenderer, summarizePanelFacts };
