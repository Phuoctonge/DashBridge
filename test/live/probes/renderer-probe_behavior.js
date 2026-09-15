'use strict';
const assert = require('node:assert/strict');
const { detectRenderer, summarizePanelFacts } = require('./renderer-probe');

assert.equal(detectRenderer({ uplotCount: 1, flotCount: 0 }), 'uplot');
assert.equal(detectRenderer({ uplotCount: 0, flotCount: 2 }), 'flot');
assert.equal(detectRenderer({ uplotCount: 1, flotCount: 1 }), 'mixed');
assert.equal(detectRenderer({ uplotCount: 0, flotCount: 0 }), 'unknown');
const facts = summarizePanelFacts({ id: '12', title: 'CPU', renderer: 'uplot', labels: ['CPU user', 'CPU idle'], width: 1000, height: 500 });
assert.deepEqual(facts, { id: '12', title: 'CPU', renderer: 'uplot', labels: ['CPU user', 'CPU idle'], width: 1000, height: 500 });
console.log('PASS live renderer probe detects bounded panel facts');
