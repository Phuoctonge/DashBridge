(function initDashBridgeAnalyticsClient(root) {
    'use strict';

    const track = (featureId, signal = 'used', dimensions = {}) => {
        try {
            const result = chrome.runtime.sendMessage({ type: 'dashbridge-analytics-track', event: {
                featureId, signal, dimensions
            } });
            result?.catch?.(() => undefined);
        } catch { /* Analytics is fail-open and never affects product behavior. */ }
    };
    const opened = featureId => track(featureId, 'used');
    const outcome = (featureId, result, dimensions = {}) => track(featureId, 'outcome', {
        ...dimensions, outcome: result
    });
    const changed = (featureId, enabled, dimensions = {}) => track(featureId, 'changed', {
        ...dimensions, state: enabled ? 'enabled' : 'disabled'
    });
    const bucket = value => {
        const count = Math.max(0, Number(value) || 0);
        if (count <= 1) return '1';
        if (count <= 5) return '2_5';
        if (count <= 10) return '6_10';
        return '11_plus';
    };

    root.DashBridgeAnalytics = Object.freeze({ track, opened, outcome, changed, bucket });
})(globalThis);
