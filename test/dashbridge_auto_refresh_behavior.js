'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8');
const timeSource = fs.readFileSync('pages/dashbridge/dashbridge-time-controller.js', 'utf8');
const profileSource = fs.readFileSync('pages/dashbridge/dashbridge-profile-controller.js', 'utf8');
const frameSource = fs.readFileSync('pages/dashbridge/dashbridge-frame-controller.js', 'utf8');
const analysisSource = fs.readFileSync('pages/dashbridge/dashbridge-panel-analysis-controller.js', 'utf8');
const panelToolsSource = fs.readFileSync('pages/dashbridge/dashbridge-panel-tools-controller.js', 'utf8');
const panelAdditionSource = fs.readFileSync('pages/dashbridge/dashbridge-panel-addition-controller.js', 'utf8');
const panelCardSource = fs.readFileSync('pages/dashbridge/dashbridge-panel-card-controller.js', 'utf8');
const panelActionsSource = fs.readFileSync('pages/dashbridge/dashbridge-panel-actions-controller.js', 'utf8');
const messageSource = fs.readFileSync('pages/dashbridge/dashbridge-iframe-message-controller.js', 'utf8');
const iframeSource = fs.readFileSync('js/content/grafana-iframe.js', 'utf8');
const html = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
const css = fs.readFileSync('pages/dashbridge/dashbridge.css', 'utf8');

const initStart = source.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
const initEnd = source.indexOf('function getCompactCaptureDimensions', initStart);
const initSource = source.slice(initStart, initEnd);
assert(initStart >= 0 && initEnd > initStart
    && initSource.includes('const [storedSettings] = await Promise.all([')
    && initSource.includes('loadProfiles(),')
    && initSource.includes('rulesPromise')
    && initSource.includes("'grafanaCompactScreenshot'"),
    'profile, settings and iframe-rule IPC must run in parallel before the first dashboard render');

const applyToolsStart = panelToolsSource.indexOf('const apply = (panel, iframe)');
const applyToolsEnd = panelToolsSource.indexOf('const requestTitle', applyToolsStart);
const applyToolsSource = panelToolsSource.slice(applyToolsStart, applyToolsEnd);
assert(applyToolsStart >= 0 && applyToolsEnd > applyToolsStart
    && applyToolsSource.includes('transformSettings: getTransformSettings()')
    && !applyToolsSource.includes('settingsStorage.get'),
    'every ready iframe must reuse the settings cache instead of repeating sync-storage IPC');

assert(frameSource.includes('iframe.dataset.dashbridgeOrigin !== targetOrigin')
    && frameSource.includes("delete iframe.dataset.dashbridgeOrigin;")
    && !frameSource.includes('iframe.contentWindow.location.origin'),
    'the hot postMessage path must use a verified origin cache without normal cross-origin exceptions');

const forceStart = timeSource.indexOf("documentRef.getElementById('forceRefreshBtn').addEventListener");
const forceEnd = timeSource.indexOf('            updateLabels();', forceStart);
const forceSource = timeSource.slice(forceStart, forceEnd);
assert(forceStart >= 0 && forceEnd > forceStart
    && forceSource.includes('await refreshAllPanels();')
    && !forceSource.includes('navigateDashboardFrame('),
    'Refresh now must traverse and navigate active panels exactly once');

const absoluteStart = timeSource.indexOf("documentRef.getElementById('applyAbsoluteTime').addEventListener");
const absoluteEnd = timeSource.indexOf("documentRef.querySelectorAll('#refreshPopover", absoluteStart);
const absoluteSource = timeSource.slice(absoluteStart, absoluteEnd);
assert(absoluteStart >= 0 && absoluteEnd > absoluteStart
    && absoluteSource.includes('if (requiresNavigation)')
    && absoluteSource.includes('navigateDashboardFrame(iframe, applyPanelParamsToUrl(panel, currentUrl))')
    && absoluteSource.includes('broadcast();')
    && absoluteSource.indexOf('broadcast()') > absoluteSource.indexOf('if (requiresNavigation)'),
    'absolute ranges must navigate once while relative ranges keep the seamless update path');

const readyStart = messageSource.indexOf("if (event.data.action === 'dashbridgeIframeReady')");
const readyEnd = messageSource.indexOf("if (event.data.action === 'dashbridgePanelRendered')", readyStart);
const readySource = messageSource.slice(readyStart, readyEnd);
const renderedEnd = messageSource.indexOf("if (event.data.action === 'panelLegendSeries'", readyEnd);
const renderedSource = messageSource.slice(readyEnd, renderedEnd);
assert(readyStart >= 0 && readyEnd > readyStart
    && analysisSource.includes("action: 'startEmbeddedPanelAnalysis'")
    && readySource.includes('retryPanelAnalysis(sourceIframe)')
    && renderedEnd > readyEnd
    && renderedSource.includes('retryPanelAnalysis(sourceIframe)'),
    'an analysis dialog must resume observing after its Grafana iframe reloads');

const storageSyncStart = profileSource.indexOf('const syncProfilesFromStorage = async () => {');
const storageSyncEnd = profileSource.indexOf("chrome.storage.onChanged.addListener((changes, areaName) => {", storageSyncStart);
const storageSyncSource = profileSource.slice(storageSyncStart, storageSyncEnd);
assert(storageSyncStart >= 0 && storageSyncEnd > storageSyncStart
    && storageSyncSource.includes('await profileStore.flush();')
    && storageSyncSource.indexOf('await profileStore.flush();')
        < storageSyncSource.indexOf('await profileStore.load();'),
    'profile storage events must wait for the newest local snapshot before deciding to rebuild iframes');

