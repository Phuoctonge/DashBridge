let profiles = [];
let activeProfileId = null;
let panels = []; // Всегда синхронизирован с активным профилем
let profilesLoaded = false;
let profileStorageSyncVersion = 0;
const DASHBRIDGE_TAB_ACTIVE_PROFILE_KEY = 'dashbridge_tab_activeProfileId';

function getTabActiveProfileId() {
    try { return sessionStorage.getItem(DASHBRIDGE_TAB_ACTIVE_PROFILE_KEY) || null; }
    catch { return null; }
}

function setTabActiveProfileId(id) {
    activeProfileId = id || null;
    try {
        if (activeProfileId) sessionStorage.setItem(DASHBRIDGE_TAB_ACTIVE_PROFILE_KEY, activeProfileId);
        else sessionStorage.removeItem(DASHBRIDGE_TAB_ACTIVE_PROFILE_KEY);
    } catch { /* The in-memory selection remains valid when sessionStorage is unavailable. */ }
    return activeProfileId;
}

function normalizePanelMetadataText(value, maxLength = 96) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function getFrameOrigin(iframe) {
    try {
        const src = iframe.dataset.src || iframe.src;
        if (src && src !== 'about:blank') return new URL(src).origin;
    } catch (e) { }
    return null;
}

function postToDashboardFrame(iframe, message) {
    // Async work (for example chrome.storage reads) can finish after a panel
    // card has already been replaced. A detached iframe keeps its old data
    // attributes, while its WindowProxy falls back to the extension document.
    if (!iframe?.isConnected || !iframe.contentWindow || iframe.dataset.dashbridgeLoaded !== 'true') return false;
    const targetOrigin = getFrameOrigin(iframe);
    if (!targetOrigin || iframe.dataset.dashbridgeOrigin !== targetOrigin) return false;
    try {
        // dashbridgeOrigin is set only after a message from this exact iframe
        // has passed the source-window and origin checks below. Avoid probing
        // cross-origin location on every cursor/report message: that throws in
        // the normal case and used to make the hottest postMessage path costly.
        iframe.contentWindow.postMessage(message, targetOrigin);
        return true;
    } catch (e) {
        // An iframe can begin navigating between the ready check and postMessage.
        return false;
    }
}

function navigateDashboardFrame(iframe, url) {
    if (!iframe || !url) return;
    iframe.dataset.dashbridgeLoaded = 'false';
    iframe.dataset.dashbridgeRendered = 'false';
    delete iframe.dataset.dashbridgeOrigin;
    iframe.src = url;
}

let crosshairMode = 'line';
let crosshairThickness = 1;
let grafanaTransformSettings = normalizeGrafanaSettings({});
const grafanaTransformSettingKeys = new Set(getGrafanaSettingsStorageKeys());

try {
    crosshairMode = localStorage.getItem('dashbridge_crosshairMode') || 'line';
    if (!['line', 'off'].includes(crosshairMode)) crosshairMode = 'line';
    crosshairThickness = parseInt(localStorage.getItem('dashbridge_crosshairThickness'), 10) || 1;
} catch (e) {
    console.warn("localStorage init failed:", e);
}

// --- Drag & Drop state ---
let draggedId = null;
let draggedEl = null;
let dragTargetEl = null;
let dragDropSide = null;

// --- Fullscreen state ---
let fullscreenPanelId = null;
let defaultCapturePrepared = false;

// --- SVG-иконки ---
const SVG_GRIP = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
  <circle cx="2" cy="2"  r="1.4"/><circle cx="8" cy="2"  r="1.4"/>
  <circle cx="2" cy="7"  r="1.4"/><circle cx="8" cy="7"  r="1.4"/>
  <circle cx="2" cy="12" r="1.4"/><circle cx="8" cy="12" r="1.4"/>
</svg>`;

const SVG_EXPAND = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
  <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
  <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
  <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
</svg>`;

const SVG_COLLAPSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
  <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
  <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
  <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
</svg>`;

const SVG_REFRESH = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
  <polyline points="21 3 21 8 16 8"/>
</svg>`;

const SVG_OPEN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
  <polyline points="15 3 21 3 21 9"/>
  <line x1="10" y1="14" x2="21" y2="3"/>
</svg>`;

const SVG_DELETE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

const SVG_PANEL_SETTINGS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 7h16"/><circle cx="9" cy="7" r="2"/>
  <path d="M4 17h16"/><circle cx="15" cy="17" r="2"/>
</svg>`;

const SVG_IFRAME_SETTINGS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 20h9"/>
  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>
</svg>`;

const SVG_PAUSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
const SVG_RESUME = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>`;
const SVG_CAPTURE_SAVE = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.25 3h12.5L21 7.25v12.5A1.25 1.25 0 0 1 19.75 21H4.25A1.25 1.25 0 0 1 3 19.75V4.25A1.25 1.25 0 0 1 4.25 3Z"/><path d="M7 3v6.25h9.5V3M7.25 21v-7.25h9.5V21"/><path d="M14 5.25v2" stroke-width="2.25"/></svg>`;
const SVG_CAPTURE_COPY = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M16.5 6V4.75A1.75 1.75 0 0 0 14.75 3h-10A1.75 1.75 0 0 0 3 4.75v10a1.75 1.75 0 0 0 1.75 1.75H6"/><rect x="6.5" y="6.5" width="14.5" height="14.5" rx="2"/><circle cx="11" cy="11" r="1.25"/><path d="m8 18 3.5-3.5 2.5 2.25 1.8-1.75 3.2 3"/></svg>`;
const SVG_MORE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`;
const SVG_ANALYSIS = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M3 19h18"/><circle cx="19" cy="6" r="2.5"/></svg>`;
const SVG_REPORT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="m4 7 8 6 8-6"/></svg>`;

function getPanelTools(panel) {
    const saved = panel.tools || {};
    const isMemoryPanel = /\b(?:memory|ram)\b|памят/i.test(String(panel.title || ''));
    // Previous visual-filter settings are deliberately ignored. Only the
    // response-level filter is retained in the current panel schema.
    const hasResponseSeriesFilter = saved.seriesFilterSettingsVersion === 2;
    // The removed click-toggle mode is not migrated. Its transient native
    // visibility state was unreliable after Grafana refreshes, so old legend
    // selections are deliberately ignored instead of becoming data filters.
    const keepCompleteHideSelection = saved.legendMode === 'fast_complete_hide';
    return {
        removeFill: !!saved.removeFill,
        thickenLines: !!saved.thickenLines,
        thickenLinesValue: saved.thickenLinesValue !== undefined ? Number(saved.thickenLinesValue) : 1.5,
        invertLegend: !!saved.invertLegend,
        capturePrepared: defaultCapturePrepared,
        legendFilter: keepCompleteHideSelection && Array.isArray(saved.legendFilter) ? saved.legendFilter : [],
        legendSelectionVersion: keepCompleteHideSelection && Number(saved.legendSelectionVersion) === 2 ? 2 : null,
        legendVisibleSeries: keepCompleteHideSelection && Array.isArray(saved.legendVisibleSeries) ? saved.legendVisibleSeries : [],
        legendSelectFilter: keepCompleteHideSelection && typeof saved.legendSelectFilter === 'string' ? saved.legendSelectFilter : '',
        legendIgnoreFilter: keepCompleteHideSelection && typeof saved.legendIgnoreFilter === 'string' ? saved.legendIgnoreFilter : '',
        legendMode: 'fast_complete_hide',
        invertIdle: !!saved.invertIdle,
        convertMemToUsed: !!saved.convertMemToUsed,
        // Existing profiles may already have convertMemToUsed=false while a
        // stale percent formatter is painted. Memory-titled panels opt into
        // the byte-unit repair during migration as well.
        forceMemByteUnit: !!saved.forceMemByteUnit || (!saved.convertMemToUsed && isMemoryPanel),
        seriesQueryFilterEnabled: hasResponseSeriesFilter && !!saved.seriesQueryFilterEnabled && !saved.cpuCapacityFilterEnabled,
        seriesQueryFilterHighlightEnabled: saved.seriesQueryFilterHighlightEnabled !== false,
        seriesQueryFilterValue: Number.isFinite(Number(saved.seriesQueryFilterValue)) ? Number(saved.seriesQueryFilterValue) : 0,
        seriesQueryFilterRawValue: Number.isFinite(Number(saved.seriesQueryFilterRawValue)) && saved.seriesQueryFilterRawValue !== null && saved.seriesQueryFilterRawValue !== ''
            ? Number(saved.seriesQueryFilterRawValue)
            : null,
        seriesQueryFilterMode: saved.seriesQueryFilterMode === 'last' ? 'last' : 'max',
        cpuCapacityFilterEnabled: !!saved.cpuCapacityFilterEnabled,
        cpuCapacityFilterHighlightEnabled: saved.cpuCapacityFilterHighlightEnabled !== false,
        cpuCapacityFilterCoefficient: Number.isFinite(Number(saved.cpuCapacityFilterCoefficient)) && Number(saved.cpuCapacityFilterCoefficient) > 0
            ? Number(saved.cpuCapacityFilterCoefficient) : grafanaTransformSettings.grafanaCpuCapacityCoefficient,
        cpuCapacityFilterMode: saved.cpuCapacityFilterMode === 'last' ? 'last' : 'max',
        cpuCapacityFilterLoad1: saved.cpuCapacityFilterLoad1 !== false,
        cpuCapacityFilterLoad5: saved.cpuCapacityFilterLoad5 === true,
        cpuCapacityFilterLoad15: saved.cpuCapacityFilterLoad15 === true,
        thresholdEnabled: !!saved.thresholdEnabled,
        thresholdNotifyEnabled: saved.thresholdNotifyEnabled !== false,
        thresholdValue: Number(saved.thresholdValue) || 0,
        thresholdRawValue: Number.isFinite(Number(saved.thresholdRawValue)) && saved.thresholdRawValue !== null && saved.thresholdRawValue !== ''
            ? Number(saved.thresholdRawValue)
            : null,
        thresholdUnit: normalizePanelMetadataText(saved.thresholdUnit)
    };
}

function applyPanelTools(panel, iframe) {
    // The cache is populated before frames are created and kept current by the
    // sync-storage listener. Re-reading the same settings once per iframe made
    // a dashboard with many panels issue a burst of duplicate IPC calls.
    return postToDashboardFrame(iframe, {
        action: 'applyPanelTools', tools: getPanelTools(panel), transformSettings: grafanaTransformSettings
    });
}

const panelLegendWaiters = new Map();
const panelThresholdWaiters = new Map();
const panelThresholdStates = new Map();
const panelTitleWaiters = new Map();
const panelReportWaiters = new Map();
let activeReportPreview = null;
const DASHBRIDGE_REPORT_FRAME_TIMEOUT_MS = 90_000;
const DASHBRIDGE_REPORT_RESPONSE_TIMEOUT_MS = 125_000;

function requestPanelTitle(panel, iframe) {
    if (!panel || !iframe) return Promise.resolve('');
    const requestId = `panel-title-${panel.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            panelTitleWaiters.delete(requestId);
            resolve('');
        }, 1000);
        panelTitleWaiters.set(requestId, title => {
            clearTimeout(timeout);
            panelTitleWaiters.delete(requestId);
            resolve(title);
        });
        if (!postToDashboardFrame(iframe, { action: 'getDashbridgePanelTitle', requestId })) {
            clearTimeout(timeout);
            panelTitleWaiters.delete(requestId);
            resolve('');
        }
    });
}

function ensureThresholdNotifications() {
    let container = document.getElementById('dashbridgeThresholdNotifications');
    if (!container) {
        container = document.createElement('div');
        container.id = 'dashbridgeThresholdNotifications';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }
    return container;
}

function updatePanelThresholdStatus(panel, status) {
    const card = document.querySelector(`.panel-card[data-panel-id="${CSS.escape(panel.id)}"]`);
    const previous = panelThresholdStates.get(panel.id) || { exceeded: false, dismissed: false };
    const currentTools = panel.tools || {};
    const rawFromStatus = status?.rawThreshold !== null && status?.rawThreshold !== ''
        && Number.isFinite(Number(status?.rawThreshold))
        ? Number(status.rawThreshold)
        : null;
    const storedRaw = Number.isFinite(Number(currentTools.thresholdRawValue)) && currentTools.thresholdRawValue !== null
        ? Number(currentTools.thresholdRawValue)
        : rawFromStatus;
    const factor = Number(status?.factor);
    const displayedValue = Number.isFinite(storedRaw) && Number.isFinite(factor) && factor > 0
        ? storedRaw / factor
        : currentTools.thresholdValue;
    const safeStatusUnit = normalizePanelMetadataText(status?.unit);
    if ((safeStatusUnit && currentTools.thresholdUnit !== safeStatusUnit)
        || (Number.isFinite(storedRaw) && currentTools.thresholdRawValue !== storedRaw)
        || (Number.isFinite(displayedValue) && currentTools.thresholdValue !== displayedValue)) {
        panel.tools = {
            ...currentTools,
            thresholdUnit: safeStatusUnit || normalizePanelMetadataText(currentTools.thresholdUnit),
            thresholdRawValue: Number.isFinite(storedRaw) ? storedRaw : currentTools.thresholdRawValue,
            thresholdValue: Number.isFinite(displayedValue) ? displayedValue : currentTools.thresholdValue
        };
        savePanels();
    }
    const exceeded = !!status?.enabled && !!status?.exceeded;
    card?.classList.toggle('threshold-exceeded', exceeded);
    if (!exceeded) {
        panelThresholdStates.set(panel.id, { exceeded: false, dismissed: false });
        return;
    }
    if (status?.thresholdNotifyEnabled === false) {
        document.querySelector(`.threshold-notification[data-panel-id="${CSS.escape(panel.id)}"]`)?.remove();
        panelThresholdStates.set(panel.id, { exceeded: false, dismissed: false });
        return;
    }
    if (previous.exceeded || previous.dismissed) {
        panelThresholdStates.set(panel.id, { ...previous, exceeded: true });
        return;
    }
    panelThresholdStates.set(panel.id, { exceeded: true, dismissed: false });
    const notice = document.createElement('div');
    notice.className = 'threshold-notification';
    notice.dataset.panelId = panel.id;
    notice.innerHTML = `
        <strong>${escapeHtml(status.panelTitle || 'Панель Grafana')}</strong>
        <button type="button" aria-label="Закрыть">×</button>
        <span class="threshold-notification-status">Порог превышен</span>`;
    notice.querySelector('button').addEventListener('click', () => {
        notice.remove();
        panelThresholdStates.set(panel.id, { exceeded: true, dismissed: true });
    });
    ensureThresholdNotifications().appendChild(notice);
}

function requestPanelLegendSeries(panel, iframe) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            panelLegendWaiters.delete(panel.id);
            resolve([]);
        }, 2500);
        panelLegendWaiters.set(panel.id, series => {
            clearTimeout(timer);
            resolve(series);
        });
        if (!postToDashboardFrame(iframe, { action: 'getPanelLegendSeries', requestId: panel.id })) {
            clearTimeout(timer);
            panelLegendWaiters.delete(panel.id);
            resolve([]);
        }
    });
}

function requestPanelThresholdStatus(panel, iframe) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            panelThresholdWaiters.delete(panel.id);
            resolve(null);
        }, 1500);
        panelThresholdWaiters.set(panel.id, status => {
            clearTimeout(timer);
            resolve(status);
        });
        if (!postToDashboardFrame(iframe, { action: 'getPanelThresholdStatus', requestId: panel.id, threshold: getPanelTools(panel) })) {
            clearTimeout(timer);
            panelThresholdWaiters.delete(panel.id);
            resolve(null);
        }
    });
}

function formatThresholdUnit(status) {
    if (status?.unit) return `Единица: ${status.unit}`;
    if (status?.engine && status.engine !== 'unknown') return 'Без единицы';
    return 'Единица определяется по графику';
}

async function openPanelTools(panel, iframe) {
    const tools = getPanelTools(panel);
    const storedSettings = await chrome.storage.sync.get(getGrafanaSettingsStorageKeys());
    const panelSettings = normalizeGrafanaSettings(storedSettings);
    let resolvedTitle = panel.title;
    let panelKind = window.DashBridgeGrafanaPanelAnalysis?.classifyPanelTitle(resolvedTitle, panelSettings) || null;
    // Most panels already have a persisted title and open immediately. Query
    // the live iframe only when that title cannot select a specialised form.
    if (!panelKind) {
        const liveTitle = await requestPanelTitle(panel, iframe);
        resolvedTitle = normalizePanelMetadataText(liveTitle, 240) || resolvedTitle;
        panelKind = window.DashBridgeGrafanaPanelAnalysis?.classifyPanelTitle(resolvedTitle, panelSettings) || null;
    }
    if (resolvedTitle && panel.title !== resolvedTitle) {
        panel.title = resolvedTitle;
        savePanels();
    }
    return window.DashBridgePanelSettingsModal.open({
        state: tools,
        content: `${window.DashBridgePanelSettingsModal.transformFields(tools, { panelKind })}${window.DashBridgePanelSettingsModal.thresholdFields(tools)}${window.DashBridgePanelSettingsModal.legendFields(tools.legendMode, tools)}`,
        advanced: {
            cpuCapacityFilterCoefficientDefault: panelSettings.grafanaCpuCapacityCoefficient,
            getLegendSeries: () => requestPanelLegendSeries(panel, iframe),
            getThresholdStatus: () => requestPanelThresholdStatus(panel, iframe),
            formatThresholdUnit
        },
        onSave: nextTools => {
            const previousTools = getPanelTools(panel);
            // The calculated response owns a percent field config. Grafana can
            // retain that config when native byte series return, so remember
            // that this panel must explicitly restore its byte unit.
            nextTools.forceMemByteUnit = nextTools.convertMemToUsed
                ? false
                : (previousTools.convertMemToUsed || previousTools.forceMemByteUnit);
            panel.tools = nextTools;
            savePanels();
            const liveApplyKeys = ['thresholdEnabled', 'thresholdNotifyEnabled', 'thresholdValue', 'thresholdRawValue', 'thresholdUnit'];
            const liveApplyOnlyChange = liveApplyKeys.some(key => previousTools[key] !== nextTools[key])
                && Object.keys(nextTools).filter(key => !liveApplyKeys.includes(key))
                    .every(key => JSON.stringify(previousTools[key]) === JSON.stringify(nextTools[key]));
            if (liveApplyOnlyChange) {
                const targetIframe = forceLoadPanel(panel.id);
                if (targetIframe) void applyPanelTools(panel, targetIframe);
            } else {
                refreshPanel(panel.id);
            }
        }
    });
}

