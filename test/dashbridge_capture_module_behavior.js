'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
const controller = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8');
const capture = fs.readFileSync('pages/dashbridge/dashbridge-capture.js', 'utf8');

assert(html.indexOf('dashbridge-capture.js') < html.indexOf('dashbridge.js'),
    'capture owner must load before the page controller');
assert(capture.includes('globalThis.DashBridgeCapture')
    && capture.includes('const capturePanel = async')
    && capture.includes('const captureAll = async')
    && capture.includes('const captureFromToolbar = async'),
    'the extracted module must own single, archive and toolbar capture lifecycles');
assert(controller.includes('DashBridgeCapture.create({')
    && controller.includes('getPanels: () => panels')
    && controller.includes('getDefaultCapturePrepared: () => defaultCapturePrepared')
    && controller.includes('const captureDashbridgePanel = dashBridgeCapture.capturePanel'),
    'the page controller must pass live state through an explicit boundary');
assert(!controller.includes('chrome.tabs.captureVisibleTab')
    && !controller.includes("card.classList.add('dashbridge-panel-capture-active')"),
    'capture implementation must not remain duplicated in the page controller');
assert(capture.includes('captureSnapshot?.forEach')
    && capture.includes('window.scrollTo(scroll.x, scroll.y)')
    && capture.includes('panelCaptureInProgress = false'),
    'capture cleanup must remain inside the extracted lifecycle owner');

console.log('PASS DashBridge capture module owns sequencing and restoration boundaries');
