(function initDashBridgeDnrRules(root) {
    'use strict';
    function planSessionRules(hosts, tabIds, options = {}) {
        const startId = Number.isInteger(options.startId) ? options.startId : 2000;
        // Chrome limits regex rules to 1000; report truncation instead of rejecting the whole update.
        const maxRules = Math.min(1000, Number.isInteger(options.maxRules) ? options.maxRules : 1000);
        const normalizedHosts = [...new Set((hosts || [])
            .map(host => String(host || '').trim().toLowerCase()).filter(Boolean))].sort();
        const normalizedTabIds = [...new Set((tabIds || []).filter(Number.isInteger))]
            .sort((left, right) => left - right);
        // One host rule covers all allowed tabs; do not spend a regex slot per tab.
        const desiredRuleCount = normalizedTabIds.length ? normalizedHosts.length : 0;
        const rules = [];
        if (normalizedTabIds.length) {
            for (const host of normalizedHosts) {
                if (rules.length >= maxRules) break;
                rules.push({
                    id: startId + rules.length,
                    priority: 1,
                    action: { type: 'modifyHeaders', responseHeaders: [
                        { header: 'x-frame-options', operation: 'remove' },
                        { header: 'content-security-policy', operation: 'remove' }
                    ] },
                    condition: { regexFilter: '^https?://' + host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                        + (/^\[[^\]]+\]:\d+$|^[^:]+:\d+$/.test(host) ? '/' : '(:[0-9]+)?/'),
                        resourceTypes: ['sub_frame'], tabIds: normalizedTabIds,
                        ...(options.initiatorDomain ? { initiatorDomains: [options.initiatorDomain] } : {}) }
                });
            }
        }
        return {
            rules,
            desiredRuleCount,
            installedRuleCount: rules.length,
            omittedRuleCount: Math.max(0, desiredRuleCount - rules.length),
            truncated: rules.length < desiredRuleCount,
            maxRules,
            hostCount: normalizedHosts.length,
            tabCount: normalizedTabIds.length,
        };
    }
    const buildSessionRules = (hosts, tabIds, options = {}) => planSessionRules(hosts, tabIds, options).rules;
    root.DashBridgeDnrRules = Object.freeze({ buildSessionRules, planSessionRules });
})(globalThis);
