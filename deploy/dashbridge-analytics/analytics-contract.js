'use strict';

const signals = new Set(['used', 'changed', 'configured', 'effective', 'outcome', 'lifecycle']);
const dimensions = Object.freeze({
    surface: new Set(['popup', 'direct_grafana', 'dashbridge', 'batch', 'worklog', 'recorder', 'tdm', 'options', 'confluence']),
    outcome: new Set(['success', 'partial', 'cancelled', 'invalid_input', 'unsupported_page', 'permission_denied', 'auth_required', 'timeout', 'no_data', 'busy', 'error']),
    state: new Set(['enabled', 'disabled']),
    mode: new Set(['period', 'latest', 'max', 'last', 'copy', 'move', 'grouped', 'standalone']),
    method: new Set(['single_url', 'manual_ids', 'dashboard_discovery']),
    module: new Set(['grafana', 'grafana_links', 'grafana_batch', 'grafana_debug', 'recorder', 'jira', 'tdm', 'confluence']),
    format: new Set(['html', 'json', 'both', 'png', 'zip', 'dashflow', 'xlsx']),
    theme: new Set(['auto', 'current', 'light', 'dark']),
    selectionMode: new Set(['all', 'whitelist', 'blacklist']),
    workflow: new Set(['main', 'series']),
    prepared: new Set([true, false]),
    countBucket: new Set(['1', '2_5', '6_10', '11_plus']),
    renderer: new Set(['uplot', 'flot', 'unknown']),
    grafanaMajor: new Set(['unknown', '8', '9', '10', '11', '12', '13']),
    source: new Set(['none', 'graph', 'custom', 'cpu_capacity', 'dom', 'response']),
});

const definitions = new Map();
const add = (ids, allowedSignals, allowedDimensions = []) => ids.forEach(id => definitions.set(id, {
    signals: new Set(allowedSignals), dimensions: new Set(allowedDimensions),
}));

add(['extension.daily_active', 'extension.installed', 'extension.updated', 'extension.data_migration'], ['lifecycle', 'outcome']);
add(['popup.opened', 'dashbridge.opened', 'batch.opened', 'worklog.opened', 'recorder.opened', 'options.opened'], ['used']);
add(['ui.theme_changed'], ['changed'], ['theme']);
add(['popup.module_opened', 'popup.grafana_subtab_opened'], ['used'], ['module']);
add(['popup.dashbridge_opened', 'popup.batch_opened', 'popup.recorder_opened', 'popup.worklog_opened', 'popup.options_opened',
    'popup.grafana_link_opened', 'popup.grafana_link_created', 'popup.grafana_link_edited', 'popup.grafana_link_deleted',
    'popup.grafana_time_read', 'popup.grafana_time_copied', 'update.available', 'update.installer_opened',
    'update.local_reload_required', 'update.extension_reloaded'], ['used', 'outcome', 'lifecycle'], ['outcome']);
add(['grafana.time_range_copied', 'grafana.time_range_pasted', 'grafana.panel.settings_saved',
    'grafana.panel.saved_to_dashbridge', 'grafana.panel.capture_png_download', 'grafana.panel.capture_png_copy',
    'grafana.panel.analysis_opened', 'grafana.panel.analysis_mode_changed', 'grafana.panel.analysis_copy_all',
    'grafana.panel.analysis_copy_top3'], ['used', 'outcome'], ['outcome', 'mode', 'prepared', 'renderer', 'grafanaMajor', 'surface']);
add(['grafana.panel.fill_removed', 'grafana.panel.lines_thickened', 'grafana.panel.legend_inverted',
    'grafana.panel.legend_selection', 'grafana.panel.cpu_idle_to_load', 'grafana.panel.ram_to_used',
    'grafana.panel.ram_force_byte_unit', 'grafana.panel.series_value_filter', 'grafana.panel.series_highlight',
    'grafana.panel.load_cpu_capacity_filter', 'grafana.panel.load_cpu_capacity_highlight',
    'grafana.panel.load_series_1m', 'grafana.panel.load_series_5m', 'grafana.panel.load_series_15m',
    'grafana.panel.threshold', 'grafana.panel.threshold_notification', 'grafana.panel.compact_capture'],
['changed', 'configured', 'effective', 'outcome'], ['surface', 'state', 'outcome', 'mode', 'countBucket', 'renderer', 'grafanaMajor']);
add(['dashbridge.profile_created', 'dashbridge.profile_switched', 'dashbridge.profile_renamed', 'dashbridge.profile_deleted',
    'dashbridge.panel_refreshed', 'dashbridge.panel_paused', 'dashbridge.panel_resumed',
    'dashbridge.panel_fullscreen_opened', 'dashbridge.panel_deleted', 'dashbridge.panel_original_opened',
    'dashbridge.panel_reordered', 'dashbridge.panel_layout_changed', 'dashbridge.panel_iframe_settings_changed',
    'dashbridge.time_quick_range_applied', 'dashbridge.time_absolute_range_applied', 'dashbridge.time_range_copied',
    'dashbridge.time_range_pasted', 'dashbridge.refresh_interval_changed', 'dashbridge.force_refresh',
    'dashbridge.crosshair_changed', 'dashbridge.crosshair_thickness_changed',
    'dashbridge.profile_exported', 'dashbridge.profile_imported'],
['used', 'changed', 'configured', 'outcome'], ['state', 'outcome', 'mode', 'theme', 'countBucket']);
add(['dashbridge.panel_added', 'dashbridge.panels_added_manual', 'dashbridge.panels_discovered', 'dashbridge.panels_added_from_discovery'],
    ['used', 'outcome'], ['method', 'outcome', 'countBucket']);
