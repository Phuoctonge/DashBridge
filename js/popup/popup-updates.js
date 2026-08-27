(function () {
    'use strict';

    const API_URL = 'https://api.github.com/repos/Phuoctonge/DashBridge/releases/latest';
    const CACHE_KEY = 'dashbridgeUpdateCheck';
    const CACHE_TTL_MS = 60 * 60 * 1000;
    const REQUEST_TIMEOUT_MS = 6000;

    function showUpdateNotice(release) {
        const notice = document.getElementById('updateNotice');
        const text = document.getElementById('updateNoticeText');
        const button = document.getElementById('downloadUpdateBtn');
        if (!notice || !text || !button) return;
        const currentVersion = chrome.runtime.getManifest().version;
        text.textContent = `Доступна версия ${release.version} (установлена ${currentVersion})`;
        button.onclick = () => chrome.tabs.create({ url: release.downloadUrl });
        notice.hidden = false;
    }

    function useRelease(release) {
        const currentVersion = chrome.runtime.getManifest().version;
        if (DashBridgeUpdateCheck.compareVersions(release?.version, currentVersion) === 1) {
            showUpdateNotice(release);
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
            useRelease(cached.release);
            return;
        }
        try {
            const release = await fetchLatestRelease();
            await chrome.storage.local.set({ [CACHE_KEY]: { checkedAt: now, release } });
            useRelease(release);
        } catch (_error) {
            // Update availability must never block or add noise to the popup.
            useRelease(cached?.release);
        }
    }

    document.addEventListener('DOMContentLoaded', () => { void checkForUpdates(); });
})();
