(function initDashBridgePanelAdditionController(root) {
    'use strict';

    function create({ normalizePanelUrl, buildSoloPanelUrl, getPanelIdentity, parsePanelIds,
        parseDashboardUrl, fetchDashboardPanels, normalizePanelMetadataText, showAlert,
        currentProfileHasPanel, getCurrentProfilePanelIdentities, getPanels, savePanels,
        appendPanelCards, documentRef = document, randomUUID = () => crypto.randomUUID() }) {
        if (typeof normalizePanelUrl !== 'function' || typeof buildSoloPanelUrl !== 'function'
            || typeof getPanelIdentity !== 'function' || typeof parsePanelIds !== 'function'
            || typeof parseDashboardUrl !== 'function' || typeof fetchDashboardPanels !== 'function'
            || typeof normalizePanelMetadataText !== 'function' || typeof showAlert !== 'function'
            || typeof currentProfileHasPanel !== 'function'
            || typeof getCurrentProfilePanelIdentities !== 'function'
            || typeof getPanels !== 'function' || typeof savePanels !== 'function'
            || typeof appendPanelCards !== 'function') {
            throw new TypeError('DashBridge panel addition controller dependencies are incomplete');
        }

        const singleModal = documentRef.getElementById('modalOverlay');
        const quickAddModal = documentRef.getElementById('quickAddModalOverlay');
        const dashboardPicker = documentRef.getElementById('dashboardPanelPickerOverlay');
        const dashboardPickerUrl = documentRef.getElementById('dashboardPanelPickerUrl');
        const dashboardPickerStatus = documentRef.getElementById('dashboardPanelPickerStatus');
        const dashboardPickerSelection = documentRef.getElementById('dashboardPanelPickerSelection');
        const dashboardPickerList = documentRef.getElementById('dashboardPanelPickerList');
        const dashboardPickerAdd = documentRef.getElementById('addSelectedDashboardPanelsBtn');
        const dashboardPickerLoad = documentRef.getElementById('loadDashboardPanelsBtn');
        let dashboardPickerState = null;
        let dashboardPickerLoadVersion = 0;

        const closeSingleModal = () => {
            singleModal.style.display = 'none';
            documentRef.getElementById('newPanelUrl').value = '';
        };

        const clearQuickAddForm = () => {
            documentRef.getElementById('quickAddDashboardUrl').value = '';
            documentRef.getElementById('quickAddPanelIds').value = '';
        };
        const closeQuickAddModal = () => {
            quickAddModal.style.display = 'none';
            clearQuickAddForm();
        };

        const updateDashboardPickerSelection = () => {
            const selected = dashboardPickerList.querySelectorAll('input[type="checkbox"]:checked').length;
            dashboardPickerAdd.disabled = selected === 0;
            if (dashboardPickerState) {
                const available = dashboardPickerList
                    .querySelectorAll('input[type="checkbox"]:not(:disabled)').length;
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
        const closeDashboardPickerIfOpen = () => {
            if (dashboardPicker.style.display !== 'flex') return false;
            closeDashboardPicker();
            return true;
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
                    url: buildSoloPanelUrl(dashboardUrl, String(panel.id))
                }));
            dashboardPickerList.replaceChildren();
            safePanels.forEach((panel, index) => {
                const existing = existingPanelIdentities.has(getPanelIdentity(panel.url));
                const item = documentRef.createElement('label');
                item.className = `dashboard-panel-picker-item${existing ? ' is-existing' : ''}`;
                const checkbox = documentRef.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.dataset.panelIndex = String(index);
                checkbox.checked = !existing;
                checkbox.disabled = existing;
                checkbox.addEventListener('change', updateDashboardPickerSelection);
                const title = documentRef.createElement('span');
                title.className = 'dashboard-panel-picker-item-title';
                title.textContent = panel.title;
                const meta = documentRef.createElement('span');
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

        const setup = () => {
            documentRef.getElementById('addPanelBtn').addEventListener('click', () => {
                singleModal.style.display = 'flex';
                documentRef.getElementById('newPanelUrl').focus();
            });
            documentRef.getElementById('closeModalBtn').addEventListener('click', closeSingleModal);
            singleModal.addEventListener('click', event => {
                if (event.target === singleModal) closeSingleModal();
            });
            documentRef.getElementById('savePanelBtn').addEventListener('click', async () => {
                let url = documentRef.getElementById('newPanelUrl').value.trim();
                const width = documentRef.getElementById('newPanelWidth').value;
                if (!url) { await showAlert('Укажите URL!'); return; }
                try {
                    url = normalizePanelUrl(url);
                } catch (error) {
                    console.error('Invalid URL format', error);
                    await showAlert('Укажите корректный URL с протоколом http или https.');
                    return;
                }
                if (currentProfileHasPanel(url)) {
                    await showAlert('Эта панель уже есть в текущем профиле.');
                    return;
                }
                const addedPanel = { id: randomUUID(), src: url, width, height: '350px' };
                getPanels().push(addedPanel);
                savePanels();
                appendPanelCards([addedPanel]);
                closeSingleModal();
            });

            documentRef.getElementById('quickAddPanelsBtn').addEventListener('click', () => {
                quickAddModal.style.display = 'flex';
                documentRef.getElementById('quickAddDashboardUrl').focus();
            });
            documentRef.getElementById('closeQuickAddModalBtn')
                .addEventListener('click', closeQuickAddModal);
            quickAddModal.addEventListener('click', event => {
                if (event.target === quickAddModal) closeQuickAddModal();
            });
            documentRef.getElementById('saveQuickPanelsBtn').addEventListener('click', async () => {
                const dashboardUrl = documentRef.getElementById('quickAddDashboardUrl').value.trim();
                const width = documentRef.getElementById('quickAddPanelWidth').value;
                if (!dashboardUrl) {
                    await showAlert('Укажите URL дашборда Grafana.');
                    return;
                }
                let panelIds;
                try {
                    panelIds = parsePanelIds(documentRef.getElementById('quickAddPanelIds').value);
                    if (!panelIds.length) throw new Error('Укажите хотя бы один ID панели.');
                } catch (error) {
                    await showAlert(error.message);
                    return;
                }
                let panelUrls;
                try {
                    panelUrls = panelIds.map(panelId => buildSoloPanelUrl(dashboardUrl, panelId));
                } catch (error) {
                    await showAlert(error.message || 'Не удалось подготовить URL панелей.');
                    return;
                }
                const existingPanelIdentities = getCurrentProfilePanelIdentities();
                const newPanels = panelUrls
                    .filter(url => {
                        const identity = getPanelIdentity(url);
                        if (!identity || existingPanelIdentities.has(identity)) return false;
                        existingPanelIdentities.add(identity);
                        return true;
                    })
                    .map(url => ({ id: randomUUID(), src: url, width, height: '350px' }));
                if (!newPanels.length) {
                    await showAlert('Все указанные панели уже есть в текущем профиле.');
                    return;
                }
                getPanels().push(...newPanels);
                savePanels();
                appendPanelCards(newPanels);
                closeQuickAddModal();
                if (newPanels.length !== panelIds.length) {
                    await showAlert(`Добавлено панелей: ${newPanels.length}. Уже существующие панели пропущены.`);
                }
            });

            documentRef.getElementById('discoverDashboardPanelsBtn').addEventListener('click', () => {
                dashboardPicker.style.display = 'flex';
                dashboardPickerUrl.focus();
            });
            documentRef.getElementById('closeDashboardPanelPickerBtn')
                .addEventListener('click', closeDashboardPicker);
            documentRef.getElementById('cancelDashboardPanelPickerBtn')
                .addEventListener('click', closeDashboardPicker);
            dashboardPicker.addEventListener('click', event => {
                if (event.target === dashboardPicker) closeDashboardPicker();
            });
            dashboardPickerLoad.addEventListener('click', async () => {
                const dashboardUrl = dashboardPickerUrl.value.trim();
                let dashboardLocation = null;
                try { dashboardLocation = new URL(dashboardUrl); } catch { dashboardLocation = null; }
                if (!parseDashboardUrl(dashboardUrl)
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
                    const result = await fetchDashboardPanels(dashboardUrl);
                    if (loadVersion !== dashboardPickerLoadVersion
                        || dashboardPicker.style.display !== 'flex') return;
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
            documentRef.getElementById('selectAllDashboardPanelsBtn').addEventListener('click', () => {
                dashboardPickerList.querySelectorAll('input[type="checkbox"]:not(:disabled)')
                    .forEach(input => { input.checked = true; });
                updateDashboardPickerSelection();
            });
            documentRef.getElementById('clearDashboardPanelsBtn').addEventListener('click', () => {
                dashboardPickerList.querySelectorAll('input[type="checkbox"]:not(:disabled)')
                    .forEach(input => { input.checked = false; });
                updateDashboardPickerSelection();
            });
            dashboardPickerAdd.addEventListener('click', async () => {
                if (!dashboardPickerState) return;
                const selectedIndexes = [...dashboardPickerList
                    .querySelectorAll('input[type="checkbox"]:checked')]
                    .map(input => Number(input.dataset.panelIndex))
                    .filter(Number.isInteger);
                const width = documentRef.getElementById('dashboardPanelPickerWidth').value;
                const existingPanelIdentities = getCurrentProfilePanelIdentities();
                const selectedPanels = selectedIndexes
                    .map(index => dashboardPickerState.panels[index])
                    .filter(panel => {
                        if (!panel) return false;
                        const identity = getPanelIdentity(panel.url);
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
                    id: randomUUID(), src: panel.url, title: panel.title, width, height: '350px'
                }));
                getPanels().push(...addedPanels);
                await savePanels();
                appendPanelCards(addedPanels);
                closeDashboardPicker();
                if (selectedPanels.length !== selectedIndexes.length) {
                    await showAlert(`Добавлено панелей: ${selectedPanels.length}. Уже существующие панели пропущены.`);
                }
            });
        };

        return Object.freeze({ setup, closeDashboardPickerIfOpen });
    }

    root.DashBridgePanelAdditionController = Object.freeze({ create });
})(globalThis);