function reportSourceLabel(config, panel) {
    if (config.sla.source === 'cpu_capacity') {
        if (!panel.tools?.cpuCapacityFilterEnabled) return 'Фильтр Load Average по vCPU выключен.';
        const coefficient = DashBridgeReport.formatNumber(panel.tools.cpuCapacityFilterCoefficient ?? 0.8);
        const mode = panel.tools.cpuCapacityFilterMode === 'last' ? 'последнему значению' : 'максимуму за период';
        return `Для каждой VM используется SLA: Load больше vCPU × ${coefficient}, расчёт по ${mode}.`;
    }
    if (config.sla.source !== 'graph') return '';
    if (!panel.tools?.thresholdEnabled) return 'Порог на графике выключен.';
    const value = DashBridgeReport.formatNumber(panel.tools.thresholdValue);
    const unit = normalizePanelMetadataText(panel.tools.thresholdUnit, 64);
    return `Используется порог на графике: больше ${value}${unit ? ` ${unit}` : ''}.`;
}

function reportPanelCardMarkup(panel, usedKeys = new Set(), expanded = false) {
    const config = DashBridgeReport.normalizePanel(panel.report, panel);
    const checked = value => value ? 'checked' : '';
    const sourceLabel = config.sla.source === 'graph' ? 'Порог графика'
        : config.sla.source === 'custom' ? 'Собственный SLA'
            : config.sla.source === 'cpu_capacity' ? 'SLA по vCPU' : 'Информационная панель';
    const includeLabel = config.includeMode === 'always' ? 'показывать всегда' : 'только при нарушении';
    return `
        <section class="report-panel-card report-overview-card" data-panel-id="${escapeHtml(panel.id)}" data-report-enabled="${config.enabled}">
            <div class="report-panel-card-header">
                <div><h4>${escapeHtml(panel.title || 'Панель Grafana')}</h4><span class="report-panel-auto-status">${escapeHtml(config.enabled ? `${sourceLabel} · ${includeLabel}` : 'Не добавляется в сообщение')}</span></div>
                <div class="report-panel-card-actions">
                    <label class="report-switch"><input class="report-enabled" type="checkbox" ${checked(config.enabled)}> Добавлять</label>
                    <button class="btn btn-outline report-open-panel-editor" type="button">Редактировать фразы</button>
                </div>
            </div>
        </section>`;
}

function openPanelReportEditor(panel, onSaved = null) {
    const config = DashBridgeReport.normalizePanel(panel.report, panel);
    const graphEnabled = !!panel.tools?.thresholdEnabled;
    const cpuCapacityEnabled = !!panel.tools?.cpuCapacityFilterEnabled;
    const source = (config.sla.source === 'graph' && !graphEnabled)
        || (config.sla.source === 'cpu_capacity' && !cpuCapacityEnabled) ? 'none' : config.sla.source;
    const selected = (value, current) => value === current ? 'selected' : '';
    const checked = value => value ? 'checked' : '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay report-panel-editor-overlay';
    overlay.innerHTML = `
        <section class="modal-content report-panel-editor-modal" role="dialog" aria-modal="true">
            <div class="report-settings-header">
                <div><h3>${escapeHtml(panel.title || 'Панель Grafana')}</h3><p class="report-wizard-caption">Фраза этой панели для сводного сообщения.</p></div>
                <button type="button" class="btn btn-outline report-panel-editor-close">Закрыть</button>
            </div>
            <div class="report-panel-editor-setup">
                <section class="report-editor-setup-card">
                    <h4>Добавление в сводку</h4>
                    <label class="report-switch"><input class="report-editor-enabled" type="checkbox" ${checked(config.enabled)}> Добавлять эту панель</label>
                    <label class="report-field">Показывать фразу
                        <select class="report-editor-include-mode">
                            <option value="always" ${selected('always', config.includeMode)}>Всегда</option>
                            <option value="critical_only" ${selected('critical_only', config.includeMode)}>Только при нарушении SLA</option>
                        </select>
                    </label>
                </section>
                <section class="report-editor-setup-card report-panel-editor-source">
                    <h4>Результат панели</h4>
                    <label class="report-field">Источник результата
                        <select class="report-editor-source">
                            <option value="graph" ${selected('graph', source)} ${graphEnabled ? '' : 'disabled'}>Автоматически по порогу графика${graphEnabled ? '' : ' — не настроен'}</option>
                            <option value="cpu_capacity" ${selected('cpu_capacity', source)} ${cpuCapacityEnabled ? '' : 'disabled'}>По фильтру Load Average: vCPU × коэффициент${cpuCapacityEnabled ? '' : ' — не настроен'}</option>
                            <option value="none" ${selected('none', source)}>Без SLA — информационная фраза</option>
                            <option value="custom" ${selected('custom', source)}>Собственный SLA</option>
                        </select>
                    </label>
                    <div class="report-effective-threshold">${escapeHtml(source === 'cpu_capacity'
                        ? reportSourceLabel({ ...config, sla: { ...config.sla, source: 'cpu_capacity' } }, panel)
                        : graphEnabled ? reportSourceLabel({ ...config, sla: { ...config.sla, source: 'graph' } }, panel)
                            : 'Порог на графике не настроен.')}</div>
                    <div class="report-field-grid report-editor-custom-sla" hidden>
                        <label class="report-field">Значение SLA<input class="report-editor-sla-value" type="number" step="any" value="${config.sla.value ?? ''}"></label>
                        <label class="report-field">Условие<select class="report-editor-operator"><option value="gt" ${selected('gt', config.sla.operator)}>Больше</option><option value="gte" ${selected('gte', config.sla.operator)}>Больше или равно</option><option value="lt" ${selected('lt', config.sla.operator)}>Меньше</option><option value="lte" ${selected('lte', config.sla.operator)}>Меньше или равно</option></select></label>
                    </div>
                </section>
            </div>
            <div class="report-panel-editor-copy">
                <div class="report-subsection-heading"><h5>Текст для сообщения</h5><span>Порог, единица и серверы подставятся автоматически. Выберите поле и нажмите значок, чтобы вставить его.</span></div>
                <div class="report-emoji-toolbar" aria-label="Вставить значок">${['🟢','⚠️','🔴','⏱️','✅','❌','🖥','🛠'].map(icon => `<button type="button" data-emoji="${icon}">${icon}</button>`).join('')}</div>
                <div class="report-template-grid report-editor-threshold-templates">
                    <label class="report-field">Если требования соблюдены<textarea class="report-editor-normal">${escapeHtml(config.templates.normal)}</textarea></label>
                    <label class="report-field">Если требования нарушены<textarea class="report-editor-breached">${escapeHtml(config.templates.breached)}</textarea></label>
                </div>
                <label class="report-field report-editor-neutral-template" hidden>Информационная фраза<textarea class="report-editor-neutral">${escapeHtml(config.templates.neutral)}</textarea></label>
            </div>
            <details class="report-editor-advanced">
                <summary>Дополнительные настройки</summary>
                <div class="report-advanced-settings-body">
                    <div class="report-field-grid">
                        <label class="report-field">Расчёт по данным<select class="report-editor-evaluation"><option value="period_max" ${selected('period_max', config.sla.evaluation)}>Максимум за период</option><option value="latest" ${selected('latest', config.sla.evaluation)}>Последнее значение</option><option value="period_min" ${selected('period_min', config.sla.evaluation)}>Минимум за период</option><option value="period_avg" ${selected('period_avg', config.sla.evaluation)}>Среднее за период</option><option value="period_sum" ${selected('period_sum', config.sla.evaluation)}>Сумма за период</option></select></label>
                        <label class="report-field report-editor-warning-fields">Предупредительный уровень<input class="report-editor-warning-value" type="number" step="any" value="${config.sla.warningValue ?? ''}" placeholder="необязательно"></label>
                    </div>
                    <label class="report-field report-editor-warning-fields">Если достигнут предупредительный уровень<textarea class="report-editor-warning">${escapeHtml(config.templates.warning)}</textarea></label>
                    <label class="report-switch"><input class="report-editor-details-enabled" type="checkbox" ${checked(config.detailsEnabled)}> Добавлять подробный список серверов</label>
                    <label class="report-field">Если данные графика недоступны<textarea class="report-editor-unavailable">${escapeHtml(config.templates.unavailable)}</textarea></label>
                </div>
            </details>
            <div class="report-panel-editor-error" role="alert" hidden></div>
            <div class="modal-actions report-panel-editor-actions"><button type="button" class="btn btn-outline report-panel-editor-cancel">Отмена</button><button type="button" class="btn btn-primary report-panel-editor-save">Сохранить фразы</button></div>
        </section>`;
    document.body.appendChild(overlay);
    overlay.style.display = 'flex';
    const sourceControl = overlay.querySelector('.report-editor-source');
    const sync = () => {
        const currentSource = sourceControl.value;
        overlay.querySelector('.report-editor-custom-sla').hidden = currentSource !== 'custom';
        overlay.querySelector('.report-editor-threshold-templates').hidden = currentSource === 'none';
        overlay.querySelector('.report-editor-neutral-template').hidden = currentSource !== 'none';
        overlay.querySelectorAll('.report-editor-warning-fields').forEach(field => {
            field.hidden = currentSource === 'none' || currentSource === 'cpu_capacity';
        });
        const sourceHint = overlay.querySelector('.report-effective-threshold');
        if (currentSource === 'cpu_capacity') {
            sourceHint.textContent = reportSourceLabel({ ...config, sla: { ...config.sla, source: 'cpu_capacity' } }, panel);
        } else if (currentSource === 'graph') {
            sourceHint.textContent = reportSourceLabel({ ...config, sla: { ...config.sla, source: 'graph' } }, panel);
        } else if (currentSource === 'custom') {
            sourceHint.textContent = 'Порог задаётся числом ниже.';
        } else {
            sourceHint.textContent = 'SLA не проверяется; в сообщение попадёт рассчитанное значение панели.';
        }
        const include = overlay.querySelector('.report-editor-include-mode');
        if (currentSource === 'none') include.value = 'always';
        include.disabled = currentSource === 'none';
        include.querySelector('[value="critical_only"]').disabled = currentSource === 'none';
    };
    const close = () => overlay.remove();
    overlay.querySelector('.report-panel-editor-close').addEventListener('click', close);
    overlay.querySelector('.report-panel-editor-cancel').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    sourceControl.addEventListener('change', sync);
    let activeTextarea = overlay.querySelector('textarea');
    overlay.querySelectorAll('textarea').forEach(area => area.addEventListener('focus', () => { activeTextarea = area; }));
    overlay.querySelectorAll('[data-emoji]').forEach(button => button.addEventListener('click', () => {
        const start = activeTextarea.selectionStart ?? activeTextarea.value.length;
        activeTextarea.setRangeText(button.dataset.emoji, start, activeTextarea.selectionEnd ?? start, 'end');
        activeTextarea.focus();
    }));
    overlay.querySelector('.report-panel-editor-save').addEventListener('click', async () => {
        const currentSource = sourceControl.value;
        const valueText = overlay.querySelector('.report-editor-sla-value').value.trim();
        const value = valueText === '' ? null : Number(valueText);
        const warningText = overlay.querySelector('.report-editor-warning-value').value.trim();
        const warningValue = warningText === '' ? null : Number(warningText);
        const error = overlay.querySelector('.report-panel-editor-error');
        if (currentSource === 'custom' && !Number.isFinite(value)) {
            error.textContent = 'Укажите числовое значение собственного SLA.';
            error.hidden = false;
            return;
        }
        if (currentSource !== 'cpu_capacity' && warningText !== '' && !Number.isFinite(warningValue)) {
            error.textContent = 'Укажите корректный предупредительный уровень.';
            error.hidden = false;
            return;
        }
        const operator = overlay.querySelector('.report-editor-operator').value;
        const criticalValue = currentSource === 'graph' ? Number(panel.tools?.thresholdValue) : value;
        if (!['none', 'cpu_capacity'].includes(currentSource) && Number.isFinite(warningValue) && Number.isFinite(criticalValue)) {
            const invalidOrder = ['gt', 'gte'].includes(operator)
                ? warningValue >= criticalValue : warningValue <= criticalValue;
            if (invalidOrder) {
                error.textContent = 'Предупредительный уровень должен наступать раньше нарушения SLA.';
                error.hidden = false;
                return;
            }
        }
        panel.report = DashBridgeReport.normalizePanel({
            enabled: overlay.querySelector('.report-editor-enabled').checked,
            key: config.key,
            includeMode: overlay.querySelector('.report-editor-include-mode').value,
            sla: { source: currentSource, operator,
                value, warningValue: currentSource === 'cpu_capacity' ? null : warningValue, unit: '',
                evaluation: currentSource === 'cpu_capacity'
                    ? (panel.tools?.cpuCapacityFilterMode === 'last' ? 'latest' : 'period_max')
                    : overlay.querySelector('.report-editor-evaluation').value },
            templates: { normal: overlay.querySelector('.report-editor-normal').value,
                warning: overlay.querySelector('.report-editor-warning').value,
                breached: overlay.querySelector('.report-editor-breached').value,
                neutral: overlay.querySelector('.report-editor-neutral').value,
                unavailable: overlay.querySelector('.report-editor-unavailable').value,
                listItem: config.templates.listItem, details: config.templates.details },
            detailsEnabled: overlay.querySelector('.report-editor-details-enabled').checked
        }, panel);
        await savePanels();
        onSaved?.(panel);
        close();
    });
    sync();
}

function reportVariableReferenceMarkup() {
    const group = (title, entries) => `<section class="report-variable-group"><h4>${title}</h4><dl>${entries.map(([name, description]) => `
        <div class="report-variable-row"><dt><code>${name}</code></dt><dd>${description}</dd></div>`).join('')}</dl></section>`;
    return `<details class="report-variable-reference">
        <summary>Справочник переменных шаблона</summary>
        <p>Переменные можно вставлять в общий шаблон, фразы панели, строки списков и блок подробностей.</p>
        <div class="report-variable-groups">
            ${group('Общие переменные', [
                ['{{profileName}}', 'Название текущего профиля DashBridge.'],
                ['{{testName}}', 'Название нагрузочного теста из блока «Контекст теста».'],
                ['{{environment}}', 'Контур или окружение проведения теста.'],
                ['{{testDuration}}', 'Время, прошедшее с указанного начала теста.'],
                ['{{stableLoadDuration}}', 'Продолжительность удержания стабильной нагрузки.'],
                ['{{period}}', 'Выбранный на сводном дашборде период Grafana.'],
                ['{{generatedAt}}', 'Дата и время формирования сообщения.'],
                ['{{panels}}', 'Все включённые фразы панелей в порядке карточек дашборда.'],
                ['{{panel:ключ}}', 'Фраза конкретной панели. Вместо «ключ» используется значение поля «Ключ панели».']
            ])}
            ${group('Переменные панели', [
                ['{{panelTitle}}', 'Название панели Grafana.'],
                ['{{warningThreshold}}', 'Предупредительное значение SLA.'],
                ['{{criticalThreshold}}', 'Критическое значение SLA.'],
                ['{{threshold}}', 'Совместимое имя критического порога для старых шаблонов.'],
                ['{{unit}}', 'Единица измерения: %, ms, req/s и т. п.'],
                ['{{criticalServers}}', 'Названия серверов с критическим нарушением через запятую.'],
                ['{{warningServers}}', 'Названия серверов предупредительного уровня через запятую.'],
                ['{{criticalCount}} / {{warningCount}}', 'Количество критических и предупредительных рядов.'],
                ['{{criticalList}}', 'Построчный список критических рядов.'],
                ['{{warningList}}', 'Построчный список рядов предупредительного уровня.'],
                ['{{breachesList}}', 'Объединённый список критических и предупредительных рядов.'],
                ['{{allSeriesList}}', 'Все видимые ряды панели с рассчитанными значениями.'],
                ['{{top3List}}', 'Три худших ряда с учётом направления SLA.'],
                ['{{stateList}}', 'Список, соответствующий текущему состоянию панели.'],
                ['{{stateQuote}}', 'Тот же список, где каждая строка начинается с > для цитатного блока.'],
                ['{{aggregateValue}}', 'Итог выбранного расчёта: максимум, минимум, среднее, сумма или последнее.'],
                ['{{cpuCapacityCoefficient}}', 'Коэффициент динамического SLA Load Average по vCPU.'],
                ['{{dataStatus}}', 'Точная причина недоступности данных: пустой datasource, HTTP/сетевая ошибка, ошибка разбора или таймаут.'],
                ['{{maxValue}} / {{minValue}}', 'Максимальное и минимальное значение панели за период.'],
                ['{{lastValue}}', 'Последнее доступное значение.'],
                ['{{averageValue}} / {{sumValue}}', 'Среднее значение и сумма значений за период.']
            ])}
            ${group('Переменные строки списка', [
                ['{{name}}', 'Название текущего ряда; для Load Average автоматически включает количество vCPU.'],
                ['{{rawName}}', 'Исходное название ряда без автоматически добавленного vCPU.'],
                ['{{vCpu}} / {{cpuCapacity}}', 'Количество vCPU для Load Average; пусто, если определить его не удалось.'],
                ['{{seriesThreshold}}', 'Индивидуальный порог Load Average: vCPU × коэффициент.'],
                ['{{value}}', 'Рассчитанное значение текущего ряда.'],
                ['{{unit}}', 'Единица измерения текущего ряда.'],
                ['{{level}}', 'Уровень строки: normal, warning или critical.']
            ])}
        </div>
    </details>`;
}

