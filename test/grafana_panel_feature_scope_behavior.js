'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const settingsContext = { globalThis: {} };
vm.createContext(settingsContext);
vm.runInContext(fs.readFileSync('js/shared/grafana-settings.js', 'utf8'), settingsContext);
const defaults = settingsContext.globalThis.getGrafanaSettingsDefaults();
assert.strictEqual(defaults.grafanaCpuPanelTitle, 'CPU Usage');
assert.strictEqual(defaults.grafanaMemPanelTitle, 'Memory');
assert.strictEqual(defaults.grafanaLoadPanelTitle, 'Load Average');

const modalContext = { window: {} };
vm.createContext(modalContext);
vm.runInContext(fs.readFileSync('js/shared/grafana-panel-settings-modal.js', 'utf8'), modalContext);
const modal = modalContext.window.DashBridgePanelSettingsModal;
const render = panelKind => modal.transformFields({}, { panelKind });
const cpu = render('cpu');
const ram = render('ram');
const load = render('load');
const other = render(null);

assert(cpu.includes('name="invertIdle"'));
assert(!cpu.includes('name="convertMemToUsed"') && !cpu.includes('name="cpuCapacityFilterEnabled"'));
assert(ram.includes('name="convertMemToUsed"'));
assert(!ram.includes('name="invertIdle"') && !ram.includes('name="cpuCapacityFilterEnabled"'));
assert(load.includes('name="cpuCapacityFilterEnabled"'));
assert(!load.includes('name="invertIdle"') && !load.includes('name="convertMemToUsed"'));
assert(!other.includes('name="invertIdle"')
    && !other.includes('name="convertMemToUsed"')
    && !other.includes('name="cpuCapacityFilterEnabled"'));
[cpu, ram, load, other].forEach(html => assert(html.includes('name="seriesQueryFilterEnabled"'),
    'the universal displayed-series filter must remain available on every graph'));
[
    [cpu, 'name="invertIdle"'],
    [ram, 'name="convertMemToUsed"'],
    [load, 'name="cpuCapacityFilterEnabled"']
].forEach(([html, contextualControl]) => assert(
    html.indexOf(contextualControl) < html.indexOf('name="seriesQueryFilterEnabled"'),
    'every panel-specific control must occupy the same slot before the universal series filter'
));

const optionsHtml = fs.readFileSync('html/options.html', 'utf8');
const optionsSource = fs.readFileSync('js/pages/options.js', 'utf8');
const dashboardSource = fs.readFileSync('js/pages/dashbridge.js', 'utf8');
const iframeSource = fs.readFileSync('js/content/grafana-iframe.js', 'utf8');
const panelToolsSource = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8');
['settingGrafanaCpuPanelTitle', 'settingGrafanaMemPanelTitle', 'settingGrafanaLoadPanelTitle'].forEach(id => {
    assert(optionsHtml.includes(`id="${id}"`));
    assert(optionsSource.includes(`document.getElementById("${id}")`));
});
assert(dashboardSource.includes("action: 'getDashbridgePanelTitle'"));
assert(iframeSource.includes("action: 'dashbridgePanelTitleResponse'"));
assert(panelToolsSource.includes('const headersByPanel = new Map();')
    && panelToolsSource.includes('headersByPanel.forEach((candidates, panel) =>')
    && panelToolsSource.includes("const panelHosts = [...panel.querySelectorAll('.dashbridge-panel-menu-host')]")
    && panelToolsSource.includes('panelHosts.forEach(host => { if (host !== existingHost) host.remove(); });')
    && panelToolsSource.includes("/panel header/i.test(candidate.getAttribute('data-testid') || '')"),
    'transient nested Cancel query headers must retain exactly one DashBridge toolbar per panel');

console.log('PASS panel-specific transforms follow configurable exact Grafana titles');
