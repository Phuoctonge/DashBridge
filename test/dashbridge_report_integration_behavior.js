'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('pages/dashbridge/dashbridge.html');
const dashboardPage = read('pages/dashbridge/dashbridge.js');
const dashboardUi = read('pages/dashbridge/dashbridge-page-ui-controller.js');
const dashboardMessages = read('pages/dashbridge/dashbridge-iframe-message-controller.js');
const reportController = read('pages/dashbridge/dashbridge-report-controller.js');
const dashboard = `${dashboardPage}\n${dashboardUi}\n${dashboardMessages}\n${reportController}`;
const profileController = read('pages/dashbridge/dashbridge-profile-controller.js');
const reportUi = read('pages/dashbridge/dashbridge-report-ui.js');
const reportAudit = read('pages/dashbridge/dashbridge-report-audit.js');
const reportTestRunner = read('pages/dashbridge/dashbridge-report-test-runner.js');
const reportTransport = read('pages/dashbridge/dashbridge-report-transport.js');
const tools = read('js/content/grafana-panel-tools.js');
const visual = `${read('js/content/grafana-report-snapshot.js')}\n${read('js/content/grafana-visual-engine.js')}`;
const tableReport = read('js/content/grafana-table-report.js');
const schema = read('js/shared/local-state-schema.js');
const css = read('pages/dashbridge/dashbridge.css');

assert(html.includes('id="generateReportBtn"') && html.includes('id="testReportBtn"')
    && html.includes('id="configureReportBtn"'));
assert(html.indexOf('id="generateReportBtn"') < html.indexOf('id="configureReportBtn"')
    && html.indexOf('id="configureReportBtn"') < html.indexOf('id="testReportBtn"'),
    'Message Test Runner must remain the final action in the report menu');
assert(html.indexOf('js/shared/dashbridge-report.js') < html.indexOf('dashbridge-report-ui.js')
    && html.indexOf('dashbridge-report-ui.js') < html.indexOf('dashbridge.js'),
    'report engine and UI must load in dependency order before the dashboard controller');
assert(html.indexOf('dashbridge-report-transport.js') < html.indexOf('dashbridge.js'),
    'report transport must load before the dashboard controller');
assert(html.indexOf('dashbridge-report-audit.js') < html.indexOf('dashbridge-report-test-runner.js')
    && html.indexOf('dashbridge-report-test-runner.js') < html.indexOf('dashbridge-report-controller.js')
    && html.indexOf('dashbridge-report-controller.js') < html.indexOf('dashbridge.js')
    && reportController.includes('testRunnerFactory.create({')
    && dashboard.includes('auditEngine: DashBridgeReportAudit')
    && reportController.includes('collect: (signal, onProgress) => collect(signal, onProgress, { requirePanels: false })')
    && dashboard.includes("documentRef.getElementById('testReportBtn').addEventListener('click'")
    && reportAudit.includes('runEngineSelfCheck')
    && reportTestRunner.includes("result(id, name, 'fixture'")
    && reportTestRunner.includes("source: 'live'")
    && reportTestRunner.includes("'Большая таблица: 2500 серий'"),
    'Message Test Runner must separate fixture and live suites while reusing one report collector');
assert(html.indexOf('dashbridge-report-ui.js') < html.indexOf('dashbridge.js')
    && dashboard.includes('window.DashBridgeReportUi.create({'),
    'report UI must load before the dashboard controller and receive explicit dependencies');
assert(reportTransport.includes("action: 'collectPanelReportSnapshot'")
    && dashboard.includes("event.data.action === 'panelReportSnapshot'")
    && dashboard.includes('acceptReportSnapshot(event.data.requestId, sourceIframe, event.data.snapshot)')
    && reportTransport.includes('waiter.iframe !== sourceIframe'),
    'dashboard must correlate every report response with its exact iframe');
