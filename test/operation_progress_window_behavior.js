'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
    setTimeout, clearTimeout, Math, Number, Promise,
    chrome: { runtime: { getURL: value => `chrome-extension://test/${value}` } },
};
context.window = context;
vm.createContext(context);
const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'pages/shared/operation-progress-window.js'), 'utf8');
const testRunnerHtml = fs.readFileSync(path.join(__dirname, '..', 'pages/test-runner/test-runner.html'), 'utf8');
const testRunnerUi = fs.readFileSync(path.join(__dirname, '..', 'pages/test-runner/test-runner-ui.js'), 'utf8');
vm.runInContext(controllerSource, context);
assert(controllerSource.includes('documentPictureInPicture.requestWindow') && controllerSource.includes('bindDocument'),
    'the shared progress controller must use an always-on-top Document Picture-in-Picture view');
assert(!controllerSource.includes('chrome.windows.create') && !controllerSource.includes('operation-progress.html'),
    'the removed popup side window must not remain as a fallback');
assert(testRunnerHtml.includes('../shared/operation-progress-window.js')
    && testRunnerHtml.indexOf('../shared/operation-progress-window.js') < testRunnerHtml.indexOf('test-runner-ui.js'),
    'the E2E runner must load the shared progress controller before its UI');
assert(testRunnerUi.includes('onCancel: handleAbort')
    && testRunnerUi.includes("title: 'Автопроверка DashBridge'")
    && testRunnerUi.includes('total: planned,')
    && testRunnerUi.includes('done: completed,')
    && testRunnerUi.includes('Общее время: ${formatElapsedDuration')
    && testRunnerUi.includes('closeDelayMs: 6000'),
    'the E2E runner PiP must expose emergency stop, test accounting, and total elapsed time');
const handleRunSource = testRunnerUi.slice(
    testRunnerUi.indexOf('async function handleRun()'),
    testRunnerUi.indexOf('function handleAbort()')
);
assert(handleRunSource.indexOf('const progressWindowPromise = openOperationProgressWindow(mode);')
    < handleRunSource.indexOf('await chrome.storage.local.set'),
    'the E2E runner must request Picture-in-Picture before its first await consumes user activation');

(async () => {
    const pipElements = new Map();
    const elementIds = ['operationTitle', 'operationPhase', 'operationStatus', 'operationBar', 'operationCount',
        'operationPercent', 'operationSuccess', 'operationFailed', 'operationMessage', 'operationCancel'];
    for (const id of elementIds) {
        pipElements.set(id, {
            dataset: {}, listeners: {}, hidden: false, disabled: false, textContent: '',
            addEventListener(type, listener) { this.listeners[type] = listener; },
            removeAttribute() {},
        });
    }
    const pipDocument = {
        documentElement: { dataset: {}, lang: '' }, title: '',
        head: { appendChild() {} }, body: { innerHTML: '' },
        createElement: () => ({}), getElementById: id => pipElements.get(id),
    };
    const pipWindow = {
        document: pipDocument, closed: false, listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        close() { this.closed = true; },
    };
    let pipOptions = null;
    context.document = { documentElement: { dataset: { theme: 'light' } } };
    context.documentPictureInPicture = {
        requestWindow: options => { pipOptions = options; return Promise.resolve(pipWindow); }
    };
    let cancelled = 0;
    const controller = context.DashBridgeOperationProgress.create({ onCancel: () => { cancelled++; }, closeDelayMs: 0 });
    assert.strictEqual(await controller.openPictureInPicture({ title: 'Recorder', phase: 'Recording', width: 390, height: 300 }), true);
    assert.strictEqual(pipOptions.width, 390);
    assert.strictEqual(pipOptions.height, 300);
    assert.strictEqual(pipDocument.documentElement.dataset.uiScale, 'auto');
    assert.strictEqual(controller.mode, 'picture-in-picture');
    controller.update({ done: 12, total: 0, unit: 'запросов', success: 10, failed: 2 });
    assert.strictEqual(pipElements.get('operationCount').textContent, '12 запросов');
    await pipElements.get('operationCancel').listeners.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(cancelled, 1);
    await controller.release();
    assert.strictEqual(pipWindow.closed, true);

    delete context.documentPictureInPicture;
    const unsupported = context.DashBridgeOperationProgress.create();
    assert.strictEqual(await unsupported.openPictureInPicture({ title: 'Unavailable' }), false,
        'operations continue without opening a legacy side window when PiP is unavailable');
    console.log('[OK] Operation Picture-in-Picture lifecycle');
})().catch(error => { console.error(error); process.exit(1); });
