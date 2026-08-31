(function initDashBridgeProfileController(root) {
    'use strict';

    const TAB_ACTIVE_PROFILE_KEY = 'dashbridge_tab_activeProfileId';

    function create(deps) {
        const {
            profileStore, timeState, renderer, getProfilePanelIdentity, showAlert, showConfirm,
            getProfiles, setProfiles, getActiveProfileId, setActiveProfileId, getPanels, setPanels,
            loadActiveProfileTimeState, syncTimeControlsFromState, renderDashboard,
            panelFrameSignature, adoptPanelState, reconcileDashboardPanelCards
        } = deps;
        if (!profileStore?.load || !timeState?.normalize || !renderer?.renderProfileList
            || typeof getProfiles !== 'function' || typeof setProfiles !== 'function'
            || typeof getPanels !== 'function' || typeof setPanels !== 'function') {
            throw new TypeError('DashBridge profile controller dependencies are incomplete');
        }
        let profilesLoaded = false;
        let storageSyncVersion = 0;

        const getTabActiveProfileId = () => {
            try { return sessionStorage.getItem(TAB_ACTIVE_PROFILE_KEY) || null; }
            catch { return null; }
        };
        const setTabActiveProfileId = id => {
            const normalized = id || null;
            setActiveProfileId(normalized);
            try {
                if (normalized) sessionStorage.setItem(TAB_ACTIVE_PROFILE_KEY, normalized);
                else sessionStorage.removeItem(TAB_ACTIVE_PROFILE_KEY);
            } catch { /* The in-memory selection remains valid when sessionStorage is unavailable. */ }
            return normalized;
        };
        const getActiveProfile = () => {
            const profiles = getProfiles();
            return profiles.find(profile => profile.id === getActiveProfileId()) || profiles[0] || null;
        };
        const saveProfiles = () => profileStore.save(getProfiles(), getActiveProfileId()).then(result => {
            document.documentElement.dataset.dashbridgeStorageDirty = 'false';
            return result;
        }).catch(error => {
            document.documentElement.dataset.dashbridgeStorageDirty = 'true';
            console.error('Не удалось сохранить профили DashBridge:', error);
            return { current: false, error: error.message || String(error) };
        });
        const savePanels = () => {
            const profile = getActiveProfile();
            if (profile) {
                profile.panels = getPanels();
                return saveProfiles();
            }
            return undefined;
        };
        const profileStorageSignature = (profileList, selectedProfileId) => {
            try { return JSON.stringify({ profiles: profileList, activeProfileId: selectedProfileId }); }
            catch { return ''; }
        };
        const dashboardLayoutSignature = profile => {
            try {
                return JSON.stringify({
                    id: profile?.id || '', timeState: timeState.normalize(profile?.timeState),
                    panels: (profile?.panels || []).map(panel => ({
                        id: panel.id, title: panel.title, width: panel.width, height: panel.height,
                        frame: panelFrameSignature(panel)
                    }))
                });
            } catch { return ''; }
        };
        const renderProfileSwitcher = () => {
            renderer.renderProfileList({
                profiles: getProfiles(), activeProfileId: getActiveProfileId(),
                onSelect(id) {
                    document.getElementById('profileDropdown').style.display = 'none';
                    void switchProfile(id);
                }
            });
        };
        const loadProfiles = async () => {
            const stored = await profileStore.load();
            const profiles = stored.profiles;
            setProfiles(profiles);
            const tabActiveProfileId = getTabActiveProfileId();
            setTabActiveProfileId(profiles.some(profile => profile.id === tabActiveProfileId)
                ? tabActiveProfileId : stored.activeProfileId);
            profiles.forEach(profile => { profile.timeState = timeState.normalize(profile.timeState); });
            loadActiveProfileTimeState();
            setPanels([...(getActiveProfile()?.panels || [])]);
            profilesLoaded = true;
            const skipped = (stored.skippedProfiles || 0) + (stored.skippedPanels || 0);
            if (skipped) await showAlert(`Пропущено повреждённых записей DashBridge: ${skipped}. Остальные профили загружены безопасно.`);
        };
        const syncProfilesFromStorage = async () => {
            if (!profilesLoaded) return;
            const syncVersion = ++storageSyncVersion;
            await profileStore.flush();
            if (syncVersion !== storageSyncVersion) return;
            const stored = await profileStore.load();
            if (syncVersion !== storageSyncVersion) return;
            const nextProfiles = stored.profiles;
            nextProfiles.forEach(profile => { profile.timeState = timeState.normalize(profile.timeState); });
            const activeProfileId = getActiveProfileId();
            const nextActiveProfileId = nextProfiles.some(profile => profile.id === activeProfileId)
                ? activeProfileId : nextProfiles.some(profile => profile.id === stored.activeProfileId)
                    ? stored.activeProfileId : nextProfiles[0]?.id || null;
            if (profileStorageSignature(getProfiles(), activeProfileId)
                === profileStorageSignature(nextProfiles, nextActiveProfileId)) return;

            const previousActiveProfileId = activeProfileId;
            const previousPanels = getPanels();
            const previousPanelStates = previousPanels.map(panel => ({
                id: panel.id, title: panel.title, paused: !!panel.paused,
                frameSignature: panelFrameSignature(panel)
            }));
            const previousTimeState = timeState.normalize(getActiveProfile()?.timeState);
            const previousActiveProfileSignature = profileStorageSignature([getActiveProfile()], activeProfileId);
            const previousDashboardLayoutSignature = dashboardLayoutSignature(getActiveProfile());
            setProfiles(nextProfiles); setTabActiveProfileId(nextActiveProfileId);
            let panels = [...(getActiveProfile()?.panels || [])];
            const previousById = new Map(previousPanels.map(panel => [panel.id, panel]));
            const previousStateById = new Map(previousPanelStates.map(state => [state.id, state]));
            panels = panels.map(panel => {
                const previous = previousById.get(panel.id);
                const previousState = previousStateById.get(panel.id);
                const canKeepCardBindings = previous && previousState
                    && previousState.frameSignature === panelFrameSignature(panel)
                    && !(previousState.paused && previousState.title !== panel.title);
                return canKeepCardBindings ? adoptPanelState(previous, panel) : panel;
            });
            setPanels(panels);
            const activeProfile = getActiveProfile();
            if (activeProfile) activeProfile.panels = panels;
            renderProfileSwitcher();
            const activeProfileChanged = previousActiveProfileId !== getActiveProfileId()
                || previousActiveProfileSignature !== profileStorageSignature([getActiveProfile()], getActiveProfileId());
            if (!activeProfileChanged) return;
            if (previousDashboardLayoutSignature === dashboardLayoutSignature(getActiveProfile())) return;
            loadActiveProfileTimeState(); syncTimeControlsFromState();
            const activeProfileSwitched = previousActiveProfileId !== getActiveProfileId();
            const timeStateChanged = JSON.stringify(previousTimeState)
                !== JSON.stringify(timeState.normalize(getActiveProfile()?.timeState));
            if (activeProfileSwitched || timeStateChanged) await renderDashboard();
            else reconcileDashboardPanelCards(previousPanelStates);
        };
        const switchProfile = async id => {
            if (id === getActiveProfileId()) return;
            const currentProfile = getActiveProfile();
            if (currentProfile) currentProfile.panels = getPanels();
            setTabActiveProfileId(id);
            const profile = getActiveProfile();
            setPanels(profile ? [...(profile.panels || [])] : []);
            loadActiveProfileTimeState(); await saveProfiles(); renderProfileSwitcher();
            syncTimeControlsFromState(); await renderDashboard();
        };
        const createProfile = async name => {
            const currentProfile = getActiveProfile();
            if (currentProfile) currentProfile.panels = getPanels();
            const newProfile = { id: crypto.randomUUID(), name: name.trim().slice(0, 120), panels: [], timeState: timeState.defaults() };
            const profiles = getProfiles(); profiles.push(newProfile);
            setTabActiveProfileId(newProfile.id); setPanels([]); loadActiveProfileTimeState();
            await saveProfiles(); renderProfileSwitcher(); syncTimeControlsFromState(); await renderDashboard();
        };
        const renameActiveProfile = newName => {
            const profile = getActiveProfile();
            if (!profile || !newName.trim()) return;
            profile.name = newName.trim().slice(0, 120); void saveProfiles(); renderProfileSwitcher();
        };
        const deleteProfile = async id => {
            const profiles = getProfiles();
            if (profiles.length <= 1) return showAlert('Нельзя удалить единственный профиль.');
            const profile = profiles.find(item => item.id === id);
            if (!profile || !await showConfirm(`Удалить профиль «${profile.name}»?\nВсе панели этого профиля будут потеряны.`)) return;
            const index = profiles.findIndex(item => item.id === id); profiles.splice(index, 1);
            if (getActiveProfileId() === id) {
                const next = profiles[Math.max(0, index - 1)]; setTabActiveProfileId(next.id);
                setPanels([...(next.panels || [])]); loadActiveProfileTimeState(); syncTimeControlsFromState(); await renderDashboard();
            }
            await saveProfiles(); renderProfileSwitcher();
        };
        const getCurrentProfilePanelIdentities = () => new Set(getPanels()
            .map(panel => getProfilePanelIdentity(panel.src)).filter(Boolean));
        const currentProfileHasPanel = value => {
            const identity = getProfilePanelIdentity(value);
            return !!identity && getCurrentProfilePanelIdentities().has(identity);
        };

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || (!changes.dashbridge_profiles && !changes.dashbridge_activeProfileId)) return;
            void syncProfilesFromStorage().catch(error => console.error(
                'Не удалось синхронизировать профили DashBridge между вкладками:', error));
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') void profileStore.flush().catch(() => undefined);
        });
        window.addEventListener('pagehide', () => { void profileStore.checkpoint().catch(() => undefined); });

        return Object.freeze({ getActiveProfile, loadProfiles, saveProfiles, savePanels, syncProfilesFromStorage,
            switchProfile, createProfile, renameActiveProfile, deleteProfile, renderProfileSwitcher,
            getCurrentProfilePanelIdentities, currentProfileHasPanel, setTabActiveProfileId });
    }

    root.DashBridgeProfileController = Object.freeze({ create });
})(globalThis);