assert(tools.includes("event.data?.action === 'collectPanelReportSnapshot'")
    && tools.includes("action: 'panelReportSnapshot'")
    && tools.includes('snapshot = attachCpuCapacityToReportSnapshot(snapshot, event.data.sla || {});'),
    'Grafana MAIN runtime must expose a bounded report snapshot command');
assert(tools.includes('const observeActive = transformActive || hasPersistentVisualWork()')
    && !tools.includes('const observeActive = isDashboardIframe ||')
    && !tools.includes('const observeNativeFetchResponse')
    && !tools.includes('const collectResponseReportSeriesStats')
    && tools.includes('visualMetadata.responseTableRecords = collectResponseTableRecords(scopedData);')
    && !tools.includes('refreshSelectedPanelData(targetPanel')
    && !tools.includes('dashbridgePanelReportDataCaptured'),
    'ordinary Grafana loading must remain native while reports reuse current chart/table runtime data');
assert(tools.includes("const terminalStatuses = new Set([")
    && tools.includes("'filtered_empty', 'empty_source', 'http_error', 'network_error', 'decode_error', 'aborted'")
    && !tools.includes("const poll = setInterval(inspect, 500);")
    && tools.includes("window.addEventListener('dashbridgePanelDataSettled', scheduleInspect)")
    && tools.includes('dataObserver = new MutationObserver(scheduleInspect)')
    && tools.includes("dataStatusText: 'Штатный запрос Grafana не завершился в отведённое время'"),
    'report snapshots must wait for datasource settlement and return a bounded timeout result');
const reportReadyStart = tools.indexOf('const readySnapshot = () => {');
const reportReadyEnd = tools.indexOf('panelReportSnapshotCancellers.get(requestId)?.();', reportReadyStart);
const reportReadySource = tools.slice(reportReadyStart, reportReadyEnd);
assert(reportReadyStart >= 0 && reportReadyEnd > reportReadyStart
    && reportReadySource.indexOf('const current = collect();')
        < reportReadySource.indexOf("if (status === 'loading') return null;")
    && reportReadySource.indexOf('if (Array.isArray(current.series) && current.series.length) return current;')
        < reportReadySource.indexOf("if (status === 'loading') return null;"),
    'a rendered table or chart must win over a stale loading status instead of waiting 120 seconds');
assert(visual.includes('const collectPanelReportSnapshot')
    && visual.includes("hasCritical ? 'critical' : (hasWarning ? 'warning' : 'ok')")
    && visual.includes("level: critical ? 'critical' : (warning ? 'warning' : 'normal')"),
    'visual engine must distinguish an informational panel from an SLA result');
assert(tableReport.includes('const collectGrafanaTableRecords')
    && visual.includes("'table-response' : 'table-dom'")
    && tableReport.includes('parseGrafanaTableDisplayValue'),
    'Grafana Metric/Value tables must feed the same report evaluation pipeline as charts');
assert(tools.includes('const overlay = existing || document.createElement')
    && tools.includes('if (!existing) document.body.appendChild(overlay);'),
    'the panel status observer must reuse its overlay instead of creating a mutation loop');
assert(schema.includes('normalizePanelReport') && schema.includes('normalizeProfileReport'),
    'import validation must cover profile and panel report settings');
const reportRequestSource = reportTransport.slice(
    reportTransport.indexOf('const waitForIframeReady ='),
    reportTransport.indexOf('const acceptSnapshot =')
);
assert(reportTransport.includes("state: 'configuration_error'")
    && reportRequestSource.includes("dataStatus: 'iframe_unavailable'")
    && reportRequestSource.includes("dataStatus: 'request_error'"),
    'unavailable data must never be treated as a successful SLA evaluation');
