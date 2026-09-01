// Popup открывается автоматически через "default_popup" в manifest.json.
// Если потребуется кастомный размер окна — убери default_popup из манифеста
// и раскомментируй обработчик ниже:
//
// chrome.action.onClicked.addListener(() => {
//     chrome.windows.create({ url: "pages/popup/popup.html", type: "popup", width: 300, height: 400 });
// });

importScripts('../vendor/jszip.min.js', 'shared/grafana-settings.js', 'shared/url-validation.js', 'shared/dnr-rules.js', 'shared/grafana-runtime-manifest.js', 'shared/local-state-schema.js', 'shared/grafana-panel-identity.js', 'background-gui-capture.js');

const LEGACY_GRAFANA_RULE_ID_START = 1000;
const LEGACY_GRAFANA_RULE_ID_END = 1099;
const GRAFANA_SESSION_RULE_ID_START = 2000;
const GRAFANA_SESSION_RULE_LIMIT = 4000;
const GRAFANA_MAIN_SCRIPT_ID = 'dashbridge-grafana-main-runtime-v1';
const GRAFANA_MAIN_RUNTIME_FILES = DashBridgeGrafanaRuntimeManifest.files;
const GRAFANA_TAB_VISUAL_STATE_PREFIX = 'grafanaVisualState:';
const STORAGE_COMMIT_KEYS = new Set([
    'dashbridge_profiles', 'dashbridge_activeProfileId',
    'jiraWorklogs', 'jiraSortOrder', 'jiraIssueCache', 'batchState'
]);
let storageCommitQueue = Promise.resolve();

function isTrustedExtensionPage(sender, page) {
    if (sender?.id !== chrome.runtime.id || typeof sender.url !== 'string') return false;
    try {
        const actual = new URL(sender.url); const expected = new URL(chrome.runtime.getURL(page));
        return actual.origin === expected.origin && actual.pathname === expected.pathname;
    } catch (_) { return false; }
}

// Recorder owns the normal detach path. This port is the crash/close fallback:
// MV3 debugger attachment belongs to the extension and can otherwise survive
// the extension page that initiated it.
chrome.runtime.onConnect?.addListener(port => {
    if (port.name !== 'dashbridge-recorder-lifecycle'
        || port.sender?.id !== chrome.runtime.id
        || port.sender?.url !== chrome.runtime.getURL('pages/recorder/recorder.html')) return;
    let recorderTabId = null;
    port.onMessage.addListener(message => {
        if (message?.type === 'bind' && Number.isInteger(message.tabId) && message.tabId >= 0) recorderTabId = message.tabId;
        if (message?.type === 'unbind') recorderTabId = null;
    });
    port.onDisconnect.addListener(() => {
        if (!Number.isInteger(recorderTabId)) return;
        chrome.debugger.detach({ tabId: recorderTabId }).catch(() => undefined);
    });
});

function queueStorageCommit(values) {
    storageCommitQueue = storageCommitQueue.catch(() => undefined)
        .then(() => chrome.storage.local.set(values));
    return storageCommitQueue;
}

async function commitDashBridgeProfilePatch(message, sender) {
    if (!isTrustedExtensionPage(sender, 'pages/dashbridge/dashbridge.html')
        || !Array.isArray(message?.upserts)
        || !Array.isArray(message?.deleteProfileIds)
        || typeof message.activeProfileId !== 'string') {
        throw new Error('Untrusted profile commit');
    }
    const deleteProfileIds = new Set(message.deleteProfileIds.map(id => String(id)));
    if (deleteProfileIds.size !== message.deleteProfileIds.length
        || [...deleteProfileIds].some(id => !id || id.length > 160)) {
        throw new Error('Некорректный список удаляемых профилей.');
    }
    const normalizedUpserts = DashBridgeLocalStateSchema.normalizeProfiles(message.upserts, { mode: 'load' });
    if (normalizedUpserts.skippedProfiles || normalizedUpserts.skippedPanels
        || normalizedUpserts.items.length !== message.upserts.length
        || normalizedUpserts.items.some(profile => deleteProfileIds.has(profile.id))) {
        throw new Error('Некорректное изменение профилей.');
    }

    const stored = await chrome.storage.local.get(['dashbridge_profiles', 'dashbridge_activeProfileId']);
    const normalizedStored = DashBridgeLocalStateSchema.normalizeProfiles(
        Array.isArray(stored.dashbridge_profiles) ? stored.dashbridge_profiles : [], { mode: 'load' }
    );
    const profiles = normalizedStored.items.filter(profile => !deleteProfileIds.has(profile.id));
    const indexById = new Map(profiles.map((profile, index) => [profile.id, index]));
    normalizedUpserts.items.forEach(profile => {
        const index = indexById.get(profile.id);
        if (index === undefined) {
            indexById.set(profile.id, profiles.length);
            profiles.push(profile);
        } else {
            profiles[index] = profile;
        }
    });
    if (!profiles.length) throw new Error('Нельзя удалить все профили DashBridge.');
    const activeProfileId = profiles.some(profile => profile.id === message.activeProfileId)
        ? message.activeProfileId
        : profiles.some(profile => profile.id === stored.dashbridge_activeProfileId)
            ? stored.dashbridge_activeProfileId : profiles[0].id;
    await chrome.storage.local.set({ dashbridge_profiles: profiles, dashbridge_activeProfileId: activeProfileId });
    return { profileCount: profiles.length, activeProfileId };
}

