'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('js/pages/dashbridge.js', 'utf8');

const initStart = source.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
const initEnd = source.indexOf('function clearDragMarkers', initStart);
const initSource = source.slice(initStart, initEnd);
assert(initStart >= 0 && initEnd > initStart
    && initSource.includes('const [storedSettings] = await Promise.all([')
    && initSource.includes('loadProfiles(),')
    && initSource.includes('rulesPromise')
    && initSource.includes("'grafanaCompactScreenshot'"),
    'profile, settings and iframe-rule IPC must run in parallel before the first dashboard render');

const applyToolsStart = source.indexOf('function applyPanelTools(panel, iframe)');
const applyToolsEnd = source.indexOf('const panelLegendWaiters', applyToolsStart);
const applyToolsSource = source.slice(applyToolsStart, applyToolsEnd);
assert(applyToolsStart >= 0 && applyToolsEnd > applyToolsStart
    && applyToolsSource.includes('transformSettings: grafanaTransformSettings')
    && !applyToolsSource.includes('chrome.storage.sync.get'),
    'every ready iframe must reuse the settings cache instead of repeating sync-storage IPC');

assert(source.includes('iframe.dataset.dashbridgeOrigin !== targetOrigin')
    && source.includes("delete iframe.dataset.dashbridgeOrigin;")
    && !source.includes('iframe.contentWindow.location.origin'),
    'the hot postMessage path must use a verified origin cache without normal cross-origin exceptions');

const forceStart = source.indexOf("document.getElementById('forceRefreshBtn').addEventListener");
const forceEnd = source.indexOf('    updateTimeLabels();', forceStart);
const forceSource = source.slice(forceStart, forceEnd);
assert(forceStart >= 0 && forceEnd > forceStart
    && forceSource.includes('await refreshAllPanels();')
    && !forceSource.includes('navigateDashboardFrame('),
    'Refresh now must traverse and navigate active panels exactly once');

const absoluteStart = source.indexOf("document.getElementById('applyAbsoluteTime').addEventListener");
const absoluteEnd = source.indexOf("document.querySelectorAll('#refreshPopover", absoluteStart);
const absoluteSource = source.slice(absoluteStart, absoluteEnd);
assert(absoluteStart >= 0 && absoluteEnd > absoluteStart
    && absoluteSource.includes('if (requiresNavigation)')
    && absoluteSource.includes('navigateDashboardFrame(iframe, applyPanelParamsToUrl(panel, currentUrl))')
    && absoluteSource.includes('} else broadcastTimeUpdate();')
    && absoluteSource.indexOf('broadcastTimeUpdate()') > absoluteSource.indexOf('if (requiresNavigation)'),
    'absolute ranges must navigate once while relative ranges keep the seamless update path');

const readyStart = source.indexOf("if (e.data.action === 'dashbridgeIframeReady')");
const readyEnd = source.indexOf("if (e.data.action === 'dashbridgePanelRendered')", readyStart);
const readySource = source.slice(readyStart, readyEnd);
const renderedEnd = source.indexOf("if (e.data.action === 'panelLegendSeries'", readyEnd);
const renderedSource = source.slice(readyEnd, renderedEnd);
assert(readyStart >= 0 && readyEnd > readyStart
    && source.includes('function requestDashboardPanelAnalysis(state)')
    && readySource.includes('activeDashboardPanelAnalysis?.iframe === sourceIframe')
    && readySource.includes('requestDashboardPanelAnalysis(activeDashboardPanelAnalysis)')
    && renderedEnd > readyEnd
    && renderedSource.includes('requestDashboardPanelAnalysis(activeDashboardPanelAnalysis)'),
    'an analysis dialog must resume observing after its Grafana iframe reloads');

const storageSyncStart = source.indexOf('async function syncProfilesFromStorage()');
const storageSyncEnd = source.indexOf("chrome.storage.onChanged.addListener((changes, areaName) => {", storageSyncStart);
const storageSyncSource = source.slice(storageSyncStart, storageSyncEnd);
assert(storageSyncStart >= 0 && storageSyncEnd > storageSyncStart
    && storageSyncSource.includes('await DashBridgeProfileStore.flush();')
    && storageSyncSource.indexOf('await DashBridgeProfileStore.flush();')
        < storageSyncSource.indexOf('await DashBridgeProfileStore.load();'),
    'profile storage events must wait for the newest local snapshot before deciding to rebuild iframes');

const pauseStart = source.indexOf('async function togglePanelPause(id)');
const pauseEnd = source.indexOf('function createDashboardPanelCard(', pauseStart);
const pauseSource = source.slice(pauseStart, pauseEnd);
assert(pauseStart >= 0 && pauseEnd > pauseStart
    && pauseSource.includes('replaceDashboardPanelCard(panel.id);')
    && !pauseSource.includes('renderDashboard();'),
    'pausing one panel must replace only that card instead of reloading every Grafana iframe');

const deleteStart = source.indexOf('async function deletePanel(id)');
const deleteEnd = source.indexOf('function refreshPanel(id)', deleteStart);
const deleteSource = source.slice(deleteStart, deleteEnd);
assert(deleteStart >= 0 && deleteEnd > deleteStart
    && deleteSource.includes('removeDashboardPanelCard(id);')
    && !deleteSource.includes('renderDashboard();'),
    'deleting one panel must remove only its card');

const iframeSettingsStart = source.indexOf('function openIframeSettings(panel)');
const iframeSettingsEnd = source.indexOf('async function togglePanelPause(id)', iframeSettingsStart);
const iframeSettingsSource = source.slice(iframeSettingsStart, iframeSettingsEnd);
assert(iframeSettingsStart >= 0 && iframeSettingsEnd > iframeSettingsStart
    && iframeSettingsSource.includes('reloadFrame: previousSrc !== panel.src || previousGrafanaTheme !== panel.grafanaTheme'),
    'layout-only iframe settings must not navigate the selected Grafana frame');

assert(source.includes('else reconcileDashboardPanelCards(previousPanelStates);')
    && source.includes('updatePanelCard(panel.id, { reloadFrame: false });')
    && source.includes('appendDashboardPanelCards([addedPanel]);')
    && source.includes('appendDashboardPanelCards(newPanels);')
    && source.includes('adoptPanelState(previous, panel)'),
    'panel-only storage sync and additions must preserve unchanged iframe elements');

const switchStart = source.indexOf('async function switchProfile(id)');
const switchEnd = source.indexOf('async function createProfile(name)', switchStart);
const switchSource = source.slice(switchStart, switchEnd);
assert(switchSource.includes('currentProfile.panels = panels;')
    && switchSource.includes('await saveProfiles();')
    && !switchSource.includes('await savePanels();'),
    'a profile switch must persist one snapshot instead of emitting two storage changes');

const timeLabelStart = source.indexOf('function updateTimeLabels()');
const timeLabelEnd = source.indexOf('function applyGlobalParamsToUrl', timeLabelStart);
const timeLabelSource = source.slice(timeLabelStart, timeLabelEnd);
assert(timeLabelSource.includes('timeLabel.replaceChildren(')
    && timeLabelSource.includes('timezone.textContent = tzName;')
    && !timeLabelSource.includes('innerHTML'),
    'absolute time labels must render as text without parsing user-controlled markup');

console.log('PASS DashBridge auto-refresh avoids duplicate navigation and restores panel analysis');
