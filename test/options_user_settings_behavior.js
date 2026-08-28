'use strict';
const assert = require('assert');
const fs = require('fs');

const optionsHtml = fs.readFileSync('options.html', 'utf8');
const optionsSource = fs.readFileSync('js/pages/options.js', 'utf8');
const tdmSource = fs.readFileSync('js/popup/popup-tdm.js', 'utf8');
const contentSource = fs.readFileSync('js/content/content.js', 'utf8');
const dashboardSource = fs.readFileSync('js/pages/dashbridge.js', 'utf8');
const popupCoreSource = fs.readFileSync('js/popup/popup-core.js', 'utf8');

const contracts = [
    ['tdmSavePhotosDefault', 'settingTdmSavePhotosDefault', tdmSource, 'tdmSavePhotosDefault'],
    ['tdmRememberDate', 'settingTdmRememberDate', tdmSource, 'tdmRememberDate'],
    ['tdmExcludeUserDefault', 'settingTdmExcludeUserDefault', tdmSource, 'tdmExcludeUserDefault'],
    ['tdmExcludeUserTextDefault', 'settingTdmExcludeUserTextDefault', tdmSource, 'tdmExcludeUserTextDefault'],
    ['confluenceScrollFixEnabled', 'settingConfluenceScrollFixEnabled', contentSource, 'SET_CONFLUENCE_FIX'],
    ['module_recorder', 'settingModuleRecorder', popupCoreSource, 'modules.module_recorder'],
];

contracts.push([
    'grafanaCpuCapacityCoefficient', 'settingGrafanaCpuCapacityCoefficient', dashboardSource,
    'grafanaTransformSettings.grafanaCpuCapacityCoefficient'
]);
contracts.push([
    'grafanaCompactExportWidth', 'settingGrafanaCompactExportWidth', dashboardSource,
    'grafanaTransformSettings.grafanaCompactExportWidth'
]);
contracts.push([
    'grafanaCompactExportHeight', 'settingGrafanaCompactExportHeight', dashboardSource,
    'grafanaTransformSettings.grafanaCompactExportHeight'
]);

contracts.forEach(([key, elementId, consumerSource, consumerMarker]) => {
    assert(optionsHtml.includes(`id="${elementId}"`), `${key} must have an Options control`);
    assert(optionsSource.includes(key) && optionsSource.includes(`"${elementId}"`),
        `${key} must load from and save to sync storage`);
    assert(consumerSource.includes(consumerMarker), `${key} must retain a real production consumer`);
});

assert(!optionsHtml.includes('id="settingModuleConfluence"')
    && !optionsSource.includes('module_confluence')
    && optionsHtml.includes('id="settingConfluenceScrollFixEnabled"')
    && optionsSource.includes('confluenceScrollFixEnabled: document.getElementById("settingConfluenceScrollFixEnabled").checked'),
    'Options must retain the Confluence scroll fix without a removed popup-module toggle');

assert(!optionsHtml.includes('id="settingGrafanaCompactScreenshot"')
    && !optionsHtml.includes('id="settingGlobalTheme"')
    && !optionsHtml.includes('id="settingCustomButtons"')
    && !optionsHtml.includes('id="settingJiraDefaultTimeSpent"')
    && !optionsHtml.includes('id="settingJiraDefaultComment"'),
    'point-of-use controls and managed collections must not be duplicated in Options');

assert(optionsSource.includes('const saveError = chrome.runtime.lastError'),
    'Options must not report success when chrome.storage.sync.set fails');
assert(optionsSource.includes('DashBridgeLocalStateSchema.normalizeCustomButtons(sync.customButtons)'),
    'Options import must validate every custom Grafana button');
assert(optionsHtml.includes('placeholder="web.tdm.mos.ru"')
    && optionsSource.includes("tdmDomain: 'web.tdm.mos.ru'")
    && tdmSource.includes("tdmDomain: 'web.tdm.mos.ru'"),
    'Options and TDM export must share web.tdm.mos.ru as the default host');

console.log('PASS Options exposes only selected global user defaults with active consumers');