function queueDashBridgeProfilePatch(message, sender) {
    let result;
    storageCommitQueue = storageCommitQueue.catch(() => undefined)
        .then(async () => { result = await commitDashBridgeProfilePatch(message, sender); });
    return storageCommitQueue.then(() => result);
}

function normalizeSavedGrafanaPanelUrl(sourceUrl, panelId) {
    const url = new URL(sourceUrl);
    if (url.pathname.includes('/d/')) url.pathname = url.pathname.replace('/d/', '/d-solo/');
    if (!url.pathname.includes('/d-solo/')) throw new Error('Открыта не страница дашборда Grafana.');
    url.searchParams.delete('viewPanel');
    url.searchParams.delete('editPanel');
    url.searchParams.set('panelId', DashBridgeGrafanaPanelIdentity.normalizePanelId(panelId));
    url.searchParams.set('kiosk', 'tv');
    url.searchParams.set('dashbridge', '1');
    return url.toString();
}

function grafanaPanelIdentity(value) {
    return DashBridgeGrafanaPanelIdentity.fromUrl(value);
}

async function saveGrafanaPanelToProfile(message, sender) {
    if (sender?.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0
        || typeof sender.url !== 'string' || !/^\d+$/.test(String(message?.panelId || ''))
        || String(message.panelId).length > 12) {
        throw new Error('Недоверенный запрос сохранения панели.');
    }
    const source = new URL(sender.url);
    const allowedHosts = await getGrafanaIframeHosts();
    if (!['http:', 'https:'].includes(source.protocol)
        || !allowedHosts.some(host => host === source.host.toLowerCase() || host === source.hostname.toLowerCase())) {
        throw new Error('Этот домен Grafana не разрешён в настройках DashBridge.');
    }
    const title = String(message.title || 'Панель Grafana').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 240)
        || 'Панель Grafana';
    const requestedProfileId = typeof message.profileId === 'string' ? message.profileId : '';
    const newProfileName = typeof message.newProfileName === 'string'
        ? message.newProfileName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';
    if ((!requestedProfileId && !newProfileName) || (requestedProfileId && newProfileName)) {
        throw new Error('Выберите профиль или укажите название нового.');
    }

    const stored = await chrome.storage.local.get(['dashbridge_profiles', 'dashbridge_activeProfileId']);
    const normalized = DashBridgeLocalStateSchema.normalizeProfiles(
        Array.isArray(stored.dashbridge_profiles) ? stored.dashbridge_profiles : [], { mode: 'load' }
    );
    const profiles = normalized.items;
    let profile = requestedProfileId ? profiles.find(item => item.id === requestedProfileId) : null;
    let createdProfile = false;
    if (requestedProfileId && !profile) throw new Error('Выбранный профиль больше не существует.');
    if (!profile) {
        createdProfile = true;
        profile = {
            id: crypto.randomUUID(), name: newProfileName, panels: [],
            timeState: { from: 'now-1h', to: 'now', refresh: '' }
        };
        profiles.push(profile);
    }

    const src = normalizeSavedGrafanaPanelUrl(sender.url, String(message.panelId));
    const identity = grafanaPanelIdentity(src);
    const duplicate = profile.panels.some(panel => grafanaPanelIdentity(panel.src) === identity);
    if (!duplicate) profile.panels.push({
        id: crypto.randomUUID(), src, title, width: '50%', height: '350px'
    });
    const activeProfileId = !createdProfile && profiles.some(item => item.id === stored.dashbridge_activeProfileId)
        ? stored.dashbridge_activeProfileId : profile.id;
    await chrome.storage.local.set({ dashbridge_profiles: profiles, dashbridge_activeProfileId: activeProfileId });
    return { profileId: profile.id, profileName: profile.name, duplicate };
}

