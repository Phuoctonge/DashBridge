'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'popup', 'popup.html'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '..', 'pages', 'popup', 'popup-core.js'), 'utf8');
assert(html.includes('openReportImageReplacementBtn')); assert(core.includes('openReportImageReplacementBtn'));
assert(core.includes('pages/confluence-report/confluence-report.html'));
console.log('PASS report replacement launcher wiring');
