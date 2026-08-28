// Durable profile persistence, independent from Dashboard rendering.
// Keep a per-tab baseline so concurrent DashBridge tabs commit only the
// profiles they actually changed instead of replacing one stale whole array.
const dashBridgeProfileFingerprint = value => JSON.stringify(value);
let dashBridgeProfileBaseline = new Map();

const dashBridgeProfilePatchWrite = (payload, revision) => new Promise((resolve, reject) => {
    const currentById = new Map(payload.profiles.map(profile => [profile.id, profile]));
    const upserts = payload.profiles.filter(profile =>
        dashBridgeProfileBaseline.get(profile.id) !== dashBridgeProfileFingerprint(profile));
    const deleteProfileIds = [...dashBridgeProfileBaseline.keys()].filter(id => !currentById.has(id));
    chrome.runtime.sendMessage({
        type: 'dashbridge-profile-commit', revision,
        activeProfileId: payload.activeProfileId,
        upserts,
        deleteProfileIds
    }, response => {
        if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
        }
        if (!response?.ok) {
            reject(new Error(response?.error || 'Profile storage broker rejected the commit'));
            return;
        }
        upserts.forEach(profile => dashBridgeProfileBaseline.set(
            profile.id, dashBridgeProfileFingerprint(profile)
        ));
        deleteProfileIds.forEach(id => dashBridgeProfileBaseline.delete(id));
        resolve({ ...response, revision });
    });
});
const dashBridgeProfileWriter = DashBridgeStorageWriter.create(null, {
    durableWrite: dashBridgeProfilePatchWrite
});
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
        dashBridgeProfileBaseline = new Map(profiles.map(profile => [
            profile.id, dashBridgeProfileFingerprint(profile)
        ]));
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
        return dashBridgeProfileWriter.write({
            profiles, activeProfileId
        });
    },
    flush() { return dashBridgeProfileWriter.flush(); },
    checkpoint() { return dashBridgeProfileWriter.checkpoint(); }
};
