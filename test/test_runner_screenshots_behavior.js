'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('pages/test-runner/test-runner-diagnostics.js', 'utf8'), context);
let options;
context.execMain = async (_tab, _fn, args) => {
    options = args[1];
    return { at: 1, panelFound: true, canvas: [{ hash: 'pixels', pixelStats: { mean: 12 } }], tools: {} };
};
context.capturePanelDiagnosticImage = async () => ({ dataUrl: 'data:image/png;base64,AAAA', hash: 'image' });
(async () => {
    const before = await context.captureRuntimeDiagnostic(1, 'panel-1');
    assert.equal(before.panelImage.dataUrl, 'data:image/png;base64,AAAA', 'legacy default retains screenshots');
    context.setDiagnosticScreenshotsEnabled(false);
    for (const captureMode of ['canvas', 'panel', 'forensic', 'semantic-only']) {
        const result = await context.captureRuntimeDiagnostic(1, 'panel-1', { captureMode, reuseVisualFrom: before });
        assert.equal(options.includeCanvasImages, false);
        assert.equal(result.visualCapture.reason, 'screenshots-disabled');
        assert.equal(result.canvas[0].hash, 'pixels', 'pixel evidence remains available');
        assert(!JSON.stringify(result).includes('data:image'), 'no reused or new image payload');
        assert.equal(result.panelImage, undefined);
        assert.equal(result.viewportImage, undefined);
        if (captureMode === 'forensic') assert.equal(options.retainFullDom, true, 'technical evidence is preserved');
    }
    context.setDiagnosticScreenshotsEnabled(true);
    assert((await context.captureRuntimeDiagnostic(1, 'panel-1')).panelImage.dataUrl);
    console.log('PASS screenshot preference keeps hashes and suppresses all diagnostic image modes');
})().catch(error => { console.error(error); process.exitCode = 1; });
