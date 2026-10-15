'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('pages/batch/batch.html', 'utf8');
const source = fs.readFileSync('pages/batch/batch.js', 'utf8')
    + fs.readFileSync('pages/batch/batch-main-run-controller.js', 'utf8');
const picker = fs.readFileSync('pages/batch/batch-panel-picker.js', 'utf8');
const css = fs.readFileSync('pages/batch/batch.css', 'utf8')
    + fs.readFileSync('pages/batch/batch-workflow.css', 'utf8');

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

// Exercise the actual asynchronous owner: IDs must still belong to the current URL.
const vm = require('vm');
class PickerElement {
    constructor() { this.value = ''; this.style = { display: 'none' }; this.children = []; this.listeners = {}; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    emit(type) { for (const listener of this.listeners[type] || []) listener({ type }); }
    dispatchEvent(event) { this.emit(event.type); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    querySelectorAll(selector) {
        const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        if (selector === '*') return all;
        return all.filter(child => child.className === 'panel-picker-checkbox' && (!selector.endsWith(':checked') || child.checked));
    }
}
function pickerHarness() {
    const fields = new Map();
    const field = id => { if (!fields.has(id)) fields.set(id, new PickerElement()); return fields.get(id); };
    const requests = []; const toasts = []; let saves = 0; let authTabs = 0;
    const context = {
        document: { getElementById: field, createElement: () => new PickerElement(), addEventListener() {} },
        parseGrafanaDashboardUrl: url => ({ uid: url.split('/').at(-1) }),
        fetchGrafanaDashboardPanels: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
        BatchPageState: { save: () => { saves++; } }, Event: class { constructor(type) { this.type = type; } },
        chrome: { tabs: { getCurrent: async () => ({ id: 1 }), create: async () => { authTabs++; return { id: 2 }; } } },
    };
    vm.createContext(context); vm.runInContext(picker, context);
    const controller = context.BatchPanelPicker.create({ showToast: message => toasts.push(message), logMessage() {}, panelsMode: field('panelsMode') });
    return { field, requests, toasts, controller, saves: () => saves, authTabs: () => authTabs };
}
(async () => {
    for (const mode of ['main', 'series']) {
        const h = pickerHarness(); const input = h.field(mode === 'main' ? 'dashUrl' : 'seriesDashUrl');
        input.value = 'https://grafana.example/d/a';
        const stale = h.controller.open({ dashboardUrl: input.value, context: mode });
        input.value = 'https://grafana.example/d/b'; input.emit('input');
        h.requests[0].resolve({ panels: { 5: 'Old dashboard' } }); await stale;
        assert.strictEqual(h.field('panelsModal').style.display, 'none', `${mode}: a late response must not open the old picker`);
        const current = h.controller.open({ dashboardUrl: input.value, context: mode });
        h.requests[1].resolve({ panels: { 91: 'Current dashboard' } }); await current;
        assert.strictEqual(h.field('panelsModal').style.display, 'flex');
        const checkbox = h.field('panelsListContainer').querySelectorAll('.panel-picker-checkbox')[0];
        assert.strictEqual(checkbox.value, '91'); checkbox.checked = true;
        input.value = 'https://grafana.example/d/c'; // Recheck at Apply even without an input event.
        h.field('applyPanelPickerBtn').emit('click');
        assert.strictEqual(h.saves(), 0); assert.strictEqual(h.field('userPanels').value, '');
        assert.deepStrictEqual(Array.from(h.controller.getSeriesSelectedPanelIds()), []);
        assert.strictEqual(h.field('panelsModal').style.display, 'none');
        const older = h.controller.open({ dashboardUrl: input.value, context: mode });
        const newer = h.controller.open({ dashboardUrl: input.value, context: mode });
        h.requests[3].resolve({ panels: { 9: 'Newer request' } }); await newer;
        h.requests[2].resolve({ panels: { 2: 'Older request' } }); await older;
        assert.strictEqual(h.field('panelsListContainer').querySelectorAll('.panel-picker-checkbox')[0].value, '9');
        const pending = h.controller.open({ dashboardUrl: input.value, context: mode });
        h.field('cancelPanelPickerBtn').emit('click');
        const count = h.toasts.length;
        h.requests[4].reject(new Error('Late cancelled failure')); await pending;
        assert.strictEqual(h.field('panelsModal').style.display, 'none'); assert.strictEqual(h.toasts.length, count);
        const unauthorized = h.controller.open({ dashboardUrl: input.value, context: mode });
        input.value = 'https://grafana.example/d/another'; input.emit('input');
        h.requests[5].reject(Object.assign(new Error('HTTP Error 401'), { status: 401 })); await unauthorized;
        assert.strictEqual(h.authTabs(), 0, 'Late unauthorized response must not activate an obsolete dashboard tab');
        assert.strictEqual(h.toasts.length, count);
    }
    console.log('PASS Batch picker rejects stale URL, superseded request and cancelled completion in Main and Series');
})().catch(error => { console.error(error); process.exitCode = 1; });
