(function initDashBridgeDnrRules(root) {
    'use strict';
    function planSessionRules(hosts, tabIds, options = {}) {
        const startId = Number.isInteger(options.startId) ? options.startId : 2000;
        const maxRules = Number.isInteger(options.maxRules) ? options.maxRules : 4000;
        const normalizedHosts = [...new Set((hosts || [])
            .map(host => String(host || '').trim().toLowerCase()).filter(Boolean))].sort();
        const normalizedTabIds = [...new Set((tabIds || []).filter(Number.isInteger))]
            .sort((left, right) => left - right);
        const desiredRuleCount = normalizedHosts.length * normalizedTabIds.length;
        const rules = [];
        for (const tabId of normalizedTabIds) {
            for (const host of normalizedHosts) {
                if (rules.length >= maxRules) break;
                rules.push({
                    id: startId + rules.length,
                    priority: 1,
                    action: { type: 'modifyHeaders', responseHeaders: [
                        { header: 'x-frame-options', operation: 'remove' },
                        { header: 'content-security-policy', operation: 'remove' }
                    ] },
                    condition: { urlFilter: `||${host}/`, resourceTypes: ['sub_frame'], tabIds: [tabId] }
                });
            }
            if (rules.length >= maxRules) break;
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
