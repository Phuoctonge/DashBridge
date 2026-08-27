(function () {
    const analysisSettingKeys = new Set([
        'grafanaIdleKeyword', 'grafanaMemTotalKeyword', 'grafanaMemAvailKeyword', 'grafanaMemCalcMode',
        'grafanaCpuPanelTitle', 'grafanaMemPanelTitle', 'grafanaLoadPanelTitle',
        'grafanaCpuCapacityCoefficient',
        'grafanaTrimDomain', 'grafanaTrimDomainEnabled',
        'cpuWarnThreshold', 'cpuCritThreshold', 'memWarnThreshold', 'memCritThreshold',
        'cpuTemplateFull', 'cpuTemplateTop3', 'memTemplateFull', 'memTemplateTop3'
    ]);
    let currentGrafanaSettings = normalizeGrafanaSettings({});
    const syncGrafanaAnalysisSettings = () => {
        if (document.documentElement.dataset.dashbridgeGrafanaMenuEnabled !== 'true') {
            delete document.documentElement.dataset.dashbridgeGrafanaAnalysisSettings;
            return;
        }
        const settings = Object.fromEntries([...analysisSettingKeys].map(key => [key, currentGrafanaSettings[key]]));
        document.documentElement.dataset.dashbridgeGrafanaAnalysisSettings = JSON.stringify(settings);
        document.dispatchEvent(new Event('dashbridgeGrafanaAnalysisSettingsChanged'));
    };
    // MAIN-world Grafana tools cannot call chrome.runtime directly. Expose the
    // packaged mark only on configured Grafana hosts, not on every web page.
    const syncGrafanaIconUrl = allowed => {
        if (allowed) document.documentElement.dataset.dashbridgeIconUrl = chrome.runtime.getURL("icons/dashbridge-mark.svg");
        else delete document.documentElement.dataset.dashbridgeIconUrl;
    };
    const syncGrafanaCaptureDefault = (value, width = currentGrafanaSettings.grafanaCompactExportWidth,
        height = currentGrafanaSettings.grafanaCompactExportHeight) => {
        document.documentElement.dataset.dashbridgeCapturePrepared = String(!!value);
        document.documentElement.dataset.dashbridgeCaptureWidth = String(width);
        document.documentElement.dataset.dashbridgeCaptureHeight = String(height);
        document.dispatchEvent(new CustomEvent('dashbridgeGrafanaCaptureDefaultChanged', {
            detail: { enabled: !!value, width, height }
        }));
    };
    const syncGrafanaMenuScope = domains => {
        const hosts = Array.isArray(domains) ? domains : [];
        const currentHost = location.host.toLowerCase();
        const allowed = hosts.some(host => {
            const normalized = String(host).trim().toLowerCase();
            // Match either exact host (with port) or hostname only
            return normalized === currentHost || normalized === location.hostname.toLowerCase();
        });
        syncGrafanaIconUrl(allowed);
        document.documentElement.dataset.dashbridgeGrafanaMenuEnabled = String(allowed);
        syncGrafanaAnalysisSettings();
        document.dispatchEvent(new Event('dashbridgeGrafanaMenuScopeChanged'));
    };
    chrome.storage.sync.get(getGrafanaSettingsStorageKeys(), data => {
        currentGrafanaSettings = normalizeGrafanaSettings(data);
        syncGrafanaMenuScope(currentGrafanaSettings.grafanaIframeDomains);
        syncGrafanaCaptureDefault(currentGrafanaSettings.grafanaCompactScreenshot);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        Object.entries(changes).forEach(([key, change]) => { currentGrafanaSettings[key] = change.newValue; });
        currentGrafanaSettings = normalizeGrafanaSettings(currentGrafanaSettings);
        if (changes.grafanaIframeDomains) syncGrafanaMenuScope(changes.grafanaIframeDomains.newValue);
        else if (Object.keys(changes).some(key => analysisSettingKeys.has(key))) syncGrafanaAnalysisSettings();
        if (changes.grafanaCompactScreenshot || changes.grafanaCompactExportWidth || changes.grafanaCompactExportHeight) {
            syncGrafanaCaptureDefault(currentGrafanaSettings.grafanaCompactScreenshot);
        }
        if (changes.globalTheme) {
            const theme = changes.globalTheme.newValue === 'dark' ? 'dark' : 'light';
            document.querySelectorAll('.dashbridge-profile-save-overlay')
                .forEach(overlay => { overlay.dataset.dashbridgeTheme = theme; });
        }
    });
    document.addEventListener('dashbridgeCapturePreparedSettingChanged', event => {
        if (document.documentElement.dataset.dashbridgeGrafanaMenuEnabled !== 'true'
            || typeof event.detail?.enabled !== 'boolean') return;
        chrome.storage.sync.set({ grafanaCompactScreenshot: event.detail.enabled });
    });

    let panelCaptureInProgress = false;
    document.addEventListener('dashbridgePanelCaptureRequest', async event => {
        const detail = event.detail || {};
        if (document.documentElement.dataset.dashbridgeGrafanaMenuEnabled !== 'true'
            || panelCaptureInProgress || !['download', 'copy'].includes(detail.action)
            || typeof detail.requestId !== 'string') return;
        panelCaptureInProgress = true;
        let result = { requestId: detail.requestId, ok: false, error: 'capture-failed' };
        try {
            const captured = await chrome.runtime.sendMessage({ type: 'dashbridge-capture-visible-tab' });
            if (!captured?.ok || !captured.dataUrl) throw new Error(captured?.error || 'capture-visible-tab-failed');
            const outputSize = detail.prepared
                ? { width: Number(detail.outputWidth) || 1000, height: Number(detail.outputHeight) || 520 }
                : null;
            const image = await globalThis.DashBridgeGrafanaCaptureOutput.crop(captured.dataUrl, detail.rect, outputSize);
            if (detail.action === 'copy') {
                // The active Grafana document owns focus after the toolbar click.
                // An offscreen extension document never does, so Chromium can
                // reject Clipboard.write there with "Document is not focused".
                await globalThis.DashBridgeGrafanaCaptureOutput.copy(image.blob);
            } else {
                const download = await chrome.runtime.sendMessage({
                    type: 'dashbridge-download-panel-capture', dataUrl: image.dataUrl,
                    filename: globalThis.DashBridgeGrafanaCaptureOutput.filename(detail.title)
                });
                if (!download?.ok) throw new Error(download?.error || 'capture-download-failed');
            }
            result = { requestId: detail.requestId, ok: true };
        } catch (error) {
            result = { requestId: detail.requestId, ok: false, error: error?.message || String(error) };
        } finally {
            panelCaptureInProgress = false;
            document.dispatchEvent(new CustomEvent('dashbridgePanelCaptureResult', { detail: result }));
        }
    });

    const ensureProfileSaveStyles = () => {
        if (document.getElementById('dashbridge-profile-save-style')) return;
        const style = document.createElement('style');
        style.id = 'dashbridge-profile-save-style';
        style.textContent = `
            .dashbridge-profile-save-overlay{--db-primary:#2563eb;--db-primary-hover:#1d4ed8;--db-bg:#f1f5f9;--db-card:#fff;--db-input:#f1f5f9;--db-text:#0f172a;--db-muted:#64748b;--db-border:#cbd5e1;--db-danger:#ef4444;position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:rgba(0,0,0,.6);font:14px/1.4 'Inter',-apple-system,system-ui,sans-serif;color:var(--db-text)}
            .dashbridge-profile-save-overlay[data-dashbridge-theme="dark"]{--db-bg:#0f172a;--db-card:#1e293b;--db-input:#334155;--db-text:#f1f5f9;--db-muted:#cbd5e1;--db-border:#475569}
            .dashbridge-profile-save-dialog,.dashbridge-profile-save-dialog *{box-sizing:border-box}
            .dashbridge-profile-save-dialog{width:min(450px,calc(100vw - 40px));max-height:calc(100dvh - 40px);display:flex;flex-direction:column;gap:16px;overflow:auto;padding:24px;border:1px solid var(--db-border);border-radius:12px;background:var(--db-card);color:var(--db-text);box-shadow:0 20px 25px -5px rgba(0,0,0,.2);transition:background-color .2s,color .2s,border-color .2s}
            .dashbridge-profile-save-dialog h3{margin:0;font-size:17px;font-weight:700;color:var(--db-text)}.dashbridge-profile-save-panel{margin:0;color:var(--db-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .dashbridge-profile-save-field{display:flex;flex-direction:column;gap:8px}.dashbridge-profile-save-field>span{color:var(--db-muted);font-size:13px;font-weight:600}.dashbridge-profile-save-select,.dashbridge-profile-save-new-name{width:100%;height:40px;padding:8px 12px;border:1px solid var(--db-border);border-radius:6px;background:var(--db-input);color:var(--db-text);font:inherit;transition:all .2s ease}.dashbridge-profile-save-select{padding-right:36px;cursor:pointer}.dashbridge-profile-save-select:focus,.dashbridge-profile-save-new-name:focus{outline:2px solid var(--db-primary);outline-offset:1px}.dashbridge-profile-save-select option:disabled{color:var(--db-muted)}.dashbridge-profile-save-new-name{margin-top:-4px}.dashbridge-profile-save-new-name[hidden]{display:none}
            .dashbridge-profile-save-status{min-height:18px;color:var(--db-muted);font-size:13px}.dashbridge-profile-save-status:empty{display:none}.dashbridge-profile-save-status.error{color:var(--db-danger)}.dashbridge-profile-save-actions{display:flex;justify-content:flex-end;gap:8px}.dashbridge-profile-save-actions button{min-height:38px;padding:8px 16px;border:1px solid var(--db-border);border-radius:12px;background:var(--db-bg);color:var(--db-text);font-family:inherit;font-size:14px;font-weight:500;line-height:1.2;cursor:pointer;transition:all .2s ease}.dashbridge-profile-save-actions button:hover{border-color:var(--db-primary);color:var(--db-primary)}.dashbridge-profile-save-actions .primary{border-color:var(--db-primary);background:var(--db-primary);color:#fff}.dashbridge-profile-save-actions .primary:hover{border-color:var(--db-primary-hover);background:var(--db-primary-hover);color:#fff}.dashbridge-profile-save-actions button:disabled{opacity:.6;cursor:progress}@media(max-width:480px){.dashbridge-profile-save-overlay{padding:12px}.dashbridge-profile-save-dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:16px}.dashbridge-profile-save-actions{flex-wrap:wrap}.dashbridge-profile-save-actions button{flex:1 1 8rem}}
        `;
        document.documentElement.appendChild(style);
    };

    const grafanaPanelProfileIdentity = (value, panelId = '') => {
        return globalThis.DashBridgeGrafanaPanelIdentity?.fromUrl(value, panelId) || '';
    };

    const openProfileSaveDialog = async panel => {
        document.querySelector('.dashbridge-profile-save-overlay')?.remove();
        ensureProfileSaveStyles();
        const [stored, themeSettings] = await Promise.all([
            chrome.storage.local.get(['dashbridge_profiles', 'dashbridge_activeProfileId']),
            chrome.storage.sync.get('globalTheme')
        ]);
        const profiles = (Array.isArray(stored.dashbridge_profiles) ? stored.dashbridge_profiles : [])
            .filter(profile => profile && typeof profile.id === 'string' && typeof profile.name === 'string')
            .slice(0, 500);
        const overlay = document.createElement('div');
        overlay.className = 'dashbridge-profile-save-overlay';
        overlay.dataset.dashbridgeTheme = themeSettings.globalTheme === 'dark' ? 'dark' : 'light';
        const dialog = document.createElement('form');
        dialog.className = 'dashbridge-profile-save-dialog';
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
        const heading = document.createElement('h3'); heading.textContent = 'Сохранить в DashBridge';
        const panelName = document.createElement('p'); panelName.className = 'dashbridge-profile-save-panel';
        panelName.textContent = panel.title || 'Панель Grafana'; panelName.title = panelName.textContent;
        const profileField = document.createElement('label'); profileField.className = 'dashbridge-profile-save-field';
        const profileLabel = document.createElement('span'); profileLabel.textContent = 'Профиль';
        const profileSelect = document.createElement('select'); profileSelect.className = 'dashbridge-profile-save-select';
        profileSelect.setAttribute('aria-label', 'Профиль DashBridge');
        const currentPanelIdentity = grafanaPanelProfileIdentity(location.href, panel.panelId);
        let firstAvailableProfileId = '';
        let activeAvailableProfileId = '';
        profiles.forEach(profile => {
            const alreadySaved = Array.isArray(profile.panels) && profile.panels.some(savedPanel =>
                grafanaPanelProfileIdentity(savedPanel?.src) === currentPanelIdentity
            );
            const option = document.createElement('option'); option.value = profile.id;
            option.textContent = alreadySaved ? `${profile.name} (уже есть в этом профиле)` : profile.name;
            option.disabled = alreadySaved;
            if (!alreadySaved && !firstAvailableProfileId) firstAvailableProfileId = profile.id;
            if (!alreadySaved && profile.id === stored.dashbridge_activeProfileId) activeAvailableProfileId = profile.id;
            profileSelect.append(option);
        });
        const newOption = document.createElement('option'); newOption.value = '__new__'; newOption.textContent = '＋ Добавить профиль';
        profileSelect.append(newOption);
        let selectedProfileId = activeAvailableProfileId || firstAvailableProfileId || '__new__';
        profileSelect.value = selectedProfileId;
        profileField.append(profileLabel, profileSelect);
        const newName = document.createElement('input'); newName.type = 'text'; newName.className = 'dashbridge-profile-save-new-name';
        newName.maxLength = 120; newName.placeholder = 'Название нового профиля'; newName.hidden = selectedProfileId !== '__new__';
        newName.setAttribute('aria-label', 'Название нового профиля');
        const status = document.createElement('div'); status.className = 'dashbridge-profile-save-status'; status.setAttribute('role', 'status');
        const actions = document.createElement('div'); actions.className = 'dashbridge-profile-save-actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Отмена';
        const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; save.textContent = 'Сохранить';
        actions.append(cancel, save); dialog.append(heading, panelName, profileField, newName, status, actions); overlay.append(dialog); document.body.append(overlay);
        const close = () => overlay.remove();
        cancel.addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        profileSelect.addEventListener('change', () => {
            selectedProfileId = profileSelect.value;
            newName.hidden = selectedProfileId !== '__new__';
            if (!newName.hidden) newName.focus();
        });
        const onKeyDown = event => { if (event.key === 'Escape') close(); };
        overlay.addEventListener('keydown', onKeyDown);
        dialog.addEventListener('submit', async event => {
            event.preventDefault();
            const creating = selectedProfileId === '__new__';
            const name = newName.value.trim();
            if (!selectedProfileId || (creating && !name)) {
                status.textContent = creating ? 'Введите название нового профиля.' : 'Выберите профиль.';
                status.classList.add('error');
                if (creating) newName.focus();
                return;
            }
            save.disabled = true; cancel.disabled = true; status.classList.remove('error'); status.textContent = 'Сохранение…';
            try {
                const response = await chrome.runtime.sendMessage({
                    type: 'dashbridge-save-grafana-panel', panelId: panel.panelId, title: panel.title,
                    profileId: creating ? '' : selectedProfileId, newProfileName: creating ? name : ''
                });
                if (!response?.ok) throw new Error(response?.error || 'Не удалось сохранить график.');
                status.textContent = response.duplicate
                    ? `График уже есть в профиле «${response.profileName}».`
                    : `Сохранено в профиль «${response.profileName}».`;
                setTimeout(close, 900);
            } catch (error) {
                status.textContent = error?.message || String(error); status.classList.add('error');
                save.disabled = false; cancel.disabled = false;
            }
        });
        (selectedProfileId === '__new__' ? newName : profileSelect).focus();
    };

    document.addEventListener('dashbridgeSavePanelRequest', event => {
        const detail = event.detail || {};
        if (document.documentElement.dataset.dashbridgeGrafanaMenuEnabled !== 'true'
            || !/^\d+$/.test(String(detail.panelId || ''))) return;
        void openProfileSaveDialog({ panelId: String(detail.panelId), title: String(detail.title || '').slice(0, 240) });
    });

    // === 1. Confluence Scroll Fix ===
    const STORAGE_KEY = "confluenceScrollFixEnabled";
    const DOMAINS_KEY = "wikiDomains";
    const IFRAME_IDS_KEY = "wikiIframeIds";
    const SCRIPT_ID = "confluence-fix-loader";

    const defaultDomains = ["itpm-wiki.mos.ru", "wiki.mos-team.ru", "wiki.lanit.ru"];
    const defaultIframeIds = "wysiwygTextarea_ifr, mce_0_ifr";

    chrome.storage.sync.get([STORAGE_KEY, DOMAINS_KEY, IFRAME_IDS_KEY], (data) => {
        const rawDomains = data[DOMAINS_KEY] || defaultDomains.join("\n");
        const allowedDomains = rawDomains.split("\n").map(d => d.trim().toLowerCase()).filter(d => d);
        const currentHost = window.location.hostname.toLowerCase();

        const isAllowed = allowedDomains.some(domain =>
            currentHost === domain || currentHost.endsWith("." + domain)
        );

        if (isAllowed) {
            const getParsedIframeIds = (val) => {
                const str = val || defaultIframeIds;
                return str.split(",").map(id => id.trim()).filter(id => id);
            };

            let currentIframeIds = getParsedIframeIds(data[IFRAME_IDS_KEY]);
            let currentActive = !!data[STORAGE_KEY];

            if (!document.getElementById(SCRIPT_ID)) {
                const script = document.createElement("script");
                script.id = SCRIPT_ID;
                script.src = chrome.runtime.getURL("js/content/inject.js");
                (document.head || document.documentElement).appendChild(script);
            }

            const sendStateToPage = (value, iframeIds) => {
                window.postMessage({
                    type: "SET_CONFLUENCE_FIX",
                    value: !!value,
                    iframeIds: iframeIds
                }, window.location.origin);
            };

            window.addEventListener("message", (event) => {
                if (event.origin !== window.location.origin) return;
                if (event.source !== window) return;
                if (event.data && event.data.type === "INJECT_READY") {
                    sendStateToPage(currentActive, currentIframeIds);
                }
            });

            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== 'sync') return;
                if (changes[IFRAME_IDS_KEY]) {
                    currentIframeIds = getParsedIframeIds(changes[IFRAME_IDS_KEY].newValue);
                }
                if (changes[STORAGE_KEY]) {
                    currentActive = !!changes[STORAGE_KEY].newValue;
                }
                if (changes[STORAGE_KEY] || changes[IFRAME_IDS_KEY]) {
                    sendStateToPage(currentActive, currentIframeIds);
                }
            });
        }
    });

})();