add(['dashbridge.capture_prepared_changed', 'dashbridge.capture_panel_download', 'dashbridge.capture_panel_copy', 'dashbridge.capture_all_zip'],
    ['changed', 'used', 'outcome'], ['state', 'outcome', 'prepared', 'countBucket', 'format']);
add(['dashbridge.analysis_cpu_opened', 'dashbridge.analysis_ram_opened', 'dashbridge.analysis_mode_period',
    'dashbridge.analysis_mode_latest', 'dashbridge.analysis_copy_all', 'dashbridge.analysis_copy_top3',
    'dashbridge.analysis_result'], ['used', 'outcome'], ['outcome', 'mode', 'source']);
add(['dashbridge.report_template_saved', 'dashbridge.report_panel_settings_saved', 'dashbridge.report_generated',
    'dashbridge.report_regenerated', 'dashbridge.report_copied'],
['used', 'changed', 'configured', 'outcome'], ['outcome', 'mode', 'source', 'countBucket']);
add(['batch.panel_discovery', 'batch.panel_selection_applied', 'batch.panel_rule_added', 'batch.panel_rule_removed',
    'batch.panel_rules_reset', 'batch.main_run', 'batch.main_cancelled', 'batch.series_discovery',
    'batch.series_selection_changed', 'batch.main_settings_copied_to_series', 'batch.series_run',
    'batch.series_cancelled', 'batch.logs_cleared'],
['used', 'changed', 'configured', 'outcome'], ['outcome', 'workflow', 'selectionMode', 'mode', 'theme', 'prepared', 'countBucket']);
add(['jira.auth_checked', 'jira.row_added', 'jira.row_cloned', 'jira.row_deleted', 'jira.undo', 'jira.redo',
    'jira.sort_changed', 'jira.sent_rows_cleared', 'jira.batch_send', 'jira.popup_transfer'],
['used', 'outcome'], ['outcome', 'mode', 'countBucket']);
add(['recorder.record_started', 'recorder.record_stopped', 'recorder.unexpected_detach', 'recorder.dashflow_imported',
    'recorder.dashflow_exported', 'recorder.replay_started', 'recorder.replay_finished',
    'recorder.cache_mode_changed', 'recorder.cookie_mode_changed', 'recorder.incognito_settings_opened',
    'recorder.traffic_filter_used', 'recorder.traffic_filters_cleared', 'recorder.request_details_opened',
    'recorder.request_url_copied', 'recorder.sensitive_details_revealed', 'recorder.comparison_filter_used',
    'recorder.comparison_export_xlsx'],
['used', 'changed', 'configured', 'outcome'], ['outcome', 'state', 'format', 'countBucket']);
add(['tdm.photos_changed', 'tdm.exclusion_changed', 'tdm.remember_dates_changed', 'tdm.export_started', 'tdm.export_finished'],
    ['changed', 'configured', 'used', 'outcome'], ['outcome', 'format', 'state', 'countBucket']);
add(['confluence.fix_configured', 'confluence.fix_activated'], ['configured', 'effective'], ['state']);
add(['options.saved', 'options.config_exported', 'options.config_imported'], ['used', 'outcome'], ['outcome']);
add(['options.module_availability'], ['configured'], ['module', 'state']);
add(['internal.debug_report', 'internal.gui_capture', 'internal.grafana_test_runner', 'internal.message_test_runner', 'internal.debug_easter_egg'],
    ['used', 'outcome'], ['outcome']);

const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));

function validateEvent(event) {
    if (!exactKeys(event, ['eventId', 'periodStart', 'featureId', 'signal', 'dimensions', 'count', 'extensionVersion'])) return false;
    const definition = definitions.get(event.featureId);
    if (!definition || !signals.has(event.signal) || !definition.signals.has(event.signal)) return false;
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(event.eventId) || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(event.periodStart)) return false;
    const period = Date.parse(event.periodStart);
    if (!Number.isFinite(period) || new Date(period).toISOString() !== event.periodStart
        || period > Date.now() + 24 * 3_600_000) return false;
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\.\d{1,4})?$/.test(event.extensionVersion)) return false;
    if (!Number.isInteger(event.count) || event.count < 1 || event.count > 1_000_000) return false;
    if (!event.dimensions || typeof event.dimensions !== 'object' || Array.isArray(event.dimensions)) return false;
    for (const [key, value] of Object.entries(event.dimensions)) {
        if (!definition.dimensions.has(key) || !dimensions[key]?.has(value)) return false;
    }
    return true;
}

function validateBatch(payload) {
    if (!exactKeys(payload, ['schemaVersion', 'installationId', 'droppedAggregates', 'events']) || payload.schemaVersion !== 1) return false;
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(payload.installationId) || !Array.isArray(payload.events)
        || payload.events.length < 1 || payload.events.length > 100) return false;
    if (!Number.isInteger(payload.droppedAggregates) || payload.droppedAggregates < 0
        || payload.droppedAggregates > 1_000_000) return false;
    return payload.events.every(validateEvent);
}

module.exports = Object.freeze({ validateBatch, featureIds: Object.freeze([...definitions.keys()]) });
