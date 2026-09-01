'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeElement {
    constructor(id) {
        this.id = id;
        this.style = { display: 'none' };
        this.listeners = new Map();
        this.attributes = new Map();
        this.checked = false;
        this.value = '';
        this.textContent = '';
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    emit(type, extra = {}) {
        const event = {
            target: this,
            currentTarget: this,
            stopPropagation() {},
            ...extra,
        };
        return this.listeners.get(type)?.(event);
    }
}

const ids = [
    'capturePreparedToggleBtn', 'captureAllPanelsBtn', 'crosshairMenuBtn',
    'crosshairDropdown', 'crosshairToggleCheckbox', 'crosshairThicknessSlider',
    'crosshairThicknessValue', 'profileDropdown', 'dataDropdown',
    'addPanelDropdown', 'reportDropdown', 'dataMenuBtn', 'addPanelMenuBtn',
    'reportMenuBtn', 'profilePickerBtn', 'timePopover', 'refreshPopover',
    'configureReportBtn', 'generateReportBtn', 'testReportBtn', 'newProfileBtn',
    'renameProfileBtn', 'deleteProfileBtn',
];
const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
const documentListeners = new Map();
const documentRef = {
    getElementById: id => elements[id] || null,
    addEventListener: (type, listener) => documentListeners.set(type, listener),
};
const storageWrites = [];
const context = vm.createContext({ console, document: documentRef, localStorage: {} });
vm.runInContext(
    fs.readFileSync('pages/dashbridge/dashbridge-page-ui-controller.js', 'utf8'),
    context,
);

let mode = 'line';
let thickness = 2;
let prepared = false;
const calls = [];
const frames = [{ id: 'a' }, { id: 'b' }];
const controller = context.DashBridgePageUiController.create({
    getCrosshairMode: () => mode,
    setCrosshairMode: value => { mode = value; },
    getCrosshairThickness: () => thickness,
    setCrosshairThickness: value => { thickness = value; },
    hideCrosshair: () => calls.push('hideCrosshair'),
    postToDashboardFrame: (frame, message) => calls.push(['post', frame.id, message]),
    getFrames: () => frames,
    getCapturePrepared: () => prepared,
    setCapturePrepared: value => { prepared = value; calls.push(['prepared', value]); },
    captureAllPanels: button => calls.push(['captureAll', button.id]),
    renderProfileSwitcher: () => calls.push('renderProfiles'),
    showPrompt: async (label, value) => label.startsWith('Название') ? ' New ' : `${value} 2`,
    createProfile: name => calls.push(['create', name]),
    renameActiveProfile: name => calls.push(['rename', name]),
    deleteProfile: id => calls.push(['delete', id]),
    getActiveProfile: () => ({ id: 'profile-1', name: 'Current' }),
    getActiveProfileId: () => 'profile-1',
    openReportSettings: () => calls.push('reportSettings'),
    openReportPreview: () => calls.push('reportPreview'),
    openReportTest: () => calls.push('reportTest'),
    setupPanelAddition: () => calls.push('setupAddition'),
    closeDashboardPickerIfOpen: () => calls.push('closePicker'),
    setupPanelTransfer: () => calls.push('setupTransfer'),
    closePanelAnalysis: () => calls.push('closeAnalysis'),
    closePanelExtraActions: () => calls.push('closeExtra'),
    exitFullscreen: () => calls.push('exitFullscreen'),
    documentRef,
    storageRef: { setItem: (key, value) => storageWrites.push([key, value]) },
});

controller.setup();
assert.deepStrictEqual(calls.slice(0, 2), ['setupAddition', 'setupTransfer']);
controller.updateCrosshairControls();
assert.strictEqual(elements.crosshairToggleCheckbox.checked, true);
assert.strictEqual(elements.crosshairThicknessValue.textContent, '2px');

elements.crosshairToggleCheckbox.checked = false;
elements.crosshairToggleCheckbox.emit('change');
assert.strictEqual(mode, 'off');
assert.deepStrictEqual(storageWrites[0], ['dashbridge_crosshairMode', 'off']);
assert(calls.includes('hideCrosshair'));
assert.strictEqual(calls.filter(call => Array.isArray(call) && call[0] === 'post').length, 2);

elements.crosshairThicknessSlider.value = '4';
elements.crosshairThicknessSlider.emit('input');
assert.strictEqual(thickness, 4);
assert.strictEqual(elements.crosshairThicknessValue.textContent, '4px');
assert.deepStrictEqual(storageWrites[1], ['dashbridge_crosshairThickness', 4]);

elements.capturePreparedToggleBtn.emit('click');
elements.captureAllPanelsBtn.emit('click');
assert.strictEqual(prepared, true);
assert(calls.some(call => Array.isArray(call) && call[0] === 'captureAll'));

elements.configureReportBtn.emit('click');
elements.generateReportBtn.emit('click');
elements.testReportBtn.emit('click');
assert(calls.includes('reportSettings') && calls.includes('reportPreview') && calls.includes('reportTest'));

Promise.resolve()
    .then(() => elements.newProfileBtn.emit('click'))
    .then(() => elements.renameProfileBtn.emit('click'))
    .then(() => {
        elements.deleteProfileBtn.emit('click');
        assert(calls.some(call => Array.isArray(call) && call[0] === 'create' && call[1] === 'New'));
        assert(calls.some(call => Array.isArray(call) && call[0] === 'rename' && call[1] === 'Current 2'));
        assert(calls.some(call => Array.isArray(call) && call[0] === 'delete' && call[1] === 'profile-1'));

        documentListeners.get('keydown')({ key: 'Escape' });
        for (const expected of ['closePicker', 'closeAnalysis', 'closeExtra', 'exitFullscreen']) {
            assert(calls.includes(expected), `Escape must invoke ${expected}`);
        }

        assert.throws(
            () => context.DashBridgePageUiController.create({ documentRef }),
            /dependencies are incomplete/,
        );
        console.log('dashbridge page UI controller behavior tests passed');
    });
