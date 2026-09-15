/* global window, document */
'use strict';
const { runScenario } = require('../scenario-engine');

async function runLiveThresholdScenario({ page, panelSelector = '[data-testid^="data-testid Panel header"]', panelId, threshold, sourceNames = [], panelProbe = null, invoker = null } = {}) {
    if (!page || typeof page.evaluate !== 'function') throw new TypeError('Playwright page is required');
    if (!Number.isFinite(Number(threshold))) return { status: 'blocked', error: 'threshold-must-be-finite' };
    if (!Array.isArray(sourceNames) || sourceNames.length === 0) return { status: 'blocked', error: 'threshold-source-names-required' };
    const before = panelProbe ? await panelProbe.snapshotPanel(page, panelSelector) : { renderer: 'unknown' };
    if (!before) return { status: 'blocked', error: 'panel-not-found' };
    let resetRequired = false;
    const call = invoker || {
        apply: args => page.evaluate(({ id, value, names }) => window.DashBridgeGrafanaVisualEngine?.setSeriesThresholdHighlights({ root: window.DashBridgeGrafanaDom?.findPanel?.({ panelId: id }) || document, enabled: true, rules: [{ threshold: value, sourceNames: names }] }), { id: String(panelId), value: Number(threshold), names: sourceNames.slice(0, 100) }),
        reset: args => page.evaluate(({ id }) => window.DashBridgeGrafanaVisualEngine?.setSeriesThresholdHighlights({ root: window.DashBridgeGrafanaDom?.findPanel?.({ panelId: id }) || document, enabled: false, rules: [] }), { id: String(args.panelId) }),
    };
    return runScenario({
        scenario: { name: 'threshold-highlight', timeoutMs: 30_000, steps: [
            { operation: 'apply', capability: 'threshold.highlight', args: { panelId, threshold } },
            { operation: 'assertVisible', capability: 'threshold.highlight', args: { panelId } },
            { operation: 'reset', capability: 'threshold.highlight', args: { panelId } },
            { operation: 'assertRestored', capability: 'threshold.highlight', args: { panelId } },
        ] },
        invoke: async step => {
            if (step.operation === 'apply') { resetRequired = true; return call.apply({ panelId, threshold, sourceNames }); }
            if (step.operation === 'reset') { const result = await call.reset({ panelId }); resetRequired = false; return result; }
            if (step.operation === 'assertVisible' && typeof page.waitForFunction === 'function') {
                await page.waitForFunction(() => document.querySelectorAll('[data-dashbridge-threshold-highlights]').length > 0, undefined, { timeout: 3_000 });
            }
            return page.evaluate(operation => {
                const visible = operation === 'assertVisible'
                    ? document.querySelectorAll('[data-dashbridge-threshold-highlights]').length > 0
                    : document.querySelectorAll('[data-dashbridge-threshold-highlights], [data-dashbridge-threshold-line]').length === 0;
                return { visible, diagnostic: window.__dashbridgeThresholdHighlightDiagnostic || null };
            }, step.operation);
        },
        assertStep: async (value, step) => {
            if (step.operation === 'apply' || step.operation === 'reset' || value === true || value?.visible === true) return true;
            throw new Error(`threshold overlay missing: ${JSON.stringify(value?.diagnostic || null).slice(0, 512)}`);
        },
        cleanup: async () => { if (resetRequired) await call.reset({ panelId }); },
    });
}
module.exports = { runLiveThresholdScenario };