function openReportSettings(focusPanelId = null) {
    const profile = getActiveProfile();
    if (!profile) return;
    const profileConfig = DashBridgeReport.normalizeProfile(profile.report);
    const loadTestTemplate = '{{testName}}\nКонтур: {{environment}}\n\nПрошло {{stableLoadDuration}} удержания стабильной нагрузки, {{testDuration}} с начала теста.\n\n{{panels}}';
    const hasTestHeader = profileConfig.template.includes('{{testName}}')
        || profileConfig.template.includes('{{testDuration}}')
        || profileConfig.template.includes('{{stableLoadDuration}}');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay report-settings-overlay';
    overlay.innerHTML = `
        <section class="modal-content report-settings-modal" role="dialog" aria-modal="true">
            <div class="report-settings-header"><h3>Настройка сообщения — ${escapeHtml(profile.name)}</h3><button type="button" class="btn btn-outline report-close">Закрыть</button></div>
            <p class="report-settings-intro">Здесь задаётся структура общей сводки. Фразы каждой панели редактируются рядом с её графиком или кнопкой в списке ниже.</p>
            <details class="report-editor-section report-collapsible-section">
                <summary class="report-section-heading"><h4>Шапка сообщения</h4><span>необязательно</span></summary>
                <div class="report-section-body">
                <label class="report-switch"><input class="report-test-header" type="checkbox" ${hasTestHeader ? 'checked' : ''}> Добавить сведения о нагрузочном тесте</label>
                <div class="report-field-grid report-context-fields" ${hasTestHeader ? '' : 'hidden'}>
                    <label class="report-field">Название теста<input class="report-test-name" maxlength="500" value="${escapeHtml(profileConfig.context.testName)}"></label>
                    <label class="report-field">Контур / окружение<input class="report-environment" maxlength="500" value="${escapeHtml(profileConfig.context.environment)}"></label>
                    <label class="report-field">Начало теста<input class="report-test-started" type="datetime-local" value="${escapeHtml(profileConfig.context.testStartedAt)}"><small>Указывается вручную; {{testDuration}} = время от этой даты до формирования сообщения.</small></label>
                    <label class="report-field">Начало стабильной нагрузки<input class="report-stable-started" type="datetime-local" value="${escapeHtml(profileConfig.context.stableLoadStartedAt)}"><small>Указывается вручную; {{stableLoadDuration}} = время от этой даты до формирования сообщения.</small></label>
                </div>
                </div>
            </details>
            <details class="report-editor-section report-collapsible-section">
                <summary class="report-section-heading"><h4>Изменить структуру сообщения</h4><span>для нестандартного формата</span></summary>
                <div class="report-section-body">
                <label class="report-field"><textarea class="report-profile-template">${escapeHtml(profileConfig.template)}</textarea></label>
                </div>
            </details>
            <div class="report-panel-list-heading"><h3>Панели сообщения</h3><p>Подключайте панели одной галочкой. Порог, единица измерения и данные серверов будут получены автоматически.</p></div>
            <div class="report-panel-list">${(() => { const usedKeys = new Set(); return panels.map(panel => reportPanelCardMarkup(panel, usedKeys, panel.id === focusPanelId)).join(''); })()}</div>
            ${reportVariableReferenceMarkup()}
            <div class="modal-actions report-settings-actions"><button type="button" class="btn btn-outline report-cancel">Отмена</button><button type="button" class="btn btn-primary report-save">Сохранить</button></div>
        </section>`;
    document.body.appendChild(overlay);
    overlay.style.display = 'flex';
    const close = () => overlay.remove();
    overlay.querySelector('.report-close').addEventListener('click', close);
    overlay.querySelector('.report-cancel').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('.report-test-header').addEventListener('change', event => {
        const template = overlay.querySelector('.report-profile-template');
        overlay.querySelector('.report-context-fields').hidden = !event.currentTarget.checked;
        if (event.currentTarget.checked && template.value.trim() === DashBridgeReport.DEFAULT_PROFILE_TEMPLATE.trim()) {
            template.value = loadTestTemplate;
        } else if (!event.currentTarget.checked && template.value.trim() === loadTestTemplate.trim()) {
            template.value = DashBridgeReport.DEFAULT_PROFILE_TEMPLATE;
        }
    });
    overlay.querySelectorAll('.report-panel-card').forEach(card => {
        const enabled = card.querySelector('.report-enabled');
        enabled.addEventListener('change', () => {
            const panel = panels.find(item => item.id === card.dataset.panelId);
            if (!panel) return;
            const report = DashBridgeReport.normalizePanel(panel.report, panel);
            card.dataset.reportEnabled = String(enabled.checked);
            card.querySelector('.report-panel-auto-status').textContent = enabled.checked
                ? (report.sla.source === 'none' ? 'Информационная панель · показывать всегда'
                    : `${report.sla.source === 'graph' ? 'Порог графика' : report.sla.source === 'cpu_capacity' ? 'SLA по vCPU' : 'Собственный SLA'} · ${report.includeMode === 'always' ? 'показывать всегда' : 'только при нарушении'}`)
                : 'Не добавляется в сообщение';
        });
        card.querySelector('.report-open-panel-editor').addEventListener('click', () => {
            const panel = panels.find(item => item.id === card.dataset.panelId);
            if (!panel) return;
            openPanelReportEditor(panel, updated => {
                const next = DashBridgeReport.normalizePanel(updated.report, updated);
                enabled.checked = next.enabled;
                card.dataset.reportEnabled = String(next.enabled);
                card.querySelector('.report-panel-auto-status').textContent = next.enabled
                    ? `${next.sla.source === 'graph' ? 'Порог графика' : next.sla.source === 'custom' ? 'Собственный SLA' : next.sla.source === 'cpu_capacity' ? 'SLA по vCPU' : 'Информационная панель'} · ${next.includeMode === 'always' ? 'показывать всегда' : 'только при нарушении'}`
                    : 'Не добавляется в сообщение';
            });
        });
    });
    overlay.querySelector('.report-save').addEventListener('click', async () => {
        overlay.querySelectorAll('.report-panel-card').forEach(card => {
            const panel = panels.find(item => item.id === card.dataset.panelId);
            if (!panel) return;
            panel.report = DashBridgeReport.normalizePanel({
                ...panel.report,
                enabled: card.querySelector('.report-enabled').checked
            }, panel);
        });
        profile.report = DashBridgeReport.normalizeProfile({
            template: overlay.querySelector('.report-profile-template').value,
            context: {
                testName: overlay.querySelector('.report-test-name').value,
                environment: overlay.querySelector('.report-environment').value,
                testStartedAt: overlay.querySelector('.report-test-started').value,
                stableLoadStartedAt: overlay.querySelector('.report-stable-started').value
            }
        });
        await savePanels();
        close();
    });
    const focused = focusPanelId && overlay.querySelector(`.report-panel-card[data-panel-id="${CSS.escape(focusPanelId)}"]`);
    if (focused) {
        const panel = panels.find(item => item.id === focusPanelId);
        if (panel) openPanelReportEditor(panel, () => close());
    }
}

function getEffectivePanelSla(panel) {
    const config = DashBridgeReport.normalizePanel(panel.report, panel);
    if (config.sla.source === 'graph') {
        if (!panel.tools?.thresholdEnabled) return { error: 'Порог на графике выключен.' };
        return { source: 'graph', operator: 'gt', evaluation: config.sla.evaluation,
            value: panel.tools.thresholdValue, rawValue: panel.tools.thresholdRawValue,
            warningValue: config.sla.warningValue, unit: panel.tools.thresholdUnit || '' };
    }
    if (config.sla.source === 'cpu_capacity') {
        if (!panel.tools?.cpuCapacityFilterEnabled) return { error: 'Фильтр Load Average по vCPU выключен.' };
        const coefficient = Number(panel.tools.cpuCapacityFilterCoefficient ?? 0.8);
        if (!Number.isFinite(coefficient) || coefficient <= 0) return { error: 'Некорректный коэффициент фильтра Load Average по vCPU.' };
        return { source: 'cpu_capacity', operator: 'gt', coefficient,
            evaluation: panel.tools.cpuCapacityFilterMode === 'last' ? 'latest' : 'period_max', unit: '' };
    }
    return { ...config.sla };
}

function reportAbortError() {
    return new DOMException('Формирование сообщения отменено', 'AbortError');
}

function throwIfReportAborted(signal) {
    if (signal?.aborted) throw reportAbortError();
}

function waitForDashboardIframeReady(iframe, timeoutMs = DASHBRIDGE_REPORT_FRAME_TIMEOUT_MS, signal = null) {
    throwIfReportAborted(signal);
    if (!iframe?.isConnected) return Promise.reject(new Error('Iframe панели удалён'));
    if (iframe.dataset.dashbridgeLoaded === 'true') return Promise.resolve(iframe);
    return new Promise((resolve, reject) => {
        let settled = false;
        let frameObserver = null;
        let removalPoll = null;
        let timeout = null;
        const finish = error => {
            if (settled) return;
            settled = true;
            frameObserver?.disconnect();
            clearInterval(removalPoll);
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            error ? reject(error) : resolve(iframe);
        };
        const abort = () => finish(reportAbortError());
        const inspect = () => {
            if (!iframe.isConnected) return finish(new Error('Iframe панели удалён во время загрузки'));
            if (iframe.dataset.dashbridgeLoaded === 'true') finish();
        };
        frameObserver = new MutationObserver(inspect);
        frameObserver.observe(iframe, { attributes: true, attributeFilter: ['data-dashbridge-loaded'] });
        removalPoll = setInterval(inspect, 500);
        timeout = setTimeout(
            () => finish(new Error('Панель не загрузилась за 90 секунд')),
            timeoutMs
        );
        signal?.addEventListener('abort', abort, { once: true });
        inspect();
    });
}

async function requestPanelReportSnapshot(panel, signal = null) {
    throwIfReportAborted(signal);
    if (panel.paused) return Promise.resolve({
        state: 'unavailable', dataStatus: 'paused',
        dataStatusText: 'Панель находится на паузе', error: 'Панель находится на паузе', series: []
    });
    const sla = getEffectivePanelSla(panel);
    if (sla.error) return Promise.resolve({
        state: 'configuration_error', dataStatus: 'configuration_error',
        dataStatusText: sla.error, error: sla.error, series: []
    });
    const iframe = forceLoadPanel(panel.id);
    if (!iframe) {
        return Promise.resolve({
            state: 'unavailable', dataStatus: 'iframe_unavailable',
            dataStatusText: 'Iframe панели отсутствует', error: 'Iframe панели отсутствует', series: []
        });
    }
    try {
        await waitForDashboardIframeReady(iframe, DASHBRIDGE_REPORT_FRAME_TIMEOUT_MS, signal);
    } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        return {
            state: 'unavailable', dataStatus: 'iframe_unavailable',
            dataStatusText: error.message || 'Iframe панели недоступен',
            error: error.message || 'Iframe панели недоступен', series: []
        };
    }
    const requestId = `panel-report-${panel.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    throwIfReportAborted(signal);
    return new Promise((resolve, reject) => {
        let settled = false;
        let frameObserver = null;
        let removalPoll = null;
        let timeout = null;
        const finish = snapshot => {
            if (settled) return;
            settled = true;
            frameObserver?.disconnect();
            clearInterval(removalPoll);
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            panelReportWaiters.delete(requestId);
            resolve(snapshot);
        };
        const abort = () => {
            if (settled) return;
            settled = true;
            frameObserver?.disconnect();
            clearInterval(removalPoll);
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            panelReportWaiters.delete(requestId);
            postToDashboardFrame(iframe, { action: 'cancelPanelReportSnapshot', requestId });
            reject(reportAbortError());
        };
        const inspect = () => {
            if (!iframe.isConnected || iframe.dataset.dashbridgeLoaded !== 'true') {
                finish({
                    state: 'unavailable', dataStatus: 'iframe_unavailable',
                    dataStatusText: 'Iframe панели был закрыт или перезагружен во время получения данных',
                    error: 'Iframe панели был закрыт или перезагружен во время получения данных', series: []
                });
            }
        };
        frameObserver = new MutationObserver(inspect);
        frameObserver.observe(iframe, { attributes: true, attributeFilter: ['data-dashbridge-loaded'] });
        removalPoll = setInterval(inspect, 500);
        timeout = setTimeout(() => finish({
            state: 'timeout', dataStatus: 'timeout',
            dataStatusText: 'Панель не ответила за 125 секунд',
            error: 'Панель не ответила за 125 секунд', series: []
        }), DASHBRIDGE_REPORT_RESPONSE_TIMEOUT_MS);
        panelReportWaiters.set(requestId, { iframe, resolve: finish });
        signal?.addEventListener('abort', abort, { once: true });
        if (!postToDashboardFrame(iframe, { action: 'collectPanelReportSnapshot', requestId, sla })) {
            finish({
                state: 'unavailable', dataStatus: 'request_error',
                dataStatusText: 'Не удалось отправить запрос в iframe',
                error: 'Не удалось отправить запрос в iframe', series: []
            });
        }
    });
}

function setDashboardPanelDataStatus(panel, snapshot) {
    const card = document.querySelector(`.panel-card[data-panel-id="${CSS.escape(panel.id)}"]`);
    const wrapper = card?.querySelector('.iframe-wrapper');
    if (!wrapper) return;
    wrapper.querySelector('.dashbridge-panel-data-status')?.remove();
    const parentKinds = new Set(['timeout', 'iframe_unavailable', 'request_error', 'configuration_error']);
    const kind = String(snapshot?.dataStatus || '');
    const message = String(snapshot?.dataStatusText || snapshot?.error || '').trim();
    if (!parentKinds.has(kind) || !message) return;
    const status = document.createElement('div');
    status.className = 'dashbridge-panel-data-status';
    status.dataset.kind = kind;
    status.setAttribute('role', 'alert');
    status.textContent = message;
    wrapper.appendChild(status);
}

async function generateProfileReport(output, status, warnings, signal = null) {
    throwIfReportAborted(signal);
    const profile = getActiveProfile();
    const reportPanels = panels.filter(panel => DashBridgeReport.normalizePanel(panel.report, panel).enabled);
    if (!reportPanels.length) throw new Error('В настройках сообщения не выбрана ни одна панель.');
    status.textContent = `Получаем данные панелей: ${reportPanels.length}…`;
    reportPanels.forEach(panel => setDashboardPanelDataStatus(panel, null));
    let completedPanels = 0;
    const snapshots = await Promise.all(reportPanels.map(async panel => {
        throwIfReportAborted(signal);
        const snapshot = await requestPanelReportSnapshot(panel, signal);
        completedPanels += 1;
        setDashboardPanelDataStatus(panel, snapshot);
        if (status.isConnected) {
            status.textContent = `Получаем данные панелей: ${completedPanels} из ${reportPanels.length}…`;
        }
        return snapshot;
    }));
    throwIfReportAborted(signal);
    const context = {
        period: document.getElementById('timePickerLabel')?.textContent?.trim() || `${globalTimeFrom} — ${globalTimeTo}`,
        generatedAt: new Date().toLocaleString('ru-RU')
    };
    const profileContext = DashBridgeReport.normalizeProfile(profile.report).context;
    Object.assign(context, profileContext, {
        testDuration: DashBridgeReport.formatDuration(profileContext.testStartedAt),
        stableLoadDuration: DashBridgeReport.formatDuration(profileContext.stableLoadStartedAt)
    });
    const panelResults = reportPanels.map((panel, index) => {
        const rendered = DashBridgeReport.renderPanel(panel, snapshots[index], context);
        return { ...rendered, key: DashBridgeReport.normalizePanel(panel.report, panel).key, panel, snapshot: snapshots[index] };
    });
    const problems = panelResults.filter(item => ['unavailable', 'timeout', 'no_data', 'error', 'configuration_error'].includes(item.snapshot?.state));
    warnings.textContent = problems.map(item => `${item.panel.title || 'Панель'}: ${item.snapshot.error || 'данные недоступны'}`).join('\n');
    warnings.hidden = !problems.length;
    output.value = DashBridgeReport.compose(profile, panelResults, context);
    status.textContent = `Готово. Обработано панелей: ${reportPanels.length}; предупреждений: ${problems.length}.`;
}

function openReportPreview() {
    if (activeReportPreview?.isConnected) {
        activeReportPreview.querySelector('.report-close')?.focus();
        return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay report-preview-overlay';
    overlay.innerHTML = `<section class="modal-content report-preview-modal" role="dialog" aria-modal="true">
        <div class="report-preview-header"><h3>Сводное сообщение</h3><button type="button" class="btn btn-outline report-close">Закрыть</button></div>
        <div class="report-preview-status" role="status">Подготовка…</div>
        <div class="report-preview-warnings" hidden></div>
        <textarea class="report-preview-output" aria-label="Сформированное сообщение"></textarea>
        <div class="modal-actions"><button type="button" class="btn btn-outline report-regenerate">Обновить данные</button><button type="button" class="btn btn-primary report-copy">Скопировать</button></div>
    </section>`;
    document.body.appendChild(overlay); overlay.style.display = 'flex';
    activeReportPreview = overlay;
    const output = overlay.querySelector('.report-preview-output');
    const status = overlay.querySelector('.report-preview-status');
    const warnings = overlay.querySelector('.report-preview-warnings');
    const regenerate = overlay.querySelector('.report-regenerate');
    let running = false;
    let runController = null;
    const run = async () => {
        if (running) return;
        running = true;
        runController = new AbortController();
        const controller = runController;
        regenerate.disabled = true;
        warnings.hidden = true;
        warnings.textContent = '';
        try { await generateProfileReport(output, status, warnings, controller.signal); }
        catch (error) {
            if (error?.name !== 'AbortError' && status.isConnected) status.textContent = error.message || String(error);
        }
        finally {
            if (runController === controller) {
                runController = null;
                running = false;
                if (regenerate.isConnected) regenerate.disabled = false;
            }
        }
    };
    const close = () => {
        runController?.abort();
        if (activeReportPreview === overlay) activeReportPreview = null;
        overlay.remove();
    };
    overlay.querySelector('.report-close').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    regenerate.addEventListener('click', run);
    overlay.querySelector('.report-copy').addEventListener('click', async event => {
        try { await navigator.clipboard.writeText(output.value); event.currentTarget.textContent = 'Скопировано'; }
        catch { event.currentTarget.textContent = 'Ошибка копирования'; }
        setTimeout(() => { if (event.currentTarget.isConnected) event.currentTarget.textContent = 'Скопировать'; }, 1800);
    });
    void run();
}

let activeDashboardPanelAnalysis = null;

function requestDashboardPanelAnalysis(state) {
    if (!state) return false;
    return postToDashboardFrame(state.iframe, {
        action: 'startEmbeddedPanelAnalysis',
        requestId: state.requestId,
        analysisType: state.type,
        panelTitle: normalizePanelMetadataText(state.panel?.title, 240)
    });
}

function closeDashboardPanelAnalysis() {
    const active = activeDashboardPanelAnalysis;
    if (!active) return;
    activeDashboardPanelAnalysis = null;
    postToDashboardFrame(active.iframe, {
        action: 'cancelEmbeddedPanelAnalysis', requestId: active.requestId
    });
    active.overlay.remove();
}

function openDashboardPanelAnalysis(panel, iframe, type) {
    if (!panel || !iframe || !['cpu', 'ram'].includes(type)) return;
    closeDashboardPanelAnalysis();
    const requestId = `dashboard-analysis-${panel.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const create = (tag, className = '', text = '') => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    const overlay = create('div', 'modal-overlay dashboard-panel-analysis-overlay');
    const dialog = create('section', 'modal-content dashboard-panel-analysis-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const header = create('div', 'dashboard-panel-analysis-header');
    const heading = create('h3', '', `Анализ ${type.toUpperCase()} — ${window.DashBridgeGrafanaPanelAnalysis?.baseTitle(panel.title) || panel.title || ''}`);
    const close = create('button', 'dashboard-panel-analysis-close');
    close.type = 'button'; close.title = 'Закрыть'; close.setAttribute('aria-label', 'Закрыть');
    close.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
    header.append(heading, close);
    const modes = create('div', 'dashboard-panel-analysis-modes');
    const period = create('button', 'btn btn-primary active', 'Максимум за период');
    const latest = create('button', 'btn btn-outline', 'Последнее значение');
    period.type = latest.type = 'button';
    modes.append(period, latest);
    const status = create('div', 'dashboard-panel-analysis-status', 'Загрузка данных выбранной панели…');
    const output = create('div', 'dashboard-panel-analysis-output');
    const actions = create('div', 'dashboard-panel-analysis-actions');
    const copyAll = create('button', 'btn btn-outline', 'Скопировать список');
    const copyTop = create('button', 'btn btn-outline', 'Скопировать TOP-3');
    copyAll.type = copyTop.type = 'button';
    actions.append(copyAll, copyTop);
    dialog.append(header, modes, status, output, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.style.display = 'flex';

    const state = {
        requestId, panel, iframe, type, overlay, mode: 'period', snapshot: null, notice: '', status: 'loading',
        receive(message) {
            this.status = message.status || 'loading';
            this.notice = typeof message.notice === 'string' ? message.notice.substring(0, 500) : '';
            if (message.snapshot && typeof message.snapshot === 'object') this.snapshot = message.snapshot;
            render();
        }
    };
    activeDashboardPanelAnalysis = state;

    const render = () => {
        if (activeDashboardPanelAnalysis !== state) return;
        period.classList.toggle('btn-primary', state.mode === 'period');
        period.classList.toggle('btn-outline', state.mode !== 'period');
        latest.classList.toggle('btn-primary', state.mode === 'latest');
        latest.classList.toggle('btn-outline', state.mode !== 'latest');
        period.classList.toggle('active', state.mode === 'period');
        latest.classList.toggle('active', state.mode === 'latest');
        const selected = state.snapshot?.[state.mode];
        const items = Array.isArray(selected?.items) ? selected.items : [];
        output.replaceChildren();
        actions.hidden = !items.length;
        if (state.status === 'loading' && !state.snapshot) {
            status.textContent = 'Загрузка данных выбранной панели…';
            return;
        }
        if (!items.length) {
            status.textContent = state.notice || `Метрики ${type.toUpperCase()} не найдены в ответе выбранной панели.`;
            return;
        }
        status.textContent = `Найдено серверов: ${items.length}.${state.notice ? ` ${state.notice}` : ''}`;
        const table = create('table', 'dashboard-panel-analysis-table');
        const head = create('thead'); const headRow = create('tr');
        headRow.append(create('th', '', 'Сервер'), create('th', '', `${type.toUpperCase()} (%)`));
        head.appendChild(headRow);
        const body = create('tbody');
        const warning = Number(state.snapshot.warning);
        const critical = Number(state.snapshot.critical);
        items.forEach(item => {
            const row = create('tr');
            const server = create('td', '', String(item.server || ''));
            const valueNumber = Number(item.value);
            const value = create('td', Number.isFinite(valueNumber) && valueNumber >= critical
                ? 'critical' : (Number.isFinite(valueNumber) && valueNumber >= warning ? 'warning' : 'normal'));
            value.textContent = Number.isFinite(valueNumber) ? `${valueNumber.toFixed(2)}%` : '—';
            row.append(server, value); body.appendChild(row);
        });
        table.append(head, body); output.appendChild(table);
    };
    const copyText = async (button, key) => {
        const selected = state.snapshot?.[state.mode];
        const text = typeof selected?.[key] === 'string' ? selected[key] : '';
        if (!text) return;
        const original = button.textContent;
        try {
            await navigator.clipboard.writeText(text);
            button.textContent = 'Скопировано';
        } catch {
            button.textContent = 'Ошибка копирования';
        }
        setTimeout(() => { if (button.isConnected) button.textContent = original; }, 2000);
    };
    period.addEventListener('click', () => { state.mode = 'period'; render(); });
    latest.addEventListener('click', () => { state.mode = 'latest'; render(); });
    copyAll.addEventListener('click', () => { void copyText(copyAll, 'copyAll'); });
    copyTop.addEventListener('click', () => { void copyText(copyTop, 'copyTop'); });
    close.addEventListener('click', closeDashboardPanelAnalysis);
    const sent = requestDashboardPanelAnalysis(state);
    if (!sent) {
        state.status = 'empty';
        state.notice = 'Панель Grafana ещё не готова к анализу.';
        render();
    }
    close.focus();
}

// ════════════════════════════════════════════════════════
//  Инициализация
// ════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    const rulesPromise = chrome.runtime.sendMessage({ type: 'dashbridge-ensure-iframe-rules' })
        .then(rulesReady => {
            if (!rulesReady?.ok) {
                console.warn('Grafana iframe rules were not acknowledged:', rulesReady?.error || 'unknown error', rulesReady);
            }
        })
        .catch(error => console.warn('Could not prepare Grafana iframe rules:', error));
    const [storedSettings] = await Promise.all([
        chrome.storage.sync.get([...new Set([...getGrafanaSettingsStorageKeys(), 'grafanaCompactScreenshot'])]),
        loadProfiles(),
        rulesPromise
    ]);
    grafanaTransformSettings = normalizeGrafanaSettings(storedSettings);
    defaultCapturePrepared = !!storedSettings.grafanaCompactScreenshot;
    syncDashboardCaptureToggles(defaultCapturePrepared);
    setupTimeControls();
    setupEventListeners();
    setupDashboardDragAndDrop();
    const crosshairSlider = document.getElementById('crosshairThicknessSlider');
    if (crosshairSlider) crosshairSlider.value = crosshairThickness;
    updateCrosshairBtn();
    renderProfileSwitcher();
    renderDashboard();
});

