'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const messages = [];
const context = {
    globalThis: null,
    chrome: { runtime: { sendMessage(message) { messages.push(message); return Promise.reject(new Error('offline')); } } },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/analytics-client.js', 'utf8'), context);

assert.doesNotThrow(() => context.DashBridgeAnalytics.outcome('jira.batch_send', 'success', { countBucket: '2_5' }),
    'a rejected analytics message must not affect the product action');
assert.deepStrictEqual(JSON.parse(JSON.stringify(messages[0])), {
    type: 'dashbridge-analytics-track',
    event: { featureId: 'jira.batch_send', signal: 'outcome', dimensions: { countBucket: '2_5', outcome: 'success' } },
});
delete context.chrome.runtime.sendMessage;
assert.doesNotThrow(() => context.DashBridgeAnalytics.opened('popup.opened'),
    'an unavailable service worker must remain fail-open');
console.log('PASS analytics client is fail-open and emits only its fixed envelope');
