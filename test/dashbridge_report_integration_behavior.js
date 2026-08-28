'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('dashbridge.html');
const dashboard = read('js/pages/dashbridge.js');
const tools = read('js/content/grafana-panel-tools.js');
const visual = read('js/content/grafana-visual-engine.js');
const schema = read('js/shared/local-state-schema.js');
const css = read('css/dashbridge.css');

assert(html.includes('id="generateReportBtn"') && html.includes('id="configureReportBtn"'));
assert(html.indexOf('js/shared/dashbridge-report.js') < html.indexOf('js/pages/dashbridge.js'),
    'report engine must load before the dashboard controller');
assert(dashboard.includes("action: 'collectPanelReportSnapshot'")
    && dashboard.includes("e.data.action === 'panelReportSnapshot'")
    && dashboard.includes('waiter.iframe === sourceIframe'),
    'dashboard must correlate every report response with its exact iframe');
assert(tools.includes("event.data?.action === 'collectPanelReportSnapshot'")
    && tools.includes("action: 'panelReportSnapshot'")
    && tools.includes('snapshot = attachCpuCapacityToReportSnapshot(snapshot, event.data.sla || {});'),
    'Grafana MAIN runtime must expose a bounded report snapshot command');
assert(tools.includes('const collectResponseReportSeriesStats = data =>')
    && tools.includes('const observeNativeFetchResponse = (')
    && tools.includes('const decodeNativeFetchResponse = response => response.clone().json();')
    && tools.includes('decodeNativeFetchResponse(response).then(data =>')
    && tools.includes('cacheReportResponse(data, requestBody, request)')
    && !tools.includes("Object.defineProperty(target, 'json'")
    && !tools.includes('refreshSelectedPanelData(targetPanel')
    && !tools.includes('dashbridgePanelReportDataCaptured'),
    'report generation must observe normal datasource traffic without issuing a refresh or depending on chart DOM');
assert(tools.includes("const terminalStatuses = new Set([")
    && tools.includes("'filtered_empty', 'empty_source', 'http_error', 'network_error', 'decode_error', 'aborted'")
    && tools.includes("const poll = setInterval(inspect, 500);")
    && tools.includes("window.addEventListener('dashbridgePanelDataSettled', inspect)")
    && tools.includes("dataStatusText: 'Штатный запрос Grafana не завершился за 120 секунд'"),
    'report snapshots must wait for datasource settlement and return a bounded timeout result');
assert(visual.includes('const collectPanelReportSnapshot')
    && visual.includes("hasCritical ? 'critical' : (hasWarning ? 'warning' : 'ok')")
    && visual.includes("level: critical ? 'critical' : (warning ? 'warning' : 'normal')"),
    'visual engine must distinguish an informational panel from an SLA result');
assert(visual.includes('const collectGrafanaTableRecords')
    && visual.includes("'table-response' : 'table-dom'")
    && visual.includes('parseGrafanaTableDisplayValue'),
    'Grafana Metric/Value tables must feed the same report evaluation pipeline as charts');
assert(tools.includes('const overlay = existing || document.createElement')
    && tools.includes('if (!existing) document.body.appendChild(overlay);'),
    'the panel status observer must reuse its overlay instead of creating a mutation loop');
assert(schema.includes('normalizePanelReport') && schema.includes('normalizeProfileReport'),
    'import validation must cover profile and panel report settings');
const reportRequestSource = dashboard.slice(
    dashboard.indexOf('function waitForDashboardIframeReady('),
    dashboard.indexOf('function setDashboardPanelDataStatus(panel, snapshot)')
);
assert(dashboard.includes("state: 'configuration_error'")
    && reportRequestSource.includes("dataStatus: 'iframe_unavailable'")
    && reportRequestSource.includes("dataStatus: 'request_error'"),
    'unavailable data must never be treated as a successful SLA evaluation');
assert(reportRequestSource.includes("iframe.dataset.dashbridgeLoaded === 'true'")
    && reportRequestSource.includes('frameObserver = new MutationObserver(inspect)')
    && reportRequestSource.includes('removalPoll = setInterval(inspect, 500);')
    && !reportRequestSource.includes('documentObserver')
    && reportRequestSource.includes('DASHBRIDGE_REPORT_FRAME_TIMEOUT_MS')
    && reportRequestSource.includes('DASHBRIDGE_REPORT_RESPONSE_TIMEOUT_MS'),
    'report collection must allow slow Grafana iframes while retaining bounded failure results');
assert(reportRequestSource.includes("action: 'cancelPanelReportSnapshot'")
    && reportRequestSource.includes("signal?.addEventListener('abort', abort, { once: true })")
    && dashboard.includes('Promise.all(reportPanels.map(async panel =>')
    && !dashboard.includes('Math.min(2, reportPanels.length)')
    && dashboard.includes('runController?.abort()')
    && tools.includes("event.data?.action === 'cancelPanelReportSnapshot'")
    && tools.includes('panelReportSnapshotCancellers.delete(requestId)'),
    'closing a report must release all waiters while panels share one parallel timeout window');
