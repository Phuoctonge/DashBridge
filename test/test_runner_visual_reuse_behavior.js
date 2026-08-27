'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'test-runner', 'test-runner-suite.js'), 'utf8');
const extractFunction = name => {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, `${name} not found`);
    let depth = 0;
    let bodyStarted = false;
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === '{') { depth += 1; bodyStarted = true; }
        if (source[index] === '}' && bodyStarted) {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`${name} body not closed`);
};

const context = vm.createContext({
    DIAGNOSTIC_CAPTURE_MODES: { PANEL: 'panel', CANVAS: 'canvas' },
});
vm.runInContext(`${extractFunction('runtimeVisualReuseSignature')}\n${extractFunction('canReuseRuntimeVisual')}\n${extractFunction('diagnosticCaptureModeForTransition')}`, context);
const base = {
    at: 1,
    panelFound: true,
    renderer: 'uplot',
    panelImage: { dataUrl: 'data:image/png;base64,A' },
    viewportImage: { dataUrl: 'data:image/png;base64,B' },
    domSnapshot: { root: { outerHTMLHash: 'dom-style-1', outerHTMLStructuralHash: 'dom-structure-1', rect: { width: 100, height: 50 } }, document: { bodyClassName: 'theme-dark' } },
    canvas: [{ hash: 'canvas-1', width: 100, height: 50, dataUrl: 'data:image/png;base64,C', pixelStats: { luminanceMean: 20 } }],
    legend: { entries: 2 }, markers: { hidden: 0 }, series: [{ label: 'A', show: true }],
    thresholdDiagnostic: { enabled: false }, visualStyleState: { removeFill: false }, tools: { removeFill: false },
};
const equivalentLater = JSON.parse(JSON.stringify({ ...base, at: 2 }));
assert.strictEqual(context.canReuseRuntimeVisual(equivalentLater, base), true,
    'timestamps alone must not force a duplicate PNG');
equivalentLater.domSnapshot.root.outerHTMLHash = 'dom-style-2';
assert.strictEqual(context.canReuseRuntimeVisual(equivalentLater, base), true,
    'volatile inline-style DOM changes must use the stable structural hash');
const changedCanvas = JSON.parse(JSON.stringify(equivalentLater));
changedCanvas.canvas[0].hash = 'canvas-2';
assert.strictEqual(context.canReuseRuntimeVisual(changedCanvas, base), false);
const changedLegend = JSON.parse(JSON.stringify(equivalentLater));
changedLegend.legend.entries = 1;
assert.strictEqual(context.canReuseRuntimeVisual(changedLegend, base), false);
const missingSourceImage = JSON.parse(JSON.stringify(base));
delete missingSourceImage.panelImage.dataUrl;
assert.strictEqual(context.canReuseRuntimeVisual(equivalentLater, missingSourceImage), false);
assert.strictEqual(context.canReuseRuntimeVisual(equivalentLater, missingSourceImage, 'semantic-only'), true,
    'semantic checkpoints may reference an equivalent state without carrying PNG payloads');
assert.strictEqual(context.canReuseRuntimeVisual(equivalentLater, missingSourceImage, 'canvas'), true,
    'canvas evidence may be reused without a full-panel or viewport image');
assert.strictEqual(context.canReuseRuntimeVisual(equivalentLater, missingSourceImage, 'panel'), false,
    'panel evidence still requires a real panel image');
const fullMatrixSettings = {
    legendVisibility: {},
    visualSettings: { removeFill: true, thickenLines: false, invertLegend: false },
    transformSettings: { invertIdle: false, convertMemToUsed: false, seriesQueryFilterEnabled: false, thresholdEnabled: false },
};
assert.strictEqual(context.diagnosticCaptureModeForTransition(fullMatrixSettings, ['removeFill'], ['removeFill']), 'canvas',
    'inactive layout keys in the full matrix command must not force a panel screenshot');
assert.strictEqual(context.diagnosticCaptureModeForTransition(fullMatrixSettings, [], ['invertLegend']), 'panel',
    'turning a layout feature off still requires panel evidence');
assert.strictEqual(context.diagnosticCaptureModeForTransition(fullMatrixSettings, ['invertLegend', 'removeFill'], ['removeFill']), 'canvas',
    'changing only a canvas feature must reuse the already-proven layout instead of recapturing the whole panel');
console.log('PASS test runner reuses PNG only for equivalent visual evidence');
