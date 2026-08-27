(function initDashBridgeGrafanaPanelIdentity(root) {
    'use strict';

    const normalizePanelId = value => {
        const normalized = String(value ?? '').trim().replace(/^panel-/i, '');
        return /^\d+$/.test(normalized) ? normalized : '';
    };

    const fromUrl = (value, explicitPanelId = '') => {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol)) return '';
            const panelId = normalizePanelId(explicitPanelId
                || url.searchParams.get('panelId') || url.searchParams.get('viewPanel'));
            if (!panelId) return '';

            const parts = url.pathname.split('/');
            const dashboardIndex = parts.findIndex(part => part === 'd' || part === 'd-solo');
            if (dashboardIndex < 0 || !parts[dashboardIndex + 1]) return '';
            const dashboardPath = [...parts.slice(0, dashboardIndex), 'd-solo', parts[dashboardIndex + 1]].join('/');
            const identity = new URL(url.origin);
            identity.pathname = dashboardPath;
            const orgId = url.searchParams.get('orgId');
            if (orgId) identity.searchParams.set('orgId', orgId);
            identity.searchParams.set('panelId', panelId);
            identity.searchParams.sort();
            return identity.toString();
        } catch { return ''; }
    };

    root.DashBridgeGrafanaPanelIdentity = Object.freeze({ normalizePanelId, fromUrl });
})(globalThis);
