'use strict';
const { detectRenderer, summarizePanelFacts } = require('./renderer-probe');

async function snapshotPanel(page, selector) {
    if (!page || typeof page.evaluate !== 'function') throw new TypeError('Playwright page is required');
    const facts = await page.evaluate(targetSelector => {
        const root = document.querySelector(targetSelector);
        if (!root) return null;
        const labels = Array.from(root.querySelectorAll('[data-testid*="legend" i], .graph-legend-series, [class*="LegendLabel"]'))
            .map(node => node.textContent?.trim()).filter(Boolean).slice(0, 100);
        const legendAdapterReady = root.querySelector('button[class*="LegendLabel"], .graph-legend-series, .u-legend tr, .u-legend-row') !== null;
        return { id: root.getAttribute('data-panelid') || root.getAttribute('data-panel-id') || '', title: root.querySelector('[class*="panel-title" i], h2, h3')?.textContent?.trim() || '', labels, legendAdapterReady, width: root.getBoundingClientRect().width, height: root.getBoundingClientRect().height, uplotCount: root.querySelectorAll('[data-uplot], .uplot').length, flotCount: root.querySelectorAll('.flot-base, .flot-overlay').length };
    }, selector);
    return facts ? summarizePanelFacts({ ...facts, renderer: detectRenderer(facts) }) : null;
}
module.exports = { snapshotPanel };
