'use strict';
const { snapshotPanel: defaultSnapshotPanel } = require('../probes/panel-probe');
const { createLegendLiveInvoker } = require('./legend-live-invoker');
const { runScenario } = require('../scenario-engine');

async function runLiveLegendScenario({ page, panelSelector, panelId, hidden, panelProbe = { snapshotPanel: defaultSnapshotPanel }, invoker = createLegendLiveInvoker(page) } = {}) {
    const before = await panelProbe.snapshotPanel(page, panelSelector);
    if (!before) return { status: 'blocked', error: 'panel-not-found' };
    const hiddenNames = Array.isArray(hidden) ? hidden.slice(0, 100) : [];
    let resetRequired = false;
    return runScenario({
        scenario: { name: 'legend-complete-hide', timeoutMs: 30_000, steps: [
            { operation: 'apply', capability: 'legend.completeHide', args: { panelId, hidden: hiddenNames } },
            { operation: 'assertHidden', capability: 'legend.completeHide', args: { panelId, hidden: hiddenNames } },
            { operation: 'reset', capability: 'legend.completeHide', args: { panelId } },
            { operation: 'assertRestored', capability: 'legend.completeHide', args: { panelId } },
        ] },
        invoke: async step => {
            if (step.operation === 'apply') {
                // Apply may mutate the renderer before rejecting.
                resetRequired = true;
                return invoker.apply({ panelId, labels: before.labels, hidden: hiddenNames });
            }
            if (step.operation === 'reset') {
                const result = await invoker.reset({ panelId });
                resetRequired = false;
                return result;
            }
            return page.evaluate(({ operation, panelId: id, hidden: names }) => {
                const root = window.DashBridgeGrafanaDom?.findPanel?.({ panelId: id }) || document;
                const labels = Array.from(root.querySelectorAll?.('[class*="LegendLabel"], .graph-legend-series') || []);
                return operation === 'assertHidden'
                    ? names.every(name => labels.some(node => node.textContent?.trim() === name && (node.closest('tr, [class*="LegendRow"]')?.classList.contains('dashbridge-uplot-fast-hidden') || node.closest('tr, [class*="LegendRow"]')?.style.display === 'none')))
                    : labels.every(node => !node.closest('tr, [class*="LegendRow"]')?.classList.contains('dashbridge-uplot-fast-hidden'));
            }, { operation: step.operation, panelId, hidden: hiddenNames });
        },
        observe: async value => value,
        assertStep: async (value, step) => step.operation === 'apply' || step.operation === 'reset' || value === true,
        cleanup: async () => {
            if (resetRequired) await invoker.reset({ panelId });
        },
    });
}
module.exports = { runLiveLegendScenario };