function queueGrafanaPanelSave(message, sender) {
    let result;
    storageCommitQueue = storageCommitQueue.catch(() => undefined)
        .then(async () => { result = await saveGrafanaPanelToProfile(message, sender); });
    return storageCommitQueue.then(() => result);
}

function isTrustedStorageCommit(message, sender) {
    const extensionRoot = chrome.runtime.getURL('');
    return sender?.id === chrome.runtime.id
        && typeof sender.url === 'string'
        && sender.url.startsWith(extensionRoot)
        && message?.area === 'local'
        && message.values !== null
        && typeof message.values === 'object'
        && !Array.isArray(message.values)
        && Object.keys(message.values).length > 0
        && Object.keys(message.values).every(key => STORAGE_COMMIT_KEYS.has(key));
}

chrome.tabs.onRemoved.addListener(tabId => {
    if (!chrome.storage.session) return;
    chrome.storage.session.remove(`${GRAFANA_TAB_VISUAL_STATE_PREFIX}${tabId}`)
        .catch(error => console.warn('Failed to remove Grafana tab visual state:', error));
    queueGrafanaIframeRulesSync().catch(error => console.warn('Failed to remove Grafana iframe tab rules:', error));
});

function normalizeGrafanaIframeHost(value) {
    return normalizeHttpHost(value);
}

async function getGrafanaIframeHosts() {
    const { grafanaIframeDomains = getGrafanaSettingsDefaults().grafanaIframeDomains } = await chrome.storage.sync.get('grafanaIframeDomains');
    return [...new Set((Array.isArray(grafanaIframeDomains) ? grafanaIframeDomains : [])
        .map(normalizeGrafanaIframeHost)
        .filter(Boolean))].slice(0, 100);
}

async function isTrustedGrafanaContentSender(sender) {
    if (sender?.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0
        || typeof sender.url !== 'string') return false;
    let url;
    try { url = new URL(sender.url); } catch { return false; }
    if (!['http:', 'https:'].includes(url.protocol)
        || !/(?:^|\/)d(?:-solo)?(?:\/|$)/.test(url.pathname)) return false;
    const allowedHosts = await getGrafanaIframeHosts();
    return allowedHosts.some(host => host === url.host.toLowerCase() || host === url.hostname.toLowerCase());
}

async function syncGrafanaMainRuntimeRegistration() {
    const hosts = await getGrafanaIframeHosts();
    const hostnames = [...new Set(hosts.map(host => parseHttpUrl(host)?.hostname.toLowerCase()).filter(Boolean))];
    const matches = hostnames.flatMap(DashBridgeGrafanaRuntimeManifest.matchesForHostname);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [GRAFANA_MAIN_SCRIPT_ID] });
    const current = existing[0];
    const sameList = (left, right) => JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
    if (current
        && sameList(current.matches, matches)
        && sameList(current.js, GRAFANA_MAIN_RUNTIME_FILES)
        && current.allFrames === true
        && current.runAt === 'document_start'
        && current.world === 'MAIN') {
        return { matchCount: matches.length, unchanged: true };
    }
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [GRAFANA_MAIN_SCRIPT_ID] });
    if (!matches.length) return { matchCount: 0 };
    await chrome.scripting.registerContentScripts([{
        id: GRAFANA_MAIN_SCRIPT_ID,
        matches,
        js: GRAFANA_MAIN_RUNTIME_FILES,
        allFrames: true,
        runAt: 'document_start',
        world: 'MAIN',
        persistAcrossSessions: true
    }]);
    return { matchCount: matches.length };
}

let grafanaRuntimeRegistrationQueue = Promise.resolve();
function queueGrafanaRuntimeRegistrationSync() {
    grafanaRuntimeRegistrationQueue = grafanaRuntimeRegistrationQueue
        .catch(() => undefined).then(syncGrafanaMainRuntimeRegistration);
    return grafanaRuntimeRegistrationQueue;
}

function isAllowedGrafanaFrameUrl(value, allowedHostnames) {
    let url;
    try { url = new URL(value); } catch { return false; }
    return ['http:', 'https:'].includes(url.protocol)
        && allowedHostnames.has(url.hostname.toLowerCase())
        && /(?:^|\/)d(?:-solo)?(?:\/|$)/.test(url.pathname);
}

