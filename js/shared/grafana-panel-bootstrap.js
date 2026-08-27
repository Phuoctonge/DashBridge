(function initDashBridgeGrafanaPanelBootstrap(root) {
    'use strict';

    const PARAM = 'dashbridgePanelTransforms';
    const cleanKeyword = (value, fallback) => {
        const cleaned = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
        return cleaned || fallback;
    };

    function buildState(tools = {}, settings = {}) {
        return {
            invertIdle: !!tools.invertIdle,
            convertMemToUsed: !!tools.convertMemToUsed,
            forceMemByteUnit: !!tools.forceMemByteUnit,
            idleKeyword: cleanKeyword(settings.grafanaIdleKeyword, 'idle'),
            totalKeyword: cleanKeyword(settings.grafanaMemTotalKeyword, 'Total'),
            availKeyword: cleanKeyword(settings.grafanaMemAvailKeyword, 'Available'),
            memCalcMode: settings.grafanaMemCalcMode === 'used' ? 'used' : 'available',
            trimDomain: cleanKeyword(settings.grafanaTrimDomain, '.passport.local:9182'),
            trimDomainEnabled: settings.grafanaTrimDomainEnabled === true
        };
    }

    function applyToUrl(urlValue, tools, settings) {
        try {
            const url = new URL(urlValue);
            const hashParams = new URLSearchParams(url.hash.slice(1));
            const state = buildState(tools, settings);
            const needsBootstrap = state.invertIdle || state.convertMemToUsed || state.forceMemByteUnit || state.trimDomainEnabled
                || !!tools?.cpuCapacityFilterEnabled;
            if (needsBootstrap) hashParams.set(PARAM, JSON.stringify(state));
            else hashParams.delete(PARAM);
            url.hash = hashParams.toString();
            // A fragment is readable by the MAIN-world runtime but is never
            // included in Grafana or datasource HTTP requests.
            url.searchParams.delete(PARAM);
            return url.toString();
        } catch {
            return urlValue;
        }
    }

    function readFromUrl(urlValue) {
        try {
            const url = new URL(urlValue);
            const raw = new URLSearchParams(url.hash.slice(1)).get(PARAM)
                || url.searchParams.get(PARAM);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            return buildState(parsed, {
                grafanaIdleKeyword: parsed.idleKeyword,
                grafanaMemTotalKeyword: parsed.totalKeyword,
                grafanaMemAvailKeyword: parsed.availKeyword,
                grafanaMemCalcMode: parsed.memCalcMode,
                grafanaTrimDomain: parsed.trimDomain,
                grafanaTrimDomainEnabled: parsed.trimDomainEnabled
            });
        } catch {
            return null;
        }
    }

    root.DashBridgeGrafanaPanelBootstrap = Object.freeze({ PARAM, buildState, applyToUrl, readFromUrl });
})(globalThis);
