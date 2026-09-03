'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const toolsSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-panel-data-transforms.js'),
    'utf8'
) + fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-panel-data-runtime.js'),
    'utf8'
);
const visualSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-report-snapshot.js'),
    'utf8'
);
const panelToolsSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'),
    'utf8'
);

assert(toolsSource.includes('const observeActive = transformActive || hasPersistentVisualWork()')
    && !toolsSource.includes('const observeActive = isDashboardIframe ||')
    && !toolsSource.includes('const observeNativeFetchResponse')
    && !toolsSource.includes('const cacheReportResponse')
    && !toolsSource.includes('const collectResponseReportSeriesStats')
    && !toolsSource.includes('responseReportSeriesStats')
    && !toolsSource.includes('responseReportTruncated'),
    'an ordinary dashboard iframe must not parse and aggregate every datasource response for a future report');

assert(toolsSource.includes('visualMetadata.responseTableRecords = collectResponseTableRecords(scopedData);')
    && toolsSource.includes('visualMetadata.responseSeriesNames = collectResponseSeriesNames(scopedData);')
    && toolsSource.includes("completeRequest(requestId, 'fetch', data?.results ? 'transformed' : 'decode-error');"),
    'active panel transforms must retain lightweight table/name metadata and return the transformed response');

assert(visualSource.includes('const collectPanelReportSnapshot')
    && visualSource.includes("engine = 'flot'")
    && visualSource.includes("engine = 'uplot'")
    && visualSource.includes("engine = table && responseTableRecords.length ? 'table-response' : 'table-dom'")
    && visualSource.includes('const summarizeValues = values =>')
    && !visualSource.includes('responseReportSeriesStats')
    && !visualSource.includes('responseReportTruncated'),
    'report evaluation must run only on explicit request using the current chart/table runtime data');

const reportRequestSource = panelToolsSource.slice(panelToolsSource.indexOf("event.data?.action === 'collectPanelReportSnapshot'"));
assert(reportRequestSource.includes('const getReportRoot = () =>')
    && reportRequestSource.includes('root: getReportRoot(), sla: event.data.sla || {}')
    && reportRequestSource.includes('current.table?.rows')
    && reportRequestSource.includes('dataObserver.observe(document.documentElement'),
    'report collection must follow a Grafana panel/Data Grid remount instead of observing a detached root until timeout');

assert(!toolsSource.includes('responseReportRecords')
    && !visualSource.includes('responseReportRecords')
    && !toolsSource.includes('refreshSelectedPanelData(targetPanel')
    && !toolsSource.includes('dashbridgePanelReportDataCaptured'),
    'report generation must neither retain point arrays nor refresh Grafana panels');

console.log('PASS ordinary Grafana loading stays on the native fast path until an explicit report request');