assert(reportRequestSource.includes("iframe.dataset.dashbridgeLoaded === 'true'")
    && reportRequestSource.includes('frameObserver = observeFrame(iframe, inspect)')
    && !reportRequestSource.includes('removalPoll = setInterval(inspect, 500);')
    && reportTransport.includes("iframe.closest?.('.panel-card')?.parentElement")
    && !reportRequestSource.includes('documentObserver')
    && reportController.includes('frameTimeoutMs: FRAME_TIMEOUT_MS')
    && reportController.includes('totalTimeoutMs: TOTAL_TIMEOUT_MS')
    && reportRequestSource.includes('timeoutMs: responseTimeoutMs'),
    'report collection must allow slow Grafana iframes while retaining bounded failure results');
assert(reportRequestSource.includes("action: 'cancelPanelReportSnapshot'")
    && reportRequestSource.includes("signal?.addEventListener('abort', abort, { once: true })")
    && reportController.includes('Promise.all(reportPanels.map(async panel =>')
    && !dashboard.includes('Math.min(2, reportPanels.length)')
    && reportController.includes('runController?.abort()')
    && tools.includes("event.data?.action === 'cancelPanelReportSnapshot'")
    && tools.includes('panelReportSnapshotCancellers.delete(requestId)'),
    'closing a report must release all waiters while panels share one parallel timeout window');
assert(reportController.includes('const setPanelDataStatus = (panel, snapshot) =>')
    && reportController.includes("new Set(['timeout', 'iframe_unavailable', 'request_error', 'configuration_error'])")
    && css.includes('.dashbridge-panel-data-status'),
    'dashboard cards must show failures that happen outside the Grafana iframe');
assert(reportUi.includes('report-test-header') && reportUi.includes('{{stableLoadDuration}}')
    && reportUi.includes('{{testDuration}}'),
    'report editor must expose the load-test summary context through the automatic header switch');
assert(reportUi.includes('reportVariableReferenceMarkup')
    && reportUi.includes('Справочник переменных шаблона')
    && reportUi.includes('Название текущего профиля DashBridge.')
    && reportUi.indexOf('${reportVariableReferenceMarkup()}') > reportUi.indexOf('report-panel-list'),
    'described variable reference must be rendered after the panel cards');
assert(reportUi.includes('{{vCpu}} / {{cpuCapacity}}')
    && reportUi.includes('{{rawName}}')
    && reportUi.includes('{{seriesThreshold}}')
    && reportUi.includes('{{dataStatus}}'),
    'the report editor must document vCPU-aware and raw series-name variables');
assert(tools.includes("filtered_empty: 'Нет превышений по заданному фильтру'")
    && tools.includes("empty_source: 'Источник вернул пустой набор данных'")
    && tools.includes("setPanelDataStatus('http_error'")
    && tools.includes("setPanelDataStatus('decode_error'")
    && tools.includes("setPanelDataStatus('network_error'")
    && visual.includes("dataStatus: 'filtered_empty'")
    && visual.includes("new Set(['http_error', 'network_error', 'decode_error', 'aborted'])"),
    'Grafana panels and report snapshots must preserve distinct empty and transport outcomes');
assert(tools.includes("error?.name === 'AbortError' ? 'aborted' : 'network-error'")
    && tools.includes("this.__dashbridgeRequestAborted ? 'aborted' : 'network-error'")
    && tools.includes("if (['filtered_empty', 'empty_source'].includes(kind))")
    && tools.includes('transportFailureWithVisibleData')
    && visual.includes("'http_error', 'network_error', 'decode_error', 'aborted'"),
    'cancelled or superseded Grafana requests must not erase cached data or cover a rendered panel with a false network error');
const reportCollectorStart = visual.indexOf('const collectPanelReportSnapshot');
const reportCollectorEnd = visual.indexOf('return Object.freeze({ collectPanelReportSnapshot });', reportCollectorStart);
const reportCollectorSource = visual.slice(reportCollectorStart, reportCollectorEnd);
assert(!reportCollectorSource.includes("if (['http_error', 'network_error', 'decode_error', 'aborted'].includes(responseDataStatus.kind))")
    && reportCollectorSource.includes("const failureKinds = new Set(['http_error', 'network_error', 'decode_error', 'aborted']);")
    && reportCollectorSource.indexOf('records = tableRecords;')
        < reportCollectorSource.indexOf('const failureKinds = new Set'),
    'visible table/chart data must be collected before a transport status is treated as a report error');
