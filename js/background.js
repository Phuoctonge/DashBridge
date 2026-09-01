// Popup открывается автоматически через "default_popup" в manifest.json.
// Если потребуется кастомный размер окна — убери default_popup из манифеста
// и раскомментируй обработчик ниже:
//
// chrome.action.onClicked.addListener(() => {
//     chrome.windows.create({ url: "pages/popup/popup.html", type: "popup", width: 300, height: 400 });
// });

importScripts('../vendor/jszip.min.js', 'shared/grafana-settings.js', 'shared/url-validation.js', 'shared/dnr-rules.js', 'shared/grafana-runtime-manifest.js', 'shared/local-state-schema.js', 'shared/grafana-panel-identity.js', 'background-grafana-infrastructure.js', 'background-profile-storage.js', 'background-gui-capture.js');

const GRAFANA_TAB_VISUAL_STATE_PREFIX = 'grafanaVisualState:';

function isTrustedExtensionPage(sender, page) {
    if (sender?.id !== chrome.runtime.id || typeof sender.url !== 'string') return false;
    try {
        const actual = new URL(sender.url); const expected = new URL(chrome.runtime.getURL(page));
        return actual.origin === expected.origin && actual.pathname === expected.pathname;
    } catch (_) { return false; }
}

const grafanaInfrastructure = DashBridgeBackgroundGrafanaInfrastructure.create();
const profileStorage = DashBridgeBackgroundProfileStorage.create({
    grafanaInfrastructure, isTrustedExtensionPage,
});

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

chrome.tabs.onRemoved.addListener(tabId => {
    if (!chrome.storage.session) return;
    chrome.storage.session.remove(`${GRAFANA_TAB_VISUAL_STATE_PREFIX}${tabId}`)
        .catch(error => console.warn('Failed to remove Grafana tab visual state:', error));
    grafanaInfrastructure.queueRulesSync()
        .catch(error => console.warn('Failed to remove Grafana iframe tab rules:', error));
});

chrome.runtime.onInstalled.addListener(() => {
    grafanaInfrastructure.sync({ backfillOpenFrames: true })
        .catch(error => console.error('Не удалось подготовить инфраструктуру Grafana:', error));
});

chrome.runtime.onStartup.addListener(() => {
    grafanaInfrastructure.sync({ backfillOpenFrames: true })
        .catch(error => console.error('Не удалось подготовить инфраструктуру Grafana:', error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.grafanaIframeDomains) {
        grafanaInfrastructure.sync({ backfillOpenFrames: true })
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
            if (!await grafanaInfrastructure.isTrustedContentSender(_sender) || !_sender.tab?.windowId) {
                throw new Error('Недоверенный запрос снимка Grafana.');
            }
            return guiCaptureController.captureVisiblePanel(_sender);
        })().then(dataUrl => sendResponse({ ok: !!dataUrl, dataUrl: dataUrl || null }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (message?.type === 'dashbridge-download-panel-capture') {
        (async () => {
            if (!await grafanaInfrastructure.isTrustedContentSender(_sender)
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
        profileStorage.queuePanelSave(message, _sender)
            .then(result => sendResponse({ ok: true, ...result }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (message?.type === 'dashbridge-profile-commit') {
        profileStorage.queueProfilePatch(message, _sender)
            .then(result => sendResponse({ ok: true, ...result }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (message?.type === 'dashbridge-storage-commit') {
        if (!profileStorage.isTrustedCommit(message, _sender)) {
            sendResponse({ ok: false, error: 'Untrusted storage commit' });
            return undefined;
        }
        profileStorage.queueCommit(message.values)
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
        grafanaInfrastructure.sync()
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