async function backfillOpenGrafanaFrames() {
    const hosts = await getGrafanaIframeHosts();
    const allowedHostnames = new Set(hosts
        .map(host => parseHttpUrl(host)?.hostname.toLowerCase())
        .filter(Boolean));
    if (!allowedHostnames.size) return { scannedTabs: 0, injectedFrames: 0, failedTabs: 0 };
    const tabs = await chrome.tabs.query({});
    let scannedTabs = 0;
    let injectedFrames = 0;
    let failedTabs = 0;
    for (const tab of tabs) {
        if (!Number.isInteger(tab.id)) continue;
        scannedTabs += 1;
        try {
            const probes = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                world: 'MAIN',
                func: () => ({
                    url: location.href,
                    loaded: window.__dashbridgePanelToolsRuntimeLoaded === true,
                    captureOutputReady: typeof window.DashBridgeGrafanaCaptureOutput?.fitPreparedSize === 'function'
                })
            });
            const missingFrameIds = probes
                .filter(probe => isAllowedGrafanaFrameUrl(probe.result?.url, allowedHostnames)
                    && (probe.result?.loaded !== true || probe.result?.captureOutputReady !== true))
                .map(probe => probe.frameId)
                .filter(Number.isInteger);
            if (!missingFrameIds.length) continue;
            const target = { tabId: tab.id, frameIds: [...new Set(missingFrameIds)] };
            await chrome.scripting.executeScript({
                target, world: 'MAIN',
                func: () => { window.__dashbridgePanelToolsAllowTop = true; }
            });
            await chrome.scripting.executeScript({ target, world: 'MAIN', files: GRAFANA_MAIN_RUNTIME_FILES });
            injectedFrames += target.frameIds.length;
        } catch (_) {
            // Browser-internal and discarded tabs are not scriptable. A later
            // navigation is still covered by the persistent registration.
            failedTabs += 1;
        }
    }
    return { scannedTabs, injectedFrames, failedTabs };
}

async function getDashBridgeTabIds() {
    const dashbridgeUrl = chrome.runtime.getURL('pages/dashbridge/dashbridge.html');
    const tabs = await chrome.tabs.query({});
    return tabs.filter(tab => typeof tab.url === 'string' && tab.url.startsWith(dashbridgeUrl))
        .map(tab => tab.id).filter(Number.isInteger);
}

