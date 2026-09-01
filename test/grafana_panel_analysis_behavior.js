'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const sourcePath = 'js/shared/grafana-panel-analysis.js';
assert(fs.existsSync(sourcePath), 'shared panel analysis module must exist');
const source = fs.readFileSync(sourcePath, 'utf8');
const context = { globalThis: {} };
context.window = context.globalThis;
vm.createContext(context);
vm.runInContext(source, context);
const analysis = context.globalThis.DashBridgeGrafanaPanelAnalysis;

assert.strictEqual(analysis.classifyTitle('CPU'), null);
assert.strictEqual(analysis.classifyTitle(' cpu CALCULATED '), null);
assert.strictEqual(analysis.classifyTitle('RAM'), null);
assert.strictEqual(analysis.classifyTitle('RAM calculated'), null);
assert.strictEqual(analysis.classifyTitle('CPU Usage'), 'cpu');
assert.strictEqual(analysis.classifyTitle('CPU Usage calculated'), 'cpu');
assert.strictEqual(analysis.classifyTitle('Memory'), 'ram');
assert.strictEqual(analysis.classifyTitle('Memory calculated'), 'ram');
assert.strictEqual(analysis.classifyTitle('CPU Count'), null);
assert.strictEqual(analysis.classifyTitle('Memory Errors'), null);
assert.strictEqual(analysis.classifyTitle('Load Average calculated'), null);
assert.strictEqual(analysis.classifyTitle('Calculated'), null);
assert.strictEqual(analysis.classifyPanelTitle('Load Average'), 'load');
assert.strictEqual(analysis.classifyPanelTitle('Load Average calculated'), 'load');
assert.strictEqual(analysis.classifyTitle('Processor calculated', { grafanaCpuPanelTitle: 'Processor' }), 'cpu');
assert.strictEqual(analysis.classifyTitle('RAM Used', { grafanaMemPanelTitle: 'RAM Used' }), 'ram');
assert.strictEqual(analysis.classifyPanelTitle('System Load calculated', { grafanaLoadPanelTitle: 'System Load' }), 'load');
assert.strictEqual(analysis.classifyPanelTitle('CPU Usage Extra'), null);

const defaults = {
    idleKeyword: 'idle[0]',
    totalKeyword: 'total[bytes]',
    availKeyword: 'available[bytes]',
    trimDomain: '.example:9182',
    trimDomainEnabled: true
};

const cpuPeriod = analysis.analyzeRecords({
    type: 'cpu', mode: 'period', settings: defaults,
    records: [
        { name: 'server-01.example:9182 idle[0]', values: ['95%', '70%', '85%'] },
        { name: 'server-02.example:9182 load (calc)', values: ['20%', '65%', '40%'] }
    ]
});
assert.strictEqual(cpuPeriod.ok, true);
assert.deepStrictEqual(Array.from(cpuPeriod.items, item => ({ server: item.server, value: item.value })), [
    { server: 'server-02', value: 65 },
    { server: 'server-01', value: 30 }
]);

const cpuLatest = analysis.analyzeRecords({
    type: 'cpu', mode: 'latest', settings: defaults,
    records: [{ name: 'server-01.example:9182 idle[0]', current: '82,5%' }]
});
assert.strictEqual(cpuLatest.items[0].value, 17.5);

const ramPeriod = analysis.analyzeRecords({
    type: 'ram', mode: 'period', settings: defaults,
    records: [
        { name: 'server-01.example:9182 total[bytes]', values: ['100 GiB', '100 GiB'] },
        { name: 'server-01.example:9182 available[bytes]', values: ['40 GiB', '25 GiB'] }
    ]
});
assert.strictEqual(ramPeriod.ok, true);
assert.strictEqual(ramPeriod.items[0].server, 'server-01');
assert.strictEqual(ramPeriod.items[0].value, 75);

