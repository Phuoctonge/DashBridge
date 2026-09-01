'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
const source = fs.readFileSync('pages/dashbridge/dashbridge-panel-addition-controller.js', 'utf8');
const coordinator = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8')
    + fs.readFileSync('pages/dashbridge/dashbridge-page-ui-controller.js', 'utf8');
const css = ['dashbridge.css', 'dashbridge-dialogs.css', 'dashbridge-interactions.css', 'dashbridge-report.css']
    .map(file => fs.readFileSync(`pages/dashbridge/${file}`, 'utf8')).join('\n');

assert(html.includes('id="quickAddPanelsBtn"')
    && html.includes('id="discoverDashboardPanelsBtn"')
    && html.includes('id="dashboardPanelPickerOverlay"'),
    'dashboard discovery must be an additional action and keep the existing ID-based flow');
assert(html.includes('Добавить панели')
    && html.includes('Указать ID вручную')
    && html.includes('Выбрать из дашборда'),
    'panel addition actions must use distinct user-facing names');
assert(html.indexOf('js/shared/grafana-url.js') < html.indexOf('js/shared/grafana-dashboard-api.js')
    && html.indexOf('js/shared/grafana-dashboard-api.js') < html.indexOf('dashbridge-panel-addition-controller.js')
    && html.indexOf('dashbridge-panel-addition-controller.js') < html.indexOf('dashbridge.js'),
    'DashBridge must load the same dashboard inventory API used by Batch before its controller');

const pickerSource = source;
assert(pickerSource.includes('fetchDashboardPanels(dashboardUrl)')
    && pickerSource.includes('result.panelList'),
    'the picker must use the shared Batch dashboard inventory function');
assert(pickerSource.includes('title.textContent = panel.title')
    && pickerSource.includes('meta.textContent = existing')
    && !pickerSource.includes('.innerHTML'),
    'Grafana panel titles and metadata must render through DOM text properties');
assert(pickerSource.includes(".filter(panel => /^\\d+$/.test(String(panel?.id || ''))")
    && pickerSource.includes('.slice(0, 2000)')
    && pickerSource.includes("!['http:', 'https:'].includes(dashboardLocation?.protocol)")
    && pickerSource.includes('dashboardLocation.username || dashboardLocation.password'),
    'external dashboard inventory must have bounded IDs and a strict HTTP(S) URL boundary');
assert(pickerSource.includes('const existingPanelIdentities = getCurrentProfilePanelIdentities()')
    && pickerSource.includes('checkbox.disabled = existing')
    && pickerSource.includes("title: panel.title, width, height: '350px'"),
    'existing panels must be disabled while selected titles are persisted with new cards');
assert(coordinator.includes('fetchDashboardPanels: fetchGrafanaDashboardPanels')
    && coordinator.includes('setupPanelAddition: dashBridgePanelAdditionController.setup')
    && coordinator.includes('closeDashboardPickerIfOpen: dashBridgePanelAdditionController.closeDashboardPickerIfOpen'),
    'the coordinator must inject the shared API and retain setup/escape orchestration');
assert(css.includes('.dashboard-panel-picker-modal')
    && css.includes('.dashboard-panel-picker-list')
    && css.includes('.dashboard-panel-picker-item.is-existing'),
    'the dashboard picker must use bounded light/dark-compatible DashBridge styles');
assert(css.includes('.dashboard-panel-picker-status:empty')
    && css.includes('display: none')
    && css.includes('.dashboard-panel-picker-selection[hidden] + .modal-actions'),
    'the dashboard picker must not reserve empty status and results space before loading a URL');

console.log('PASS DashBridge discovers and safely adds selected dashboard panels');
