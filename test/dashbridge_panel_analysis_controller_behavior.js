'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const pageSource = [
    'dashbridge.js',
    'dashbridge-panel-card-controller.js',
    'dashbridge-page-ui-controller.js',
    'dashbridge-iframe-message-controller.js',
].map(file => fs.readFileSync(path.join(root, 'pages', 'dashbridge', file), 'utf8')).join('\n');
const html = fs.readFileSync(path.join(root, 'pages', 'dashbridge', 'dashbridge.html'), 'utf8');
assert(html.indexOf('dashbridge-panel-analysis-controller.js') < html.indexOf('dashbridge.js'),
    'panel analysis controller must load before its page consumer');
assert(pageSource.includes('panelAnalysis.isPanel(panel)')
    && pageSource.includes('panelAnalysis.isPanel(panelId)')
    && pageSource.includes('panelAnalysis: dashBridgePanelAnalysisController')
    && pageSource.includes('acceptPanelAnalysis(event.data, sourceIframe)')
    && pageSource.match(/retryPanelAnalysis\(sourceIframe\)/g)?.length === 2
    && pageSource.includes('closePanelAnalysis();'),
    'pause, removal, reconciliation, escape, rerender and iframe messages must retain one analysis owner');

class FakeNode {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.classList = { toggle() {} };
        this.listeners = {};
        this.isConnected = true;
        this.textContent = '';
    }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(type, listener) { this.listeners[type] = listener; }
    focus() { this.focused = true; }
    remove() { this.removed = true; this.isConnected = false; }
}

const body = new FakeNode('body');
const documentRef = { body, createElement: tag => new FakeNode(tag) };
const messages = [];
const context = { document: documentRef, navigator: { clipboard: { writeText: async () => undefined } }, setTimeout };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'pages', 'dashbridge', 'dashbridge-panel-analysis-controller.js'), 'utf8'), context);

const iframe = { id: 'frame' };
const analysisAction = {
    dataset: {}, hidden: true, title: '',
    setAttribute(name, value) { this[name] = value; },
};
const controller = context.DashBridgePanelAnalysisController.create({
    postToDashboardFrame(target, message) { messages.push({ target, message }); return true; },
    normalizePanelMetadataText: value => String(value || '').trim(),
    analysisApi: {
        baseTitle: value => String(value || '').replace(/ calculated$/i, ''),
        classifyTitle: value => String(value || '').startsWith('CPU') ? 'cpu' : null,
    },
    getTransformSettings: () => ({}),
    findPanelCard: () => ({ querySelector: selector => selector === '.btn-analysis' ? analysisAction : null }),
    documentRef,
    navigatorRef: context.navigator,
    now: () => 10,
    random: () => 0.5,
});

assert.strictEqual(controller.syncAction({ id: 'cpu-1', title: 'CPU Usage calculated' }), 'cpu');
assert.strictEqual(analysisAction.hidden, false);
assert.strictEqual(analysisAction.dataset.analysisType, 'cpu');

assert.strictEqual(controller.open({ id: 'cpu-1', title: 'CPU Usage calculated' }, iframe, 'cpu'), true);
assert.strictEqual(controller.active, true);
assert.strictEqual(controller.isPanel('cpu-1'), true);
assert.strictEqual(messages[0].message.action, 'startEmbeddedPanelAnalysis');
assert.strictEqual(messages[0].message.analysisType, 'cpu');
const requestId = messages[0].message.requestId;
assert.strictEqual(controller.accept({ requestId: 'wrong' }, iframe), false, 'an unrelated response must be rejected');
assert.strictEqual(controller.accept({ requestId, status: 'ready', snapshot: { period: { items: [] } } }, {}), false,
    'a response from another iframe must be rejected');
assert.strictEqual(controller.accept({ requestId, status: 'ready', snapshot: { period: { items: [] } } }, iframe), true);
assert.strictEqual(controller.retryForFrame({}), false);
assert.strictEqual(controller.retryForFrame(iframe), true, 'a remounted ready iframe must receive the active analysis request again');
assert.strictEqual(controller.close(), true);
assert.strictEqual(controller.active, false);
assert.strictEqual(messages.at(-1).message.action, 'cancelEmbeddedPanelAnalysis');
assert.strictEqual(controller.close(), false, 'closing an already closed analysis must be harmless');
assert.throws(() => context.DashBridgePanelAnalysisController.create({}), /dependencies are incomplete/);
console.log('PASS DashBridge panel analysis controller preserves source, retry and cleanup contracts');
