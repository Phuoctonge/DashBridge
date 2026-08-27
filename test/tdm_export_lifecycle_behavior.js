'use strict';
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('js/popup/popup-tdm.js', 'utf8');
assert(source.includes('originalDistanceFromBottom'), 'TDM export must snapshot the chat scroll position');
assert(source.includes('finally') && source.includes('chatContainer.scrollTop = Math.max(0, chatContainer.scrollHeight - originalDistanceFromBottom)'),
    'TDM export must restore chat position on success and failure');
assert(source.includes('TDM_EXPORT_MAX_DURATION_MS'), 'TDM export must have a bounded execution time');

console.log('PASS TDM export has bounded lifecycle and restores chat scroll');