function clearDragMarkers(_container) {
    dragTargetEl?.classList.remove('drag-over-left', 'drag-over-right');
    dragTargetEl = null;
    dragDropSide = null;
}

function savePanelOrder(container) {
    const panelsById = new Map(panels.map(panel => [panel.id, panel]));
    panels = [...container.querySelectorAll('.panel-card')]
        .map(card => panelsById.get(card.dataset.panelId))
        .filter(Boolean);
    savePanels();
}

function setupDashboardDragAndDrop() {
    const container = document.getElementById('dashboard');

    container.addEventListener('dragover', (e) => {
        if (!draggedEl) return;
        const target = e.target.closest('.panel-card');
        if (!target || target === draggedEl || !container.contains(target)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        clearDragMarkers(container);
        dragTargetEl = target;
        dragDropSide = e.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2 ? 'left' : 'right';
        target.classList.add(dragDropSide === 'left' ? 'drag-over-left' : 'drag-over-right');
    });

    container.addEventListener('dragleave', (e) => {
        if (e.target === container && !container.contains(e.relatedTarget)) clearDragMarkers(container);
    });

    container.addEventListener('drop', (e) => {
        if (!draggedEl || !dragTargetEl || !dragDropSide) return;
        e.preventDefault();
        if (dragDropSide === 'left') container.insertBefore(draggedEl, dragTargetEl);
        else container.insertBefore(draggedEl, dragTargetEl.nextSibling);
        savePanelOrder(container);
        clearDragMarkers(container);
    });
}

function getCompactCaptureDimensions() {
    return {
        width: grafanaTransformSettings.grafanaCompactExportWidth,
        height: grafanaTransformSettings.grafanaCompactExportHeight
    };
}

function syncDashboardCaptureToggles(enabled) {
    const dimensions = getCompactCaptureDimensions();
    document.querySelectorAll('.btn-capture-toggle').forEach(button => {
        button.classList.toggle('capture-toggle-active', enabled);
        button.setAttribute('aria-pressed', String(enabled));
        button.title = enabled
            ? `Компактный снимок ${dimensions.width}×${dimensions.height}: включён`
            : `Компактный снимок ${dimensions.width}×${dimensions.height}: выключен`;
        button.setAttribute('aria-label', button.title);
    });
}

function getPanelAnalysisType(panel) {
    return window.DashBridgeGrafanaPanelAnalysis?.classifyTitle(panel?.title, grafanaTransformSettings) || null;
}

function findPanelCard(panelId) {
    return document.querySelector(`.panel-card[data-panel-id="${CSS.escape(String(panelId))}"]`);
}

function syncPanelAnalysisAction(panel, card = findPanelCard(panel?.id)) {
    const action = card?.querySelector('.btn-analysis');
    if (!action) return null;
    const type = getPanelAnalysisType(panel);
    action.hidden = type !== 'cpu' && type !== 'ram';
    action.dataset.analysisType = type || '';
    action.title = type === 'ram' ? 'Анализ RAM' : 'Анализ CPU';
    action.setAttribute('aria-label', action.title);
    return type;
}

function closePanelExtraActions(except = null) {
    document.querySelectorAll('.panel-actions.extra-actions-open').forEach(actions => {
        if (actions === except) return;
        actions.classList.remove('extra-actions-open');
        actions.querySelectorAll('.panel-extra-inline').forEach(button => { button.hidden = true; });
        actions.querySelector('.btn-more')?.setAttribute('aria-expanded', 'false');
    });
}

function togglePanelExtraActions(button) {
    const actions = button?.closest('.panel-actions');
    if (!actions) return;
    const opening = !actions.classList.contains('extra-actions-open');
    closePanelExtraActions(opening ? actions : null);
    actions.classList.toggle('extra-actions-open', opening);
    actions.querySelectorAll('.panel-extra-inline').forEach(extra => { extra.hidden = !opening; });
    button.setAttribute('aria-expanded', String(opening));
}

function setDashboardCapturePrepared(enabled, { persist = true } = {}) {
    defaultCapturePrepared = !!enabled;
    syncDashboardCaptureToggles(defaultCapturePrepared);
    const dimensions = getCompactCaptureDimensions();
    document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
        postToDashboardFrame(iframe, {
            action: 'dashbridgeCapturePreparedDefaultChanged',
            enabled: defaultCapturePrepared,
            outputWidth: dimensions.width,
            outputHeight: dimensions.height
        });
    });
    if (persist) void chrome.storage.sync.set({ grafanaCompactScreenshot: defaultCapturePrepared });
    return defaultCapturePrepared;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (Object.keys(changes).some(key => grafanaTransformSettingKeys.has(key))) {
        const nextSettings = { ...grafanaTransformSettings };
        Object.entries(changes).forEach(([key, change]) => {
            if (grafanaTransformSettingKeys.has(key)) nextSettings[key] = change.newValue;
        });
        grafanaTransformSettings = normalizeGrafanaSettings(nextSettings);
        panels.forEach(panel => syncPanelAnalysisAction(panel));
    }
    if (changes.grafanaCompactScreenshot) {
        const nextPrepared = !!changes.grafanaCompactScreenshot.newValue;
        // A local click already updated every iframe before persisting. Ignore
        // its storage echo; external-tab changes still propagate normally.
        if (nextPrepared !== defaultCapturePrepared) {
            setDashboardCapturePrepared(nextPrepared, { persist: false });
        }
    } else if (changes.grafanaCompactExportWidth || changes.grafanaCompactExportHeight) {
        syncDashboardCaptureToggles(defaultCapturePrepared);
        const dimensions = getCompactCaptureDimensions();
        document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
            postToDashboardFrame(iframe, {
                action: 'dashbridgeCapturePreparedDefaultChanged',
                enabled: defaultCapturePrepared,
                outputWidth: dimensions.width,
                outputHeight: dimensions.height
            });
        });
    }
});

// ════════════════════════════════════════════════════════
//  Профили
// ════════════════════════════════════════════════════════

function getActiveProfile() {
    return profiles.find(p => p.id === activeProfileId) || profiles[0] || null;
}

async function loadProfiles() {
    const stored = await DashBridgeProfileStore.load();
    profiles = stored.profiles;
    const tabActiveProfileId = getTabActiveProfileId();
    setTabActiveProfileId(profiles.some(profile => profile.id === tabActiveProfileId)
        ? tabActiveProfileId : stored.activeProfileId);
    const legacyTimeState = DashBridgeTimeState.load();
    let migratedTimeState = false;
    profiles.forEach(profile => {
        if (!profile.timeState || typeof profile.timeState !== 'object') {
            profile.timeState = { ...legacyTimeState };
            migratedTimeState = true;
        } else {
            const normalizedTimeState = DashBridgeTimeState.normalize(profile.timeState);
            if (profile.timeState.from !== normalizedTimeState.from
                || profile.timeState.to !== normalizedTimeState.to
                || profile.timeState.refresh !== normalizedTimeState.refresh) {
                migratedTimeState = true;
            }
            profile.timeState = normalizedTimeState;
        }
    });
    loadActiveProfileTimeState();
    panels = [...(getActiveProfile()?.panels || [])];
    if (migratedTimeState) await saveProfiles();
    profilesLoaded = true;
    const skipped = (stored.skippedProfiles || 0) + (stored.skippedPanels || 0);
    if (skipped) {
        await showAlert(`Пропущено повреждённых записей DashBridge: ${skipped}. Остальные профили загружены безопасно.`);
    }
}

function saveProfiles() {
    return DashBridgeProfileStore.save(profiles, activeProfileId).then(result => {
        document.documentElement.dataset.dashbridgeStorageDirty = 'false';
        return result;
    }).catch(error => {
        document.documentElement.dataset.dashbridgeStorageDirty = 'true';
        console.error('Не удалось сохранить профили DashBridge:', error);
        return { current: false, error: error.message || String(error) };
    });
}

// savePanels всегда сохраняет в активный профиль
function savePanels() {
    const profile = getActiveProfile();
    if (profile) {
        profile.panels = panels;
        return saveProfiles();
    }
}

function profileStorageSignature(profileList, selectedProfileId) {
    try { return JSON.stringify({ profiles: profileList, activeProfileId: selectedProfileId }); }
    catch { return ''; }
}

function dashboardLayoutSignature(profile) {
    try {
        return JSON.stringify({
            id: profile?.id || '',
            timeState: DashBridgeTimeState.normalize(profile?.timeState),
            panels: (profile?.panels || []).map(panel => ({
                id: panel.id,
                title: panel.title,
                width: panel.width,
                height: panel.height,
                frame: panelFrameSignature(panel)
            }))
        });
    } catch {
        return '';
    }
}

async function syncProfilesFromStorage() {
    if (!profilesLoaded) return;
    const syncVersion = ++profileStorageSyncVersion;
    // A burst of panel metadata/settings saves is persisted as a sequence of
    // immutable snapshots. chrome.storage.onChanged is emitted for every
    // committed snapshot, including our own intermediate ones. Reading one of
    // those snapshots immediately can roll the in-memory profile back and
    // rebuild every iframe. Wait until our writer is idle so a self-generated
    // event is compared with the newest snapshot; genuine external changes
    // still pass through immediately when there is no local write in flight.
    await DashBridgeProfileStore.flush();
    if (syncVersion !== profileStorageSyncVersion) return;
    const stored = await DashBridgeProfileStore.load();
    if (syncVersion !== profileStorageSyncVersion) return;
    const nextProfiles = stored.profiles;
    const legacyTimeState = DashBridgeTimeState.load();
    nextProfiles.forEach(profile => {
        profile.timeState = DashBridgeTimeState.normalize(profile.timeState, legacyTimeState);
    });
    // Profile data is shared, but the selected profile belongs to this tab.
    // A save from another DashBridge tab must not navigate the current one.
    const nextActiveProfileId = nextProfiles.some(profile => profile.id === activeProfileId)
        ? activeProfileId
        : nextProfiles.some(profile => profile.id === stored.activeProfileId)
            ? stored.activeProfileId : nextProfiles[0]?.id || null;
    if (profileStorageSignature(profiles, activeProfileId)
        === profileStorageSignature(nextProfiles, nextActiveProfileId)) return;

    const previousActiveProfileId = activeProfileId;
    const previousPanels = panels;
    const previousPanelStates = previousPanels.map(panel => ({
        id: panel.id,
        title: panel.title,
        paused: !!panel.paused,
        frameSignature: panelFrameSignature(panel)
    }));
    const previousTimeState = DashBridgeTimeState.normalize(getActiveProfile()?.timeState);
    const previousActiveProfileSignature = profileStorageSignature([getActiveProfile()], activeProfileId);
    const previousDashboardLayoutSignature = dashboardLayoutSignature(getActiveProfile());
    profiles = nextProfiles;
    setTabActiveProfileId(nextActiveProfileId);
    panels = [...(getActiveProfile()?.panels || [])];
    const previousById = new Map(previousPanels.map(panel => [panel.id, panel]));
    const previousStateById = new Map(previousPanelStates.map(state => [state.id, state]));
    panels = panels.map(panel => {
        const previous = previousById.get(panel.id);
        const previousState = previousStateById.get(panel.id);
        const canKeepCardBindings = previous && previousState
            && previousState.frameSignature === panelFrameSignature(panel)
            && !(previousState.paused && previousState.title !== panel.title);
        return canKeepCardBindings ? adoptPanelState(previous, panel) : panel;
    });
    const activeProfile = getActiveProfile();
    if (activeProfile) activeProfile.panels = panels;
    renderProfileSwitcher();
    const activeProfileChanged = previousActiveProfileId !== activeProfileId
        || previousActiveProfileSignature !== profileStorageSignature([getActiveProfile()], activeProfileId);
    if (!activeProfileChanged) return;
    const dashboardLayoutChanged = previousDashboardLayoutSignature !== dashboardLayoutSignature(getActiveProfile());
    if (!dashboardLayoutChanged) return;
    loadActiveProfileTimeState();
    syncTimeControlsFromState();
    const activeProfileSwitched = previousActiveProfileId !== activeProfileId;
    const timeStateChanged = JSON.stringify(previousTimeState)
        !== JSON.stringify(DashBridgeTimeState.normalize(getActiveProfile()?.timeState));
    if (activeProfileSwitched || timeStateChanged) await renderDashboard();
    else reconcileDashboardPanelCards(previousPanelStates);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local'
        || (!changes.dashbridge_profiles && !changes.dashbridge_activeProfileId)) return;
    void syncProfilesFromStorage().catch(error => {
        console.error('Не удалось синхронизировать профили DashBridge между вкладками:', error);
    });
});

async function switchProfile(id) {
    if (id === activeProfileId) return;
    const currentProfile = getActiveProfile();
    if (currentProfile) currentProfile.panels = panels;
    setTabActiveProfileId(id);
    const profile = getActiveProfile();
    panels = profile ? [...(profile.panels || [])] : [];
    loadActiveProfileTimeState();
    await saveProfiles();
    renderProfileSwitcher();
    syncTimeControlsFromState();
    renderDashboard();
}

async function createProfile(name) {
    const currentProfile = getActiveProfile();
    if (currentProfile) currentProfile.panels = panels;
    const newProfile = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 120),
        panels: [],
        timeState: DashBridgeTimeState.defaults()
    };
    profiles.push(newProfile);
    setTabActiveProfileId(newProfile.id);
    panels = [];
    loadActiveProfileTimeState();
    await saveProfiles();
    renderProfileSwitcher();
    syncTimeControlsFromState();
    renderDashboard();
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void DashBridgeProfileStore.flush().catch(() => undefined);
});
window.addEventListener('pagehide', () => { void DashBridgeProfileStore.checkpoint().catch(() => undefined); });

function renameActiveProfile(newName) {
    const profile = getActiveProfile();
    if (!profile || !newName.trim()) return;
    profile.name = newName.trim().slice(0, 120);
    saveProfiles();
    renderProfileSwitcher();
}

