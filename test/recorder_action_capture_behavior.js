'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/recorder/recorder-action-capture.js', 'utf8'), context);

const state = {
    mode: 'recording', steps: [], actionSequence: 0, activeStepId: null,
    requests: new Map([['request-1', { wallTime: 1.1 }]]),
};
const statuses = [];
let renders = 0;
const capture = context.DashBridgeRecorderActionCapture.create({
    state,
    schema: {
        MAX_FLOW_STEPS: 20,
        normalizeHttpUrl: value => value.startsWith('http') ? value : `https://${value}`,
    },
    setStatus: (...args) => statuses.push(args),
    scheduleRender: () => { renders += 1; },
    maxActionValue: 5,
    now: () => 1000,
});

capture.addNavigateStep('site.example/', 1000);
assert.strictEqual(state.steps[0].url, 'https://site.example/');
capture.addRecordedAction({
    type: 'change', at: 1100, value: '123456789', frameUrl: 'https://site.example/',
    locator: { id: 'name', testId: 'name-input', css: '#name' },
}, 0);
assert.strictEqual(state.steps[1].value, '12345');
assert.deepStrictEqual(JSON.parse(JSON.stringify(state.steps[1].selectors)), [
    ['id/name'], ['data-testid/name-input'], ['#name'],
]);
capture.addRecordedAction({
    type: 'change', at: 1200, value: 'next', frameUrl: 'https://site.example/', locator: { css: '#name' },
}, 0);
assert.strictEqual(state.steps.length, 2, 'nearby changes for one locator must coalesce');
capture.addNavigateStep('https://site.example/next', 1300);
assert.strictEqual(state.steps[2].url, 'https://site.example/next');
assert(renders >= 3);
assert.strictEqual(statuses.length, 0);
assert.throws(() => context.DashBridgeRecorderActionCapture.create({}), /dependencies are incomplete/);
console.log('PASS Recorder action capture owns navigation, locators and action coalescing');
