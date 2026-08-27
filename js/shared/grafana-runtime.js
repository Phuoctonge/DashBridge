const DASHBRIDGE_GRAFANA_MAIN_RUNTIME_FILES = DashBridgeGrafanaRuntimeManifest.files;

function dashBridgeRuntimeRegistrationId(url) {
    let hash = 2166136261;
    for (const character of url.hostname) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `dashbridge-grafana-explicit-${(hash >>> 0).toString(16)}`;
}

async function ensureEarlyGrafanaRuntimeForUrl(value) {
    let url;
    try { url = new URL(value); } catch { return { ok: false, reason: 'invalid-url' }; }
    if (!['http:', 'https:'].includes(url.protocol) || !/(?:^|\/)d(?:-solo)?(?:\/|$)/.test(url.pathname)) {
        return { ok: false, reason: 'unsupported-page' };
    }
    const permanent = await chrome.scripting.getRegisteredContentScripts({ ids: ['dashbridge-grafana-main-runtime-v1'] });
    const coveredByPermanentRegistration = permanent.some(script => (script.matches || [])
        .some(pattern => pattern.includes(`://${url.hostname.toLowerCase()}/`)));
    if (coveredByPermanentRegistration) return { ok: true, id: permanent[0].id, alreadyRegistered: true };
    const id = dashBridgeRuntimeRegistrationId(url);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (!existing.length) {
        await chrome.scripting.registerContentScripts([{
            id,
            matches: DashBridgeGrafanaRuntimeManifest.matchesForHostname(url.hostname),
            js: [...DASHBRIDGE_GRAFANA_MAIN_RUNTIME_FILES],
            allFrames: true,
            runAt: 'document_start',
            world: 'MAIN',
            persistAcrossSessions: false
        }]);
    }
    return { ok: true, id, alreadyRegistered: existing.length > 0 };
}

async function ensureGrafanaRuntime(tabId, frameIds = null) {
    const tab = await chrome.tabs.get(tabId);
    let url;
    try { url = new URL(tab?.url || ''); } catch { return { ok: false, reason: 'invalid-url' }; }
    if (!['http:', 'https:'].includes(url.protocol) || !/(?:^|\/)d(?:-solo)?(?:\/|$)/.test(url.pathname)) {
        return { ok: false, reason: 'unsupported-page' };
    }
    const target = { tabId };
    if (Array.isArray(frameIds) && frameIds.length) target.frameIds = [...new Set(frameIds.filter(Number.isInteger))];
    await chrome.scripting.executeScript({
        target, world: 'MAIN',
        func: () => { window.__dashbridgePanelToolsAllowTop = true; }
    });
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: [...DASHBRIDGE_GRAFANA_MAIN_RUNTIME_FILES] });
    const probe = await chrome.scripting.executeScript({
        target, world: 'MAIN',
        func: () => ({
            loaded: window.__dashbridgePanelToolsRuntimeLoaded === true,
            generation: window.__dashbridgePanelToolsRuntimeGeneration || 0,
            interceptorInstalled: window.__dashbridgeCardDataInterceptor === true
        })
    });
    return { ok: probe.length > 0 && probe.every(item => item.result?.loaded), frames: probe.map(item => item.result) };
}
