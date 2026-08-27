// Durable profile persistence, independent from Dashboard rendering.
const dashBridgeProfileWriter = DashBridgeStorageWriter.createLocal();
const DashBridgeProfileStore = {
    async load() {
        const result = await chrome.storage.local.get(['dashbridge_profiles', 'dashbridge_activeProfileId', 'dashbridge_rejected_profiles_backup']);
        const normalized = DashBridgeLocalStateSchema.normalizeProfiles(
            Array.isArray(result.dashbridge_profiles) ? result.dashbridge_profiles : [],
            { mode: 'load' }
        );
        const profiles = normalized.items.length
            ? normalized.items : [{ id: crypto.randomUUID(), name: 'Default', panels: [] }];
        const activeProfileId = profiles.some(item => item.id === result.dashbridge_activeProfileId)
            ? result.dashbridge_activeProfileId : profiles[0].id;
        if ((normalized.skippedProfiles || normalized.skippedPanels) && !result.dashbridge_rejected_profiles_backup) {
            await chrome.storage.local.set({
                dashbridge_rejected_profiles_backup: {
                    createdAt: new Date().toISOString(),
                    dashbridge_profiles: result.dashbridge_profiles,
                    dashbridge_activeProfileId: result.dashbridge_activeProfileId
                }
            }).catch(error => console.warn('Не удалось сохранить backup повреждённых профилей:', error));
        }
        return { profiles, activeProfileId, skippedProfiles: normalized.skippedProfiles, skippedPanels: normalized.skippedPanels };
    },
    async save(profiles, activeProfileId) {
        if (!Array.isArray(profiles) || !profiles.some(profile => profile?.id === activeProfileId)) {
            throw new TypeError('Активный профиль отсутствует в сохраняемом списке.');
        }
        return dashBridgeProfileWriter.write({ dashbridge_profiles: profiles, dashbridge_activeProfileId: activeProfileId });
    },
    flush() { return dashBridgeProfileWriter.flush(); },
    checkpoint() { return dashBridgeProfileWriter.checkpoint(); }
};
