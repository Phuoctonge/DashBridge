'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

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

const thresholdValidator = optionsSource.match(/function getAnalysisThresholdPairError\([\s\S]*?\n    \}/)?.[0];
assert(thresholdValidator, 'Options must expose one shared CPU/RAM threshold-pair validator');
const thresholdContext = {};
vm.createContext(thresholdContext);
vm.runInContext(`${thresholdValidator}\nthis.validateThresholds = getAnalysisThresholdPairError;`, thresholdContext);
assert.strictEqual(thresholdContext.validateThresholds(50, 80, 'CPU'), '');
assert.match(thresholdContext.validateThresholds(90, 80, 'CPU'), /меньше критического/);
assert.match(thresholdContext.validateThresholds(-1, 80, 'CPU'), /от 0 до 100/);
assert(optionsSource.includes("const raw = document.getElementById(inputId).value.trim()")
    && optionsSource.includes("raw === '' ? Number.NaN : Number(raw)"),
    'an empty threshold field must be rejected instead of being silently saved as zero');
const thresholdPairs = optionsSource.match(/const analysisThresholdPairs = Object\.freeze\(\[[\s\S]*?\n    \]\);/)?.[0];
const effectiveImportValidator = optionsSource.match(/function validateEffectiveImportedThresholds\([\s\S]*?\n    \}/)?.[0];
assert(thresholdPairs && effectiveImportValidator,
    'Options import must expose executable effective CPU/RAM threshold validation');
const importThresholdContext = {
    getGrafanaSettingsDefaults: () => ({
        cpuWarnThreshold: 50,
        cpuCritThreshold: 80,
        memWarnThreshold: 80,
        memCritThreshold: 90,
    }),
};
vm.createContext(importThresholdContext);
vm.runInContext(`${thresholdValidator}\n${thresholdPairs}\n${effectiveImportValidator}\n`
    + 'this.validateEffectiveImport = validateEffectiveImportedThresholds;', importThresholdContext);
assert.doesNotThrow(() => importThresholdContext.validateEffectiveImport(
    { cpuCritThreshold: 85 }, { cpuWarnThreshold: 60 }
), 'a valid partial CPU import must be checked against the current critical threshold');
assert.throws(() => importThresholdContext.validateEffectiveImport(
    { cpuCritThreshold: 70 }, { cpuWarnThreshold: 75 }
), /меньше критического/, 'an invalid partial CPU import must be rejected');
assert.doesNotThrow(() => importThresholdContext.validateEffectiveImport(
    {}, { memCritThreshold: 95 }
), 'a partial RAM import must fall back to the canonical warning threshold');
assert.throws(() => importThresholdContext.validateEffectiveImport(
    {}, { memCritThreshold: 75 }
), /меньше критического/, 'an invalid partial RAM import must be rejected against canonical defaults');
const importValidationCall = optionsSource.indexOf('validateEffectiveImportedThresholds(currentSync, imported.sync);');
const importBackupWrite = optionsSource.indexOf('dashbridge_import_backup:', importValidationCall);
const importSyncWrite = optionsSource.indexOf('await setStorageValues(chrome.storage.sync, imported.sync);', importBackupWrite);
assert(importValidationCall >= 0 && importBackupWrite > importValidationCall && importSyncWrite > importBackupWrite,
    'confirmed import must validate before creating its backup and writing sync settings');
for (const id of ['settingCpuWarn', 'settingCpuCrit', 'settingMemWarn', 'settingMemCrit']) {
    assert(new RegExp(`id="${id}"[^>]*min="0"[^>]*max="100"`).test(optionsHtml),
        `${id} must expose its valid percentage range`);
}

console.log('PASS Options exposes only selected global user defaults with active consumers');
