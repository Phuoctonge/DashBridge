(function initBackgroundProfileStorage(root) {
    'use strict';

    const STORAGE_COMMIT_KEYS = new Set([
        'dashbridge_profiles', 'dashbridge_activeProfileId',
        'jiraWorklogs', 'jiraSortOrder', 'jiraIssueCache', 'batchState',
    ]);

    function create({ chromeRef = chrome, localStateSchema = root.DashBridgeLocalStateSchema,
        panelIdentity = root.DashBridgeGrafanaPanelIdentity, grafanaInfrastructure,
        isTrustedExtensionPage, cryptoRef = crypto } = {}) {
        if (!chromeRef?.runtime || !chromeRef?.storage?.local
            || typeof localStateSchema?.normalizeProfiles !== 'function'
            || typeof panelIdentity?.normalizePanelId !== 'function'
            || typeof panelIdentity?.fromUrl !== 'function'
            || typeof grafanaInfrastructure?.getHosts !== 'function'
            || typeof isTrustedExtensionPage !== 'function'
            || typeof cryptoRef?.randomUUID !== 'function') {
            throw new TypeError('Background profile storage dependencies are incomplete');
        }
        let commitQueue = Promise.resolve();

        const enqueue = operation => {
            let result;
            commitQueue = commitQueue.catch(() => undefined)
                .then(async () => { result = await operation(); });
            return commitQueue.then(() => result);
        };

        const queueCommit = values => enqueue(() => chromeRef.storage.local.set(values));

        const commitProfilePatch = async (message, sender) => {
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
            const normalizedUpserts = localStateSchema.normalizeProfiles(message.upserts, { mode: 'load' });
            if (normalizedUpserts.skippedProfiles || normalizedUpserts.skippedPanels
                || normalizedUpserts.items.length !== message.upserts.length
                || normalizedUpserts.items.some(profile => deleteProfileIds.has(profile.id))) {
                throw new Error('Некорректное изменение профилей.');
            }

            const stored = await chromeRef.storage.local.get(['dashbridge_profiles', 'dashbridge_activeProfileId']);
            const normalizedStored = localStateSchema.normalizeProfiles(
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
            await chromeRef.storage.local.set({ dashbridge_profiles: profiles, dashbridge_activeProfileId: activeProfileId });
            return { profileCount: profiles.length, activeProfileId };
        };

        const normalizePanelUrl = (sourceUrl, panelId) => {
            const url = new URL(sourceUrl);
            if (url.pathname.includes('/d/')) url.pathname = url.pathname.replace('/d/', '/d-solo/');
            if (!url.pathname.includes('/d-solo/')) throw new Error('Открыта не страница дашборда Grafana.');
            url.searchParams.delete('viewPanel');
            url.searchParams.delete('editPanel');
            url.searchParams.set('panelId', panelIdentity.normalizePanelId(panelId));
            url.searchParams.set('kiosk', 'tv');
            url.searchParams.set('dashbridge', '1');
            return url.toString();
        };

        const savePanel = async (message, sender) => {
            if (sender?.id !== chromeRef.runtime.id || !sender.tab || sender.frameId !== 0
                || typeof sender.url !== 'string' || !/^\d+$/.test(String(message?.panelId || ''))
                || String(message.panelId).length > 12) {
                throw new Error('Недоверенный запрос сохранения панели.');
            }
            const source = new URL(sender.url);
            const allowedHosts = await grafanaInfrastructure.getHosts();
            if (!['http:', 'https:'].includes(source.protocol)
                || !allowedHosts.some(host => host === source.host.toLowerCase()
                    || host === source.hostname.toLowerCase())) {
                throw new Error('Этот домен Grafana не разрешён в настройках DashBridge.');
            }
            const title = String(message.title || 'Панель Grafana')
                .replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 240) || 'Панель Grafana';
            const requestedProfileId = typeof message.profileId === 'string' ? message.profileId : '';
            const newProfileName = typeof message.newProfileName === 'string'
                ? message.newProfileName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';
            if ((!requestedProfileId && !newProfileName) || (requestedProfileId && newProfileName)) {
                throw new Error('Выберите профиль или укажите название нового.');
            }

            const stored = await chromeRef.storage.local.get(['dashbridge_profiles', 'dashbridge_activeProfileId']);
            const normalized = localStateSchema.normalizeProfiles(
                Array.isArray(stored.dashbridge_profiles) ? stored.dashbridge_profiles : [], { mode: 'load' }
            );
            const profiles = normalized.items;
            let profile = requestedProfileId ? profiles.find(item => item.id === requestedProfileId) : null;
            let createdProfile = false;
            if (requestedProfileId && !profile) throw new Error('Выбранный профиль больше не существует.');
            if (!profile) {
                createdProfile = true;
                profile = {
                    id: cryptoRef.randomUUID(), name: newProfileName, panels: [],
                    timeState: { from: 'now-1h', to: 'now', refresh: '' },
                };
                profiles.push(profile);
            }

            const src = normalizePanelUrl(sender.url, String(message.panelId));
            const identity = panelIdentity.fromUrl(src);
            const duplicate = profile.panels.some(panel => panelIdentity.fromUrl(panel.src) === identity);
            if (!duplicate) profile.panels.push({
                id: cryptoRef.randomUUID(), src, title, width: '50%', height: '350px',
            });
            const activeProfileId = !createdProfile
                && profiles.some(item => item.id === stored.dashbridge_activeProfileId)
                ? stored.dashbridge_activeProfileId : profile.id;
            await chromeRef.storage.local.set({ dashbridge_profiles: profiles, dashbridge_activeProfileId: activeProfileId });
            return { profileId: profile.id, profileName: profile.name, duplicate };
        };

        const isTrustedCommit = (message, sender) => {
            const extensionRoot = chromeRef.runtime.getURL('');
            return sender?.id === chromeRef.runtime.id
                && typeof sender.url === 'string' && sender.url.startsWith(extensionRoot)
                && message?.area === 'local' && message.values !== null
                && typeof message.values === 'object' && !Array.isArray(message.values)
                && Object.keys(message.values).length > 0
                && Object.keys(message.values).every(key => STORAGE_COMMIT_KEYS.has(key));
        };

        return Object.freeze({
            isTrustedCommit,
            queueCommit,
            queuePanelSave: (message, sender) => enqueue(() => savePanel(message, sender)),
            queueProfilePatch: (message, sender) => enqueue(() => commitProfilePatch(message, sender)),
        });
    }

    root.DashBridgeBackgroundProfileStorage = Object.freeze({ create });
})(globalThis);
