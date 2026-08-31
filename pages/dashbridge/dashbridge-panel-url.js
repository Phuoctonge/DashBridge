'use strict';

(() => {
    function isSupportedPanelUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
            return false;
        }
    }

    // DashBridge cards intentionally retain dashboard variables and time state,
    // while forcing the single-panel route and hiding the native Grafana chrome.
    function normalizeGrafanaPanelUrl(value) {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            throw new Error('Поддерживаются только URL с протоколом http или https.');
        }

        const hasPanelId = url.searchParams.has('viewPanel') || url.searchParams.has('panelId');
        if (hasPanelId) {
            if (url.pathname.includes('/d/')) url.pathname = url.pathname.replace('/d/', '/d-solo/');
            if (url.searchParams.has('viewPanel')) {
                const panelId = url.searchParams.get('viewPanel');
                url.searchParams.delete('viewPanel');
                url.searchParams.set('panelId', panelId);
            }
        } else if (url.pathname.includes('/d-solo/')) {
            // Grafana renders an empty solo route when no panel ID is present.
            url.pathname = url.pathname.replace('/d-solo/', '/d/');
        }

        url.searchParams.set('kiosk', 'tv');
        url.searchParams.set('dashbridge', '1');
        return url.toString();
    }

    function buildDashBridgeSoloPanelUrl(dashboardUrl, panelId) {
        const url = new URL(dashboardUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            throw new Error('Поддерживаются только URL с протоколом http или https.');
        }

        if (url.pathname.includes('/d/')) {
            url.pathname = url.pathname.replace('/d/', '/d-solo/');
        } else if (!url.pathname.includes('/d-solo/')) {
            throw new Error('Укажите ссылку Grafana вида /d/... или /d-solo/....');
        }

        url.searchParams.delete('viewPanel');
        url.searchParams.delete('editPanel');
        url.searchParams.set('panelId', panelId);
        url.searchParams.set('kiosk', 'tv');
        url.searchParams.set('dashbridge', '1');
        return url.toString();
    }

    function getProfilePanelIdentity(value) {
        const grafanaIdentity = window.DashBridgeGrafanaPanelIdentity?.fromUrl(value) || '';
        if (grafanaIdentity) return grafanaIdentity;
        try {
            const url = new URL(value);
            ['from', 'to', 'refresh', 'theme', 'kiosk', 'dashbridge'].forEach(key => url.searchParams.delete(key));
            url.hash = '';
            url.searchParams.sort();
            return url.toString();
        } catch {
            return String(value || '');
        }
    }

    function parseQuickPanelIds(value) {
        const tokens = String(value || '').split(',').map(token => token.trim()).filter(Boolean);
        const invalid = tokens.filter(token => !/^\d+$/.test(token) || Number(token) < 1);
        if (invalid.length) throw new Error(`Некорректные ID панелей: ${invalid.join(', ')}`);
        return [...new Set(tokens)];
    }

    window.DashBridgePanelUrl = Object.freeze({
        isSupportedPanelUrl,
        normalizeGrafanaPanelUrl,
        buildDashBridgeSoloPanelUrl,
        getProfilePanelIdentity,
        parseQuickPanelIds,
    });
})();
