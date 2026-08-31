'use strict';

// Owns the dashboard panel picker and the temporary Grafana authorization tab.
// Batch capture consumes only the selected IDs and the recovered dashboard API.
globalThis.BatchPanelPicker = (() => {
    const AUTH_RECOVERY_TIMEOUT_MS = 120_000;
    const isUnauthorizedError = error => [401, 403].includes(Number(error?.status))
        || error?.code === 'GRAFANA_AUTH_REQUIRED'
        || /^HTTP Error (?:401|403)$/.test(String(error?.message || error));

    function create({ showToast, logMessage, panelsMode }) {
        const panelsModal = document.getElementById('panelsModal');
        const panelsListContainer = document.getElementById('panelsListContainer');
        const panelPickerSelectionStatus = document.getElementById('panelPickerSelectionStatus');
        const applyPanelPickerBtn = document.getElementById('applyPanelPickerBtn');
        let panelPickerState = null;
        let seriesSelectedPanelIds = [];

        const recoverGrafanaDashboardSession = async dashboardUrl => {
            const batchTab = await chrome.tabs.getCurrent();
            const authTab = await chrome.tabs.create({ url: dashboardUrl, active: true });
            if (!authTab.id) throw new Error('Не удалось открыть вкладку Grafana для авторизации');

            return new Promise((resolve, reject) => {
                let settled = false;
                let timeoutId = null;
                const cleanup = () => {
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    chrome.tabs.onRemoved.removeListener(onRemoved);
                    if (timeoutId) clearTimeout(timeoutId);
                };
                const finish = async (result, error = null, { closeAuthTab = false } = {}) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    if (error) {
                        if (closeAuthTab) await chrome.tabs.remove(authTab.id).catch(() => undefined);
                        reject(error);
                        return;
                    }
                    await chrome.tabs.remove(authTab.id).catch(() => undefined);
                    if (batchTab?.id) await chrome.tabs.update(batchTab.id, { active: true }).catch(() => undefined);
                    resolve(result);
                };
                const retryDashboardApi = async () => {
                    try {
                        await finish(await fetchGrafanaDashboardPanels(dashboardUrl));
                    } catch (error) {
                        if (!isUnauthorizedError(error)) await finish(null, error);
                    }
                };
                const onUpdated = (tabId, changeInfo) => {
                    if (tabId === authTab.id && changeInfo.status === 'complete') void retryDashboardApi();
                };
                const onRemoved = tabId => {
                    if (tabId === authTab.id) void finish(null, new Error('Вкладка авторизации была закрыта'));
                };
                chrome.tabs.onUpdated.addListener(onUpdated);
                chrome.tabs.onRemoved.addListener(onRemoved);
                timeoutId = setTimeout(() => {
                    void finish(null, new Error('Время ожидания авторизации Grafana истекло'), { closeAuthTab: true });
                }, AUTH_RECOVERY_TIMEOUT_MS);
            });
        };

        const getDashboardPanelsWithRecovery = async dashboardUrl => {
            try {
                return await fetchGrafanaDashboardPanels(dashboardUrl);
            } catch (error) {
                if (!isUnauthorizedError(error)) throw error;
                showToast('Открываю Grafana для авторизации. После входа список панелей загрузится автоматически.', 'info');
                return recoverGrafanaDashboardSession(dashboardUrl);
            }
        };

        const close = () => {
            panelsModal.style.display = 'none';
            panelPickerState = null;
            panelsListContainer.replaceChildren();
            panelPickerSelectionStatus.textContent = '';
            applyPanelPickerBtn.disabled = true;
        };

        const updateSelection = () => {
            const checkboxes = [...panelsListContainer.querySelectorAll('.panel-picker-checkbox')];
            const selected = checkboxes.filter(input => input.checked).length;
            panelPickerSelectionStatus.textContent = checkboxes.length
                ? `Выбрано панелей: ${selected} из ${checkboxes.length}.`
                : 'В дашборде не найдены панели с числовыми ID.';
            applyPanelPickerBtn.disabled = selected === 0;
        };

        const render = panels => {
            panelsListContainer.replaceChildren();
            const selectedIds = panelPickerState?.selectedIds || new Set();
            const panelEntries = Array.isArray(panels)
                ? panels.map(panel => ({ id: String(panel.id), title: panel.title, type: panel.type || '' }))
                : Object.entries(panels).map(([id, title]) => ({ id: String(id), title, type: '' }));
            const safePanelEntries = panelEntries
                .filter(panel => /^\d+$/.test(panel.id) && Number(panel.id) > 0)
                .slice(0, 2000);
            for (const panel of safePanelEntries) {
                const item = document.createElement('label');
                item.className = 'panel-list-item';
                const checkbox = document.createElement('input');
                checkbox.className = 'panel-picker-checkbox';
                checkbox.type = 'checkbox';
                checkbox.value = panel.id;
                checkbox.checked = selectedIds.has(panel.id);
                checkbox.addEventListener('change', updateSelection);
                const title = document.createElement('span');
                title.className = 'batch-panel-title';
                title.textContent = String(panel.title || `Panel_${panel.id}`).slice(0, 240);
                const meta = document.createElement('span');
                meta.className = 'panel-id-badge';
                meta.textContent = `ID ${panel.id}${panel.type ? ` · ${String(panel.type).slice(0, 80)}` : ''}`;
                item.append(checkbox, title, meta);
                panelsListContainer.appendChild(item);
            }
            document.getElementById('modalTitleText').textContent = 'Выбрать панели дашборда';
            panelsModal.style.display = 'flex';
            updateSelection();
            logMessage(`Найдено панелей: ${safePanelEntries.length}`);
        };

        const open = async ({ dashboardUrl, context }) => {
            const info = parseGrafanaDashboardUrl(dashboardUrl);
            if (!info) return showToast('Введите корректный URL дашборда Grafana', 'error');
            const selectedIds = context === 'main'
                ? new Set(document.getElementById('userPanels').value.split(',').map(id => id.trim()).filter(Boolean))
                : new Set(seriesSelectedPanelIds);
            try {
                logMessage(`Запрашиваем панели для ${info.uid}...`);
                const { panels, panelList } = await getDashboardPanelsWithRecovery(dashboardUrl);
                panelPickerState = { context, selectedIds };
                render(panelList?.length ? panelList : panels);
            } catch (error) {
                logMessage(`Ошибка: ${error.message}`, true);
                showToast(`Не удалось получить панели: ${error.message}`, 'error');
            }
        };

        const applySelection = () => {
            if (!panelPickerState) return;
            const selectedIds = [...panelsListContainer.querySelectorAll('.panel-picker-checkbox:checked')]
                .map(input => input.value);
            if (!selectedIds.length) return showToast('Выберите хотя бы одну панель', 'error');
            if (panelPickerState.context === 'main') {
                panelsMode.value = 'whitelist';
                panelsMode.dispatchEvent(new Event('change'));
                document.getElementById('userPanels').value = selectedIds.join(', ');
                BatchPageState.save();
            } else {
                seriesSelectedPanelIds = selectedIds;
                document.getElementById('seriesPanelSelectionStatus').textContent = `Выбрано панелей: ${selectedIds.length}`;
                document.getElementById('loadSelectedSeriesBtn').hidden = false;
            }
            close();
        };

        applyPanelPickerBtn.addEventListener('click', applySelection);
        document.getElementById('closePanelsModal').addEventListener('click', close);
        document.getElementById('cancelPanelPickerBtn').addEventListener('click', close);
        document.getElementById('selectAllPanelPickerBtn').addEventListener('click', () => {
            panelsListContainer.querySelectorAll('.panel-picker-checkbox').forEach(input => { input.checked = true; });
            updateSelection();
        });
        document.getElementById('clearPanelPickerBtn').addEventListener('click', () => {
            panelsListContainer.querySelectorAll('.panel-picker-checkbox').forEach(input => { input.checked = false; });
            updateSelection();
        });
        panelsModal.addEventListener('click', event => { if (event.target === panelsModal) close(); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && panelsModal.style.display === 'flex') close();
        });

        return Object.freeze({
            open,
            getDashboardPanelsWithRecovery,
            getSeriesSelectedPanelIds: () => [...seriesSelectedPanelIds],
            clearSeriesSelection: () => { seriesSelectedPanelIds = []; },
        });
    }

    return Object.freeze({ create, isUnauthorizedError });
})();
