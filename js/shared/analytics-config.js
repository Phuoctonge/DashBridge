(function initDashBridgeAnalyticsConfig(root) {
    'use strict';
    // The fixed collector accepts only the strict aggregate envelope and does
    // not receive credentials, browsing data or referrer information.
    root.DashBridgeAnalyticsConfig = Object.freeze({
        endpoint: 'https://analytics.tongehub.com/v1/events/batch',
        batchSize: 100,
        queueLimit: 2000,
        // At most one short background request per hour. A large offline
        // backlog is intentionally drained one batch at a time.
        minimumSendIntervalMs: 60 * 60 * 1000,
    });
})(globalThis);
