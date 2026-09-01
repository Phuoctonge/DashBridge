(function initRecorderSettings(root) {
    'use strict';

    const DRAFT_KEY = 'dashbridgeRecorderDraft';
    const SETTINGS_KEY = 'dashbridgeRecorderSettings';

    function create({ ui, storage = chrome.storage.local, setTimer = root.setTimeout,
        clearTimer = root.clearTimeout }) {
        if (!ui?.startUrl || !ui?.disableCache || !ui?.disableCookies
            || typeof storage?.get !== 'function' || typeof storage?.set !== 'function'
            || typeof storage?.remove !== 'function' || typeof setTimer !== 'function'
            || typeof clearTimer !== 'function') {
            throw new TypeError('Recorder settings dependencies are incomplete');
        }
        let saveTimer = null;

        const snapshot = () => ({
            startUrl: String(ui.startUrl.value || '').slice(0, 4096),
            disableCache: ui.disableCache.checked,
            disableCookies: ui.disableCookies.checked,
        });

        const save = async ({ includeDraft = false } = {}) => {
            const settings = snapshot();
            const values = { [SETTINGS_KEY]: settings };
            if (includeDraft) values[DRAFT_KEY] = settings;
            await storage.set(values);
        };

        const cancelScheduled = () => {
            if (saveTimer !== null) clearTimer(saveTimer);
            saveTimer = null;
        };

        const schedule = () => {
            cancelScheduled();
            saveTimer = setTimer(() => {
                saveTimer = null;
                void save().catch(() => undefined);
            }, 250);
        };

        const saveDraft = () => save({ includeDraft: true });

        const restore = async () => {
            try {
                const stored = await storage.get([SETTINGS_KEY, DRAFT_KEY]);
                const persistent = stored?.[SETTINGS_KEY];
                const draft = stored?.[DRAFT_KEY];
                const settings = draft && typeof draft === 'object' ? draft : persistent;
                if (!settings || typeof settings !== 'object') return;
                if (typeof settings.startUrl === 'string') ui.startUrl.value = settings.startUrl.slice(0, 4096);
                if (typeof settings.disableCache === 'boolean') ui.disableCache.checked = settings.disableCache;
                if (typeof settings.disableCookies === 'boolean') ui.disableCookies.checked = settings.disableCookies;
                await save();
                if (draft) await storage.remove(DRAFT_KEY);
            } catch (_) { /* settings restoration is best-effort */ }
        };

        return Object.freeze({ snapshot, save, schedule, saveDraft, restore, cancelScheduled });
    }

    root.DashBridgeRecorderSettings = Object.freeze({ create });
})(globalThis);