const pauseStart = panelActionsSource.indexOf('const togglePanelPause = async id =>');
const pauseEnd = panelActionsSource.indexOf('const bindPanelActions =', pauseStart);
const pauseSource = panelActionsSource.slice(pauseStart, pauseEnd);
assert(pauseStart >= 0 && pauseEnd > pauseStart
    && pauseSource.includes('replacePanelCard(panel.id);')
    && !pauseSource.includes('renderDashboard();'),
    'pausing one panel must replace only that card instead of reloading every Grafana iframe');

const deleteStart = panelActionsSource.indexOf('const deletePanel = async id =>');
const deleteEnd = panelActionsSource.indexOf('const refreshPanel =', deleteStart);
const deleteSource = panelActionsSource.slice(deleteStart, deleteEnd);
assert(deleteStart >= 0 && deleteEnd > deleteStart
    && deleteSource.includes('removePanelCard(id);')
    && !deleteSource.includes('renderDashboard();'),
    'deleting one panel must remove only its card');

const iframeSettingsStart = panelActionsSource.indexOf('const openIframeSettings = panel =>');
const iframeSettingsEnd = panelActionsSource.indexOf('const togglePanelPause =', iframeSettingsStart);
const iframeSettingsSource = panelActionsSource.slice(iframeSettingsStart, iframeSettingsEnd);
assert(iframeSettingsStart >= 0 && iframeSettingsEnd > iframeSettingsStart
    && iframeSettingsSource.includes('reloadFrame: previousSrc !== panel.src')
    && iframeSettingsSource.includes('|| previousGrafanaTheme !== panel.grafanaTheme'),
    'layout-only iframe settings must not navigate the selected Grafana frame');

assert(profileSource.includes('else reconcileDashboardPanelCards(previousPanelStates);')
    && panelCardSource.includes('updatePanelCard(panel.id, { reloadFrame: false });')
    && panelAdditionSource.includes('appendPanelCards([addedPanel]);')
    && panelAdditionSource.includes('appendPanelCards(newPanels);')
    && source.includes('appendPanelCards: appendDashboardPanelCards')
    && profileSource.includes('adoptPanelState(previous, panel)'),
    'panel-only storage sync and additions must preserve unchanged iframe elements');

const switchStart = profileSource.indexOf('const switchProfile = async id => {');
const switchEnd = profileSource.indexOf('const createProfile = async name => {', switchStart);
const switchSource = profileSource.slice(switchStart, switchEnd);
assert(switchSource.includes('currentProfile.panels = getPanels();')
    && switchSource.includes('await saveProfiles();')
    && !switchSource.includes('await savePanels();'),
    'a profile switch must persist one snapshot instead of emitting two storage changes');

const timeLabelStart = timeSource.indexOf('const updateLabels = () => {');
const timeLabelEnd = timeSource.indexOf('const syncControls', timeLabelStart);
const timeLabelSource = timeSource.slice(timeLabelStart, timeLabelEnd);
assert(timeLabelSource.includes('timeLabel.replaceChildren(')
    && timeLabelSource.includes('timezone.textContent = timezoneName;')
    && !timeLabelSource.includes('innerHTML'),
    'absolute time labels must render as text without parsing user-controlled markup');

assert(iframeSource.includes('applyRefreshPolicyToUrl?.(url.toString(), event.data.refresh || \'\')')
    && !iframeSource.includes("url.searchParams.set('refresh', '1y')")
    && !iframeSource.includes("url.searchParams.set('refresh', 'off')"),
    'Off must use the shared bootstrap policy instead of unsupported or clamped Grafana intervals');
const refreshChoiceStart = timeSource.indexOf("documentRef.querySelectorAll('#refreshPopover .dropdown-item')");
const refreshChoiceEnd = timeSource.indexOf("documentRef.getElementById('forceRefreshBtn')", refreshChoiceStart);
const refreshChoiceSource = timeSource.slice(refreshChoiceStart, refreshChoiceEnd);
assert(refreshChoiceStart >= 0 && refreshChoiceEnd > refreshChoiceStart
    && refreshChoiceSource.includes('const previousRefresh = state.refresh;')
    && refreshChoiceSource.includes('if (!state.refresh && previousRefresh)')
    && refreshChoiceSource.includes('void refreshAllPanels();')
    && refreshChoiceSource.includes('else {\n                        broadcast();'),
    'switching a live profile to Off must navigate once to destroy the existing Grafana scheduler');
assert(iframeSource.includes("window.history.replaceState(null, '', url.toString())")
    && !iframeSource.includes("window.history.pushState(null, '', url.toString())"),
    'seamless time updates must replace the iframe URL instead of growing browser history');

assert(html.includes('class="btn btn-outline gtp-clipboard-btn"')
    && css.includes('flex: 0 0 2.25rem;')
    && css.includes('.gtp-clipboard-btn svg'),
    'time clipboard icons must retain a fixed visible slot beside the apply button');

console.log('PASS DashBridge auto-refresh avoids duplicate navigation and restores panel analysis');