async function deleteProfile(id) {
    if (profiles.length <= 1) {
        await showAlert('Нельзя удалить единственный профиль.');
        return;
    }
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    if (!await showConfirm(`Удалить профиль «${profile.name}»?\nВсе панели этого профиля будут потеряны.`)) return;

    const idx = profiles.findIndex(p => p.id === id);
    profiles.splice(idx, 1);

    if (activeProfileId === id) {
        // Переходим на соседний профиль
        const newActive = profiles[Math.max(0, idx - 1)];
        setTabActiveProfileId(newActive.id);
        panels = [...(newActive.panels || [])];
        loadActiveProfileTimeState();
        syncTimeControlsFromState();
        renderDashboard();
    }

    saveProfiles();
    renderProfileSwitcher();
}

function renderProfileSwitcher() {
    DashBridgeRenderer.renderProfileList({
        profiles,
        activeProfileId,
        onSelect(id) {
            document.getElementById('profileDropdown').style.display = 'none';
            switchProfile(id);
        }
    });
}

function escapeHtml(str) {
    return DashBridgeRenderer.escapeHtml(str);
}

function isSupportedPanelUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch (e) {
        return false;
    }
}

// Единая нормализация ссылки Grafana для карточки дашборда.
// Используется и при добавлении панели, и при правке URL в «Настройки iframe»,
// иначе отредактированная ссылка остаётся в режиме полного дашборда и панель
// приезжает вместе с верхней панелью настроек Grafana.
function normalizeGrafanaPanelUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('Поддерживаются только URL с протоколом http или https.');
    }

    const hasPanelId = url.searchParams.has('viewPanel') || url.searchParams.has('panelId');
    if (hasPanelId) {
        if (url.pathname.includes('/d/')) url.pathname = url.pathname.replace('/d/', '/d-solo/');
        if (url.searchParams.has('viewPanel')) {
            const panelId = url.searchParams.get('viewPanel');
            url.searchParams.delete('viewPanel');
            url.searchParams.set('panelId', panelId);
        }
    } else if (url.pathname.includes('/d-solo/')) {
        // Без panelId режим d-solo отдаёт пустую панель.
        url.pathname = url.pathname.replace('/d-solo/', '/d/');
    }

    url.searchParams.set('kiosk', 'tv');
    url.searchParams.set('dashbridge', '1');
    return url.toString();
}

function buildGrafanaSoloPanelUrl(dashboardUrl, panelId) {
    const url = new URL(dashboardUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('Поддерживаются только URL с протоколом http или https.');
    }

    if (url.pathname.includes('/d/')) {
        url.pathname = url.pathname.replace('/d/', '/d-solo/');
    } else if (!url.pathname.includes('/d-solo/')) {
        throw new Error('Укажите ссылку Grafana вида /d/... или /d-solo/....');
    }

    url.searchParams.delete('viewPanel');
    url.searchParams.delete('editPanel');
    url.searchParams.set('panelId', panelId);
    url.searchParams.set('kiosk', 'tv');
    url.searchParams.set('dashbridge', '1');
    return url.toString();
}

function getProfilePanelIdentity(value) {
    const grafanaIdentity = window.DashBridgeGrafanaPanelIdentity?.fromUrl(value) || '';
    if (grafanaIdentity) return grafanaIdentity;
    try {
        const url = new URL(value);
        ['from', 'to', 'refresh', 'theme', 'kiosk', 'dashbridge'].forEach(key => url.searchParams.delete(key));
        url.hash = '';
        url.searchParams.sort();
        return url.toString();
    } catch { return String(value || ''); }
}

function getCurrentProfilePanelIdentities() {
    return new Set(panels.map(panel => getProfilePanelIdentity(panel.src)).filter(Boolean));
}

function currentProfileHasPanel(value) {
    const identity = getProfilePanelIdentity(value);
    return !!identity && getCurrentProfilePanelIdentities().has(identity);
}

function parseQuickPanelIds(value) {
    const tokens = String(value || '').split(',').map(t => t.trim()).filter(Boolean);
    const invalid = tokens.filter(token => !/^\d+$/.test(token) || Number(token) < 1);
    if (invalid.length) throw new Error(`Некорректные ID панелей: ${invalid.join(', ')}`);
    return [...new Set(tokens)];
}

// ════════════════════════════════════════════════════════
//  Кастомные модалки (не блокируют выполнение, в отличие от alert/confirm/prompt)
// ════════════════════════════════════════════════════════

function showAlert(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = '<div class="modal-content" style="max-width: 400px;"><div class="form-group" style="margin-bottom: 16px;"><p style="margin: 0; color: var(--text-main);">' + escapeHtml(message) + '</p></div><div class="modal-actions"><button class="btn btn-primary modal-ok">OK</button></div></div>';
        document.body.appendChild(overlay);
        overlay.style.display = 'flex';
        const okBtn = overlay.querySelector('.modal-ok');
        okBtn.focus();
        const close = () => { overlay.remove(); resolve(true); };
        okBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    });
}

function showConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = '<div class="modal-content" style="max-width: 400px;"><div class="form-group" style="margin-bottom: 16px;"><p style="margin: 0; color: var(--text-main); white-space: pre-line;">' + escapeHtml(message) + '</p></div><div class="modal-actions"><button class="btn btn-outline modal-cancel">Отмена</button><button class="btn btn-primary modal-ok">OK</button></div></div>';
        document.body.appendChild(overlay);
        overlay.style.display = 'flex';
        const okBtn = overlay.querySelector('.modal-ok');
        const cancelBtn = overlay.querySelector('.modal-cancel');
        okBtn.focus();
        const onOk = () => { overlay.remove(); resolve(true); };
        const onCancel = () => { overlay.remove(); resolve(false); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });
    });
}

function showPrompt(message, defaultValue) {
    if (defaultValue === undefined) defaultValue = '';
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = '<div class="modal-content" style="max-width: 400px;"><div class="form-group" style="margin-bottom: 16px;"><label style="display: block; margin-bottom: 8px; color: var(--text-main);">' + escapeHtml(message) + '</label><input type="text" class="form-input modal-input" value="' + escapeHtml(defaultValue) + '" style="width: 100%;"></div><div class="modal-actions"><button class="btn btn-outline modal-cancel">Отмена</button><button class="btn btn-primary modal-ok">OK</button></div></div>';
        document.body.appendChild(overlay);
        overlay.style.display = 'flex';
        const input = overlay.querySelector('.modal-input');
        const okBtn = overlay.querySelector('.modal-ok');
        const cancelBtn = overlay.querySelector('.modal-cancel');
        input.focus();
        input.select();
        const onOk = () => { const v = input.value; overlay.remove(); resolve(v); };
        const onCancel = () => { overlay.remove(); resolve(null); };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') onOk();
            else if (e.key === 'Escape') onCancel();
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });
    });
}

// ════════════════════════════════════════════════════════
//  Тема
// ════════════════════════════════════════════════════════

function updateCrosshairBtn() {
    const toggle = document.getElementById('crosshairToggleCheckbox');
    if (toggle) toggle.checked = crosshairMode === 'line';

    const valueLabel = document.getElementById('crosshairThicknessValue');
    if (valueLabel) valueLabel.textContent = crosshairThickness + 'px';
}
// ════════════════════════════════════════════════════════
//  Обработчики событий
// ════════════════════════════════════════════════════════

async function refreshAllPanels() {
    document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
        const panel = getPanelForIframe(iframe);
        if (!panel || panel.paused) return;
        if (iframe.src) navigateDashboardFrame(iframe, applyPanelParamsToUrl(panel, iframe.src));
        else if (iframe.dataset.src) iframe.dataset.src = applyPanelParamsToUrl(panel, iframe.dataset.src);
    });
}

function setupEventListeners() {
    // --- Тема (глобальная, синхронизируется через chrome.storage.sync) ---
    document.getElementById('capturePreparedToggleBtn')?.addEventListener('click', () => {
        setDashboardCapturePrepared(!defaultCapturePrepared);
    });
    document.getElementById('captureAllPanelsBtn')?.addEventListener('click', event => {
        void captureAllDashboardPanels(event.currentTarget);
    });

    // --- Режим курсора (меню) ---
    const crosshairMenuBtn = document.getElementById('crosshairMenuBtn');
    const crosshairDropdown = document.getElementById('crosshairDropdown');
    const crosshairToggleCheckbox = document.getElementById('crosshairToggleCheckbox');

    if (crosshairMenuBtn) {
        crosshairMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isShowing = crosshairDropdown.style.display === 'flex';
            closeHeaderMenus(); // Закрываем остальные
            crosshairDropdown.style.display = isShowing ? 'none' : 'flex';
            crosshairMenuBtn.setAttribute('aria-expanded', !isShowing);
        });
    }

    if (crosshairDropdown) {
        crosshairDropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    if (crosshairToggleCheckbox) {
        crosshairToggleCheckbox.addEventListener('change', (e) => {
            crosshairMode = e.target.checked ? 'line' : 'off';
            try {
                localStorage.setItem('dashbridge_crosshairMode', crosshairMode);
            } catch (err) { }
            if (crosshairMode === 'off') hideCrosshair();
            document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(ifr => {
                postToDashboardFrame(ifr, { action: 'setCrosshairMode', mode: crosshairMode, thickness: crosshairThickness });
            });
        });
    }

    const crosshairSlider = document.getElementById('crosshairThicknessSlider');
    if (crosshairSlider) {
        crosshairSlider.addEventListener('input', (e) => {
            crosshairThickness = parseInt(e.target.value, 10) || 1;
            const valueLabel = document.getElementById('crosshairThicknessValue');
            if (valueLabel) valueLabel.textContent = crosshairThickness + 'px';

            try {
                localStorage.setItem('dashbridge_crosshairThickness', crosshairThickness);
            } catch (err) { }
            document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(ifr => {
                postToDashboardFrame(ifr, { action: 'setCrosshairThickness', thickness: crosshairThickness });
            });
        });
    }

    // --- Профили ---
    const profileDropdown = document.getElementById('profileDropdown');
    const dataDropdown = document.getElementById('dataDropdown');
    const addPanelDropdown = document.getElementById('addPanelDropdown');
    const reportDropdown = document.getElementById('reportDropdown');
    const closeHeaderMenus = () => {
        if (dataDropdown) dataDropdown.style.display = 'none';
        if (addPanelDropdown) addPanelDropdown.style.display = 'none';
        if (reportDropdown) reportDropdown.style.display = 'none';
        if (crosshairDropdown) crosshairDropdown.style.display = 'none';
        document.getElementById('dataMenuBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('addPanelMenuBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('reportMenuBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('crosshairMenuBtn')?.setAttribute('aria-expanded', 'false');
    };
    document.getElementById('profilePickerBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        const isShowing = profileDropdown.style.display === 'flex';
        profileDropdown.style.display = isShowing ? 'none' : 'flex';
        // Закрываем другие поповеры
        document.getElementById('timePopover').style.display = 'none';
        document.getElementById('refreshPopover').style.display = 'none';
        closeHeaderMenus();
        if (!isShowing) renderProfileSwitcher();
    });
    profileDropdown.addEventListener('click', (e) => e.stopPropagation());

    const toggleHeaderMenu = (button, dropdown) => {
        const isShowing = dropdown.style.display === 'block';
        closeHeaderMenus();
        profileDropdown.style.display = 'none';
        document.getElementById('timePopover').style.display = 'none';
        document.getElementById('refreshPopover').style.display = 'none';
        if (!isShowing) {
            dropdown.style.display = 'block';
            button.setAttribute('aria-expanded', 'true');
        }
    };
    document.getElementById('dataMenuBtn').addEventListener('click', event => {
        event.stopPropagation();
        toggleHeaderMenu(event.currentTarget, dataDropdown);
    });
    document.getElementById('addPanelMenuBtn').addEventListener('click', event => {
        event.stopPropagation();
        toggleHeaderMenu(event.currentTarget, addPanelDropdown);
    });
    document.getElementById('reportMenuBtn').addEventListener('click', event => {
        event.stopPropagation();
        toggleHeaderMenu(event.currentTarget, reportDropdown);
    });
    dataDropdown.addEventListener('click', event => event.stopPropagation());
    addPanelDropdown.addEventListener('click', event => event.stopPropagation());
    reportDropdown.addEventListener('click', event => event.stopPropagation());
    document.getElementById('configureReportBtn').addEventListener('click', () => {
        closeHeaderMenus(); openReportSettings();
    });
    document.getElementById('generateReportBtn').addEventListener('click', () => {
        closeHeaderMenus(); openReportPreview();
    });

    document.getElementById('newProfileBtn').addEventListener('click', async () => {
        const name = await showPrompt('Название нового профиля:');
        if (name && name.trim()) createProfile(name.trim());
    });

    document.getElementById('renameProfileBtn').addEventListener('click', async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const name = await showPrompt('Переименовать профиль:', profile.name);
        if (name && name.trim() && name.trim() !== profile.name) {
            renameActiveProfile(name.trim());
        }
    });

    document.getElementById('deleteProfileBtn').addEventListener('click', () => {
        deleteProfile(activeProfileId);
    });

    // --- Модал добавления панели ---
    const modal = document.getElementById('modalOverlay');
    document.getElementById('addPanelBtn').addEventListener('click', () => {
        modal.style.display = 'flex';
        document.getElementById('newPanelUrl').focus();
    });
    document.getElementById('closeModalBtn').addEventListener('click', () => {
        modal.style.display = 'none';
        document.getElementById('newPanelUrl').value = '';
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            document.getElementById('newPanelUrl').value = '';
        }
    });

    document.getElementById('savePanelBtn').addEventListener('click', async () => {
        let url = document.getElementById('newPanelUrl').value.trim();
        const width = document.getElementById('newPanelWidth').value;
        if (!url) { await showAlert('Укажите URL!'); return; }

        try {
            url = normalizeGrafanaPanelUrl(url);
        } catch (e) {
            console.error('Invalid URL format', e);
            await showAlert('Укажите корректный URL с протоколом http или https.');
            return;
        }

        if (currentProfileHasPanel(url)) {
            await showAlert('Эта панель уже есть в текущем профиле.');
            return;
        }

        const addedPanel = { id: crypto.randomUUID(), src: url, width, height: '350px' };
        panels.push(addedPanel);
        savePanels();
        appendDashboardPanelCards([addedPanel]);
        modal.style.display = 'none';
        document.getElementById('newPanelUrl').value = '';
    });

    // --- Экспорт / Импорт ---
    // Quick addition of several panels from one dashboard URL.
    const quickAddModal = document.getElementById('quickAddModalOverlay');
    const clearQuickAddForm = () => {
        document.getElementById('quickAddDashboardUrl').value = '';
        document.getElementById('quickAddPanelIds').value = '';
    };
    const closeQuickAddModal = () => {
        quickAddModal.style.display = 'none';
        clearQuickAddForm();
    };

    document.getElementById('quickAddPanelsBtn').addEventListener('click', () => {
        quickAddModal.style.display = 'flex';
        document.getElementById('quickAddDashboardUrl').focus();
    });
    document.getElementById('closeQuickAddModalBtn').addEventListener('click', closeQuickAddModal);
    quickAddModal.addEventListener('click', event => {
        if (event.target === quickAddModal) closeQuickAddModal();
    });
    document.getElementById('saveQuickPanelsBtn').addEventListener('click', async () => {
        const dashboardUrl = document.getElementById('quickAddDashboardUrl').value.trim();
        const width = document.getElementById('quickAddPanelWidth').value;
        if (!dashboardUrl) {
            await showAlert('Укажите URL дашборда Grafana.');
            return;
        }

        let panelIds;
        try {
            panelIds = parseQuickPanelIds(document.getElementById('quickAddPanelIds').value);
            if (!panelIds.length) throw new Error('Укажите хотя бы один ID панели.');
        } catch (error) {
            await showAlert(error.message);
            return;
        }

        let panelUrls;
        try {
            panelUrls = panelIds.map(panelId => buildGrafanaSoloPanelUrl(dashboardUrl, panelId));
        } catch (error) {
            await showAlert(error.message || 'Не удалось подготовить URL панелей.');
            return;
        }

        const existingPanelIdentities = getCurrentProfilePanelIdentities();
        const newPanels = panelUrls
            .filter(url => {
                const identity = getProfilePanelIdentity(url);
                if (!identity || existingPanelIdentities.has(identity)) return false;
                existingPanelIdentities.add(identity);
                return true;
            })
            .map(url => ({ id: crypto.randomUUID(), src: url, width, height: '350px' }));

        if (!newPanels.length) {
            await showAlert('Все указанные панели уже есть в текущем профиле.');
            return;
        }

        panels.push(...newPanels);
        savePanels();
        appendDashboardPanelCards(newPanels);
        closeQuickAddModal();
        if (newPanels.length !== panelIds.length) {
            await showAlert(`Добавлено панелей: ${newPanels.length}. Уже существующие панели пропущены.`);
        }
    });

    // Independent dashboard inventory picker. The existing ID-based flow above
    // remains available for users who already know the panel IDs.
    const dashboardPicker = document.getElementById('dashboardPanelPickerOverlay');
    const dashboardPickerUrl = document.getElementById('dashboardPanelPickerUrl');
    const dashboardPickerStatus = document.getElementById('dashboardPanelPickerStatus');
    const dashboardPickerSelection = document.getElementById('dashboardPanelPickerSelection');
    const dashboardPickerList = document.getElementById('dashboardPanelPickerList');
    const dashboardPickerAdd = document.getElementById('addSelectedDashboardPanelsBtn');
    const dashboardPickerLoad = document.getElementById('loadDashboardPanelsBtn');
    let dashboardPickerState = null;
    let dashboardPickerLoadVersion = 0;

    const updateDashboardPickerSelection = () => {
        const selected = dashboardPickerList.querySelectorAll('input[type="checkbox"]:checked').length;
        dashboardPickerAdd.disabled = selected === 0;
        if (dashboardPickerState) {
            const available = dashboardPickerList.querySelectorAll('input[type="checkbox"]:not(:disabled)').length;
            dashboardPickerStatus.textContent = available
                ? `Выбрано панелей: ${selected} из ${available}.`
                : 'Все найденные панели уже добавлены в текущий профиль.';
        }
    };
    const resetDashboardPicker = () => {
        dashboardPickerLoadVersion += 1;
        dashboardPickerState = null;
        dashboardPickerUrl.value = '';
        dashboardPickerStatus.textContent = '';
        dashboardPickerList.replaceChildren();
        dashboardPickerSelection.hidden = true;
        dashboardPickerAdd.disabled = true;
        dashboardPickerLoad.disabled = false;
        dashboardPickerLoad.textContent = 'Получить панели';
    };
    const closeDashboardPicker = () => {
        dashboardPicker.style.display = 'none';
        resetDashboardPicker();
    };
    const renderDashboardPickerPanels = (dashboardUrl, panelList) => {
        const existingPanelIdentities = getCurrentProfilePanelIdentities();
        const safePanels = (Array.isArray(panelList) ? panelList : [])
            .filter(panel => /^\d+$/.test(String(panel?.id || '')) && Number(panel.id) > 0)
            .slice(0, 2000)
            .map(panel => ({
                id: String(panel.id),
                title: normalizePanelMetadataText(panel.title || `Panel_${panel.id}`, 240),
                type: normalizePanelMetadataText(panel.type || '', 80),
                url: buildGrafanaSoloPanelUrl(dashboardUrl, String(panel.id))
            }));
        dashboardPickerList.replaceChildren();
        safePanels.forEach((panel, index) => {
            const existing = existingPanelIdentities.has(getProfilePanelIdentity(panel.url));
            const item = document.createElement('label');
            item.className = `dashboard-panel-picker-item${existing ? ' is-existing' : ''}`;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.panelIndex = String(index);
            checkbox.checked = !existing;
            checkbox.disabled = existing;
            checkbox.addEventListener('change', updateDashboardPickerSelection);
            const title = document.createElement('span');
            title.className = 'dashboard-panel-picker-item-title';
            title.textContent = panel.title;
            const meta = document.createElement('span');
            meta.className = 'dashboard-panel-picker-item-meta';
            meta.textContent = existing
                ? `ID ${panel.id} · уже добавлена`
                : `ID ${panel.id}${panel.type ? ` · ${panel.type}` : ''}`;
            item.append(checkbox, title, meta);
            dashboardPickerList.appendChild(item);
        });
        dashboardPickerState = { dashboardUrl, panels: safePanels };
        dashboardPickerSelection.hidden = false;
        if (!safePanels.length) {
            dashboardPickerStatus.textContent = 'В дашборде не найдены панели с числовыми ID.';
            dashboardPickerAdd.disabled = true;
            return;
        }
        updateDashboardPickerSelection();
    };

    document.getElementById('discoverDashboardPanelsBtn').addEventListener('click', () => {
        dashboardPicker.style.display = 'flex';
        dashboardPickerUrl.focus();
    });
    document.getElementById('closeDashboardPanelPickerBtn').addEventListener('click', closeDashboardPicker);
    document.getElementById('cancelDashboardPanelPickerBtn').addEventListener('click', closeDashboardPicker);
    dashboardPicker.addEventListener('click', event => {
        if (event.target === dashboardPicker) closeDashboardPicker();
    });
    dashboardPickerLoad.addEventListener('click', async () => {
        const dashboardUrl = dashboardPickerUrl.value.trim();
        let dashboardLocation = null;
        try { dashboardLocation = new URL(dashboardUrl); } catch { dashboardLocation = null; }
        if (!parseGrafanaDashboardUrl(dashboardUrl)
            || !['http:', 'https:'].includes(dashboardLocation?.protocol)
            || dashboardLocation.username || dashboardLocation.password) {
            dashboardPickerStatus.textContent = 'Укажите корректный URL дашборда Grafana вида /d/...';
            return;
        }
        const loadVersion = ++dashboardPickerLoadVersion;
        dashboardPickerState = null;
        dashboardPickerSelection.hidden = true;
        dashboardPickerList.replaceChildren();
        dashboardPickerAdd.disabled = true;
        dashboardPickerLoad.disabled = true;
        dashboardPickerLoad.textContent = 'Загрузка…';
        dashboardPickerStatus.textContent = 'Получаем список панелей Grafana…';
        try {
            const result = await fetchGrafanaDashboardPanels(dashboardUrl);
            if (loadVersion !== dashboardPickerLoadVersion || dashboardPicker.style.display !== 'flex') return;
            renderDashboardPickerPanels(dashboardUrl, result.panelList);
        } catch (error) {
            if (loadVersion !== dashboardPickerLoadVersion) return;
            const unauthorized = [401, 403].includes(Number(error?.status))
                || error?.code === 'GRAFANA_AUTH_REQUIRED';
            dashboardPickerStatus.textContent = unauthorized
                ? 'Требуется авторизация Grafana. Откройте дашборд в обычной вкладке, войдите и повторите запрос.'
                : `Не удалось получить панели: ${String(error?.message || error).slice(0, 300)}`;
        } finally {
            if (loadVersion === dashboardPickerLoadVersion) {
                dashboardPickerLoad.disabled = false;
                dashboardPickerLoad.textContent = 'Получить панели';
            }
        }
    });
    document.getElementById('selectAllDashboardPanelsBtn').addEventListener('click', () => {
        dashboardPickerList.querySelectorAll('input[type="checkbox"]:not(:disabled)')
            .forEach(input => { input.checked = true; });
        updateDashboardPickerSelection();
    });
    document.getElementById('clearDashboardPanelsBtn').addEventListener('click', () => {
        dashboardPickerList.querySelectorAll('input[type="checkbox"]:not(:disabled)')
            .forEach(input => { input.checked = false; });
        updateDashboardPickerSelection();
    });
    dashboardPickerAdd.addEventListener('click', async () => {
        if (!dashboardPickerState) return;
        const selectedIndexes = [...dashboardPickerList.querySelectorAll('input[type="checkbox"]:checked')]
            .map(input => Number(input.dataset.panelIndex))
            .filter(Number.isInteger);
        const width = document.getElementById('dashboardPanelPickerWidth').value;
        const existingPanelIdentities = getCurrentProfilePanelIdentities();
        const selectedPanels = selectedIndexes
            .map(index => dashboardPickerState.panels[index])
            .filter(panel => {
                if (!panel) return false;
                const identity = getProfilePanelIdentity(panel.url);
                if (!identity || existingPanelIdentities.has(identity)) return false;
                existingPanelIdentities.add(identity);
                return true;
            });
        if (!selectedPanels.length) {
            dashboardPickerStatus.textContent = 'Выберите хотя бы одну панель, которой ещё нет в профиле.';
            updateDashboardPickerSelection();
            return;
        }
        const addedPanels = selectedPanels.map(panel => ({
            id: crypto.randomUUID(), src: panel.url, title: panel.title, width, height: '350px'
        }));
        panels.push(...addedPanels);
        await savePanels();
        appendDashboardPanelCards(addedPanels);
        closeDashboardPicker();
        if (selectedPanels.length !== selectedIndexes.length) {
            await showAlert(`Добавлено панелей: ${selectedPanels.length}. Уже существующие панели пропущены.`);
        }
    });

    document.getElementById('exportPanelsBtn').addEventListener('click', exportPanels);
    const importInput = document.getElementById('importPanelsInput');
    document.getElementById('importPanelsBtn').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importPanels(file);
        importInput.value = '';
    });

    // --- ESC выходит из fullscreen ---
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (dashboardPicker.style.display === 'flex') closeDashboardPicker();
        if (activeDashboardPanelAnalysis) closeDashboardPanelAnalysis();
        closePanelExtraActions();
        if (fullscreenPanelId) toggleFullscreen(fullscreenPanelId);
    });

    // --- Закрыть все поповеры по клику вне ---
    document.addEventListener('click', () => {
        profileDropdown.style.display = 'none';
        closeHeaderMenus();
        const tp = document.getElementById('timePopover');
        const rp = document.getElementById('refreshPopover');
        if (tp) tp.style.display = 'none';
        if (rp) rp.style.display = 'none';
        closePanelExtraActions();
    });
}

