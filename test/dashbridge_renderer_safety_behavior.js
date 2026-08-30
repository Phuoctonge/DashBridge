'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.className = '';
        this.innerHTML = '';
        this.attributes = {};
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener() {}
    setAttribute(name, value) { this.attributes[name] = String(value); }
}
const document = { createElement: tag => new FakeElement(tag), getElementById: () => null };
const context = { document };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashbridge', 'dashbridge-renderer.js'), 'utf8') + '\nthis.renderer = DashBridgeRenderer;', context);

const hostileId = '\"><svg data-owned="true">';
const card = context.renderer.createPanelCard({
    panel: { id: hostileId, src: 'https://grafana.example/d-solo/x', width: '50%', height: '350px' },
    width: '50%', iframeSrc: 'https://grafana.example/d-solo/x',
    analysisType: 'cpu',
    icons: { grip: '<svg></svg>', expand: '', refresh: '', pause: '', resume: '', captureSave: '', captureCopy: '', iframeSettings: '', panelSettings: '', more: '', analysis: '', open: '', delete: '' }
});
const actions = card.children[0];
const iframe = card.children[1].children[0];
assert.strictEqual(card.dataset.panelId, hostileId);
assert.strictEqual(iframe.id, `iframe-${hostileId}`);
assert(actions.children.some(button => button.dataset.id === hostileId));
assert(!actions.children.some(button => button.className.includes('btn-capture-toggle')),
    'the card must rely on the single compact-capture toggle in the page header');
const analysis = actions.children.find(button => button.className.includes('btn-analysis'));
assert(analysis && analysis.hidden === false && analysis.dataset.analysisType === 'cpu');
assert(fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashbridge', 'dashbridge.css'), 'utf8').includes('.btn-analysis[hidden]'),
    'author styles must not override the hidden state on non-CPU/RAM panels');
assert(actions.children.find(button => button.className.includes('btn-iframe-settings')).hidden === true);
assert(actions.children.find(button => button.className.includes('btn-open')).hidden === true);
assert(actions.children.some(button => button.className.includes('btn-capture-save')));
assert(actions.children.some(button => button.className.includes('btn-capture-copy')));
assert(actions.children.some(button => button.className.includes('btn-more')));
const visibleToolbar = actions.children
    .filter(child => child.hidden !== true)
    .map(child => child.className);
assert.deepStrictEqual(visibleToolbar, [
    'drag-handle',
    'icon-btn btn-fullscreen',
    'icon-btn btn-refresh',
    'icon-btn btn-pause',
    'icon-btn btn-capture-save',
    'icon-btn btn-capture-copy',
    'icon-btn btn-panel-tools',
    'icon-btn btn-analysis',
    'icon-btn btn-more',
    'icon-btn delete btn-delete'
], 'the always-visible toolbar must retain the agreed action order');
const loadCard = context.renderer.createPanelCard({
    panel: { id: 'load-panel', src: 'https://grafana.example/d-solo/x', height: '350px' },
    width: '100%', iframeSrc: 'https://grafana.example/d-solo/x', analysisType: null,
    icons: { grip: '', expand: '', refresh: '', pause: '', resume: '', captureSave: '', captureCopy: '', iframeSettings: '', panelSettings: '', more: '', analysis: '', open: '', delete: '' }
});
const loadAnalysis = loadCard.children[0].children.find(button => button.className.includes('btn-analysis'));
assert(loadAnalysis.hidden === true && loadAnalysis.dataset.analysisType === '',
    'Load Average and unrelated panels must not expose a CPU analysis action');
assert(!actions.innerHTML.includes(hostileId), 'dynamic panel IDs must not be parsed as HTML');
console.log('PASS DashBridge renderer assigns imported values through DOM properties');
