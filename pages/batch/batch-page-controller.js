(function initBatchPageController(root) {
    'use strict';

    function createNotifier(container, documentRef) {
        return (message, type = 'info') => {
            const toast = documentRef.createElement('div');
            toast.className = `toast ${type}`;
            const icons = {
                success: '<svg class="ic toast-icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
                error: '<svg class="ic toast-icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
                info: '<svg class="ic toast-icon-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
            };
            const icon = documentRef.createElement('span');
            icon.innerHTML = icons[type] || icons.info;
            const text = documentRef.createElement('span');
            text.textContent = String(message);
            toast.append(icon, text);
            container.appendChild(toast);
            root.setTimeout(() => {
                toast.style.animation = 'toastFadeOut 0.3s ease-out forwards';
                root.setTimeout(() => toast.remove(), 300);
            }, 3000);
        };
    }

    function createLogger(container, documentRef) {
        return (message, isError = false) => {
            const entry = documentRef.createElement('div');
            entry.className = `log-entry ${isError ? 'log-error' : ''}`;
            const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
            const timestamp = documentRef.createElement('span');
            timestamp.className = 'log-time';
            timestamp.textContent = `[${time}]`;
            entry.append(timestamp, documentRef.createTextNode(` ${String(message)}`));
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        };
    }

    function create({ pageState, normalizeTimeRanges, documentRef = document }) {
        if (typeof pageState?.bind !== 'function'
            || typeof pageState?.restore !== 'function'
            || typeof pageState?.save !== 'function'
            || typeof normalizeTimeRanges !== 'function'
            || typeof documentRef?.createElement !== 'function'
            || typeof documentRef?.createTextNode !== 'function') {
            throw new TypeError('Batch page controller dependencies are incomplete');
        }

        const mainActionArea = documentRef.getElementById('mainActionArea');
        const panelsMode = documentRef.getElementById('panelsMode');
        const userPanelsGroup = documentRef.getElementById('userPanelsGroup');
        const logContainer = documentRef.getElementById('logContainer');
        const showToast = createNotifier(documentRef.getElementById('toastContainer'), documentRef);
        const logMessage = createLogger(logContainer, documentRef);
        const batchProgress = documentRef.getElementById('batchProgress');
        const batchProgressText = documentRef.getElementById('batchProgressText');
        const batchProgressStats = documentRef.getElementById('batchProgressStats');
        const batchProgressBar = documentRef.getElementById('batchProgressBar');
        let operationProgressController = null;
        let previousSeriesDashboardUrl = documentRef.getElementById('seriesDashUrl').value.trim();

        const setOperationProgressController = controller => {
            operationProgressController = controller || null;
        };

        const updateBatchProgress = ({ done, total, success, failed, phase }) => {
            batchProgress.hidden = false;
            const safeTotal = Math.max(1, Number(total) || 1);
            batchProgressBar.max = safeTotal;
            batchProgressBar.value = Math.min(safeTotal, Math.max(0, done));
            batchProgressText.textContent = `${phase}: ${Math.min(done, safeTotal)} / ${total}`;
            batchProgressStats.textContent = `Успешно: ${success} · Ошибки: ${failed}`;
            operationProgressController?.update({ done, total, success, failed, phase });
        };

        const normalizeTimeRangesField = ({ fieldId, notify = true } = {}) => {
            const field = documentRef.getElementById(fieldId);
            const result = normalizeTimeRanges(field.value);
            if (!result.ranges.length) {
                if (notify) showToast('Не удалось распознать временные диапазоны', 'error');
                return result;
            }
            if (result.errors.length) {
                if (notify) showToast(`Не удалось распознать диапазоны в строках: ${result.errors.join(', ')}`, 'error');
                return result;
            }
            field.value = result.ranges.map(({ from, to }) => `${from}, ${to}`).join('\n');
            pageState.save();
            if (notify) showToast(`Преобразовано диапазонов: ${result.ranges.length}.`, 'success');
            return result;
        };

        const getCaptureTheme = (groupId = 'captureThemeMain') => {
            const value = documentRef.querySelector(`#${groupId} input:checked`)?.value;
            return value === 'current' || value === 'dark' ? value : 'light';
        };

        const setCaptureTheme = (value, groupId) => {
            const normalized = value === 'current' || value === 'dark' ? value : 'light';
            documentRef.querySelectorAll(`#${groupId} .batch-capture-theme`).forEach(input => {
                input.checked = input.value === normalized;
            });
        };

        const resetSeriesDashboardSelection = panelPicker => {
            const currentUrl = documentRef.getElementById('seriesDashUrl').value.trim();
            if (currentUrl === previousSeriesDashboardUrl) return;
            previousSeriesDashboardUrl = currentUrl;
            panelPicker.clearSeriesSelection();
            documentRef.getElementById('seriesPanelsContainer').replaceChildren();
            documentRef.getElementById('seriesPanelSelectionStatus').textContent = 'Панели ещё не выбраны';
            documentRef.getElementById('loadSelectedSeriesBtn').hidden = true;
        };

        const setup = ({ updateActionVisibility, loadBatchPanelRules, panelPicker }) => {
            if (typeof updateActionVisibility !== 'function'
                || typeof loadBatchPanelRules !== 'function'
                || typeof panelPicker?.open !== 'function'
                || typeof panelPicker?.clearSeriesSelection !== 'function') {
                throw new TypeError('Batch page controller setup dependencies are incomplete');
            }

            const tabButtons = documentRef.querySelectorAll('.tab-btn');
            const tabContents = documentRef.querySelectorAll('.tab-content');
            tabButtons.forEach(button => {
                button.addEventListener('click', () => {
                    tabButtons.forEach(item => item.classList.remove('active'));
                    tabContents.forEach(item => item.classList.remove('active'));
                    button.classList.add('active');
                    documentRef.getElementById(button.dataset.tab).classList.add('active');
                    updateActionVisibility();
                });
            });
            panelsMode.addEventListener('change', () => {
                userPanelsGroup.style.display = ['whitelist', 'blacklist'].includes(panelsMode.value)
                    ? 'block'
                    : 'none';
            });
            documentRef.getElementById('clearLogs').addEventListener('click', () => {
                logContainer.innerHTML = '';
            });

            pageState.bind();
            pageState.restore().then(loadBatchPanelRules);
            documentRef.getElementById('copyMainSettingsToSeriesBtn').addEventListener('click', () => {
                const mainUrl = documentRef.getElementById('dashUrl').value.trim();
                const mainSlices = documentRef.getElementById('timestamps').value.trim();
                if (!mainUrl && !mainSlices) {
                    showToast('В настройках сбора нет URL и временных срезов для копирования', 'info');
                    return;
                }
                documentRef.getElementById('seriesDashUrl').value = mainUrl;
                documentRef.getElementById('seriesTimestamps').value = mainSlices;
                resetSeriesDashboardSelection(panelPicker);
                pageState.save();
                showToast('URL и временные срезы скопированы в Series', 'success');
            });
            const seriesDashboardUrl = documentRef.getElementById('seriesDashUrl');
            seriesDashboardUrl.addEventListener('input', () => resetSeriesDashboardSelection(panelPicker));
            seriesDashboardUrl.addEventListener('change', () => resetSeriesDashboardSelection(panelPicker));
            documentRef.querySelectorAll('.batch-capture-theme').forEach(input => {
                input.addEventListener('change', () => {
                    if (input.checked) setCaptureTheme(input.value, input.closest('fieldset')?.id);
                });
            });
            documentRef.getElementById('getPanelsBtn').addEventListener('click', () => {
                void panelPicker.open({
                    dashboardUrl: documentRef.getElementById('dashUrl').value.trim(),
                    context: 'main',
                });
            });
        };

        return Object.freeze({
            mainActionArea, panelsMode, showToast, logMessage, updateBatchProgress,
            normalizeTimeRangesField, getCaptureTheme,
            setOperationProgressController, setup,
        });
    }

    root.BatchPageController = Object.freeze({ create });
})(globalThis);