const ramUsedKeywordIsIndependentFromFormula = analysis.analyzeRecords({
    type: 'ram', mode: 'latest',
    settings: { ...defaults, availKeyword: 'consumed[bytes]', memCalcMode: 'used' },
    records: [
        { name: 'server-01.example:9182 total[bytes]', current: '200 GiB' },
        { name: 'server-01.example:9182 consumed[bytes]', current: '50 GiB' }
    ]
});
assert.strictEqual(ramUsedKeywordIsIndependentFromFormula.items[0].value, 25,
    'explicit Used mode must not depend on the second series containing the word "used"');

const ramCalculated = analysis.analyzeRecords({
    type: 'ram', mode: 'latest', settings: defaults,
    records: [{ name: 'server-02.example:9182 Used % (calc)', current: '91,25%' }]
});
assert.strictEqual(ramCalculated.items[0].value, 91.25);

const missing = analysis.analyzeRecords({
    type: 'ram', mode: 'period', settings: defaults,
    records: [{ name: 'requests', values: ['10', '20'] }]
});
assert.strictEqual(missing.ok, false);
assert.strictEqual(missing.reason, 'metrics-not-found');

const responseFrame = (name, instance, times, values, extra = {}) => ({
    schema: { name: extra.frameName || instance, fields: [
        { name: 'Time', type: 'time' },
        {
            name, type: 'number', labels: { instance, ...(extra.labels || {}) },
            config: { displayName: extra.displayName || name, ...(extra.config || {}) }
        }
    ] },
    data: { values: [times, values] }
});
const response = results => ({ results });

const cpuResponse = analysis.analyzeResponse({
    type: 'cpu', settings: defaults, targetRefIds: new Set(['A', 'B']),
    data: response({
        A: { frames: [responseFrame('idle[0]', 'server-01.example:9182', [1, 2, 3], [90, 60, 80])] },
        B: { frames: [responseFrame('load (calc)', 'server-02.example:9182', [3, 1, 2], [20, 10, 55])] },
        Z: { frames: [responseFrame('idle[0]', 'wrong-panel', [1], [0])] }
    })
});
assert.strictEqual(cpuResponse.ok, true);
assert.deepStrictEqual(Array.from(cpuResponse.period, item => ({ server: item.server, value: item.value })), [
    { server: 'server-02', value: 55 },
    { server: 'server-01', value: 40 }
]);
assert.deepStrictEqual(Array.from(cpuResponse.latest, item => ({ server: item.server, value: item.value })), [
    { server: 'server-01', value: 20 },
    { server: 'server-02', value: 20 }
]);

const ramResponse = analysis.analyzeResponse({
    type: 'ram', settings: defaults,
    data: response({
        T: { frames: [
            responseFrame('total[bytes]', 'server-01.example:9182', [1, 2, 3, 4], [100, 100, 100, 100]),
            responseFrame('total[bytes]', 'server-02.example:9182', [1, 2], [200, 200])
        ] },
        A: { frames: [
            responseFrame('available[bytes]', 'server-01.example:9182', [1, 3, 4, 5], [80, 20, 50, 0]),
            responseFrame('available[bytes]', 'server-02.example:9182', [1, 2], [100, 40])
        ] }
    })
});
assert.strictEqual(ramResponse.ok, true);
assert.deepStrictEqual(Array.from(ramResponse.period, item => ({ server: item.server, value: item.value })), [
    { server: 'server-01', value: 80 },
    { server: 'server-02', value: 80 }
]);
assert.deepStrictEqual(Array.from(ramResponse.latest, item => ({ server: item.server, value: item.value })), [
    { server: 'server-02', value: 80 },
    { server: 'server-01', value: 50 }
]);

const ramUsedResponse = analysis.analyzeResponse({
    type: 'ram', settings: { ...defaults, availKeyword: 'consumed[bytes]', memCalcMode: 'used' },
    data: response({
        T: { frames: [responseFrame('total[bytes]', 'server-06.example:9182', [1, 2], [200, 200])] },
        U: { frames: [responseFrame('consumed[bytes]', 'server-06.example:9182', [1, 2], [40, 100])] }
    })
});
assert.deepStrictEqual(Array.from(ramUsedResponse.period, item => item.value), [50]);
assert.deepStrictEqual(Array.from(ramUsedResponse.latest, item => item.value), [50]);