// ════════════════════════════════════════════════════════
//  Управление панелями
// ════════════════════════════════════════════════════════

async function deletePanel(id) {
    if (await showConfirm('Удалить панель?')) {
        panels = panels.filter(p => p.id !== id);
        savePanels();
        removeDashboardPanelCard(id);
    }
}

// Обновляет iframe панели: если ещё не загружен — форсирует загрузку с cache-busting
function refreshPanel(id) {
    const panel = panels.find(item => item.id === id);
    if (panel) setDashboardPanelDataStatus(panel, null);
    const iframe = forceLoadPanel(id);
    if (iframe && iframe.src) {
        const url = new URL(applyPanelParamsToUrl(panel, iframe.src));
        url.searchParams.set('_t', Date.now());
        navigateDashboardFrame(iframe, url.toString());
    }
}

// При входе в fullscreen форсируем загрузку iframe, иначе пользователь увидит пустой экран
function refreshPanelThresholdLayout(id) {
    const panel = panels.find(item => item.id === id);
    const iframe = document.getElementById('iframe-' + id);
    if (!panel?.tools?.thresholdEnabled || !iframe) return;

    let notified = false;
    let observer = null;
    const notifyAfterLayout = () => {
        if (notified) return;
        notified = true;
        observer?.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            postToDashboardFrame(iframe, { action: 'refreshPanelThresholdLayout' });
        }));
    };
    if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(notifyAfterLayout);
        observer.observe(iframe);
    }
    // The fallback also covers browsers that do not expose ResizeObserver.
    requestAnimationFrame(() => requestAnimationFrame(notifyAfterLayout));
}

function toggleFullscreen(id) {
    const card = findPanelCard(id);
    if (!card) return;
    const isCurrentlyFullscreen = fullscreenPanelId === id;

    if (fullscreenPanelId) {
        const prevCard = findPanelCard(fullscreenPanelId);
        if (prevCard) {
            prevCard.classList.remove('fullscreen');
            const prevBtn = prevCard.querySelector('.btn-fullscreen');
            if (prevBtn) { prevBtn.innerHTML = SVG_EXPAND; prevBtn.title = 'На весь экран'; }
        }
        fullscreenPanelId = null;
    }

    if (!isCurrentlyFullscreen) {
        card.classList.add('fullscreen');
        const btn = card.querySelector('.btn-fullscreen');
        if (btn) { btn.innerHTML = SVG_COLLAPSE; btn.title = 'Свернуть (Esc)'; }
        fullscreenPanelId = id;
        // Гарантируем наличие iframe перед переходом в полноэкранный режим.
        forceLoadPanel(id);
    }
    refreshPanelThresholdLayout(id);
}

