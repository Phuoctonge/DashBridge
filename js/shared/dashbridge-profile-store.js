// Durable profile persistence, independent from Dashboard rendering.
// Keep a per-tab baseline so concurrent DashBridge tabs commit only the
// profiles they actually changed instead of replacing one stale whole array.
const dashBridgeProfileFingerprint = value => DashBridgeLocalStateSchema.profileFingerprint(
    DashBridgeLocalStateSchema.normalizeProfiles([value], { mode: 'load' }).items[0]);
let dashBridgeProfileBaseline = new Map();
let dashBridgeSystemProfileBaseline = null;

const dashBridgeProfilePatchWrite = (payload, revision) => new Promise((resolve, reject) => {
    const currentById = new Map(payload.profiles.map(profile => [profile.id, profile]));
    const upserts = payload.profiles.filter(profile =>
        dashBridgeProfileBaseline.get(profile.id) !== dashBridgeProfileFingerprint(profile));
    const deleteProfileIds = [...dashBridgeProfileBaseline.keys()].filter(id => !currentById.has(id));
    const expectedProfiles = Object.fromEntries([...upserts.map(profile => profile.id), ...deleteProfileIds]
        .map(id => [id, dashBridgeProfileBaseline.get(id) ?? null]));
    chrome.runtime.sendMessage({
        type: 'dashbridge-profile-commit', revision,
        activeProfileId: payload.activeProfileId,
        upserts,
        expectedProfiles,
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
    async load({ deferBaseline = false } = {}) {
        const read = async () => {
        const result = await chrome.storage.local.get(['dashbridge_profiles', 'dashbridge_activeProfileId', 'dashbridge_rejected_profiles_backup']);
        let rawProfiles = Array.isArray(result.dashbridge_profiles) ? result.dashbridge_profiles : [];
        let seededDefault = false;
        {
            try {
                const response = await fetch('dashbridge-default-profile.json', { cache: 'no-store' });
                if (response.ok) {
                    const seed = await response.json();
                    if (seed && typeof seed === 'object' && Array.isArray(seed.panels)) {
                        const existing = rawProfiles.find(profile => profile?.systemKey === 'dashbridge' || profile?.isSystemDefault === true);
                        const canonical = { ...seed, name: 'DashBridge', systemKey: 'dashbridge', isSystemDefault: true,
                            id: existing?.id || crypto.randomUUID() };
                        let restored = canonical;
                        seededDefault = true;
                        try {
                            if (existing) restored = DashBridgeLocalStateSchema.projectSystemProfile(canonical, existing);
                            seededDefault = !existing || DashBridgeLocalStateSchema.systemProfileFingerprint(existing)
                                !== DashBridgeLocalStateSchema.systemProfileFingerprint(restored);
                        } catch (_) {
                            // Invalid legacy customization must not discard the
                            // packaged panels or prevent structural repair.
                            restored = canonical;
                        }
                        rawProfiles = rawProfiles.filter(profile => profile !== existing);
                        rawProfiles.push(restored);
                    }
                }
            } catch (_) { /* packaged seed is optional in restricted/offline contexts */ }
        }
        const normalized = DashBridgeLocalStateSchema.normalizeProfiles(
            rawProfiles,
            { mode: 'load' }
        );
        const profiles = normalized.items.length
            ? normalized.items : [{ id: crypto.randomUUID(), name: 'DashBridge', panels: [], systemKey: 'dashbridge', isSystemDefault: true }];
        profiles.sort((left, right) => Number(right.systemKey === 'dashbridge') - Number(left.systemKey === 'dashbridge'));
        const systemProfile = profiles.find(profile => profile.systemKey === 'dashbridge');
        const systemProfileRenamed = !!systemProfile && systemProfile.name !== 'DashBridge';
        if (systemProfile) systemProfile.name = 'DashBridge';
        if (seededDefault || systemProfileRenamed || !result.dashbridge_profiles?.length) {
            await chrome.storage.local.set({
                dashbridge_profiles: profiles,
                dashbridge_activeProfileId: result.dashbridge_activeProfileId
                    && profiles.some(profile => profile.id === result.dashbridge_activeProfileId)
                    ? result.dashbridge_activeProfileId : profiles[0].id
            });
        }
        const activeProfileId = profiles.some(item => item.id === result.dashbridge_activeProfileId)
            ? result.dashbridge_activeProfileId : profiles[0].id;
        const baseline = new Map(normalized.items.map(profile => [
            profile.id, dashBridgeProfileFingerprint(profile)
        ]));
        const systemBaseline = normalized.items.find(profile => profile.systemKey === 'dashbridge');
        if ((normalized.skippedProfiles || normalized.skippedPanels) && !result.dashbridge_rejected_profiles_backup) {
            await chrome.storage.local.set({
                dashbridge_rejected_profiles_backup: {
                    createdAt: new Date().toISOString(),
                    dashbridge_profiles: result.dashbridge_profiles,
                    dashbridge_activeProfileId: result.dashbridge_activeProfileId
                }
            }).catch(error => console.warn('Не удалось сохранить backup повреждённых профилей:', error));
        }
        // Cross-tab reads are speculative until the page accepts them. Rejected
        // reads must not authorize a stale draft against a newer CAS baseline.
        const accept = () => {
            dashBridgeProfileBaseline = baseline;
            dashBridgeSystemProfileBaseline = systemBaseline ? structuredClone(systemBaseline) : null;
        };
        if (!deferBaseline) accept();
        return { profiles, activeProfileId, skippedProfiles: normalized.skippedProfiles, skippedPanels: normalized.skippedPanels, accept };
        };
        // Reconciliation with the packaged seed is a write; serialize it with
        // migration and the broker, including the initial read and fetch.
        if (typeof globalThis.navigator?.locks?.request !== 'function') {
            throw new Error('Web Locks недоступны: профили не изменены.');
        }
        return globalThis.navigator.locks.request('dashbridge-profile-storage', read);
    },
    async save(profiles, activeProfileId) {
        if (!Array.isArray(profiles) || !profiles.some(profile => profile?.id === activeProfileId)) {
            throw new TypeError('Активный профиль отсутствует в сохраняемом списке.');
        }
        const nextProfiles = profiles.map(profile => {
            if (profile?.systemKey !== 'dashbridge' || !dashBridgeSystemProfileBaseline) return profile;
            // Runtime metadata must not become edits of the packaged layout.
            return DashBridgeLocalStateSchema.projectSystemProfile(dashBridgeSystemProfileBaseline, profile);
        });
        return dashBridgeProfileWriter.write({ profiles: nextProfiles, activeProfileId });
    },
    flush() { return dashBridgeProfileWriter.flush(); },
    checkpoint() { return dashBridgeProfileWriter.checkpoint(); }
};
