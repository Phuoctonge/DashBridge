(function initDashBridgeBackgroundUpdateIndicator(root) {
    'use strict';

    const STORAGE_KEY = 'dashbridgeUpdateIndicator';
    const NORMAL_ICONS = Object.freeze({ 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' });
    const UPDATE_ICONS = Object.freeze({ 16: 'icons/icon16-update.png', 48: 'icons/icon48-update.png', 128: 'icons/icon128-update.png' });
    const parseVersion = value => {
        const match = String(value || '').trim().match(/^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/);
        return match ? match.slice(1).map(Number) : null;
    };
    const isNewerVersion = (candidate, current) => {
        const next = parseVersion(candidate);
        const installed = parseVersion(current);
        if (!next || !installed) return false;
        for (let index = 0; index < 3; index += 1) {
            if (next[index] !== installed[index]) return next[index] > installed[index];
        }
        return false;
    };

    const create = ({ actionApi = chrome.action, storageArea = chrome.storage.local, runtimeApi = chrome.runtime } = {}) => {
        if (!actionApi?.setIcon || !actionApi?.setBadgeText || !actionApi?.setTitle
            || !storageArea?.get || !storageArea?.remove || !runtimeApi?.getManifest) {
            throw new TypeError('Update indicator dependencies are incomplete');
        }
        const show = async version => {
            await Promise.all([
                actionApi.setIcon({ path: UPDATE_ICONS }),
                actionApi.setBadgeText({ text: '' }),
                actionApi.setTitle({ title: `DashBridge — доступно обновление ${version}` })
            ]);
        };
        const clear = async () => {
            await Promise.all([
                actionApi.setIcon({ path: NORMAL_ICONS }),
                actionApi.setBadgeText({ text: '' }),
                actionApi.setTitle({ title: 'DashBridge' })
            ]);
        };
        const apply = async state => {
            const version = typeof state?.version === 'string' ? state.version : '';
            if (isNewerVersion(version, runtimeApi.getManifest().version)) {
                await show(version);
                return true;
            }
            await clear();
            if (state) await storageArea.remove(STORAGE_KEY);
            return false;
        };
        const restore = async () => {
            const stored = await storageArea.get(STORAGE_KEY);
            return apply(stored[STORAGE_KEY]);
        };
        const handleStorageChange = (changes, areaName) => areaName === 'local' && changes[STORAGE_KEY]
            ? apply(changes[STORAGE_KEY].newValue) : Promise.resolve(false);

        return Object.freeze({ restore, handleStorageChange });
    };

    root.DashBridgeBackgroundUpdateIndicator = Object.freeze({ create, STORAGE_KEY, isNewerVersion });
})(globalThis);
