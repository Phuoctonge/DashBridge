'use strict';
const { runScenario } = require('../scenario-engine');

function createLegendCompleteHideScenario({ panel, series }) {
    const args = { panel, series: Array.isArray(series) ? series.slice(0, 100) : [] };
    return {
        name: 'legend-complete-hide',
        run({ invoke, observe, assertStep, cleanup } = {}) {
            return runScenario({
                scenario: { name: 'legend-complete-hide', timeoutMs: 30_000, steps: [
                    { capability: 'legend.completeHide', operation: 'apply', panel, args },
                    { capability: 'legend.completeHide', operation: 'snapshot', panel, args: {} },
                    { capability: 'legend.completeHide', operation: 'reset', panel, args: {} },
                ] },
                invoke, observe, assertStep, cleanup,
            });
        },
    };
}
module.exports = { createLegendCompleteHideScenario };