async function exportPanels() {
    if (panels.length === 0) { await showAlert('Нет панелей для экспорта.'); return; }
    const profile = getActiveProfile();
    const data = {
        version: 3,
        profileName: profile ? profile.name : 'Default',
        timeState: DashBridgeTimeState.normalize(profile?.timeState),
        report: DashBridgeReport.normalizeProfile(profile?.report),
        exportedAt: new Date().toISOString(),
        // JSON serialization creates the export snapshot. Keep the complete
        // panel contract: tools, theme, pause state and forward-compatible data.
        panels
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (profile?.name || 'panels').replace(/[^a-zа-яё0-9]/gi, '_').toLowerCase();
    a.download = `dashbridge_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function importPanels(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.panels || !Array.isArray(data.panels)) {
                await showAlert('Неверный формат файла: ожидается поле panels[]');
                return;
            }
            const profileName = String(data.profileName || file.name.replace('.json', '')).trim().slice(0, 120) || 'Imported';
            const importedTimeState = DashBridgeTimeState.normalize(data.timeState);
            const importedReport = DashBridgeReport.normalizeProfile(data.report);
            const importedPanels = [];
            for (const source of data.panels) {
                if (!source || typeof source !== 'object' || typeof source.src !== 'string' || !isSupportedPanelUrl(source.src)) continue;
                const height = Number.parseInt(source.height, 10);
                const candidate = {
                    ...source,
                    id: crypto.randomUUID(),
                    width: ['33%', '50%', '100%'].includes(source.width) ? source.width : '50%',
                    height: Number.isFinite(height) ? `${Math.min(3000, Math.max(180, height))}px` : '350px'
                };
                try {
                    const normalized = DashBridgeLocalStateSchema.normalizeProfiles([{
                        id: crypto.randomUUID(), name: profileName, panels: [candidate]
                    }]).items[0]?.panels[0];
                    if (normalized) importedPanels.push(normalized);
                } catch (error) {
                    console.warn('Пропущена некорректная импортируемая панель:', error);
                }
            }
            if (importedPanels.length === 0) { await showAlert('В файле нет панелей с корректными настройками и URL.'); return; }

            const choice = await showConfirm(
                `Файл содержит ${importedPanels.length} панел(и).\n\n` +
                `[OK] — Заменить панели текущего профиля\n` +
                `[Отмена] — Создать новый профиль «${profileName}»`
            );

            if (choice) {
                // Заменяем панели активного профиля
                panels = importedPanels;
                const activeProfile = getActiveProfile();
                if (activeProfile && data.timeState && typeof data.timeState === 'object') {
                    activeProfile.timeState = importedTimeState;
                    loadActiveProfileTimeState();
                    syncTimeControlsFromState();
                }
                if (activeProfile && data.report && typeof data.report === 'object') activeProfile.report = importedReport;
                savePanels();
                renderDashboard();
            } else {
                // Создаём новый профиль с импортированными панелями
                const newProfile = {
                    id: crypto.randomUUID(), name: profileName, panels: importedPanels,
                    timeState: importedTimeState, report: importedReport
                };
                const currentProfile = getActiveProfile();
                if (currentProfile) currentProfile.panels = panels;
                profiles.push(newProfile);
                setTabActiveProfileId(newProfile.id);
                panels = importedPanels;
                loadActiveProfileTimeState();
                await saveProfiles();
                renderProfileSwitcher();
                syncTimeControlsFromState();
                renderDashboard();
            }
        } catch (err) {
            await showAlert('Ошибка чтения файла: ' + err.message);
        }
    };
    reader.readAsText(file);
}

window.deletePanel = deletePanel;
window.refreshPanel = refreshPanel;

// ════════════════════════════════════════════════════════
//  Рендер дашборда
// ════════════════════════════════════════════════════════

function forceLoadPanel(id) {
    const iframe = document.getElementById('iframe-' + id);
    if (!iframe) return null;
    const pendingSrc = iframe.dataset.src;
    if (pendingSrc && !iframe.src) {
        navigateDashboardFrame(iframe, pendingSrc);
        iframe.removeAttribute('data-src');
    }
    return iframe;
}

function updatePanelCard(panelId) {
    const { reloadFrame = true } = arguments[1] || {};
    const panel = panels.find(p => p.id === panelId);
    if (!panel) return;

    const card = document.querySelector(`.panel-card[data-panel-id="${panelId}"]`);
    if (!card) return;

    // Update card dimensions
    card.dataset.panelSize = panel.width === '100%' ? 'full' : (panel.width === '33%' ? 'third' : 'half');
    card.dataset.heightMode = panel.height === '350px' ? 'auto' : 'fixed';
    card.style.height = panel.height;

    // «Открыть в Grafana» читает адрес из data-url — синхронизируем с новым src.
    const openBtn = card.querySelector('.btn-open');
    if (openBtn) openBtn.dataset.url = panel.src;

    // Update iframe src if panel is not paused
    if (!panel.paused && reloadFrame) {
        const iframe = card.querySelector('iframe');
        if (iframe) {
            const newSrc = applyPanelParamsToUrl(panel);
            // Only reload iframe if URL actually changed
            if (iframe.src !== newSrc && iframe.dataset.src !== newSrc) {
                if (iframe.src) {
                    // Уже загруженный iframe переводим на новый URL.
                    // data-src не выставляем: он хранит только ещё не применённый URL.
                    iframe.removeAttribute('data-src');
                    navigateDashboardFrame(iframe, newSrc);
                } else {
                    // Кадр ещё ждёт попадания в viewport — обновляем отложенный URL.
                    iframe.dataset.src = newSrc;
                }
            }
        }
    }
}

function openIframeSettings(panel) {
    const selectedGrafanaTheme = ['light', 'dark'].includes(panel.grafanaTheme) ? panel.grafanaTheme : 'follow';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content iframe-settings-modal">
            <div class="modal-header"><h4>Настройки iframe</h4></div>
            <p class="panel-tools-hint">Размер и параметры применяются только к этой карточке и сохраняются в текущем профиле.</p>
            <div class="form-group">
                <label for="iframeSettingsUrl">URL Grafana</label>
                <input class="form-input" type="url" id="iframeSettingsUrl" value="${escapeHtml(panel.src)}" spellcheck="false">
            </div>
            <div class="form-group">
                <label for="iframeSettingsTheme">Тема Grafana</label>
                <select class="form-input" id="iframeSettingsTheme">
                    <option value="follow" ${selectedGrafanaTheme === 'follow' ? 'selected' : ''}>Как в DashBridge</option>
                    <option value="light" ${selectedGrafanaTheme === 'light' ? 'selected' : ''}>Светлая</option>
                    <option value="dark" ${selectedGrafanaTheme === 'dark' ? 'selected' : ''}>Тёмная</option>
                </select>
            </div>
            <div class="form-group">
                <label for="iframeSettingsWidth">Ширина на экране</label>
                <select class="form-input" id="iframeSettingsWidth">
                    <option value="100%" ${panel.width === '100%' ? 'selected' : ''}>100% (на всю ширину)</option>
                    <option value="50%" ${panel.width !== '100%' && panel.width !== '33%' ? 'selected' : ''}>50% (половина экрана)</option>
                    <option value="33%" ${panel.width === '33%' ? 'selected' : ''}>33% (треть экрана)</option>
                </select>
            </div>
            <div class="form-group">
                <label for="iframeSettingsHeight">Высота, px</label>
                <input class="form-input" type="number" id="iframeSettingsHeight" min="180" max="3000" step="10" value="${Math.max(180, parseInt(panel.height, 10) || 350)}">
            </div>
            <div class="modal-actions"><button type="button" class="btn btn-outline iframe-settings-cancel">Отмена</button><button type="button" class="btn btn-primary iframe-settings-save">Сохранить</button></div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.style.display = 'flex';

    const close = () => overlay.remove();
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('.iframe-settings-cancel').addEventListener('click', close);
    overlay.querySelector('.iframe-settings-save').addEventListener('click', async () => {
        const rawUrl = overlay.querySelector('#iframeSettingsUrl').value.trim();
        const height = Number(overlay.querySelector('#iframeSettingsHeight').value);
        if (!isSupportedPanelUrl(rawUrl)) {
            await showAlert('Укажите корректный HTTP(S) URL Grafana.');
            return;
        }
        if (!Number.isFinite(height) || height < 180 || height > 3000) {
            await showAlert('Высота должна быть от 180 до 3000 px.');
            return;
        }
        // Ссылку приводим к тому же виду, что и при добавлении панели: иначе
        // вставленный из Grafana адрес остаётся полным дашбордом (/d/ без kiosk)
        // и карточка показывает панель вместе с верхней частью интерфейса.
        let url;
        try {
            url = normalizeGrafanaPanelUrl(rawUrl);
        } catch (error) {
            await showAlert(error.message || 'Укажите ссылку Grafana вида /d/... или /d-solo/....');
            return;
        }
        const previousSrc = panel.src;
        const previousGrafanaTheme = panel.grafanaTheme || 'follow';
        panel.src = url;
        panel.grafanaTheme = overlay.querySelector('#iframeSettingsTheme').value;
        panel.width = overlay.querySelector('#iframeSettingsWidth').value;
        panel.height = `${Math.round(height)}px`;
        savePanels();
        close();
        // Update only this panel card without reloading the entire dashboard
        updatePanelCard(panel.id, {
            reloadFrame: previousSrc !== panel.src || previousGrafanaTheme !== panel.grafanaTheme
        });
    });
}

async function togglePanelPause(id) {
    const panel = panels.find(item => item.id === id);
    if (!panel) return;
    if (activeDashboardPanelAnalysis?.panel?.id === panel.id) closeDashboardPanelAnalysis();
    panel.paused = !panel.paused;
    savePanels();
    replaceDashboardPanelCard(panel.id);
}

function createDashboardPanelCard(panel, container) {
    const card = DashBridgeRenderer.createPanelCard({
            panel,
            iframeSrc: applyPanelParamsToUrl(panel),
            analysisType: getPanelAnalysisType(panel),
            icons: { grip: SVG_GRIP, expand: SVG_EXPAND, refresh: SVG_REFRESH, pause: SVG_PAUSE, resume: SVG_RESUME, captureSave: SVG_CAPTURE_SAVE, captureCopy: SVG_CAPTURE_COPY, iframeSettings: SVG_IFRAME_SETTINGS, panelSettings: SVG_PANEL_SETTINGS, report: SVG_REPORT, more: SVG_MORE, analysis: SVG_ANALYSIS, open: SVG_OPEN, delete: SVG_DELETE }
    });


    const iframeEl = card.querySelector('iframe');

    if (!panel.paused) {
        navigateDashboardFrame(iframeEl, iframeEl.dataset.src);
        iframeEl.removeAttribute('data-src');
    }

    // ── Drag & Drop ──────────────────────────────────────────────────────
    const handle = card.querySelector('.drag-handle');
    handle.addEventListener('mousedown', () => { card.draggable = true; });
    // Сбрасываем draggable, если пользователь отпустил кнопку без drag
    handle.addEventListener('mouseup', () => { card.draggable = false; });

    card.addEventListener('dragstart', (e) => {
        draggedId = panel.id;
        draggedEl = card;
        card.classList.add('dragging');
        container.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', panel.id);
    });
    card.addEventListener('dragend', () => {
        card.draggable = false;
        card.classList.remove('dragging');
        container.classList.remove('is-dragging');
        clearDragMarkers(container);
        draggedId = null;
        draggedEl = null;
    });

    // ── Кнопки ──────────────────────────────────────────────────────────
    card.querySelector('.btn-fullscreen')?.addEventListener('click', () => toggleFullscreen(panel.id));
    card.querySelector('.btn-refresh')?.addEventListener('click', () => refreshPanel(panel.id));
    card.querySelector('.btn-pause')?.addEventListener('click', () => togglePanelPause(panel.id));
    card.querySelector('.btn-resume')?.addEventListener('click', () => togglePanelPause(panel.id));
    card.querySelector('.btn-capture-save')?.addEventListener('click', event => {
        void runDashboardToolbarCapture(panel, iframeEl, 'download', event.currentTarget);
    });
    card.querySelector('.btn-capture-copy')?.addEventListener('click', event => {
        void runDashboardToolbarCapture(panel, iframeEl, 'copy', event.currentTarget);
    });
    card.querySelector('.btn-iframe-settings')?.addEventListener('click', () => openIframeSettings(panel));
    card.querySelector('.btn-report-settings')?.addEventListener('click', () => { closePanelExtraActions(); openPanelReportEditor(panel); });
    card.querySelector('.btn-panel-tools')?.addEventListener('click', () => openPanelTools(panel, iframeEl));
    card.querySelector('.btn-more')?.addEventListener('click', event => {
        event.stopPropagation();
        syncPanelAnalysisAction(panel, card);
        togglePanelExtraActions(event.currentTarget);
    });
    card.querySelector('.btn-analysis')?.addEventListener('click', event => {
        const type = event.currentTarget.dataset.analysisType;
        if (!['cpu', 'ram'].includes(type)) return;
        openDashboardPanelAnalysis(panel, iframeEl, type);
        closePanelExtraActions();
    });
    card.querySelector('.btn-open')?.addEventListener('click', (e) => {
        // noopener,noreferrer — защита от уязвимости target=_blank
        window.open(applyPanelParamsToUrl(panel, e.currentTarget.dataset.url), '_blank', 'noopener,noreferrer');
    });
    card.querySelector('.btn-delete').addEventListener('click', () => deletePanel(panel.id));
    return card;
}

function replaceDashboardPanelCard(panelId) {
    const panel = panels.find(item => item.id === panelId);
    const currentCard = findPanelCard(panelId);
    const container = document.getElementById('dashboard');
    if (!panel || !currentCard || !container) return;
    const wasFullscreen = currentCard.classList.contains('fullscreen');
    const replacement = createDashboardPanelCard(panel, container);
    if (wasFullscreen) {
        replacement.classList.add('fullscreen');
        const fullscreenButton = replacement.querySelector('.btn-fullscreen');
        if (fullscreenButton) {
            fullscreenButton.innerHTML = SVG_COLLAPSE;
            fullscreenButton.title = 'Свернуть (Esc)';
        }
    }
    currentCard.replaceWith(replacement);
}

function appendDashboardPanelCards(addedPanels) {
    const container = document.getElementById('dashboard');
    if (!container || !Array.isArray(addedPanels) || !addedPanels.length) return;
    container.querySelector('.empty-state')?.remove();
    const fragment = document.createDocumentFragment();
    addedPanels.forEach(panel => fragment.appendChild(createDashboardPanelCard(panel, container)));
    container.appendChild(fragment);
}

function removeDashboardPanelCard(panelId) {
    if (activeDashboardPanelAnalysis?.panel?.id === panelId) closeDashboardPanelAnalysis();
    findPanelCard(panelId)?.remove();
    panelThresholdStates.delete(panelId);
    document.querySelector(`.threshold-notification[data-panel-id="${CSS.escape(panelId)}"]`)?.remove();
    if (fullscreenPanelId === panelId) fullscreenPanelId = null;
    if (panels.length === 0) void renderDashboard();
}

function panelFrameSignature(panel) {
    try {
        return JSON.stringify({
            src: panel?.src || '',
            grafanaTheme: panel?.grafanaTheme || 'follow',
            paused: !!panel?.paused,
            tools: panel?.tools || {}
        });
    } catch {
        return '';
    }
}

function adoptPanelState(target, source) {
    Object.keys(target).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
    });
    Object.assign(target, source);
    return target;
}

function reconcileDashboardPanelCards(previousPanels = []) {
    const container = document.getElementById('dashboard');
    if (!container) return;
    if (panels.length === 0) {
        void renderDashboard();
        return;
    }

    container.querySelector('.empty-state')?.remove();
    const previousById = new Map(previousPanels.map(panel => [panel.id, panel]));
    const nextIds = new Set(panels.map(panel => panel.id));
    container.querySelectorAll('.panel-card').forEach(card => {
        if (!nextIds.has(card.dataset.panelId)) removeDashboardPanelCard(card.dataset.panelId);
    });

    panels.forEach(panel => {
        const previous = previousById.get(panel.id);
        let card = findPanelCard(panel.id);
        const previousFrameSignature = previous?.frameSignature ?? panelFrameSignature(previous);
        const frameChanged = previous && previousFrameSignature !== panelFrameSignature(panel);
        const pausedTitleChanged = previous?.paused && previous.title !== panel.title;
        if (!card) {
            card = createDashboardPanelCard(panel, container);
        } else if (frameChanged || pausedTitleChanged) {
            if (activeDashboardPanelAnalysis?.panel?.id === panel.id) closeDashboardPanelAnalysis();
            replaceDashboardPanelCard(panel.id);
            card = findPanelCard(panel.id);
        } else {
            updatePanelCard(panel.id, { reloadFrame: false });
            syncPanelAnalysisAction(panel, card);
        }
        if (card) container.appendChild(card);
    });
}

async function renderDashboard() {
    closeDashboardPanelAnalysis();
    const container = document.getElementById('dashboard');
    container.innerHTML = '';

    if (panels.length === 0) {
        const profile = getActiveProfile();
        container.innerHTML = `<div class="empty-state">
            <h2>Профиль «${escapeHtml(profile?.name || 'Default')}» пуст</h2>
            <p style="margin-top: 10px; opacity: 0.7;">Нажмите «Добавить панель» и вставьте ссылку Embed из Grafana.</p>
        </div>`;
        return;
    }

    // DocumentFragment: 1 reflow вместо N при рендере 20-30 панелей
    const fragment = document.createDocumentFragment();
    for (const panel of panels) {
        fragment.appendChild(createDashboardPanelCard(panel, container));
    }

    // Один appendChild фрагмента — 1 reflow вместо N
    container.appendChild(fragment);
}

// ════════════════════════════════════════════════════════
//  Время и автообновление активного профиля
// ════════════════════════════════════════════════════════

const initialTimeState = DashBridgeTimeState.defaults();
let globalTimeFrom = initialTimeState.from;
let globalTimeTo = initialTimeState.to;
let globalRefresh = initialTimeState.refresh;

function loadActiveProfileTimeState() {
    const state = DashBridgeTimeState.normalize(getActiveProfile()?.timeState);
    globalTimeFrom = state.from;
    globalTimeTo = state.to;
    globalRefresh = state.refresh;
}

function saveActiveProfileTimeState() {
    const profile = getActiveProfile();
    if (!profile) return;
    profile.timeState = { from: globalTimeFrom, to: globalTimeTo, refresh: globalRefresh };
    void saveProfiles();
}

function syncTimeControlsFromState() {
    const fromInput = document.getElementById('absTimeFrom');
    const toInput = document.getElementById('absTimeTo');
    if (fromInput) fromInput.value = DashBridgeTimeState.formatForInput(globalTimeFrom);
    if (toInput) toInput.value = DashBridgeTimeState.formatForInput(globalTimeTo);
    if (document.getElementById('timePickerLabel')) updateTimeLabels();
}

function updateTimeLabels() {
    const timeLabel = document.getElementById('timePickerLabel');
    if (globalTimeFrom.toString().startsWith('now-')) {
        timeLabel.textContent = 'Last ' + globalTimeFrom.replace('now-', '');
    } else {
        let tzName = '';
        try {
            const parts = new Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(new Date());
            const tzPart = parts.find(p => p.type === 'timeZoneName');
            if (tzPart) tzName = tzPart.value;
        } catch (e) { }
        const timezone = document.createElement('span');
        timezone.className = 'time-picker-timezone';
        timezone.textContent = tzName;
        timeLabel.replaceChildren(document.createTextNode(
            `${DashBridgeTimeState.formatForInput(globalTimeFrom)} to ${DashBridgeTimeState.formatForInput(globalTimeTo)} `
        ), timezone);
    }
    document.getElementById('refreshPickerLabel').textContent = globalRefresh || 'Off';
}

function applyGlobalParamsToUrl(urlStr) {
    return DashBridgeTimeState.applyToUrl(urlStr, { from: globalTimeFrom, to: globalTimeTo, refresh: globalRefresh });
}

// The MAIN-world script reads this before Grafana's first datasource query.
const DASHBRIDGE_LEGEND_FILTER_PARAM = 'dashbridgeLegendFilter';
const DASHBRIDGE_LEGEND_SELECTION_PARAM = 'dashbridgeLegendSelection';
const DASHBRIDGE_SERIES_QUERY_FILTER_PARAM = 'dashbridgeSeriesQueryFilter';
const DASHBRIDGE_CPU_CAPACITY_FILTER_PARAM = 'dashbridgeCpuCapacityFilter';

function applyPanelLegendFilterToUrl(panel, urlValue) {
    try {
        const url = new URL(urlValue);
        const tools = getPanelTools(panel);
        const selection = window.DashBridgeGrafanaLegendSelection;
        const hasAllowlist = tools.legendMode === 'fast_complete_hide' && selection?.isAllowlistState(tools);
        const visible = hasAllowlist ? selection.normalizeNames(tools.legendVisibleSeries) : [];
        const hidden = tools.legendMode === 'fast_complete_hide' && !hasAllowlist
            ? [...new Set((tools.legendFilter || [])
                .filter(name => typeof name === 'string')
                .map(name => name.trim())
                .filter(Boolean))]
            : [];
        // A complete-hide selection can contain hundreds of series. Keep it
        // in the URL fragment: it is available to the iframe at startup but
        // is never sent to Grafana or copied into the same-origin Referer of
        // the datasource query.
        const hashParams = new URLSearchParams(url.hash.slice(1));
        if (hasAllowlist) {
            hashParams.set(DASHBRIDGE_LEGEND_SELECTION_PARAM, JSON.stringify({ version: 2, visibleSeries: visible }));
            hashParams.delete(DASHBRIDGE_LEGEND_FILTER_PARAM);
        } else {
            hashParams.delete(DASHBRIDGE_LEGEND_SELECTION_PARAM);
            if (hidden.length) hashParams.set(DASHBRIDGE_LEGEND_FILTER_PARAM, JSON.stringify(hidden));
            else hashParams.delete(DASHBRIDGE_LEGEND_FILTER_PARAM);
        }
        url.hash = hashParams.toString();
        url.searchParams.delete(DASHBRIDGE_LEGEND_FILTER_PARAM);
        url.searchParams.delete(DASHBRIDGE_LEGEND_SELECTION_PARAM);
        if (tools.seriesQueryFilterEnabled) {
            url.searchParams.set(DASHBRIDGE_SERIES_QUERY_FILTER_PARAM, JSON.stringify({
                enabled: true,
                value: tools.seriesQueryFilterValue,
                rawValue: tools.seriesQueryFilterRawValue,
                mode: tools.seriesQueryFilterMode === 'last' ? 'last' : 'max',
                highlightEnabled: tools.seriesQueryFilterHighlightEnabled !== false
            }));
        } else {
            url.searchParams.delete(DASHBRIDGE_SERIES_QUERY_FILTER_PARAM);
        }
        if (tools.cpuCapacityFilterEnabled) {
            url.searchParams.set(DASHBRIDGE_CPU_CAPACITY_FILTER_PARAM, JSON.stringify({
                enabled: true,
                coefficient: tools.cpuCapacityFilterCoefficient,
                mode: tools.cpuCapacityFilterMode === 'last' ? 'last' : 'max',
                highlightEnabled: tools.cpuCapacityFilterHighlightEnabled !== false,
                load1: tools.cpuCapacityFilterLoad1 !== false,
                load5: tools.cpuCapacityFilterLoad5 === true,
                load15: tools.cpuCapacityFilterLoad15 === true
            }));
        } else {
            url.searchParams.delete(DASHBRIDGE_CPU_CAPACITY_FILTER_PARAM);
        }
        return url.toString();
    } catch (e) {
        return urlValue;
    }
}

function resolveGrafanaTheme(panel) {
    const configuredTheme = panel?.grafanaTheme || 'follow';
    if (configuredTheme === 'light' || configuredTheme === 'dark') return configuredTheme;
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyPanelParamsToUrl(panel, urlStr = panel?.src) {
    const urlWithGlobalParams = window.DashBridgeGrafanaPanelBootstrap.applyToUrl(
        applyPanelLegendFilterToUrl(panel, applyGlobalParamsToUrl(urlStr)),
        getPanelTools(panel),
        grafanaTransformSettings
    );
    try {
        const url = new URL(urlWithGlobalParams);
        url.searchParams.set('theme', resolveGrafanaTheme(panel));
        return url.toString();
    } catch (e) { return urlWithGlobalParams; }
}

window.addEventListener('dashbridge-theme-change', () => {
    document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
        const panel = getPanelForIframe(iframe);
        if ((panel?.grafanaTheme || 'follow') !== 'follow' || !iframe.src || iframe.src === 'about:blank') return;
        navigateDashboardFrame(iframe, applyPanelParamsToUrl(panel, iframe.src));
    });
});

function getPanelForIframe(iframe) {
    const id = iframe?.closest('.panel-card')?.dataset.panelId;
    return panels.find(panel => panel.id === id) || null;
}

// Обновляет время во всех iframe: загруженным шлёт postMessage, незагруженным — обновляет data-src
function broadcastTimeUpdate() {
    document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
        const panel = getPanelForIframe(iframe);
        if (!panel) return;
        const timeUrl = iframe.dataset.src || iframe.src;
        const message = {
            type: 'DASHBRIDGE_TIME_UPDATE',
            from: DashBridgeTimeState.formatForUrl(timeUrl, globalTimeFrom),
            to: DashBridgeTimeState.formatForUrl(timeUrl, globalTimeTo),
            refresh: globalRefresh
        };
        if (iframe.contentWindow && iframe.src && iframe.src !== 'about:blank') {
            postToDashboardFrame(iframe, message);
        } else if (iframe.dataset.src) {
            // Навигация ещё не началась — обновляем отложенный URL.
            iframe.dataset.src = applyPanelParamsToUrl(panel, iframe.dataset.src);
        }
    });
}

function setupTimeControls() {
    const timeBtn = document.getElementById('timePickerBtn');
    const refreshBtn = document.getElementById('refreshPickerBtn');
    const timePopover = document.getElementById('timePopover');
    const refreshPopover = document.getElementById('refreshPopover');
    if (!timeBtn) return;

    timeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const showing = timePopover.style.display === 'flex';
        timePopover.style.display = showing ? 'none' : 'flex';
        refreshPopover.style.display = 'none';
        document.getElementById('profileDropdown').style.display = 'none';
    });
    refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const showing = refreshPopover.style.display === 'block';
        refreshPopover.style.display = showing ? 'none' : 'block';
        timePopover.style.display = 'none';
        document.getElementById('profileDropdown').style.display = 'none';
    });
    timePopover.addEventListener('click', (e) => e.stopPropagation());
    refreshPopover.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('absTimeFrom').value = DashBridgeTimeState.formatForInput(globalTimeFrom);
    document.getElementById('absTimeTo').value = DashBridgeTimeState.formatForInput(globalTimeTo);

    document.querySelectorAll('.quick-range-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.getElementById('absTimeFrom').value = e.target.dataset.time;
            document.getElementById('absTimeTo').value = 'now';
            document.getElementById('applyAbsoluteTime').click();
        });
    });

    document.querySelectorAll('.calendar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById(e.target.closest('.calendar-btn').dataset.picker).showPicker();
        });
    });

    document.getElementById('quickRangeSearch').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.quick-range-btn').forEach(btn => {
            btn.style.display = btn.textContent.toLowerCase().includes(q) ? 'block' : 'none';
        });
    });

    document.querySelectorAll('.hidden-date-picker').forEach(picker => {
        picker.addEventListener('change', (e) => {
            if (e.target.value) {
                const suffix = e.target.dataset.target === 'absTimeTo' ? ' 23:59:59' : ' 00:00:00';
                document.getElementById(e.target.dataset.target).value = e.target.value + suffix;
            }
        });
    });

    document.getElementById('copyTimeBtn').addEventListener('click', async () => {
        const from = document.getElementById('absTimeFrom').value.trim();
        const to = document.getElementById('absTimeTo').value.trim();
        try {
            await navigator.clipboard.writeText(JSON.stringify({ from, to }));
            const btn = document.getElementById('copyTimeBtn');
            const orig = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => btn.innerHTML = orig, 1000);
        } catch (e) { console.error('Failed to copy', e); }
    });

    document.getElementById('pasteTimeBtn').addEventListener('click', async () => {
        try {
            const data = JSON.parse(await navigator.clipboard.readText());
            if (data.from) document.getElementById('absTimeFrom').value = data.from;
            if (data.to) document.getElementById('absTimeTo').value = data.to;
            const btn = document.getElementById('pasteTimeBtn');
            const orig = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => btn.innerHTML = orig, 1000);
        } catch (e) { console.error('Failed to paste', e); }
    });

    document.getElementById('applyAbsoluteTime').addEventListener('click', () => {
        const fromVal = document.getElementById('absTimeFrom').value.trim();
        const toVal = document.getElementById('absTimeTo').value.trim();
        if (!fromVal || !toVal) return;

        const tryParse = v => v.startsWith('now') ? v : (isNaN(Date.parse(v)) ? v : Date.parse(v).toString());
        globalTimeFrom = tryParse(fromVal);
        globalTimeTo = tryParse(toVal);
        saveActiveProfileTimeState();
        updateTimeLabels();
        timePopover.style.display = 'none';

        const requiresNavigation = !globalTimeFrom.toString().startsWith('now')
            || !globalTimeTo.toString().startsWith('now');
        if (requiresNavigation) {
            document.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
                const panel = getPanelForIframe(iframe);
                if (!panel) return;
                const currentUrl = iframe.dataset.src || iframe.src || panel.src;
                navigateDashboardFrame(iframe, applyPanelParamsToUrl(panel, currentUrl));
            });
        } else broadcastTimeUpdate();
    });

    document.querySelectorAll('#refreshPopover .dropdown-item').forEach(btn => {
        if (!btn.hasAttribute('data-refresh')) return;
        btn.addEventListener('click', (e) => {
            globalRefresh = e.target.dataset.refresh;
            saveActiveProfileTimeState();
            updateTimeLabels();
            broadcastTimeUpdate();
            refreshPopover.style.display = 'none';
        });
    });

    // Принудительное обновление всех iframe: загруженным — cache-busting, незагруженным — обновляем data-src
    document.getElementById('forceRefreshBtn').addEventListener('click', async () => {
        const icon = document.getElementById('forceRefreshBtn').querySelector('svg');
        icon.style.transition = 'transform 0.5s ease';
        icon.style.transform = 'rotate(360deg)';
        setTimeout(() => { icon.style.transition = 'none'; icon.style.transform = 'none'; }, 500);
        await refreshAllPanels();
    });

    updateTimeLabels();
}

// ════════════════════════════════════════════════════════
//  Кроссхейр-синхронизация между iframe
// ════════════════════════════════════════════════════════

const dashBridgeCrosshair = createDashBridgeCrosshair({
    frames: () => document.querySelectorAll('iframe[name="dashbridge-iframe"]'),
    send: postToDashboardFrame,
    isEnabled: () => crosshairMode === 'line'
});
const broadcastCrosshair = (percentX, timestamp, sourceIframe) => dashBridgeCrosshair.broadcast(percentX, timestamp, sourceIframe);
const hideCrosshair = () => dashBridgeCrosshair.hide();

let dashbridgePanelCaptureInProgress = false;
let dashbridgeArchiveCaptureInProgress = false;
let lastDashbridgePanelCaptureAt = 0;
const waitForDashboardCaptureLayout = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function safeCaptureArchiveName(value, fallback = 'panel') {
    const cleaned = String(value || fallback)
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
    return cleaned || fallback;
}

function waitForDashboardPanelRendered(iframe, timeoutMs = 20_000) {
    if (iframe?.dataset.dashbridgeRendered === 'true') return Promise.resolve();
    return new Promise((resolve, reject) => {
        const finish = error => {
            clearTimeout(timeout);
            observer.disconnect();
            error ? reject(error) : resolve();
        };
        const observer = new MutationObserver(() => {
            if (iframe.dataset.dashbridgeRendered === 'true') finish();
        });
        const timeout = setTimeout(() => finish(new Error('panel-render-timeout')), timeoutMs);
        observer.observe(iframe, { attributes: true, attributeFilter: ['data-dashbridge-rendered'] });
    });
}

async function captureAllDashboardPanels(button) {
    if (!button || dashbridgeArchiveCaptureInProgress || dashbridgePanelCaptureInProgress) return;
    const activePanels = panels.filter(panel => !panel.paused);
    const pausedCount = panels.length - activePanels.length;
    if (!activePanels.length) {
        await showAlert(pausedCount ? 'Все графики текущего профиля поставлены на паузу.' : 'В текущем профиле нет графиков.');
        return;
    }

    dashbridgeArchiveCaptureInProgress = true;
    const originalHtml = button.innerHTML;
    const originalTitle = button.title;
    const originalScroll = { x: window.scrollX, y: window.scrollY };
    const errors = [];
    const zip = new JSZip();
    const budget = DashBridgeArchiveBudget.create(64 * 1024 * 1024);
    const lockedControls = new Map(
        [...document.querySelectorAll('header button, header input, header select, .panel-actions button')]
            .map(control => [control, control.disabled])
    );
    lockedControls.forEach((_wasDisabled, control) => { control.disabled = true; });

    try {
        for (let index = 0; index < activePanels.length; index += 1) {
            const panel = activePanels[index];
            button.querySelector('span').textContent = `Снимки ${index + 1}/${activePanels.length}`;
            const iframe = forceLoadPanel(panel.id);
            try {
                if (!iframe) throw new Error('panel-iframe-not-found');
                await waitForDashboardPanelRendered(iframe);
                const result = await captureDashbridgePanel(iframe, panel, {
                    requestId: `dashboard_archive_${Date.now()}_${index}`,
                    outputAction: 'archive',
                    prepared: defaultCapturePrepared,
                    outputWidth: getCompactCaptureDimensions().width,
                    outputHeight: getCompactCaptureDimensions().height,
                    title: panel.title
                });
                if (!result?.ok || !result.image?.blob) throw new Error(result?.error || 'capture-failed');
                budget.reserve(result.image.blob.size, panel.title || panel.id);
                const name = `${String(index + 1).padStart(2, '0')}_${safeCaptureArchiveName(panel.title, `panel_${panel.id}`)}.png`;
                zip.file(name, result.image.blob);
            } catch (error) {
                errors.push(`${index + 1}. ${panel.title || panel.id}: ${error?.message || String(error)}`);
            }
        }

        if (pausedCount) errors.push(`Пропущено панелей на паузе: ${pausedCount}.`);
        if (errors.length) zip.file('errors.txt', `DashBridge — отчёт создания снимков\n\n${errors.join('\n')}\n`);
        if (Object.keys(zip.files).every(name => name === 'errors.txt')) {
            throw new Error('Не удалось создать ни одного снимка. Проверьте загрузку панелей Grafana.');
        }

        button.querySelector('span').textContent = 'Упаковка ZIP…';
        const profileName = safeCaptureArchiveName(getActiveProfile()?.name, 'profile');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await downloadZipArchive(zip, `dashbridge_${profileName}_${timestamp}.zip`);
        button.classList.add('active');
        setTimeout(() => button.classList.remove('active'), 1600);
        if (errors.length) {
            await showAlert(`ZIP создан. Успешно: ${activePanels.length - (errors.length - (pausedCount ? 1 : 0))} из ${activePanels.length}. Подробности добавлены в errors.txt.`);
        }
    } catch (error) {
        console.error('DashBridge archive capture failed:', error);
        await showAlert('Не удалось сохранить снимки: ' + (error?.message || String(error)));
    } finally {
        window.scrollTo(originalScroll.x, originalScroll.y);
        button.innerHTML = originalHtml;
        button.title = originalTitle;
        lockedControls.forEach((wasDisabled, control) => { control.disabled = wasDisabled; });
        syncDashboardCaptureToggles(defaultCapturePrepared);
        dashbridgeArchiveCaptureInProgress = false;
    }
}

async function runDashboardToolbarCapture(panel, iframe, outputAction, button) {
    if (!iframe || !button) return;
    const originalTitle = button.title;
    button.disabled = true;
    button.title = outputAction === 'copy' ? 'Копирование снимка…' : 'Сохранение снимка…';
    button.setAttribute('aria-label', button.title);
    try {
        const result = await captureDashbridgePanel(iframe, panel, {
            requestId: `dashboard_capture_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            outputAction,
            prepared: defaultCapturePrepared,
            outputWidth: getCompactCaptureDimensions().width,
            outputHeight: getCompactCaptureDimensions().height,
            title: panel?.title
        });
        if (!result?.ok) throw new Error(result?.error || 'capture-failed');
        button.classList.add('capture-action-success');
        setTimeout(() => button.classList.remove('capture-action-success'), 1600);
    } catch (error) {
        console.error('DashBridge panel capture failed:', error);
        button.classList.add('capture-action-error');
        setTimeout(() => button.classList.remove('capture-action-error'), 2000);
    } finally {
        button.disabled = false;
        button.title = originalTitle;
        button.setAttribute('aria-label', originalTitle);
    }
}

