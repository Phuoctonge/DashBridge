(function initDashBridgeAnalyticsPageEvents(root) {
    'use strict';
    const analytics = root.DashBridgeAnalytics;
    if (!analytics?.track || typeof document === 'undefined') return;

    const path = location.pathname.replace(/\\/g, '/');
    const pages = [
        ['/pages/popup/popup.html', 'popup.opened'],
        ['/pages/dashbridge/dashbridge.html', 'dashbridge.opened'],
        ['/pages/batch/batch.html', 'batch.opened'],
        ['/pages/worklog/worklog.html', 'worklog.opened'],
        ['/pages/recorder/recorder.html', 'recorder.opened'],
        ['/pages/options/options.html', 'options.opened'],
    ];
    const opened = pages.find(([suffix]) => path.endsWith(suffix));
    if (opened) analytics.opened(opened[1]);

    const clickMap = new Map(Object.entries({
        openDashBridgeBtn: 'popup.dashbridge_opened', openBatchCaptureBtn: 'popup.batch_opened',
        openTrafficRecorderBtn: 'popup.recorder_opened', openJiraPage: 'popup.worklog_opened',
        openSettingsBtn: 'popup.options_opened', openSettingsFallbackBtn: 'popup.options_opened',
        grafanaTimestampReadBtn: 'popup.grafana_time_read',
        newProfileBtn: 'dashbridge.profile_created', renameProfileBtn: 'dashbridge.profile_renamed',
        deleteProfileBtn: 'dashbridge.profile_deleted', forceRefreshBtn: 'dashbridge.force_refresh',
        copyTimeBtn: 'dashbridge.time_range_copied', pasteTimeBtn: 'dashbridge.time_range_pasted',
        applyAbsoluteTime: 'dashbridge.time_absolute_range_applied', captureAllPanelsBtn: 'dashbridge.capture_all_zip',
        generateReportBtn: 'dashbridge.report_generated',
        testReportBtn: 'internal.message_test_runner', exportPanelsBtn: 'dashbridge.profile_exported',
        importPanelsBtn: 'dashbridge.profile_imported', savePanelBtn: 'dashbridge.panel_added',
        saveQuickPanelsBtn: 'dashbridge.panels_added_manual', loadDashboardPanelsBtn: 'dashbridge.panels_discovered',
        addSelectedDashboardPanelsBtn: 'dashbridge.panels_added_from_discovery',
        addBatchPanelRuleBtn: 'batch.panel_rule_added', resetBatchPanelRulesBtn: 'batch.panel_rules_reset',
        copyMainSettingsToSeriesBtn: 'batch.main_settings_copied_to_series', getPanelsBtn: 'batch.panel_discovery',
        getSeriesPanelsBtn: 'batch.series_discovery', loadSelectedSeriesBtn: 'batch.series_discovery',
        startBtn: 'batch.main_run', startSeriesBtn: 'batch.series_run',
        clearLogs: 'batch.logs_cleared', checkAuth: 'jira.auth_checked', addRow: 'jira.row_added',
        clearSent: 'jira.sent_rows_cleared', sendAll: 'jira.batch_send', transferWorklogBtn: 'jira.popup_transfer',
        startButton: 'recorder.record_started', stopButton: 'recorder.record_stopped',
        replayButton: 'recorder.replay_started', saveButton: 'recorder.dashflow_exported',
        clearTrafficFilters: 'recorder.traffic_filters_cleared', copyRequestUrlButton: 'recorder.request_url_copied',
        exportComparisonButton: 'recorder.comparison_export_xlsx', openIncognitoSettings: 'recorder.incognito_settings_opened',
        exportBtn: 'options.config_exported', importBtn: 'options.config_imported',
        grafanaDebugFullBtn: 'internal.debug_report', grafanaDebugGuiCaptureBtn: 'internal.gui_capture',
        grafanaDebugTestRunnerBtn: 'internal.grafana_test_runner', debugFreshCodeEasterEgg: 'internal.debug_easter_egg',
    }));
    if (path.endsWith('/pages/options/options.html')) clickMap.set('saveBtn', 'options.saved');
    const classMap = [
        ...(path.endsWith('/pages/popup/popup.html') ? [] : [['.btn-delete', 'dashbridge.panel_deleted']]),
        ['.quick-range-btn', 'dashbridge.time_quick_range_applied'], ['.btn-refresh', 'dashbridge.panel_refreshed'],
        ['.dropdown-item[data-refresh]', 'dashbridge.refresh_interval_changed'],
        ['.btn-pause', 'dashbridge.panel_paused'], ['.btn-resume', 'dashbridge.panel_resumed'],
        ['.btn-fullscreen', 'dashbridge.panel_fullscreen_opened'], ['.btn-open', 'dashbridge.panel_original_opened'],
        ['.btn-capture-save', 'dashbridge.capture_panel_download'], ['.btn-capture-copy', 'dashbridge.capture_panel_copy'],
        ['.btn-iframe-settings', 'dashbridge.panel_iframe_settings_changed'],
        ['.btn-report-settings', 'dashbridge.report_panel_settings_saved'],
        ['.report-regenerate', 'dashbridge.report_regenerated'], ['.report-copy', 'dashbridge.report_copied'],
    ];

    document.addEventListener('click', event => {
        if (!event.isTrusted) return;
        const target = event.target?.closest?.('button,[role="button"],[data-timestamp-copy]');
        if (!target) return;
        if (target.dataset?.timestampCopy) {
            analytics.opened('popup.grafana_time_copied');
            return;
        }
        if (target.matches?.('.tab-btn') && path.endsWith('/pages/popup/popup.html')) {
            const module = String(target.dataset.tab || '').replace(/^tab-/, '');
            analytics.track('popup.module_opened', 'used', { module });
            return;
        }
        if (target.matches?.('.grafana-sub-btn')) {
            const sub = String(target.dataset.sub || '').replace(/^grafana-/, 'grafana_');
            analytics.track('popup.grafana_subtab_opened', 'used', { module: sub });
            return;
        }
        const featureId = clickMap.get(target.id) || classMap.find(([selector]) => target.matches?.(selector))?.[1];
        if (featureId) analytics.opened(featureId);
    }, true);

    document.addEventListener('change', event => {
        if (!event.isTrusted) return;
        const target = event.target;
        const checkboxMap = {
            disableCache: 'recorder.cache_mode_changed', disableCookies: 'recorder.cookie_mode_changed',
            tdmExportPhotos: 'tdm.photos_changed', tdmExcludeUserCheckbox: 'tdm.exclusion_changed',
            settingTdmRememberDate: 'tdm.remember_dates_changed'
        };
        const featureId = checkboxMap[target?.id];
        if (featureId) analytics.changed(featureId, !!target.checked);
        if (target?.id === 'flowFile' && target.files?.length) analytics.opened('recorder.dashflow_imported');
        if (target?.id === 'sortToggle') analytics.opened('jira.sort_changed');
    }, true);
})(globalThis);
