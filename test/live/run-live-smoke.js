'use strict';
const { parseArgs, runLiveScenario } = require('./run-live-scenario');

const SMOKE_SCENARIOS = Object.freeze(['legend-complete-hide']);

function parseSmokeArgs(argv) {
    const args = parseArgs(argv.filter((value, index) => value !== '--scenario' && argv[index - 1] !== '--scenario'));
    const index = argv.indexOf('--scenario');
    const scenario = index >= 0 ? argv[index + 1] : 'legend-complete-hide';
    if (!SMOKE_SCENARIOS.includes(scenario)) return { ...args, scenario };
    return { ...args, scenario };
}

async function runLiveSmoke(options) {
    if (!SMOKE_SCENARIOS.includes(options.scenario)) return { status: 'blocked', reason: `unknown-smoke-scenario:${String(options.scenario).slice(0, 96)}` };
    return runLiveScenario(options);
}

if (require.main === module) runLiveSmoke(parseSmokeArgs(process.argv.slice(2))).then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'passed' ? 0 : 2; }).catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { SMOKE_SCENARIOS, parseSmokeArgs, runLiveSmoke };