async function removeLegacyGrafanaIframeRules() {
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = dynamicRules
        .filter(rule => rule.id >= LEGACY_GRAFANA_RULE_ID_START && rule.id <= LEGACY_GRAFANA_RULE_ID_END)
        .map(rule => rule.id);
    if (removeRuleIds.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
}

async function syncGrafanaIframeRules() {
    const [hosts, tabIds, existingRules] = await Promise.all([
        getGrafanaIframeHosts(), getDashBridgeTabIds(), chrome.declarativeNetRequest.getSessionRules()
    ]);
    const removeRuleIds = existingRules
        .filter(rule => rule.id >= GRAFANA_SESSION_RULE_ID_START && rule.id < GRAFANA_SESSION_RULE_ID_START + GRAFANA_SESSION_RULE_LIMIT)
        .map(rule => rule.id);
    const plan = DashBridgeDnrRules.planSessionRules(hosts, tabIds, {
        startId: GRAFANA_SESSION_RULE_ID_START, maxRules: GRAFANA_SESSION_RULE_LIMIT
    });
    const addRules = plan.rules;
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    // Remove broad legacy rules only after Chrome accepted the tab-scoped set.
    await removeLegacyGrafanaIframeRules();
    return {
        ruleCount: addRules.length,
        tabCount: tabIds.length,
        hostCount: hosts.length,
        desiredRuleCount: plan.desiredRuleCount,
        omittedRuleCount: plan.omittedRuleCount,
        truncated: plan.truncated,
        maxRules: plan.maxRules,
    };
}

let grafanaIframeRulesSyncQueue = Promise.resolve();

function queueGrafanaIframeRulesSync() {
    grafanaIframeRulesSyncQueue = grafanaIframeRulesSyncQueue
        .catch(() => undefined)
        .then(syncGrafanaIframeRules);
    return grafanaIframeRulesSyncQueue;
}

async function syncGrafanaInfrastructure({ backfillOpenFrames = false } = {}) {
    const registration = await queueGrafanaRuntimeRegistrationSync();
    const backfill = backfillOpenFrames
        ? await backfillOpenGrafanaFrames()
        : { skipped: true, scannedTabs: 0, injectedFrames: 0, failedTabs: 0 };
    const rules = await queueGrafanaIframeRulesSync();
    return { registration, backfill, rules };
}

chrome.runtime.onInstalled.addListener(() => {
    syncGrafanaInfrastructure({ backfillOpenFrames: true })
        .catch(error => console.error('Не удалось подготовить инфраструктуру Grafana:', error));
});

chrome.runtime.onStartup.addListener(() => {
    syncGrafanaInfrastructure({ backfillOpenFrames: true })
        .catch(error => console.error('Не удалось подготовить инфраструктуру Grafana:', error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.grafanaIframeDomains) {
        syncGrafanaInfrastructure({ backfillOpenFrames: true })
            .catch(error => console.error('Не удалось подготовить инфраструктуру Grafana:', error));
    }
});

const guiCaptureController = DashBridgeBackgroundGuiCapture.create({ zipConstructor: JSZip });

// This listener is a trust boundary: a new message type must validate its sender,
// payload shape/size, and target scope in its own branch before using Chrome APIs.
// Do not replace the branch-specific checks with a single "extension sender" test:
// content scripts and extension pages intentionally have different authority.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'dashbridge-capture-visible-tab') {
        (async () => {
            if (!await isTrustedGrafanaContentSender(_sender) || !_sender.tab?.windowId) {
                throw new Error('Недоверенный запрос снимка Grafana.');
            }
            return guiCaptureController.captureVisiblePanel(_sender);
        })().then(dataUrl => sendResponse({ ok: !!dataUrl, dataUrl: dataUrl || null }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (message?.type === 'dashbridge-download-panel-capture') {
        (async () => {
            if (!await isTrustedGrafanaContentSender(_sender)
                || typeof message.dataUrl !== 'string'
                || !message.dataUrl.startsWith('data:image/png;base64,')) {
                throw new Error('Недоверенный запрос сохранения снимка Grafana.');
            }
            const safeName = String(message.filename || 'grafana_panel.png').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
            const downloadId = await chrome.downloads.download({
                url: message.dataUrl, filename: safeName, saveAs: false
            });
            return { ok: Number.isInteger(downloadId), downloadId };
        })().then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (message?.type === 'dashbridge-save-grafana-panel') {
        queueGrafanaPanelSave(message, _sender)
            .then(result => sendResponse({ ok: true, ...result }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (message?.type === 'dashbridge-profile-commit') {
        queueDashBridgeProfilePatch(message, _sender)
            .then(result => sendResponse({ ok: true, ...result }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (message?.type === 'dashbridge-storage-commit') {
        if (!isTrustedStorageCommit(message, _sender)) {
            sendResponse({ ok: false, error: 'Untrusted storage commit' });
            return undefined;
        }
        queueStorageCommit(message.values)
            .then(() => sendResponse({ ok: true, channel: message.channel || null, revision: message.revision || 0 }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (message && message.type === 'dashbridge-ensure-iframe-rules' && _sender.tab) {
        const expectedUrl = chrome.runtime.getURL('pages/dashbridge/dashbridge.html');
        if (typeof _sender.tab.url !== 'string' || !_sender.tab.url.startsWith(expectedUrl)) {
            sendResponse({ ok: false, error: 'Unexpected sender' });
            return undefined;
        }
        syncGrafanaInfrastructure()
            .then(details => sendResponse({
                ok: !details.rules.truncated,
                ...details.rules,
                runtimeMatchCount: details.registration.matchCount,
                error: details.rules.truncated
                    ? `Лимит DNR: не установлено правил ${details.rules.omittedRuleCount}` : null
            }))
            .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
    }
    if (message && message.type === 'dashbridge-gui-capture-ready' && _sender.tab) {
        guiCaptureController.markReady(_sender.tab.id);
        return undefined;
    }
    if (message && message.type === 'dashbridge-popup-capture-size' && _sender.tab && _sender.tab.windowId) {
        const width = Math.min(480, Math.max(366, Number(message.width) || 366));
        const height = Math.min(1500, Math.max(420, Number(message.height) || 420));
        chrome.windows.update(_sender.tab.windowId, { state: 'normal', width, height });
        return undefined;
    }
    if (message && message.type === 'dashbridge-capture-gui') {
        if (!isTrustedExtensionPage(_sender, 'pages/popup/popup.html')) {
            sendResponse({ ok: false, error: 'Unexpected sender' });
            return undefined;
        }
        guiCaptureController.collect()
            .then(count => sendResponse({ ok: true, count }))
            .catch(error => {
                const messageText = error && error.message ? error.message : String(error);
                console.error('GUI screenshot collection error:', messageText, error);
                chrome.storage.local.set({ guiCaptureStatus: { state: 'error', message: messageText, updatedAt: Date.now() } });
                sendResponse({ ok: false, error: error.message || String(error) });
            });
        return true;
    }
    return undefined;
});
