'use strict';
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('pages/popup/popup-tdm.js', 'utf8');
const formatterSource = source.slice(0, source.indexOf('document.addEventListener'));
const formatProgress = Function(formatterSource + '; return formatTdmExportProgress;')();
assert(source.includes('originalDistanceFromBottom'), 'TDM export must snapshot the chat scroll position');
assert(source.includes('finally') && source.includes('chatContainer.scrollTop = Math.max(0, chatContainer.scrollHeight - originalDistanceFromBottom)'),
    'TDM export must restore chat position on success and failure');
assert(source.includes('TDM_EXPORT_MAX_DURATION_MS'), 'TDM export must have a bounded execution time');
assert(source.includes('formatTdmExportProgress(msg)')
    && source.includes('message.total !== undefined && message.total !== null')
    && source.includes('current: extractedMessages.size, text: "Сбор сообщений:"')
    && !source.includes("total: '...'"),
    'message collection progress must show the collected count without an unknown expected total');
assert.strictEqual(formatProgress({ text: 'Сбор сообщений:', current: 101 }), 'Сбор сообщений: 101...');
assert.strictEqual(formatProgress({ text: 'Упаковка фото:', current: 2, total: 5 }), 'Упаковка фото: 2 из 5...');

console.log('PASS TDM export has bounded lifecycle and restores chat scroll');