const incompleteRam = analysis.analyzeResponse({
    type: 'ram', settings: defaults,
    data: response({ T: { frames: [responseFrame('total[bytes]', 'server-01', [1], [100])] } })
});
assert.strictEqual(incompleteRam.ok, false);
assert.strictEqual(incompleteRam.reason, 'metrics-not-found');

const calculatedRam = analysis.analyzeResponse({
    type: 'ram', settings: defaults,
    data: response({ U: { frames: [responseFrame('Used % (calc)', 'server-03.example:9182', [1, 2], [25, 75])] } })
});
assert.deepStrictEqual(Array.from(calculatedRam.period, item => item.value), [75]);
assert.deepStrictEqual(Array.from(calculatedRam.latest, item => item.value), [75]);

const untrimmedCpu = analysis.analyzeResponse({
    type: 'cpu', settings: { ...defaults, trimDomainEnabled: false },
    data: response({ A: { frames: [responseFrame('idle[0]', 'server-04.example:9182', [1], [75])] } })
});
assert.strictEqual(untrimmedCpu.period[0].server, 'server-04.example:9182');
const untrimmedRam = analysis.analyzeResponse({
    type: 'ram', settings: { ...defaults, trimDomainEnabled: false },
    data: response({ U: { frames: [responseFrame('Used % (calc)', 'server-05.example:9182', [1], [65])] } })
});
assert.strictEqual(untrimmedRam.period[0].server, 'server-05.example:9182');

assert.strictEqual(analysis.serverNameForCopy('server-04.example:9182', {
    ...defaults, trimDomainEnabled: false
}), 'server-04', 'copying must always remove the configured suffix even when display trimming is disabled');
assert.strictEqual(analysis.serverNameForCopy('SERVER-05.EXAMPLE:9182', {
    ...defaults, trimDomainEnabled: false
}), 'SERVER-05', 'copy suffix matching must be case-insensitive');
assert.strictEqual(analysis.serverNameForCopy('server-06.example:9182 replica', {
    ...defaults, trimDomainEnabled: false
}), 'server-06.example:9182 replica', 'copying must remove only a trailing configured suffix');

const panelTools = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8')
    + fs.readFileSync('js/content/grafana-panel-data-runtime.js', 'utf8')
    + fs.readFileSync('js/content/grafana-panel-menu-runtime.js', 'utf8');
const contentBridge = fs.readFileSync('js/content/content.js', 'utf8');
const dashboardPage = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8');
const dashboardAnalysis = fs.readFileSync('pages/dashbridge/dashbridge-panel-analysis-controller.js', 'utf8');
const dashboardActions = fs.readFileSync('pages/dashbridge/dashbridge-panel-actions-controller.js', 'utf8');
const dashboardMessages = fs.readFileSync('pages/dashbridge/dashbridge-iframe-message-controller.js', 'utf8');
const dashboard = `${dashboardPage}\n${dashboardAnalysis}\n${dashboardActions}\n${dashboardMessages}`;
assert(panelTools.includes('const syncPanelAnalysisAction = (host, panel, header) =>')
    && panelTools.includes('analysis?.classifyTitle(getPanelAnalysisTitle(panel, header), readPanelAnalysisSettings())')
    && panelTools.includes("analysis.analyzePanel({ panel, type, mode: 'period', settings })")
    && panelTools.includes('DashBridgeGrafanaPanelAnalysis?.analyzeResponse'),
    'the toolbar action must be panel-scoped and derived from the shared strict classifier');
assert(panelTools.includes("[class*=\"panel-title\" i]")
    && fs.readFileSync('test/fixtures/grafana-panel-viz-key.html', 'utf8').includes('css-biljvk-panel-title'),
    'strict analysis title detection must cover Grafana generated panel-title classes');
