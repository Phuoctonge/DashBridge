'use strict';
const { parseArgs } = require('./run-live-scenario');
const { runLiveSmoke } = require('./run-live-smoke');

function parseMatrixArgs(argv) {
    const index = argv.indexOf('--urls');
    if (index < 0 || !argv[index + 1]) throw new Error('Pass --urls <url-1,url-2>');
    const urls = argv[index + 1].split(',').map(value => value.trim()).filter(Boolean);
    if (!urls.length || urls.length > 2) throw new Error('Matrix accepts one or two Grafana URLs');
    const rest = argv.filter((value, position) => position !== index && position !== index + 1);
    const scenarioIndex = rest.indexOf('--scenario');
    const scenario = scenarioIndex >= 0 ? rest[scenarioIndex + 1] : 'legend-complete-hide';
    const forwarded = scenarioIndex >= 0 ? rest.filter((value, position) => position !== scenarioIndex && position !== scenarioIndex + 1) : rest;
    return { ...parseArgs(['--url', urls[0], ...forwarded]), scenario, urls };
}

async function runLiveMatrix(options, runOne = runLiveSmoke) {
    const results = [];
    for (const url of options.urls) results.push({ url, result: await runOne({ ...options, url }) });
    const statuses = results.map(item => item.result.status);
    const status = statuses.some(value => ['failed', 'timeout'].includes(value)) ? 'failed' : statuses.every(value => value === 'passed') ? 'passed' : 'blocked';
    return { status, results };
}

if (require.main === module) runLiveMatrix(parseMatrixArgs(process.argv.slice(2))).then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'passed' ? 0 : 2; }).catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { parseMatrixArgs, runLiveMatrix };