async function captureDashbridgePanel(sourceIframe, panel, request) {
    if (dashbridgePanelCaptureInProgress) {
        const busyResult = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: false, error: 'capture-in-progress' };
        postToDashboardFrame(sourceIframe, busyResult);
        return busyResult;
    }
    dashbridgePanelCaptureInProgress = true;
    const card = sourceIframe.closest('.panel-card');
    const prepared = !!request.prepared;
    const scroll = { x: window.scrollX, y: window.scrollY };
    const captureProps = ['position', 'inset', 'left', 'top', 'right', 'bottom', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'transform', 'z-index', 'margin', 'box-sizing', 'border'];
    const captureSnapshot = card && new Map(captureProps.map(prop => [prop, {
        value: card.style.getPropertyValue(prop), priority: card.style.getPropertyPriority(prop)
    }]));
    let result = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: false, error: 'capture-failed' };
    try {
        if (!card) throw new Error('capture-card-not-found');
        if (prepared) {
            const fitted = window.DashBridgeGrafanaCaptureOutput.fitPreparedSize({
                viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
                outputWidth: Number(request.outputWidth) || 1000,
                outputHeight: Number(request.outputHeight) || 520
            });
            card.style.setProperty('position', 'fixed', 'important');
            card.style.setProperty('inset', 'auto', 'important');
            card.style.setProperty('left', `${fitted.left}px`, 'important');
            card.style.setProperty('top', `${fitted.top}px`, 'important');
            card.style.setProperty('width', `${fitted.width}px`, 'important');
            card.style.setProperty('height', `${fitted.height}px`, 'important');
            card.style.setProperty('min-width', '0', 'important');
            card.style.setProperty('min-height', '0', 'important');
            card.style.setProperty('max-width', 'none', 'important');
            card.style.setProperty('max-height', 'none', 'important');
            card.style.setProperty('transform', 'none', 'important');
            card.style.setProperty('z-index', '2147483645', 'important');
            card.style.setProperty('margin', '0', 'important');
            card.style.setProperty('box-sizing', 'border-box', 'important');
            // The PNG is cropped to the iframe, not the surrounding card. Removing
            // the card's 1 px border preserves the configured output aspect ratio.
            card.style.setProperty('border', 'none', 'important');
        } else card.scrollIntoView({ block: 'center', inline: 'center' });
        card.classList.add('dashbridge-panel-capture-active');
        postToDashboardFrame(sourceIframe, { action: 'dashbridgeCaptureLayoutChanged' });
        await new Promise(resolve => setTimeout(resolve, prepared ? 260 : 80));
        await waitForDashboardCaptureLayout();
        const rect = sourceIframe.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) throw new Error('capture-panel-empty');
        const tab = await chrome.tabs.getCurrent();
        if (!tab?.windowId) throw new Error('capture-tab-unavailable');
        const throttleWait = Math.max(0, 600 - (Date.now() - lastDashbridgePanelCaptureAt));
        if (throttleWait) await new Promise(resolve => setTimeout(resolve, throttleWait));
        lastDashbridgePanelCaptureAt = Date.now();
        const source = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        if (!source) throw new Error('capture-visible-tab-failed');
        const outputSize = prepared ? {
            width: Number(request.outputWidth) || 1000,
            height: Number(request.outputHeight) || 520
        } : null;
        const image = await window.DashBridgeGrafanaCaptureOutput.crop(source, {
            x: rect.left, y: rect.top, width: rect.width, height: rect.height,
            dpr: window.devicePixelRatio || 1
        }, outputSize);
        if (request.outputAction === 'copy') {
            await window.DashBridgeGrafanaCaptureOutput.copy(image.blob);
        } else if (request.outputAction === 'archive') {
            result = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: true, image };
        } else {
            await chrome.downloads.download({
                url: image.dataUrl,
                filename: window.DashBridgeGrafanaCaptureOutput.filename(request.title || panel?.title),
                saveAs: false
            });
        }
        if (request.outputAction !== 'archive') {
            result = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: true };
        }
    } catch (error) {
        result = { action: 'dashbridgePanelCaptureResult', requestId: request.requestId, ok: false, error: error?.message || String(error) };
    } finally {
        if (card) {
            card.classList.remove('dashbridge-panel-capture-active');
            captureSnapshot?.forEach((state, prop) => state.value
                ? card.style.setProperty(prop, state.value, state.priority || '')
                : card.style.removeProperty(prop));
        }
        window.scrollTo(scroll.x, scroll.y);
        postToDashboardFrame(sourceIframe, { action: 'dashbridgeCaptureLayoutChanged' });
        await waitForDashboardCaptureLayout();
        postToDashboardFrame(sourceIframe, {
            action: result.action, requestId: result.requestId, ok: result.ok, error: result.error
        });
        dashbridgePanelCaptureInProgress = false;
    }
    return result;
}

window.addEventListener('message', (e) => {
    if (!e.data || !e.data.action) return;

    // Проверка безопасности: принимаем сообщения только от iframe-ов, открытых на нашем дашборде
    const sourceIframe = Array.from(document.querySelectorAll('iframe[name="dashbridge-iframe"]'))
        .find(ifr => ifr.contentWindow === e.source);
    if (!sourceIframe || getFrameOrigin(sourceIframe) !== e.origin) return;

    if (e.data.action === 'panelReportSnapshot' && typeof e.data.requestId === 'string') {
        const waiter = panelReportWaiters.get(e.data.requestId);
        if (waiter && waiter.iframe === sourceIframe) {
            panelReportWaiters.delete(e.data.requestId);
            const snapshot = e.data.snapshot && typeof e.data.snapshot === 'object'
                ? e.data.snapshot : { state: 'error', error: 'Некорректный ответ панели.', series: [] };
            waiter.resolve(snapshot);
        }
        return;
    }

    if (e.data.action === 'dashbridgePanelAnalysisUpdate'
        && typeof e.data.requestId === 'string') {
        const active = activeDashboardPanelAnalysis;
        if (active && active.requestId === e.data.requestId && active.iframe === sourceIframe) {
            active.receive(e.data);
        }
        return;
    }

    if (e.data.action === 'dashbridgePanelCaptureRequest'
        && typeof e.data.requestId === 'string'
        && ['download', 'copy'].includes(e.data.outputAction)) {
        const panel = getPanelForIframe(sourceIframe);
        void captureDashbridgePanel(sourceIframe, panel, e.data);
        return;
    }

    if (e.data.action === 'dashbridgeCapturePreparedChanged' && typeof e.data.enabled === 'boolean') {
        setDashboardCapturePrepared(e.data.enabled);
        return;
    }

    if (e.data.action === 'dashbridgePanelTitle') {
        const panel = getPanelForIframe(sourceIframe);
        const title = typeof e.data.title === 'string' ? e.data.title.trim().slice(0, 240) : '';
        if (panel && title && panel.title !== title) {
            panel.title = title;
            savePanels();
            syncPanelAnalysisAction(panel, sourceIframe.closest('.panel-card'));
        }
        return;
    }

    if (e.data.action === 'dashbridgePanelTitleResponse' && typeof e.data.requestId === 'string') {
        const resolve = panelTitleWaiters.get(e.data.requestId);
        if (resolve) resolve(normalizePanelMetadataText(e.data.title, 240));
        return;
    }

    if (e.data.action === 'dashbridgeIframeReady') {
        // `load` can fire for an inherited about:blank document. A message from
        // the content script proves that the Grafana document now owns this window.
        sourceIframe.dataset.dashbridgeOrigin = e.origin;
        sourceIframe.dataset.dashbridgeLoaded = 'true';
        postToDashboardFrame(sourceIframe, { action: 'setCrosshairMode', mode: crosshairMode, thickness: crosshairThickness });
        const panel = getPanelForIframe(sourceIframe);
        postToDashboardFrame(sourceIframe, {
            type: 'DASHBRIDGE_TIME_UPDATE',
            from: DashBridgeTimeState.formatForUrl(sourceIframe.src, globalTimeFrom),
            to: DashBridgeTimeState.formatForUrl(sourceIframe.src, globalTimeTo),
            refresh: globalRefresh
        });
        if (panel) applyPanelTools(panel, sourceIframe);
        if (activeDashboardPanelAnalysis?.iframe === sourceIframe) {
            requestDashboardPanelAnalysis(activeDashboardPanelAnalysis);
        }
        return;
    }

    if (e.data.action === 'dashbridgePanelRendered') {
        sourceIframe.dataset.dashbridgeRendered = 'true';
        if (activeDashboardPanelAnalysis?.iframe === sourceIframe) {
            requestDashboardPanelAnalysis(activeDashboardPanelAnalysis);
        }
        if (new URLSearchParams(location.search).has('guiCapture')) {
            chrome.runtime.sendMessage({ type: 'dashbridge-gui-capture-ready' }).catch(() => undefined);
        }
        return;
    }

    if (e.data.action === 'panelLegendSeries' && typeof e.data.requestId === 'string') {
        const panel = panels.find(item => item.id === sourceIframe.closest('.panel-card')?.dataset.panelId);
        const resolve = panel && panelLegendWaiters.get(e.data.requestId);
        if (resolve && panel?.id === e.data.requestId) {
            panelLegendWaiters.delete(e.data.requestId);
            resolve(Array.isArray(e.data.series) ? e.data.series : []);
        }
        return;
    }

    if (e.data.action === 'panelThresholdStatus') {
        const panel = getPanelForIframe(sourceIframe);
        const resolve = panel && panelThresholdWaiters.get(e.data.requestId);
        if (resolve && panel?.id === e.data.requestId) {
            panelThresholdWaiters.delete(e.data.requestId);
            const safeStatusUnit = normalizePanelMetadataText(e.data.status?.unit);
            if (safeStatusUnit && panel.tools?.thresholdUnit !== safeStatusUnit) {
                panel.tools = { ...panel.tools, thresholdUnit: safeStatusUnit };
                savePanels();
            }
            resolve(e.data.status || null);
            return;
        }
        if (panel) updatePanelThresholdStatus(panel, e.data.status);
        return;
    }

    if (e.data.action === 'broadcastCrosshair' && e.data.percentX !== undefined) {
        broadcastCrosshair(e.data.percentX, e.data.timestamp, sourceIframe);
    } else if (e.data.action === 'broadcastCrosshairHide') {
        hideCrosshair();
    }
});