assert(panelTools.includes("button.className = 'dashbridge-panel-analysis-action'")
    && panelTools.includes("host.querySelector('.dashbridge-panel-analysis-action')")
    && panelTools.includes('existing?.remove();'),
    'panel remount/title changes must not duplicate or retain an ineligible analysis action');
const modalStart = panelTools.indexOf('const openPanelAnalysis =');
const modalEnd = panelTools.indexOf('    const installPanelMenu =', modalStart);
const modalSource = panelTools.slice(modalStart, modalEnd);
assert(modalStart >= 0 && modalEnd > modalStart
    && modalSource.includes('serverCell.textContent = item.server')
    && !modalSource.includes('innerHTML'),
    'analysis results must render external server names through DOM text only');
assert(source.includes('DashBridgeGrafanaPanelAnalysis?.serverNameForCopy?.(item.server, settings)')
    && source.includes('.replaceAll(\'{server}\', copyServer(item))')
    && source.includes('.replaceAll(`{server${index + 1}}`, copyServer(item))'),
    'both analysis copy formats must always trim the configured server suffix without changing displayed items');
assert.strictEqual(analysis.formatPanelAnalysisCopy([
    { server: 'server-01', value: 42 }
], 'cpu', true, {}), 'server-01 до 42,00%',
'TOP-3 with fewer than three rows must use the complete-list template without unresolved placeholders');
assert.strictEqual(analysis.formatPanelAnalysisCopy([
    { server: 'server-01', value: 42 }
], 'cpu', false, { cpuTemplateFull: '{server}: {cpu}; {server}: {cpu}' }),
'server-01: 42,00; server-01: 42,00', 'every repeated template placeholder must be replaced');
assert.strictEqual(analysis.analysisThreshold({}, 'cpu', 'warning'), 50);
assert.strictEqual(analysis.analysisThreshold({}, 'ram', 'critical'), 90);
assert.strictEqual(analysis.analysisThreshold({ cpuWarnThreshold: 65 }, 'cpu', 'warning'), 65);
assert.strictEqual(analysis.analysisThreshold({ memCritThreshold: 101 }, 'ram', 'critical'), 90,
    'out-of-range thresholds must retain the safe fallback');
assert(modalSource.includes("document.createElementNS('http://www.w3.org/2000/svg', 'svg')")
    && modalSource.includes("closePath.setAttribute('d', 'M5 5l10 10M15 5L5 15')")
    && panelTools.includes('.dashbridge-panel-analysis-close svg'),
    'the close action must use a stable centered SVG icon instead of a font-dependent multiplication glyph');
assert(!modalSource.includes("'Обновить данные'")
    && modalSource.includes('refreshSelectedPanelData(panel)')
    && modalSource.includes('loadSnapshot();')
    && modalSource.includes("selectedMode = 'period'; render();")
    && modalSource.includes("selectedMode = 'latest'; render();")
    && !modalSource.includes("period.addEventListener('click', () => render('period'))")
    && !modalSource.includes("latest.addEventListener('click', () => render('latest'))"),
    'opening requests fresh panel data once, auto-refresh updates the snapshot, and tab switches only render it');
assert(modalSource.includes("overlay.classList.toggle('dashbridge-panel-analysis-dark', darkTheme)")
    && panelTools.includes('.dashbridge-panel-analysis-overlay.dashbridge-panel-analysis-dark')
    && panelTools.includes('--analysis-primary:#4361e8')
    && panelTools.includes('--analysis-primary:#60a5fa'),
    'analysis modal must use the DashBridge light/dark palette independently from Grafana generated styles');
assert(!modalSource.includes('toLocaleTimeString')
    && modalSource.includes('`Найдено серверов: ${currentItems.length}.${progress}'),
    'auto-refreshed analysis status must avoid a redundant wall-clock timestamp');