assert(reportUi.includes('value="cpu_capacity"')
    && reportUi.includes("config.sla.source === 'cpu_capacity'")
    && dashboard.includes("source: 'cpu_capacity', operator: 'gt', coefficient"),
    'Load Average reports must expose the same dynamic vCPU threshold as the graph filter');
assert(reportUi.includes('{{testDuration}} = время от этой даты')
    && reportUi.includes('{{stableLoadDuration}} = время от этой даты'),
    'the report header must explain that duration variables are calculated from manually entered start times');
assert(visual.includes('const legendMaxByName = () =>')
    && visual.includes('legendMaximums.get(reportSeriesName(item.label')
    && visual.includes("evaluation === 'period_max' && Number.isFinite(record.legendMaximum)"),
    'period maximum reports must prefer the displayed legend Max matched by the resolved series name');
assert(tools.includes('sourceFilterRemovedEverything')
    && tools.includes('cpuFilterRemovedEverything')
    && tools.includes('responseFilterEmptyIsNormal')
    && visual.includes('filteredEmpty: true'),
    'a successful response emptied by an active filter must render the normal report phrase');
assert(css.includes('.report-settings-modal,') && css.includes('box-sizing: border-box;')
    && css.includes('width: 70vw;')
    && css.includes('grid-template-columns: repeat(auto-fit')
    && css.includes('@media (max-width: 37.5rem)')
    && css.includes('max-height: 92dvh')
    && css.includes('flex: 1 1 8rem'),
    'report editor must remain spaced and width-safe on narrow screens');
assert(css.includes('.report-settings-modal [hidden]')
    && css.includes('display: none !important;')
    && css.includes('.report-template-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));'),
    'irrelevant SLA fields must be hidden and report templates must stay readable');
assert(reportUi.includes('report-collapsible-section')
    && dashboard.includes('openPanelReportEditor')
    && reportUi.includes('Если требования соблюдены')
    && reportUi.includes('Если требования нарушены')
    && reportUi.includes('Дополнительные настройки'),
    'each graph must expose a focused two-outcome phrase editor with optional advanced settings');
assert(reportUi.includes('Автоматически по порогу графика')
    && reportUi.includes('Без SLA — информационная фраза')
    && reportUi.includes('Только при нарушении SLA'),
    'common panel setup must use outcome-oriented choices and automatic Grafana thresholds');
assert(profileController.includes('dashboardLayoutSignature')
    && profileController.includes("previousDashboardLayoutSignature === dashboardLayoutSignature(getActiveProfile())"),
    'report-only saves must not reconcile or move live Grafana iframe cards');
assert(dashboardMessages.includes('!iframe?.isConnected')
    && dashboardMessages.includes('iframe.dataset.dashbridgeOrigin !== targetOrigin')
    && dashboard.includes('sourceIframe.dataset.dashbridgeOrigin = event.origin;')
    && dashboardMessages.includes("iframe.dataset.dashbridgeLoaded = 'false';"),
    'postMessage must reject detached or unverified iframe windows before using a Grafana target origin');
assert(!reportUi.includes('Единица измерения\n')
    && visual.includes('const resolvedUnit = String(sla.unit || unit ||'),
    'the report editor must infer the unit from Grafana instead of asking the user');
assert(tools.includes("debugLog('Skipping visual engine: no current or previous visual work')")
    && tools.includes('if (layoutWork) window.dispatchEvent(new Event(\'resize\'));')
    && tools.includes('else if (thresholdWasEnabled) await startThresholdReporting();'),
    'a plain iframe must not redraw or run inactive visual/threshold work during bootstrap');
console.log('PASS dashboard report UI, iframe transport and schema are wired end to end');
