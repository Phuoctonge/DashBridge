'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const toolsSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-panel-data-runtime.js'),
    'utf8'
);
const visualSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'content', 'grafana-report-snapshot.js'),
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
    && visualSource.includes("engine = responseTableRecords.length ? 'table-response' : 'table-dom'")
    && visualSource.includes('const summarizeValues = values =>')
    && !visualSource.includes('responseReportSeriesStats')
    && !visualSource.includes('responseReportTruncated'),
    'report evaluation must run only on explicit request using the current chart/table runtime data');

assert(!toolsSource.includes('responseReportRecords')
    && !visualSource.includes('responseReportRecords')
    && !toolsSource.includes('refreshSelectedPanelData(targetPanel')
    && !toolsSource.includes('dashbridgePanelReportDataCaptured'),
    'report generation must neither retain point arrays nor refresh Grafana panels');

console.log('PASS ordinary Grafana loading stays on the native fast path until an explicit report request');
