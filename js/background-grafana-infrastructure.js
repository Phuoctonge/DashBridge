(function initBackgroundGrafanaInfrastructure(root) {
    'use strict';

    const LEGACY_RULE_ID_START = 1000;
    const LEGACY_RULE_ID_END = 1099;
    const SESSION_RULE_ID_START = 2000;
    const SESSION_RULE_LIMIT = 4000;
    const MAIN_SCRIPT_ID = 'dashbridge-grafana-main-runtime-v1';

    function create({ chromeRef = chrome, runtimeManifest = root.DashBridgeGrafanaRuntimeManifest,
        dnrRules = root.DashBridgeDnrRules, settingsDefaults = root.getGrafanaSettingsDefaults,
        normalizeHost = root.normalizeHttpHost, parseUrl = root.parseHttpUrl } = {}) {
        if (!chromeRef?.runtime || !chromeRef?.tabs || !chromeRef?.scripting
            || !chromeRef?.declarativeNetRequest || !chromeRef?.storage?.sync
            || !Array.isArray(runtimeManifest?.files)
            || typeof runtimeManifest?.matchesForHostname !== 'function'
            || typeof dnrRules?.planSessionRules !== 'function'
            || typeof settingsDefaults !== 'function' || typeof normalizeHost !== 'function'
            || typeof parseUrl !== 'function') {
            throw new TypeError('Background Grafana infrastructure dependencies are incomplete');
        }
        const runtimeFiles = runtimeManifest.files;
        let registrationQueue = Promise.resolve();
        let rulesQueue = Promise.resolve();

        const getHosts = async () => {
            const fallback = settingsDefaults().grafanaIframeDomains;
            const { grafanaIframeDomains = fallback } = await chromeRef.storage.sync.get('grafanaIframeDomains');
            return [...new Set((Array.isArray(grafanaIframeDomains) ? grafanaIframeDomains : [])
                .map(normalizeHost).filter(Boolean))].slice(0, 100);
        };

        const isTrustedContentSender = async sender => {
            if (sender?.id !== chromeRef.runtime.id || !sender.tab || sender.frameId !== 0
                || typeof sender.url !== 'string') return false;
            let url;
            try { url = new URL(sender.url); } catch { return false; }
            if (!['http:', 'https:'].includes(url.protocol)
                || !/(?:^|\/)d(?:-solo)?(?:\/|$)/.test(url.pathname)) return false;
            const hosts = await getHosts();
            return hosts.some(host => host === url.host.toLowerCase() || host === url.hostname.toLowerCase());
        };

        const syncRegistration = async () => {
            const hosts = await getHosts();
            const hostnames = [...new Set(hosts.map(host => parseUrl(host)?.hostname.toLowerCase()).filter(Boolean))];
            const matches = hostnames.flatMap(runtimeManifest.matchesForHostname);
            const existing = await chromeRef.scripting.getRegisteredContentScripts({ ids: [MAIN_SCRIPT_ID] });
            const current = existing[0];
            const sameList = (left, right) => JSON.stringify([...(left || [])].sort())
                === JSON.stringify([...(right || [])].sort());
            if (current && sameList(current.matches, matches) && sameList(current.js, runtimeFiles)
                && current.allFrames === true && current.runAt === 'document_start' && current.world === 'MAIN') {
                return { matchCount: matches.length, unchanged: true };
            }
            if (existing.length) await chromeRef.scripting.unregisterContentScripts({ ids: [MAIN_SCRIPT_ID] });
            if (!matches.length) return { matchCount: 0 };
            await chromeRef.scripting.registerContentScripts([{
                id: MAIN_SCRIPT_ID, matches, js: runtimeFiles, allFrames: true,
                runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true,
            }]);
            return { matchCount: matches.length };
        };

        const queueRegistrationSync = () => {
            registrationQueue = registrationQueue.catch(() => undefined).then(syncRegistration);
            return registrationQueue;
        };

        const isAllowedFrameUrl = (value, allowedHostnames) => {
            let url;
            try { url = new URL(value); } catch { return false; }
            return ['http:', 'https:'].includes(url.protocol)
                && allowedHostnames.has(url.hostname.toLowerCase())
                && /(?:^|\/)d(?:-solo)?(?:\/|$)/.test(url.pathname);
        };

        const backfillOpenFrames = async () => {
            const hosts = await getHosts();
            const allowedHostnames = new Set(hosts.map(host => parseUrl(host)?.hostname.toLowerCase()).filter(Boolean));
            if (!allowedHostnames.size) return { scannedTabs: 0, injectedFrames: 0, failedTabs: 0 };
            const tabs = await chromeRef.tabs.query({});
            let scannedTabs = 0;
            let injectedFrames = 0;
            let failedTabs = 0;
            for (const tab of tabs) {
                if (!Number.isInteger(tab.id)) continue;
                scannedTabs += 1;
                try {
                    const probes = await chromeRef.scripting.executeScript({
                        target: { tabId: tab.id, allFrames: true }, world: 'MAIN',
                        func: () => ({
                            url: location.href,
                            loaded: window.__dashbridgePanelToolsRuntimeLoaded === true,
                            captureOutputReady: typeof window.DashBridgeGrafanaCaptureOutput?.fitPreparedSize === 'function',
                        }),
                    });
                    const frameIds = probes
                        .filter(probe => isAllowedFrameUrl(probe.result?.url, allowedHostnames)
                            && (probe.result?.loaded !== true || probe.result?.captureOutputReady !== true))
                        .map(probe => probe.frameId).filter(Number.isInteger);
                    if (!frameIds.length) continue;
                    const target = { tabId: tab.id, frameIds: [...new Set(frameIds)] };
                    await chromeRef.scripting.executeScript({
                        target, world: 'MAIN', func: () => { window.__dashbridgePanelToolsAllowTop = true; },
                    });
                    await chromeRef.scripting.executeScript({ target, world: 'MAIN', files: runtimeFiles });
                    injectedFrames += target.frameIds.length;
                } catch (_) {
                    failedTabs += 1;
                }
            }
            return { scannedTabs, injectedFrames, failedTabs };
        };

        const getDashBridgeTabIds = async () => {
            const dashbridgeUrl = chromeRef.runtime.getURL('pages/dashbridge/dashbridge.html');
            const tabs = await chromeRef.tabs.query({});
            return tabs.filter(tab => typeof tab.url === 'string' && tab.url.startsWith(dashbridgeUrl))
                .map(tab => tab.id).filter(Number.isInteger);
        };

        const removeLegacyRules = async () => {
            const dynamicRules = await chromeRef.declarativeNetRequest.getDynamicRules();
            const removeRuleIds = dynamicRules
                .filter(rule => rule.id >= LEGACY_RULE_ID_START && rule.id <= LEGACY_RULE_ID_END)
                .map(rule => rule.id);
            if (removeRuleIds.length) {
                await chromeRef.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
            }
        };

        const syncRules = async () => {
            const [hosts, tabIds, existingRules] = await Promise.all([
                getHosts(), getDashBridgeTabIds(), chromeRef.declarativeNetRequest.getSessionRules(),
            ]);
            const removeRuleIds = existingRules
                .filter(rule => rule.id >= SESSION_RULE_ID_START
                    && rule.id < SESSION_RULE_ID_START + SESSION_RULE_LIMIT)
                .map(rule => rule.id);
            const plan = dnrRules.planSessionRules(hosts, tabIds, {
                startId: SESSION_RULE_ID_START, maxRules: SESSION_RULE_LIMIT,
            });
            await chromeRef.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: plan.rules });
            await removeLegacyRules();
            return {
                ruleCount: plan.rules.length, tabCount: tabIds.length, hostCount: hosts.length,
                desiredRuleCount: plan.desiredRuleCount, omittedRuleCount: plan.omittedRuleCount,
                truncated: plan.truncated, maxRules: plan.maxRules,
            };
        };

        const queueRulesSync = () => {
            rulesQueue = rulesQueue.catch(() => undefined).then(syncRules);
            return rulesQueue;
        };

        const sync = async ({ backfillOpenFrames: shouldBackfill = false } = {}) => {
            const registration = await queueRegistrationSync();
            const backfill = shouldBackfill
                ? await backfillOpenFrames()
                : { skipped: true, scannedTabs: 0, injectedFrames: 0, failedTabs: 0 };
            const rules = await queueRulesSync();
            return { registration, backfill, rules };
        };

        return Object.freeze({ getHosts, isTrustedContentSender, queueRulesSync, sync });
    }

    root.DashBridgeBackgroundGrafanaInfrastructure = Object.freeze({ create });
})(globalThis);
