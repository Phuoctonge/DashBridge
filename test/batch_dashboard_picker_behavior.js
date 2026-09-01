'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('pages/batch/batch.html', 'utf8');
const source = fs.readFileSync('pages/batch/batch.js', 'utf8')
    + fs.readFileSync('pages/batch/batch-main-run-controller.js', 'utf8');
const picker = fs.readFileSync('pages/batch/batch-panel-picker.js', 'utf8');
const css = fs.readFileSync('pages/batch/batch.css', 'utf8');

assert(html.includes('id="getPanelsBtn"')
    && html.includes('id="panelsModal"')
    && html.includes('id="selectAllPanelPickerBtn"')
    && html.includes('id="clearPanelPickerBtn"')
    && html.includes('id="cancelPanelPickerBtn"')
    && html.includes('id="applyPanelPickerBtn"'),
    'Batch must keep its ID-panels action and expose the complete dashboard picker controls');
assert(picker.includes('fetchGrafanaDashboardPanels(dashboardUrl)')
    && picker.includes('render(panelList?.length ? panelList : panels)')
    && html.indexOf('batch-panel-picker.js') < html.indexOf('batch.js'),
    'Batch picker must continue to use the shared Grafana dashboard inventory');
assert(picker.includes("panelsMode.value = 'whitelist'")
    && picker.includes("document.getElementById('userPanels').value = selectedIds.join(', ')")
    && picker.includes('seriesSelectedPanelIds = selectedIds'),
    'the redesigned picker must preserve main whitelist and Series selection behavior');
assert(source.includes("mode === 'whitelist' && !userPanels.length")
    && source.includes('Для белого списка укажите хотя бы один ID панели'),
    'an empty whitelist must stop the run instead of silently capturing every dashboard panel');
assert(picker.includes('title.textContent = String(panel.title')
    && picker.includes('meta.textContent = `ID ${panel.id}')
    && picker.includes('panelsListContainer.replaceChildren()'),
    'external Grafana metadata must be rendered with bounded DOM text nodes');
assert(picker.includes("document.getElementById('selectAllPanelPickerBtn')")
    && picker.includes("document.getElementById('clearPanelPickerBtn')")
    && picker.includes("event.key === 'Escape'")
    && picker.includes('event.target === panelsModal'),
    'the picker must support bulk selection and consistent close interactions');
assert(css.includes('.batch-panel-picker-header')
    && css.includes('.batch-panel-picker-toolbar')
    && css.includes('.batch-panel-picker-list')
    && css.includes('.batch-panel-picker-footer')
    && css.includes('.close-modal-btn svg'),
    'Batch picker must use the structured light/dark-compatible DashBridge modal styling');

console.log('PASS Batch dashboard picker matches the DashBridge selection experience');
