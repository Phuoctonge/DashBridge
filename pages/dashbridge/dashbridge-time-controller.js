(function initDashBridgeTimeController(root) {
    'use strict';

    const LEGEND_FILTER_PARAM = 'dashbridgeLegendFilter';
    const LEGEND_SELECTION_PARAM = 'dashbridgeLegendSelection';
    const SERIES_QUERY_FILTER_PARAM = 'dashbridgeSeriesQueryFilter';
    const CPU_CAPACITY_FILTER_PARAM = 'dashbridgeCpuCapacityFilter';
    const TIME_HISTORY_KEY = 'dashbridge.timepicker.history';
    const MAX_HISTORY_ITEMS = 4;

    function create({ timeState, getActiveProfile, saveProfiles, getPanels, getPanelTools,
        legendSelection, panelBootstrap, getTransformSettings, postToDashboardFrame,
        navigateDashboardFrame, refreshAllPanels, runtimeScopeId, documentRef = document, windowRef = window,
        navigatorRef = navigator, setTimer = setTimeout }) {
        if (!timeState?.defaults || !timeState?.normalize || !timeState?.applyToUrl
            || !timeState?.formatForInput || !timeState?.formatForLabel
            || typeof getActiveProfile !== 'function' || typeof saveProfiles !== 'function'
            || typeof getPanels !== 'function' || typeof getPanelTools !== 'function'
            || !panelBootstrap?.applyToUrl || typeof getTransformSettings !== 'function'
            || typeof postToDashboardFrame !== 'function' || typeof navigateDashboardFrame !== 'function'
            || typeof refreshAllPanels !== 'function' || typeof runtimeScopeId !== 'string' || !runtimeScopeId) {
            throw new TypeError('DashBridge time controller dependencies are incomplete');
        }

        let state = timeState.defaults();
        let recentRanges = [];

        const parseTimeInput = value => {
            if (typeof value !== 'string' || !value || value.length > 100) return null;
            if (/^now(?:[+-]\d+[smhdwMy]|\/(?:[smhdwMy]|fy))*$/.test(value)) return value;
            const milliseconds = /^-?\d+$/.test(value) ? Number(value) : Date.parse(value);
            return Number.isFinite(milliseconds) && Number.isFinite(new Date(milliseconds).getTime())
                ? String(milliseconds) : null;
        };

        const normalizeHistoryRange = value => {
            const from = parseTimeInput(value?.from);
            const to = parseTimeInput(value?.to);
            if (from === null || to === null || (from.startsWith('now') && to.startsWith('now'))) return null;
            if (!from.startsWith('now') && !to.startsWith('now') && Number(from) > Number(to)) return null;
            return { from, to };
        };

        const readRecentRanges = () => {
            try {
                if (!windowRef.localStorage) return recentRanges;
                const raw = windowRef.localStorage.getItem(TIME_HISTORY_KEY);
                if (raw == null) { recentRanges = []; return recentRanges; }
                const values = raw.length <= 4096 ? JSON.parse(raw) : [];
                const seen = new Set();
                recentRanges = (Array.isArray(values) ? values.slice(0, 32) : [])
                    .map(normalizeHistoryRange).filter(value => {
                        if (!value) return false;
                        const key = `${value.from}|${value.to}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    }).slice(0, MAX_HISTORY_ITEMS);
            } catch (_) { /* Unavailable storage must not block applying time. */ }
            return recentRanges;
        };

        const rememberRange = () => {
            const range = normalizeHistoryRange(state);
            if (!range) return;
            recentRanges = [range, ...readRecentRanges().filter(item => item.from !== range.from || item.to !== range.to)]
                .slice(0, MAX_HISTORY_ITEMS);
            try { windowRef.localStorage?.setItem(TIME_HISTORY_KEY, JSON.stringify(recentRanges)); }
            catch (_) { /* Keep this tab's history when storage is unavailable. */ }
        };

        const renderRecentRanges = () => {
            const list = documentRef.getElementById('recentTimeRanges');
            if (!list) return;
            const ranges = readRecentRanges();
            documentRef.getElementById('recentTimeRangesEmpty').hidden = ranges.length > 0;
            list.replaceChildren(...ranges.map(range => {
                const button = documentRef.createElement('button');
                button.type = 'button';
                button.className = 'recent-time-range';
                button.textContent = `${timeState.formatForInput(range.from)} — ${timeState.formatForInput(range.to)}`;
                button.addEventListener('click', () => {
                    // Use exact stored instants; formatting the inputs would discard milliseconds.
                    documentRef.getElementById('absTimeFrom').value = range.from;
                    documentRef.getElementById('absTimeTo').value = range.to;
                    documentRef.getElementById('applyAbsoluteTime').click();
                    syncControls();
                    documentRef.getElementById('timePickerBtn').focus();
                });
                return button;
            }));
        };

        const getState = () => ({ ...state });

        const loadProfileState = () => {
            state = timeState.normalize(getActiveProfile()?.timeState);
            return getState();
        };

        const saveProfileState = () => {
            const profile = getActiveProfile();
            if (!profile) return false;
            profile.timeState = getState();
            void saveProfiles();
            return true;
        };

        const updateLabels = () => {
            const timeLabel = documentRef.getElementById('timePickerLabel');
            if (!timeLabel) return;
            if (state.from.toString().startsWith('now-')) {
                const interval = state.from.replace('now-', '');
                const units = { s: 'с', m: 'мин', h: 'ч', d: 'дн', w: 'нед', M: 'мес', y: 'г' };
                timeLabel.textContent = 'За ' + interval.replace(/(\d+)([smhdwMy])/g, (_match, count, unit) => `${count} ${units[unit]}`);
            } else {
                timeLabel.textContent = timeState.formatForLabel(state.from, state.to);
            }
            const timePickerButton = documentRef.getElementById('timePickerBtn');
            if (timePickerButton) timePickerButton.title = state.from.toString().startsWith('now-')
                ? `Выбрать время: ${timeLabel.textContent}`
                : `Выбрать время: ${timeState.formatForInput(state.from)} — ${timeState.formatForInput(state.to)}`;
            const refreshLabel = documentRef.getElementById('refreshPickerLabel');
            if (refreshLabel) refreshLabel.textContent = state.refresh === 'auto' ? 'Авто'
                : state.refresh ? state.refresh.replace(/(\d+)([smhd])/, (_match, count, unit) => `${count} ${{ s: 'с', m: 'мин', h: 'ч', d: 'дн' }[unit]}`) : 'Выкл.';
        };

        const syncControls = () => {
            const fromInput = documentRef.getElementById('absTimeFrom');
            const toInput = documentRef.getElementById('absTimeTo');
            if (fromInput) fromInput.value = timeState.formatForInput(state.from);
            if (toInput) toInput.value = timeState.formatForInput(state.to);
            if (documentRef.getElementById('timePickerLabel')) updateLabels();
        };

        const applyGlobalParamsToUrl = urlValue => timeState.applyToUrl(urlValue, state);

        const applyPanelLegendFilterToUrl = (panel, urlValue) => {
            try {
                const url = new URL(urlValue);
                const tools = getPanelTools(panel);
                const hasAllowlist = tools.legendMode === 'fast_complete_hide'
                    && legendSelection?.isAllowlistState(tools);
                const visible = hasAllowlist ? legendSelection.normalizeNames(tools.legendVisibleSeries) : [];
                const hidden = tools.legendMode === 'fast_complete_hide' && !hasAllowlist
                    ? [...new Set((tools.legendFilter || [])
                        .filter(name => typeof name === 'string')
                        .map(name => name.trim())
                        .filter(Boolean))]
                    : [];
                // Large complete-hide selections stay in the fragment so they
                // never reach Grafana or datasource Referer headers.
                const hashParams = new URLSearchParams(url.hash.slice(1));
                if (hasAllowlist) {
                    hashParams.set(LEGEND_SELECTION_PARAM, JSON.stringify({ version: 2, visibleSeries: visible }));
                    hashParams.delete(LEGEND_FILTER_PARAM);
                } else {
                    hashParams.delete(LEGEND_SELECTION_PARAM);
                    if (hidden.length) hashParams.set(LEGEND_FILTER_PARAM, JSON.stringify(hidden));
                    else hashParams.delete(LEGEND_FILTER_PARAM);
                }
                url.hash = hashParams.toString();
                url.searchParams.delete(LEGEND_FILTER_PARAM);
                url.searchParams.delete(LEGEND_SELECTION_PARAM);
                if (tools.seriesQueryFilterEnabled) {
                    url.searchParams.set(SERIES_QUERY_FILTER_PARAM, JSON.stringify({
                        enabled: true,
                        value: tools.seriesQueryFilterValue,
                        rawValue: tools.seriesQueryFilterRawValue,
                        mode: tools.seriesQueryFilterMode === 'last' ? 'last' : 'max',
                        highlightEnabled: tools.seriesQueryFilterHighlightEnabled !== false
                    }));
                } else {
                    url.searchParams.delete(SERIES_QUERY_FILTER_PARAM);
                }
                if (tools.cpuCapacityFilterEnabled) {
                    url.searchParams.set(CPU_CAPACITY_FILTER_PARAM, JSON.stringify({
                        enabled: true,
                        coefficient: tools.cpuCapacityFilterCoefficient,
                        mode: tools.cpuCapacityFilterMode === 'last' ? 'last' : 'max',
                        highlightEnabled: tools.cpuCapacityFilterHighlightEnabled !== false,
                        load1: tools.cpuCapacityFilterLoad1 !== false,
                        load5: tools.cpuCapacityFilterLoad5 === true,
                        load15: tools.cpuCapacityFilterLoad15 === true
                    }));
                } else {
                    url.searchParams.delete(CPU_CAPACITY_FILTER_PARAM);
                }
                return url.toString();
            } catch (_) {
                return urlValue;
            }
        };

        const resolveTheme = panel => {
            const configuredTheme = panel?.grafanaTheme || 'follow';
            if (configuredTheme === 'light' || configuredTheme === 'dark') return configuredTheme;
            return documentRef.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        };

        const applyPanelParamsToUrl = (panel, urlValue = panel?.src) => {
            const transformed = panelBootstrap.applyToUrl(
                applyPanelLegendFilterToUrl(panel, applyGlobalParamsToUrl(urlValue)),
                getPanelTools(panel),
                getTransformSettings()
            );
            try {
                const url = new URL(transformed);
                url.searchParams.set('theme', resolveTheme(panel));
                return url.toString();
            } catch (_) {
                return transformed;
            }
        };

        const getPanelForIframe = iframe => {
            const card = iframe?.closest('.panel-card');
            const id = card?.dataset.panelId;
            const activeProfileId = String(getActiveProfile()?.id || '');
            const frameProfileId = String(iframe?.dataset?.dashbridgeProfileId || card?.dataset?.profileId || '');
            const frameScopeId = String(iframe?.dataset?.dashbridgeScopeId || card?.dataset?.dashbridgeScopeId || '');
            if (frameScopeId !== runtimeScopeId || (activeProfileId && frameProfileId !== activeProfileId)) return null;
            return getPanels().find(panel => panel.id === id) || null;
        };

        const sendTimeUpdate = iframe => {
            const panel = getPanelForIframe(iframe);
            if (!panel) return false;
            const timeUrl = iframe.dataset.src || iframe.src;
            return postToDashboardFrame(iframe, {
                type: 'DASHBRIDGE_TIME_UPDATE',
                from: timeState.formatForUrl(timeUrl, state.from),
                to: timeState.formatForUrl(timeUrl, state.to),
                refresh: state.refresh
            });
        };

        const broadcast = () => {
            documentRef.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
                const panel = getPanelForIframe(iframe);
                if (!panel) return;
                if (iframe.contentWindow && iframe.src && iframe.src !== 'about:blank') {
                    sendTimeUpdate(iframe);
                } else if (iframe.dataset.src) {
                    iframe.dataset.src = applyPanelParamsToUrl(panel);
                }
            });
        };

        windowRef.addEventListener('dashbridge-theme-change', () => {
            documentRef.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
                const panel = getPanelForIframe(iframe);
                if ((panel?.grafanaTheme || 'follow') !== 'follow' || !iframe.src || iframe.src === 'about:blank') return;
                navigateDashboardFrame(iframe, applyPanelParamsToUrl(panel));
            });
        });

        const setupControls = () => {
            const timeButton = documentRef.getElementById('timePickerBtn');
            const refreshButton = documentRef.getElementById('refreshPickerBtn');
            const timePopover = documentRef.getElementById('timePopover');
            const refreshPopover = documentRef.getElementById('refreshPopover');
            if (!timeButton) return;
            const closeTimePopover = () => {
                timePopover.style.display = 'none';
                timeButton.focus();
            };
            documentRef.getElementById('closeTimePopover')?.addEventListener('click', closeTimePopover);
            documentRef.addEventListener('keydown', event => {
                if (event.key === 'Escape' && timePopover.style.display === 'flex') closeTimePopover();
            });

            timeButton.addEventListener('click', event => {
                event.stopPropagation();
                const showing = timePopover.style.display === 'flex';
                if (!showing) renderRecentRanges();
                timePopover.style.display = showing ? 'none' : 'flex';
                refreshPopover.style.display = 'none';
                documentRef.getElementById('profileDropdown').style.display = 'none';
            });
            refreshButton.addEventListener('click', event => {
                event.stopPropagation();
                const showing = refreshPopover.style.display === 'block';
                refreshPopover.style.display = showing ? 'none' : 'block';
                timePopover.style.display = 'none';
                documentRef.getElementById('profileDropdown').style.display = 'none';
            });
            timePopover.addEventListener('click', event => event.stopPropagation());
            refreshPopover.addEventListener('click', event => event.stopPropagation());

            syncControls();
            documentRef.querySelectorAll('.quick-range-btn').forEach(button => {
                button.addEventListener('click', event => {
                    documentRef.getElementById('absTimeFrom').value = event.target.dataset.time;
                    documentRef.getElementById('absTimeTo').value = 'now';
                    documentRef.getElementById('applyAbsoluteTime').click();
                });
            });
            documentRef.querySelectorAll('.calendar-btn').forEach(button => {
                button.addEventListener('click', event => {
                    event.preventDefault();
                    documentRef.getElementById(event.target.closest('.calendar-btn').dataset.picker).showPicker();
                });
            });
            documentRef.getElementById('quickRangeSearch').addEventListener('input', event => {
                const query = event.target.value.toLowerCase();
                documentRef.querySelectorAll('.quick-range-btn').forEach(button => {
                    button.style.display = button.textContent.toLowerCase().includes(query) ? 'block' : 'none';
                });
            });
            documentRef.querySelectorAll('.hidden-date-picker').forEach(picker => {
                picker.addEventListener('change', event => {
                    if (!event.target.value) return;
                    const suffix = event.target.dataset.target === 'absTimeTo' ? ' 23:59:59' : ' 00:00:00';
                    documentRef.getElementById(event.target.dataset.target).value = event.target.value + suffix;
                });
            });
            documentRef.getElementById('copyTimeBtn').addEventListener('click', async () => {
                const from = documentRef.getElementById('absTimeFrom').value.trim();
                const to = documentRef.getElementById('absTimeTo').value.trim();
                try {
                    await navigatorRef.clipboard.writeText(JSON.stringify({ from, to }));
                    const button = documentRef.getElementById('copyTimeBtn');
                    const original = button.innerHTML;
                    button.innerHTML = '✅';
                    setTimer(() => { button.innerHTML = original; }, 1000);
                    root.DashBridgeAnalytics?.outcome('dashbridge.time_range_copied', 'success');
                } catch (error) {
                    root.DashBridgeAnalytics?.outcome('dashbridge.time_range_copied', 'error');
                    console.error('Failed to copy', error);
                }
            });
            documentRef.getElementById('pasteTimeBtn').addEventListener('click', async () => {
                try {
                    const data = JSON.parse(await navigatorRef.clipboard.readText());
                    if (data.from) documentRef.getElementById('absTimeFrom').value = data.from;
                    if (data.to) documentRef.getElementById('absTimeTo').value = data.to;
                    const button = documentRef.getElementById('pasteTimeBtn');
                    const original = button.innerHTML;
                    button.innerHTML = '✅';
                    setTimer(() => { button.innerHTML = original; }, 1000);
                    root.DashBridgeAnalytics?.outcome('dashbridge.time_range_pasted', 'success');
                } catch (error) {
                    root.DashBridgeAnalytics?.outcome('dashbridge.time_range_pasted', 'invalid_input');
                    console.error('Failed to paste', error);
                }
            });
            documentRef.getElementById('applyAbsoluteTime').addEventListener('click', () => {
                const fromValue = documentRef.getElementById('absTimeFrom').value.trim();
                const toValue = documentRef.getElementById('absTimeTo').value.trim();
                if (!fromValue || !toValue) return;
                const from = parseTimeInput(fromValue);
                const to = parseTimeInput(toValue);
                const error = documentRef.getElementById('timeRangeError');
                const invalid = from === null || to === null
                    || (!from.startsWith('now') && !to.startsWith('now') && Number(from) > Number(to));
                if (error) error.hidden = !invalid;
                if (invalid) return;
                state = { ...state, from, to };
                saveProfileState();
                rememberRange();
                updateLabels();
                timePopover.style.display = 'none';
                const requiresNavigation = !state.from.toString().startsWith('now')
                    || !state.to.toString().startsWith('now');
                if (requiresNavigation) {
                    documentRef.querySelectorAll('iframe[name="dashbridge-iframe"]').forEach(iframe => {
                        const panel = getPanelForIframe(iframe);
                        if (!panel) return;
                        navigateDashboardFrame(iframe, applyPanelParamsToUrl(panel));
                    });
                } else {
                    broadcast();
                }
                root.DashBridgeAnalytics?.track('dashbridge.time_absolute_range_applied', 'used', {});
            });
            documentRef.querySelectorAll('#refreshPopover .dropdown-item').forEach(button => {
                if (!button.hasAttribute('data-refresh')) return;
                button.addEventListener('click', event => {
                    const previousRefresh = state.refresh;
                    state = { ...state, refresh: event.target.dataset.refresh };
                    saveProfileState();
                    updateLabels();
                    if (state.refresh !== previousRefresh) {
                        // Grafana versions disagree on whether a d-solo router
                        // recreates its scheduler after a history-only refresh
                        // change. One navigation gives every iframe the same
                        // document-start policy and scheduler lifecycle.
                        void refreshAllPanels();
                    } else {
                        broadcast();
                    }
                    refreshPopover.style.display = 'none';
                    root.DashBridgeAnalytics?.track('dashbridge.refresh_interval_changed', 'changed', {});
                });
            });
            documentRef.getElementById('forceRefreshBtn').addEventListener('click', async () => {
                const icon = documentRef.getElementById('forceRefreshBtn').querySelector('svg');
                icon.style.transition = 'transform 0.5s ease';
                icon.style.transform = 'rotate(360deg)';
                setTimer(() => { icon.style.transition = 'none'; icon.style.transform = 'none'; }, 500);
                await refreshAllPanels();
            });
            updateLabels();
        };

        return Object.freeze({ loadProfileState, saveProfileState, syncControls, updateLabels,
            applyPanelParamsToUrl, getPanelForIframe, sendTimeUpdate, broadcast, setupControls, getState,
            resolveTheme });
    }

    root.DashBridgeTimeController = Object.freeze({ create });
})(globalThis);
