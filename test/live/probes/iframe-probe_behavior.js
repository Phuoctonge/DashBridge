'use strict';
const assert = require('node:assert/strict');
const { validateIframeMessage } = require('./iframe-probe');

assert.equal(validateIframeMessage({ origin: 'chrome-extension://abc', sourceMatches: true, action: 'dashbridgeFrameLocation', requestId: '1' }, 'chrome-extension://abc'), true);
assert.equal(validateIframeMessage({ origin: 'https://evil.test', sourceMatches: true, action: 'dashbridgeFrameLocation', requestId: '1' }, 'chrome-extension://abc'), false);
assert.equal(validateIframeMessage({ origin: 'chrome-extension://abc', sourceMatches: false, action: 'dashbridgeFrameLocation', requestId: '1' }, 'chrome-extension://abc'), false);
assert.equal(validateIframeMessage({ origin: 'chrome-extension://abc', sourceMatches: true, action: 'wrong', requestId: '1' }, 'chrome-extension://abc'), false);
console.log('PASS live iframe probe validates origin, source, and correlation');
