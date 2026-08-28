'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'grafana-runtime.js'), 'utf8');
const context = { URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'grafana-runtime-manifest.js'), 'utf8'), context);
vm.runInContext(`${source}\nglobalThis.__runtimeFiles = DASHBRIDGE_GRAFANA_MAIN_RUNTIME_FILES;`, context);
const files = Array.from(context.__runtimeFiles);
assert.deepStrictEqual(files, [
    'js/shared/grafana-panel-bootstrap.js', 'js/content/grafana-refresh-policy.js', 'js/shared/grafana-legend-selection.js', 'js/shared/grafana-capture-output.js', 'js/content/grafana-dom.js', 'js/content/grafana-panel-state.js', 'js/shared/grafana-panel-analysis.js', 'js/content/grafana-series-capture.js',
    'js/content/grafana-visual-engine.js', 'js/content/grafana-compact-layout.js', 'js/shared/grafana-panel-settings-modal.js',
    'js/shared/bounded-journal.js', 'js/content/grafana-network.js', 'js/content/grafana-cpu-capacity-filter.js', 'js/content/grafana-panel-tools.js'
]);
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
assert(!manifest.content_scripts.some(script => script.world === 'MAIN' && script.matches.includes('<all_urls>')));
const iframeScripts = manifest.content_scripts.find(script => script.all_frames === true)?.js || [];
assert(iframeScripts.indexOf('js/shared/grafana-panel-bootstrap.js') >= 0
    && iframeScripts.indexOf('js/shared/grafana-panel-bootstrap.js') < iframeScripts.indexOf('js/content/grafana-iframe.js'),
    'the isolated iframe bridge must load the shared refresh URL policy before consuming time updates');
const basePathMatches = Array.from(context.DashBridgeGrafanaRuntimeManifest.matchesForHostname('grafana.test'));
assert(basePathMatches.includes('*://grafana.test/*/d/*'));
const background = fs.readFileSync(path.join(__dirname, '..', 'js', 'background.js'), 'utf8');
const panelTools = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
assert(background.includes('async function backfillOpenGrafanaFrames()'));
assert(background.includes("loaded: window.__dashbridgePanelToolsRuntimeLoaded === true"));
assert(background.includes('frameIds: [...new Set(missingFrameIds)]'));
assert(panelTools.includes('window.__dashbridgePanelToolsLifecycle?.cleanup?.()'));
assert(panelTools.includes("document.removeEventListener('dashbridgeGrafanaMenuScopeChanged', syncPanelMenuScope)"));
console.log('PASS Grafana MAIN runtime has one ordered installer and no static all-URL bundle');
