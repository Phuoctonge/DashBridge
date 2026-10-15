'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const logs = [];
const buttons = {
    mainActionArea: { hidden: false },
    startButton: { hidden: false, disabled: false },
    startSeriesButton: { disabled: false },
    cancelButton: { hidden: true, style: {}, addEventListener(type, listener) { this[type] = listener; } },
};
let active = true;
let captureImpl = async () => ({ dataUrl: 'data:image/png;base64,AQID' });
const context = {
    TextEncoder,
    document: {
        querySelector: () => ({ dataset: { tab: 'tab-main' } }),
        getElementById: () => ({ checked: false }),
    },
    addEventListener() {},
    window: null,
    captureGrafanaPanelImage: options => captureImpl(options),
    BatchCaptureUtils: { base64ToUint8Array: base64 => Uint8Array.from(Buffer.from(base64, 'base64')) },
    normalizeGrafanaSettings: value => value,
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/batch/batch-operation-controller.js', 'utf8'), context);

const operation = context.BatchOperationController.create({
    ...buttons,
    showToast() {},
    logMessage: value => logs.push(value),
    lifecycle: {
        begin: () => 1,
        cancel() { active = false; },
        isActive: runId => active && runId === 1,
        finish: () => true,
    },
    progressFactory: {
        create: () => ({ openPictureInPicture: async () => {}, cancel() {}, finish() {}, release: async () => {} }),
    },
    captureWindowRunner: { acquire: async () => ({}), release: async () => {} },
    loadPanel: async () => null,
});

(async () => {
    const firstArchive = { add: async () => assert.fail('archive write must not begin after capture cancellation') };
    captureImpl = async () => {
        active = false;
        return { dataUrl: 'data:image/png;base64,AQID' };
    };
    const cancelledDuringCapture = await operation.capturePanelToZip(
        { id: 1 }, 2, '7', 'panel.png', firstArchive, {}, () => active,
    );
    assert.equal(cancelledDuringCapture, null);
    assert(!logs.some(message => message.startsWith('Saved:')));

    active = true;
    logs.length = 0;
    let writes = 0;
    captureImpl = async () => ({ dataUrl: 'data:image/png;base64,AQID' });
    const secondArchive = {
        add: async () => {
            writes++;
            active = false;
        },
    };
    const cancelledAfterWrite = await operation.capturePanelToZip(
        { id: 1 }, 2, '7', 'panel.png', secondArchive, {}, () => active,
    );
    assert.equal(cancelledAfterWrite, null);
    assert.equal(writes, 1);
    assert(!logs.some(message => message.startsWith('Saved:')), 'no late success log after cancellation');

    active = true;
    const reportWrites = [];
    const reportArchive = {
        add: async filename => {
            reportWrites.push(filename);
            active = false;
        },
    };
    const cancelledReport = await operation.addArchiveReport(reportArchive, {
        errors: [{ file: 'panel.png', reason: 'capture failed' }],
    }, () => active);
    assert.equal(cancelledReport, false);
    assert.deepEqual(reportWrites, ['manifest.json'], 'cancellation must prevent a later archive report write');

    let previousOwnerActive = true;
    let releaseRollover;
    let rolloverStarted;
    const rolloverGate = new Promise(resolve => { releaseRollover = resolve; });
    const rolloverEntered = new Promise(resolve => { rolloverStarted = resolve; });
    const previousCapture = operation.capturePanelToZip({ id: 1 }, 2, '7', 'old.png', {
        async add() { rolloverStarted(); await rolloverGate; },
    }, {}, () => previousOwnerActive);
    await rolloverEntered;
    previousOwnerActive = false;
    // A new run clears the shared capture list while the old rollover settles.
    await operation.begin({ title: 'New run', phase: 'Preparing' });
    releaseRollover();
    await previousCapture;
    let newManifest;
    await operation.addArchiveReport({ async add(name, bytes) {
        if (name === 'manifest.json') newManifest = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } }, { errors: [] });
    assert.deepEqual(newManifest.captures, [], 'cancelled rollover must not append old capture metadata into a new run');

    console.log('batch operation controller cancellation behavior tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