assert(dashboard.includes('function setDashboardPanelDataStatus(panel, snapshot)')
    && dashboard.includes("new Set(['timeout', 'iframe_unavailable', 'request_error', 'configuration_error'])")
    && css.includes('.dashbridge-panel-data-status'),
    'dashboard cards must show failures that happen outside the Grafana iframe');
assert(dashboard.includes('report-test-header') && dashboard.includes('{{stableLoadDuration}}')
    && dashboard.includes('{{testDuration}}'),
    'report editor must expose the load-test summary context through the automatic header switch');
assert(dashboard.includes('reportVariableReferenceMarkup')
    && dashboard.includes('Справочник переменных шаблона')
    && dashboard.includes('Название текущего профиля DashBridge.')
    && dashboard.indexOf('${reportVariableReferenceMarkup()}') > dashboard.indexOf('report-panel-list'),
    'described variable reference must be rendered after the panel cards');
assert(dashboard.includes('{{vCpu}} / {{cpuCapacity}}')
    && dashboard.includes('{{rawName}}')
    && dashboard.includes('{{seriesThreshold}}')
    && dashboard.includes('{{dataStatus}}'),
    'the report editor must document vCPU-aware and raw series-name variables');
assert(tools.includes("filtered_empty: 'Нет превышений по заданному фильтру'")
    && tools.includes("empty_source: 'Источник вернул пустой набор данных'")
    && tools.includes("setPanelDataStatus('http_error'")
    && tools.includes("setPanelDataStatus('decode_error'")
    && tools.includes("setPanelDataStatus('network_error'")
    && visual.includes("dataStatus: 'filtered_empty'")
    && visual.includes("new Set(['http_error', 'network_error', 'decode_error'])"),
    'Grafana panels and report snapshots must preserve distinct empty and transport outcomes');
assert(tools.includes("error?.name === 'AbortError' ? 'aborted' : 'network-error'")
    && tools.includes("this.__dashbridgeRequestAborted ? 'aborted' : 'network-error'")
    && tools.includes("if (['filtered_empty', 'empty_source'].includes(kind))")
    && tools.includes('transportFailureWithVisibleData')
    && visual.includes("'http_error', 'network_error', 'decode_error', 'aborted'"),
    'cancelled or superseded Grafana requests must not erase cached data or cover a rendered panel with a false network error');
assert(dashboard.includes('value="cpu_capacity"')
    && dashboard.includes("config.sla.source === 'cpu_capacity'")
    && dashboard.includes("source: 'cpu_capacity', operator: 'gt', coefficient"),
    'Load Average reports must expose the same dynamic vCPU threshold as the graph filter');
assert(dashboard.includes('{{testDuration}} = время от этой даты')
    && dashboard.includes('{{stableLoadDuration}} = время от этой даты'),
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
assert(dashboard.includes('report-collapsible-section')
    && dashboard.includes('openPanelReportEditor')
    && dashboard.includes('Если требования соблюдены')
    && dashboard.includes('Если требования нарушены')
    && dashboard.includes('Дополнительные настройки'),
    'each graph must expose a focused two-outcome phrase editor with optional advanced settings');
assert(dashboard.includes('Автоматически по порогу графика')
    && dashboard.includes('Без SLA — информационная фраза')
    && dashboard.includes('Только при нарушении SLA'),
    'common panel setup must use outcome-oriented choices and automatic Grafana thresholds');
assert(dashboard.includes('dashboardLayoutSignature')
    && dashboard.includes('if (!dashboardLayoutChanged) return;'),
    'report-only saves must not reconcile or move live Grafana iframe cards');
assert(dashboard.includes('!iframe?.isConnected')
    && dashboard.includes('iframe.dataset.dashbridgeOrigin !== targetOrigin')
    && dashboard.includes('sourceIframe.dataset.dashbridgeOrigin = e.origin;')
    && dashboard.includes("iframe.dataset.dashbridgeLoaded = 'false';"),
    'postMessage must reject detached or unverified iframe windows before using a Grafana target origin');
assert(!dashboard.includes('Единица измерения\n')
    && visual.includes('const resolvedUnit = String(sla.unit || unit ||'),
    'the report editor must infer the unit from Grafana instead of asking the user');
assert(tools.includes("debugLog('Skipping visual engine: no current or previous visual work')")
    && tools.includes('if (layoutWork) window.dispatchEvent(new Event(\'resize\'));')
    && tools.includes('else if (thresholdWasEnabled) await startThresholdReporting();'),
    'a plain iframe must not redraw or run inactive visual/threshold work during bootstrap');
console.log('PASS dashboard report UI, iframe transport and schema are wired end to end');
