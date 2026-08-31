'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('pages/recorder/recorder.html', 'utf8');
const controller = fs.readFileSync('pages/recorder/recorder.js', 'utf8');
const view = fs.readFileSync('pages/recorder/recorder-view.js', 'utf8');

assert(html.includes('<script src="recorder-view.js"></script>'),
    'Recorder page must load its view module');
assert(html.indexOf('recorder-view.js') < html.indexOf('recorder.js'),
    'Recorder view must load before the lifecycle controller');
assert(controller.includes('DashBridgeRecorderView.create({'),
    'Recorder controller must create the view through explicit adapters');
for (const adapter of ['ui', 'state', 'flowCompare', 'comparisonXlsx', 'schema', 'formatBytes', 'setStatus', 'updateControls', 'updateRecordingProgress']) {
    assert(controller.includes(`${adapter},`), `Recorder controller must pass the ${adapter} adapter`);
}
for (const method of ['stepLabel', 'requestDuration', 'renderSteps', 'renderTraffic', 'renderRequestDetails', 'renderComparison', 'buildComparison', 'exportComparisonReport', 'scheduleRender']) {
    assert(view.includes(method), `Recorder view must own ${method}`);
}
assert(view.includes('sensitiveNamePattern') && view.includes('redactSensitiveValue')
    && view.includes('redactSensitiveText') && view.includes('redactSensitiveUrl'),
    'Recorder view must preserve sensitive value redaction');
assert(view.includes("const entries = matchingEntries.slice(-1000)"),
    'Recorder traffic rendering must keep its bounded DOM cap');
assert(view.includes('if (renderPending) return;') && view.includes('requestAnimationFrame'),
    'Recorder view must coalesce rendering without changing its frame boundary');
assert(!controller.includes('function renderTraffic()') && !controller.includes('function renderComparison()'),
    'Recorder lifecycle controller must not retain duplicate render owners');

console.log('PASS Recorder view owns bounded rendering without changing session lifecycle');
