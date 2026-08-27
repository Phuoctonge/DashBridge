(function (root) {
    'use strict';

    const VERSION_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/;
    const RELEASE_ORIGIN = 'https://github.com';

    function parseVersion(value) {
        const match = VERSION_PATTERN.exec(String(value || '').trim());
        if (!match) return null;
        const parts = match.slice(1).map(part => Number(part || 0));
        return parts.every(part => Number.isInteger(part) && part >= 0 && part <= 65535)
            ? parts
            : null;
    }

    function compareVersions(left, right) {
        const leftParts = parseVersion(left);
        const rightParts = parseVersion(right);
        if (!leftParts || !rightParts) return null;
        for (let index = 0; index < 4; index += 1) {
            if (leftParts[index] !== rightParts[index]) {
                return leftParts[index] > rightParts[index] ? 1 : -1;
            }
        }
        return 0;
    }

    function isTrustedReleaseUrl(value, expectedPath) {
        try {
            const url = new URL(value);
            return url.origin === RELEASE_ORIGIN
                && url.pathname === expectedPath
                && !url.username && !url.password && !url.search && !url.hash;
        } catch (_error) {
            return false;
        }
    }

    function parseLatestRelease(payload) {
        if (!payload || typeof payload !== 'object' || payload.draft || payload.prerelease) return null;
        const versionParts = parseVersion(payload.tag_name);
        if (!versionParts) return null;
        const version = versionParts.slice(0, 3).join('.');
        const tag = `v${version}`;
        if (payload.tag_name !== tag
            || !isTrustedReleaseUrl(payload.html_url, `/Phuoctonge/DashBridge/releases/tag/${tag}`)) return null;
        const expectedName = `DashBridge-${version}.zip`;
        const asset = Array.isArray(payload.assets)
            ? payload.assets.find(candidate => candidate?.name === expectedName
                && isTrustedReleaseUrl(candidate.browser_download_url,
                    `/Phuoctonge/DashBridge/releases/download/${tag}/${expectedName}`))
            : null;
        if (!asset) return null;
        return Object.freeze({
            version,
            pageUrl: payload.html_url,
            downloadUrl: asset.browser_download_url,
            publishedAt: typeof payload.published_at === 'string' ? payload.published_at : null,
        });
    }

    root.DashBridgeUpdateCheck = Object.freeze({ parseVersion, compareVersions, parseLatestRelease });
})(globalThis);
