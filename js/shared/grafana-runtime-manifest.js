(function initDashBridgeGrafanaRuntimeManifest(root) {
    'use strict';
    // This order is a runtime dependency contract shared by dynamic registration,
    // manual backfill, Popup, Batch, and the test runner. Dependencies must stay
    // before their consumers; add or move a file only with wiring + behavior tests.
    const files = Object.freeze([
        'js/shared/grafana-panel-bootstrap.js',
        'js/content/grafana-refresh-policy.js',
        'js/shared/grafana-legend-selection.js',
        'js/shared/grafana-capture-output.js',
        'js/content/grafana-dom.js',
        'js/content/grafana-panel-state.js',
        'js/shared/grafana-panel-analysis.js',
        'js/content/grafana-series-capture.js',
        'js/content/grafana-panel-definition.js',
        'js/content/grafana-unit.js',
        'js/content/grafana-visual-engine.js',
        'js/content/grafana-compact-layout.js',
        'js/shared/grafana-panel-settings-modal.js',
        'js/shared/bounded-journal.js',
        'js/content/grafana-network.js',
        'js/content/grafana-cpu-capacity-filter.js',
        'js/content/grafana-panel-tools.js'
    ]);
    const matchesForHostname = hostname => {
        const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
        if (!host || !/^[a-z0-9.-]+$/.test(host)) return [];
        return [
            `*://${host}/d/*`, `*://${host}/d-solo/*`,
            `*://${host}/*/d/*`, `*://${host}/*/d-solo/*`
        ];
    };
    root.DashBridgeGrafanaRuntimeManifest = Object.freeze({ files, matchesForHostname });
})(globalThis);
