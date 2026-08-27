'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/content/grafana-panel-state.js', 'utf8');
const createContext = () => {
    const window = {
        DashBridgeGrafanaDom: {
            panelKey: panel => panel?.dataset?.vizPanelKey || panel?.dataset?.panelid || null
        }
    };
    const context = { window };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context;
};
const panel = key => ({ dataset: { vizPanelKey: key }, querySelector: () => null });

const currentDocument = createContext();
currentDocument.window.DashBridgeGrafanaPanelState.set(panel('panel-12'), {
    convertMemToUsed: true, thresholdEnabled: false
});
assert.strictEqual(
    currentDocument.window.DashBridgeGrafanaPanelState.get(panel('panel-12')).convertMemToUsed,
    true,
    'state survives a panel DOM remount inside the current Grafana document'
);

const refreshedDocument = createContext();
assert.strictEqual(
    refreshedDocument.window.DashBridgeGrafanaPanelState.get(panel('panel-12')),
    undefined,
    'state resets when Grafana creates a new document after page refresh'
);

const background = fs.readFileSync('js/background.js', 'utf8');
const content = fs.readFileSync('js/content/content.js', 'utf8');
assert(!background.includes('dashbridge-grafana-panel-state-get')
    && !background.includes('dashbridge-grafana-panel-state-set')
    && !content.includes('dashbridge-grafana-panel-state-get')
    && !content.includes('dashbridge-grafana-panel-state-set'),
    'native Grafana panel state has no extension-storage bridge');

console.log('PASS native Grafana panel switches are temporary for the current page');
