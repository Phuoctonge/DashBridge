'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8');
const profileSource = fs.readFileSync('pages/dashbridge/dashbridge-profile-controller.js', 'utf8');
const frameSource = fs.readFileSync('pages/dashbridge/dashbridge-frame-controller.js', 'utf8');
const iframeSource = fs.readFileSync('js/content/grafana-iframe.js', 'utf8');
const html = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
const css = fs.readFileSync('pages/dashbridge/dashbridge.css', 'utf8');

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

assert(frameSource.includes('iframe.dataset.dashbridgeOrigin !== targetOrigin')
    && frameSource.includes("delete iframe.dataset.dashbridgeOrigin;")
    && !frameSource.includes('iframe.contentWindow.location.origin'),
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

const storageSyncStart = profileSource.indexOf('const syncProfilesFromStorage = async () => {');
const storageSyncEnd = profileSource.indexOf("chrome.storage.onChanged.addListener((changes, areaName) => {", storageSyncStart);
const storageSyncSource = profileSource.slice(storageSyncStart, storageSyncEnd);
assert(storageSyncStart >= 0 && storageSyncEnd > storageSyncStart
    && storageSyncSource.includes('await profileStore.flush();')
    && storageSyncSource.indexOf('await profileStore.flush();')
        < storageSyncSource.indexOf('await profileStore.load();'),
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

assert(profileSource.includes('else reconcileDashboardPanelCards(previousPanelStates);')
    && source.includes('updatePanelCard(panel.id, { reloadFrame: false });')
    && source.includes('appendDashboardPanelCards([addedPanel]);')
    && source.includes('appendDashboardPanelCards(newPanels);')
    && profileSource.includes('adoptPanelState(previous, panel)'),
    'panel-only storage sync and additions must preserve unchanged iframe elements');

const switchStart = profileSource.indexOf('const switchProfile = async id => {');
const switchEnd = profileSource.indexOf('const createProfile = async name => {', switchStart);
const switchSource = profileSource.slice(switchStart, switchEnd);
assert(switchSource.includes('currentProfile.panels = getPanels();')
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

assert(iframeSource.includes('applyRefreshPolicyToUrl?.(url.toString(), event.data.refresh || \'\')')
    && !iframeSource.includes("url.searchParams.set('refresh', '1y')")
    && !iframeSource.includes("url.searchParams.set('refresh', 'off')"),
    'Off must use the shared bootstrap policy instead of unsupported or clamped Grafana intervals');
const refreshChoiceStart = source.indexOf("document.querySelectorAll('#refreshPopover .dropdown-item')");
const refreshChoiceEnd = source.indexOf("document.getElementById('forceRefreshBtn')", refreshChoiceStart);
const refreshChoiceSource = source.slice(refreshChoiceStart, refreshChoiceEnd);
assert(refreshChoiceStart >= 0 && refreshChoiceEnd > refreshChoiceStart
    && refreshChoiceSource.includes('const previousRefresh = globalRefresh;')
    && refreshChoiceSource.includes('if (!globalRefresh && previousRefresh)')
    && refreshChoiceSource.includes('void refreshAllPanels();')
    && refreshChoiceSource.includes('else {\n                broadcastTimeUpdate();'),
    'switching a live profile to Off must navigate once to destroy the existing Grafana scheduler');
assert(iframeSource.includes("window.history.replaceState(null, '', url.toString())")
    && !iframeSource.includes("window.history.pushState(null, '', url.toString())"),
    'seamless time updates must replace the iframe URL instead of growing browser history');

assert(html.includes('class="btn btn-outline gtp-clipboard-btn"')
    && css.includes('flex: 0 0 2.25rem;')
    && css.includes('.gtp-clipboard-btn svg'),
    'time clipboard icons must retain a fixed visible slot beside the apply button');

console.log('PASS DashBridge auto-refresh avoids duplicate navigation and restores panel analysis');