assert(panelTools.includes('observePanelAnalysisResponse')
    && panelTools.includes('response.clone().json()')
    && panelTools.includes('session !== window.__dashbridgePanelAnalysisCaptureSession')
    && panelTools.includes('requestStartedAt < session.acceptAfter'),
    'native datasource capture must be panel-scoped and reject stale or replaced sessions');
const embeddedStart = panelTools.indexOf('const startEmbeddedPanelAnalysis =');
const embeddedEnd = panelTools.indexOf('    const openPanelAnalysis =', embeddedStart);
const embeddedSource = panelTools.slice(embeddedStart, embeddedEnd);
assert(embeddedStart >= 0 && embeddedEnd > embeddedStart
    && embeddedSource.includes('publishCurrentPanel();')
    && embeddedSource.includes('onSnapshot: acceptSnapshot')
    && !embeddedSource.includes('refreshSelectedPanelData(panel)')
    && !embeddedSource.includes('setTimeout(')
    && !embeddedSource.includes('Локальное обновление панели недоступно'),
    'DashBridge analysis must show the current panel and passively follow its configured auto-refresh');
assert(dashboard.includes('openPanelAnalysis(panel, iframe, type)')
    && dashboard.includes("action: 'startEmbeddedPanelAnalysis'")
    && dashboard.includes("event.data.action === 'dashbridgePanelAnalysisUpdate'")
    && dashboard.includes('dashboard-panel-analysis-overlay')
    && dashboard.includes('documentRef.body.appendChild(overlay)')
    && dashboard.includes("action: 'cancelEmbeddedPanelAnalysis'")
    && dashboard.includes('active.requestId !== message?.requestId || active.iframe !== iframe')
    && dashboard.includes('acceptPanelAnalysis(event.data, sourceIframe)')
    && dashboard.includes('analysisApi?.classifyTitle(panel?.title, getTransformSettings())')
    && panelTools.includes("if (event.data?.action === 'startEmbeddedPanelAnalysis')")
    && panelTools.includes("if (event.data?.action === 'cancelEmbeddedPanelAnalysis')")
    && panelTools.includes("action: 'dashbridgePanelAnalysisUpdate'")
    && !dashboard.includes("action: 'openPanelAnalysis'"),
    'DashBridge must render analysis globally while the selected iframe only captures and returns data');
const observerStart = panelTools.indexOf('const observePanelAnalysisResponse =');
const observerEnd = panelTools.indexOf('    const panelAnalysisRequestMatches =', observerStart);
const observerContext = {
    window: {
        DashBridgeGrafanaPanelAnalysis: { analyzeResponse() { throw new Error('malformed frame'); } }
    },
    getAnalysisQueryRefIds: () => null
};
observerContext.window.__dashbridgePanelAnalysisCaptureSession = {
    cancelled: false, acceptAfter: 0, signatures: [], type: 'cpu', settings: {}, onSnapshot() {}
};
vm.createContext(observerContext);
vm.runInContext(`${panelTools.slice(observerStart, observerEnd)}
globalThis.observe = observePanelAnalysisResponse;`, observerContext);
assert.doesNotThrow(() => observerContext.observe(
    observerContext.window.__dashbridgePanelAnalysisCaptureSession, {}, null, 1
), 'analysis failures must fail open without cancelling the established response transformation');
assert(contentBridge.includes('dashbridgeGrafanaAnalysisSettings')
    && contentBridge.includes('dashbridgeGrafanaAnalysisSettingsChanged'),
    'the isolated bridge must publish current analysis settings without giving MAIN access to chrome.storage');
assert(contentBridge.includes("'grafanaTrimDomainEnabled'")
    && source.includes('grafanaTrimDomainEnabled'),
    'the global domain-trimming switch must reach both CPU and RAM panel analysis');
assert(contentBridge.includes("'grafanaMemCalcMode'")
    && source.includes('grafanaMemCalcMode'),
    'the explicit RAM calculation mode must reach panel analysis independently from custom series names');

console.log('PASS panel-scoped CPU/RAM analysis keeps strict title and metric contracts');
