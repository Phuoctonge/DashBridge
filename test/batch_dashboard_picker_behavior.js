'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('pages/batch/batch.html', 'utf8');
const source = fs.readFileSync('pages/batch/batch.js', 'utf8');
const css = fs.readFileSync('pages/batch/batch.css', 'utf8');

assert(html.includes('id="getPanelsBtn"')
    && html.includes('id="panelsModal"')
    && html.includes('id="selectAllPanelPickerBtn"')
    && html.includes('id="clearPanelPickerBtn"')
    && html.includes('id="cancelPanelPickerBtn"')
    && html.includes('id="applyPanelPickerBtn"'),
    'Batch must keep its ID-panels action and expose the complete dashboard picker controls');
assert(source.includes('fetchGrafanaDashboardPanels(dashboardUrl)')
    && source.includes('renderPanelPicker(panelList?.length ? panelList : panels)'),
    'Batch picker must continue to use the shared Grafana dashboard inventory');
assert(source.includes("panelsMode.value = 'whitelist'")
    && source.includes("document.getElementById('userPanels').value = selectedIds.join(', ')")
    && source.includes('seriesSelectedPanelIds = selectedIds'),
    'the redesigned picker must preserve main whitelist and Series selection behavior');
assert(source.includes("mode === 'whitelist' && uPanels.length === 0")
    && source.includes('Для белого списка укажите хотя бы один ID панели'),
    'an empty whitelist must stop the run instead of silently capturing every dashboard panel');
assert(source.includes('title.textContent = String(panel.title')
    && source.includes('meta.textContent = `ID ${panel.id}')
    && source.includes('panelsListContainer.replaceChildren()'),
    'external Grafana metadata must be rendered with bounded DOM text nodes');
assert(source.includes("document.getElementById('selectAllPanelPickerBtn')")
    && source.includes("document.getElementById('clearPanelPickerBtn')")
    && source.includes("event.key === 'Escape'")
    && source.includes('event.target === panelsModal'),
    'the picker must support bulk selection and consistent close interactions');
assert(css.includes('.batch-panel-picker-header')
    && css.includes('.batch-panel-picker-toolbar')
    && css.includes('.batch-panel-picker-list')
    && css.includes('.batch-panel-picker-footer')
    && css.includes('.close-modal-btn svg'),
    'Batch picker must use the structured light/dark-compatible DashBridge modal styling');

console.log('PASS Batch dashboard picker matches the DashBridge selection experience');
