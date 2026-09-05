(function (root) {
    'use strict';

    const API_URL = 'https://api.github.com/repos/Phuoctonge/DashBridge/releases/latest';
    const CACHE_KEY = 'dashbridgeUpdateCheck';
    const INDICATOR_KEY = 'dashbridgeUpdateIndicator';
    const CACHE_TTL_MS = 60 * 60 * 1000;
    const REQUEST_TIMEOUT_MS = 6000;
    let localReloadRequired = false;
    const applyUpdateIndicator = async version => {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'dashbridge-apply-update-indicator', version
            });
            return response?.ok === true && response.applied === true;
        } catch (_error) {
            return false;
        }
    };
    const rememberUpdate = async version => {
        try {
            await chrome.storage.local.set({ [INDICATOR_KEY]: { version } });
            return applyUpdateIndicator(version);
        } catch (_error) {
            return false;
        }
    };
    const forgetUpdate = async () => {
        try {
            await chrome.storage.local.remove(INDICATOR_KEY);
            await applyUpdateIndicator(chrome.runtime.getManifest().version);
        } catch (_error) {
            // Update indication is fail-open for the rest of the popup.
        }
    };

    async function showLocalReloadNotice(diskVersion, currentVersion) {
        localReloadRequired = true;
        await rememberUpdate(diskVersion);
        const notice = document.getElementById('updateNotice');
        const text = document.getElementById('updateNoticeText');
        const button = document.getElementById('downloadUpdateBtn');
        if (!notice || !text || !button) return;
        text.textContent = `Файлы версии ${diskVersion} готовы (запущена ${currentVersion})`;
        button.textContent = 'Перезагрузить расширение';
        root.DashBridgeAnalytics?.track('update.local_reload_required', 'lifecycle', {});
        button.onclick = () => {
            root.DashBridgeAnalytics?.track('update.extension_reloaded', 'lifecycle', {});
            setTimeout(() => chrome.runtime.reload(), 50);
        };
        notice.hidden = false;
    }

    async function checkLocalFiles() {
        const currentVersion = chrome.runtime.getManifest().version;
        try {
            const manifestUrl = `${chrome.runtime.getURL('manifest.json')}?disk-check=${Date.now()}`;
            const response = await fetch(manifestUrl, { cache: 'no-store' });
            if (!response.ok) return;
            const manifest = await response.json();
            if (manifest?.name === 'DashBridge'
                && DashBridgeUpdateCheck.compareVersions(manifest.version, currentVersion) === 1) {
                await showLocalReloadNotice(manifest.version, currentVersion);
            }
        } catch (_error) {
            // A failed disk check must not affect the normal popup startup.
        }
    }

    async function showUpdateNotice(release) {
        if (localReloadRequired) return;
        await rememberUpdate(release.version);
        const notice = document.getElementById('updateNotice');
        const text = document.getElementById('updateNoticeText');
        const button = document.getElementById('downloadUpdateBtn');
        if (!notice || !text || !button) return;
        const currentVersion = chrome.runtime.getManifest().version;
        text.textContent = `Доступна версия ${release.version} (установлена ${currentVersion})`;
        button.onclick = () => {
            root.DashBridgeAnalytics?.opened('update.installer_opened');
            chrome.tabs.create({ url: release.installerUrl });
        };
        root.DashBridgeAnalytics?.track('update.available', 'lifecycle', {});
        notice.hidden = false;
    }

    async function useRelease(release) {
        const currentVersion = chrome.runtime.getManifest().version;
        if (DashBridgeUpdateCheck.compareVersions(release?.version, currentVersion) === 1) {
            await showUpdateNotice(release);
        } else if (!localReloadRequired) {
            await forgetUpdate();
        }
    }

    async function fetchLatestRelease() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(API_URL, {
                headers: { Accept: 'application/vnd.github+json' },
                signal: controller.signal,
                cache: 'no-store',
            });
            if (!response.ok) throw new Error(`GitHub release check failed: ${response.status}`);
            return DashBridgeUpdateCheck.parseLatestRelease(await response.json());
        } finally {
            clearTimeout(timeout);
        }
    }

    async function checkForUpdates() {
        const stored = await chrome.storage.local.get(CACHE_KEY);
        const cached = stored[CACHE_KEY];
        const now = Date.now();
        if (cached?.checkedAt && now - cached.checkedAt < CACHE_TTL_MS) {
            await useRelease(cached.release);
            return;
        }
        try {
            const release = await fetchLatestRelease();
            await chrome.storage.local.set({ [CACHE_KEY]: { checkedAt: now, release } });
            await useRelease(release);
        } catch (_error) {
            // Update availability must never block or add noise to the popup.
            await useRelease(cached?.release);
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        await checkLocalFiles();
        await checkForUpdates();
    });
})(globalThis);
