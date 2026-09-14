(function initDashBridgeGrafanaRuntimeManifest(root) {
    'use strict';
    // This order is a runtime dependency contract shared by dynamic registration,
    // manual backfill, Popup, Batch, and the test runner. Dependencies must stay
    // before their consumers; add or move a file only with wiring + behavior tests.
    const files = Object.freeze([
        'js/shared/grafana-panel-bootstrap.js',
        'js/content/grafana-refresh-policy.js',
        'js/content/grafana-variables-runtime.js',
        'js/shared/grafana-legend-selection.js',
        'js/shared/grafana-capture-output.js',
        'js/content/grafana-dom.js',
        'js/content/grafana-panel-state.js',
        'js/shared/grafana-panel-analysis.js',
        'js/content/grafana-series-capture.js',
        'js/content/grafana-panel-definition.js',
        'js/content/grafana-unit.js',
        'js/content/grafana-table-report.js',
        'js/content/grafana-legend-visibility-adapters.js',
        'js/content/grafana-legend-columns.js',
        'js/content/grafana-legend-visuals.js',
        'js/content/grafana-threshold-visuals.js',
        'js/content/grafana-report-snapshot.js',
        'js/content/grafana-series-styles.js',
        'js/content/grafana-visual-engine.js',
        'js/content/grafana-compact-layout.js',
        'js/shared/grafana-panel-settings-modal.js',
        'js/shared/bounded-journal.js',
        'js/content/grafana-network.js',
        'js/content/grafana-cpu-capacity-filter.js',
        'js/content/grafana-cpu-capacity-legend.js',
        'js/content/grafana-panel-capture-runtime.js',
        'js/content/grafana-panel-data-transforms.js',
        'js/content/grafana-panel-data-transforms-runtime.js',
        'js/content/grafana-panel-data-runtime.js',
        'js/content/grafana-panel-menu-runtime.js',
        'js/content/grafana-panel-tools.js'
    ]);
    const matchesForHostname = hostname => {
        const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
        const parts = /^([a-z0-9.-]+)(?::([0-9]+))?$/.exec(host);
        if (!parts || (parts[2] && Number(parts[2]) > 65535)) return [];
        // Chromium accepts a port with explicit schemes, but rejects *://host:port.
        const schemes = parts[2] ? ['http', 'https'] : ['*'];
        return schemes.flatMap(scheme => ['/d/*', '/d-solo/*', '/*/d/*', '/*/d-solo/*']
            .map(route => `${scheme}://${host}${route}`));
    };
    root.DashBridgeGrafanaRuntimeManifest = Object.freeze({ files, matchesForHostname });
})(globalThis);
