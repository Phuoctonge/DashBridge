'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.value = '';
        this.checked = false;
        this.hidden = false;
        this.innerHTML = '';
        this.textContent = '';
        this.dataset = {};
        this.style = {};
        this.listeners = {};
        this.children = [];
        this.removed = false;
        this.classList = { add() {}, remove() {} };
    }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    emit(type) { return this.listeners[type]?.({ target: this, currentTarget: this }); }
    replaceChildren() { this.replaced = true; }
    closest() { return { id: 'captureThemeMain' }; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
    remove() { this.removed = true; }
}

const ids = [
    'mainActionArea', 'panelsMode', 'userPanelsGroup', 'logContainer',
    'toastContainer', 'batchProgress', 'batchProgressText', 'batchProgressStats',
    'batchProgressBar', 'seriesDashUrl', 'seriesPanelsContainer',
    'seriesPanelSelectionStatus', 'loadSelectedSeriesBtn', 'clearLogs',
    'copyMainSettingsToSeriesBtn', 'dashUrl', 'timestamps', 'seriesTimestamps',
    'getPanelsBtn', 'tab-main',
];
const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
elements.seriesDashUrl.value = 'https://old.example/d/uid/name';
const tabButton = new FakeElement('tabButton');
tabButton.dataset.tab = 'tab-main';
const tabContent = elements['tab-main'];
const themeLight = new FakeElement('themeLight');
themeLight.value = 'light';
themeLight.checked = true;
const themeDark = new FakeElement('themeDark');
themeDark.value = 'dark';

const documentRef = {
    createElement: tag => new FakeElement(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => elements[id] || null,
    querySelector(selector) {
        if (selector === '#captureThemeMain input:checked') {
            return [themeLight, themeDark].find(input => input.checked) || null;
        }
        return null;
    },
    querySelectorAll(selector) {
        if (selector === '.tab-btn') return [tabButton];
        if (selector === '.tab-content') return [tabContent];
        if (selector === '.batch-capture-theme'
            || selector === '#captureThemeMain .batch-capture-theme') return [themeLight, themeDark];
        return [];
    },
};
const stateCalls = [];
const timers = [];
const context = {
    document: documentRef,
    setTimeout(callback) { timers.push(callback); return timers.length; },
    Date,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/batch/batch-page-controller.js', 'utf8'), context);

const controller = context.BatchPageController.create({
    pageState: {
        bind: () => stateCalls.push('bind'),
        restore: async () => { stateCalls.push('restore'); },
        save: () => stateCalls.push('save'),
    },
    normalizeTimeRanges: value => value === 'bad'
        ? { ranges: [], errors: [1] }
        : { ranges: [{ from: 'now-1h', to: 'now' }], errors: [] },
    documentRef,
});

controller.showToast('<unsafe>', 'unknown');
assert.strictEqual(elements.toastContainer.children.length, 1);
assert.strictEqual(elements.toastContainer.children[0].children[1].textContent, '<unsafe>');
assert.match(elements.toastContainer.children[0].children[0].innerHTML, /toast-icon-info/);
timers.shift()();
assert.match(elements.toastContainer.children[0].style.animation, /toastFadeOut/);
timers.shift()();
assert.strictEqual(elements.toastContainer.children[0].removed, true);

elements.logContainer.scrollHeight = 42;
controller.logMessage('<failure>', true);
assert.match(elements.logContainer.children[0].className, /log-error/);
assert.strictEqual(elements.logContainer.children[0].children[1].textContent, ' <failure>');
assert.strictEqual(elements.logContainer.scrollTop, 42);

assert.strictEqual(controller.getCaptureTheme('captureThemeMain'), 'light');
themeLight.checked = false;
themeDark.checked = true;
assert.strictEqual(controller.getCaptureTheme('captureThemeMain'), 'dark');
elements.timestamps.value = 'raw';
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(controller.normalizeTimeRangesField({ fieldId: 'timestamps', notify: false }))),
    { ranges: [{ from: 'now-1h', to: 'now' }], errors: [] },
);
assert.strictEqual(elements.timestamps.value, 'now-1h, now');
assert(stateCalls.includes('save'));

const progressCalls = [];
controller.setOperationProgressController({ update: value => progressCalls.push(value) });
controller.updateBatchProgress({ done: 2, total: 4, success: 1, failed: 1, phase: 'Сбор' });
assert.strictEqual(elements.batchProgressBar.value, 2);
assert.strictEqual(elements.batchProgressText.textContent, 'Сбор: 2 / 4');
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(progressCalls[0])),
    { done: 2, total: 4, success: 1, failed: 1, phase: 'Сбор' },
);

const pickerCalls = [];
const panelPicker = {
    open: options => pickerCalls.push(['open', options]),
    clearSeriesSelection: () => pickerCalls.push(['clear']),
};
let actionVisibilityCalls = 0;
controller.setup({
    updateActionVisibility: () => { actionVisibilityCalls += 1; },
    loadBatchPanelRules: () => stateCalls.push('rules'),
    panelPicker,
});
tabButton.emit('click');
assert.strictEqual(actionVisibilityCalls, 1);
elements.panelsMode.value = 'whitelist';
elements.panelsMode.emit('change');
assert.strictEqual(elements.userPanelsGroup.style.display, 'block');

elements.dashUrl.value = 'https://grafana.example/d/uid/name';
elements.timestamps.value = 'now-1h, now';
elements.copyMainSettingsToSeriesBtn.emit('click');
assert.strictEqual(elements.seriesDashUrl.value, elements.dashUrl.value);
assert.strictEqual(elements.seriesTimestamps.value, elements.timestamps.value);
assert(pickerCalls.some(call => call[0] === 'clear'));
elements.getPanelsBtn.emit('click');
assert(pickerCalls.some(call => call[0] === 'open' && call[1].context === 'main'));

assert.throws(
    () => context.BatchPageController.create({ documentRef }),
    /dependencies are incomplete/,
);
assert.throws(
    () => controller.setup({}),
    /setup dependencies are incomplete/,
);
console.log('batch page controller behavior tests passed');
