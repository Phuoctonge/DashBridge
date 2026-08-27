// js/pages/batch.js

document.addEventListener("DOMContentLoaded", () => {
    // --- UI Logic: Tabs ---
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const mainActionArea = document.getElementById('mainActionArea');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            // Full-dashboard capture belongs to collection settings.  Series
            // capture has its own action and must not offer the unrelated one.
            updateActionVisibility();
        });
    });

    // --- UI Logic: Panels Mode ---
    const panelsMode = document.getElementById('panelsMode');
    const userPanelsGroup = document.getElementById('userPanelsGroup');
    panelsMode.addEventListener('change', () => {
        if (panelsMode.value === 'whitelist' || panelsMode.value === 'blacklist') {
            userPanelsGroup.style.display = 'block';
        } else {
            userPanelsGroup.style.display = 'none';
        }
    });

    // --- Modals ---
    const panelsModal = document.getElementById('panelsModal');
    const closePanelsModal = document.getElementById('closePanelsModal');

    // --- Toast & Logs ---
    const showToast = BatchPageUi.createNotifier(document.getElementById('toastContainer'));
    const logContainer = document.getElementById('logContainer');
    const logMessage = BatchPageUi.createLogger(logContainer);
    const batchProgress = document.getElementById('batchProgress');
    const batchProgressText = document.getElementById('batchProgressText');
    const batchProgressStats = document.getElementById('batchProgressStats');
    const batchProgressBar = document.getElementById('batchProgressBar');
    let operationProgressController = null;
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
        const field = document.getElementById(fieldId);
        const result = normalizeGrafanaTimeRanges(field.value);
        if (!result.ranges.length) {
            if (notify) showToast('Не удалось распознать временные диапазоны', 'error');
            return result;
        }
        // Preserve the original input when even one line is invalid, so the
        // user can correct it after the launch-time validation message.
        if (result.errors.length) {
            if (notify) showToast(`Не удалось распознать диапазоны в строках: ${result.errors.join(', ')}`, 'error');
            return result;
        }
        field.value = result.ranges.map(({ from, to }) => `${from}, ${to}`).join('\n');
        BatchPageState.save();
        if (notify) showToast(`Преобразовано диапазонов: ${result.ranges.length}.`, 'success');
        return result;
    };
    document.getElementById('clearLogs').addEventListener('click', () => {
        logContainer.innerHTML = '';
    });

    const isUnauthorizedError = error => [401, 403].includes(Number(error?.status))
        || error?.code === 'GRAFANA_AUTH_REQUIRED'
        || /^HTTP Error (?:401|403)$/.test(String(error?.message || error));
    const AUTH_RECOVERY_TIMEOUT_MS = 120_000;
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

    let panelPickerState = null;
    let seriesSelectedPanelIds = [];
    const panelsListContainer = document.getElementById('panelsListContainer');
    const panelPickerSelectionStatus = document.getElementById('panelPickerSelectionStatus');
    const applyPanelPickerBtn = document.getElementById('applyPanelPickerBtn');

    const closePanelPicker = () => {
        panelsModal.style.display = 'none';
        panelPickerState = null;
        panelsListContainer.replaceChildren();
        panelPickerSelectionStatus.textContent = '';
        applyPanelPickerBtn.disabled = true;
    };

    const updatePanelPickerSelection = () => {
        const checkboxes = [...panelsListContainer.querySelectorAll('.panel-picker-checkbox')];
        const selected = checkboxes.filter(input => input.checked).length;
        panelPickerSelectionStatus.textContent = checkboxes.length
            ? `Выбрано панелей: ${selected} из ${checkboxes.length}.`
            : 'В дашборде не найдены панели с числовыми ID.';
        applyPanelPickerBtn.disabled = selected === 0;
    };

    const renderPanelPicker = panels => {
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
            checkbox.addEventListener('change', updatePanelPickerSelection);
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
        updatePanelPickerSelection();
        logMessage(`Найдено панелей: ${safePanelEntries.length}`);
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

    const openPanelPicker = async ({ dashboardUrl, context }) => {
        const info = parseGrafanaUrl(dashboardUrl);
        if (!info) return showToast('Введите корректный URL дашборда Grafana', 'error');
        const selectedIds = context === 'main'
            ? new Set(document.getElementById('userPanels').value.split(',').map(id => id.trim()).filter(Boolean))
            : new Set(seriesSelectedPanelIds);
        try {
            logMessage(`Запрашиваем панели для ${info.uid}...`);
            const { panels, panelList } = await getDashboardPanelsWithRecovery(dashboardUrl);
            panelPickerState = { context, selectedIds };
            renderPanelPicker(panelList?.length ? panelList : panels);
        } catch (error) {
            logMessage(`Ошибка: ${error.message}`, true);
            showToast(`Не удалось получить панели: ${error.message}`, 'error');
        }
    };

    const applyPanelPickerSelection = () => {
        if (!panelPickerState) return;
        const selectedIds = [...panelsListContainer.querySelectorAll('.panel-picker-checkbox:checked')].map(input => input.value);
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
        closePanelPicker();
    };

    applyPanelPickerBtn.addEventListener('click', applyPanelPickerSelection);
    closePanelsModal.addEventListener('click', closePanelPicker);
    document.getElementById('cancelPanelPickerBtn').addEventListener('click', closePanelPicker);
    document.getElementById('selectAllPanelPickerBtn').addEventListener('click', () => {
        panelsListContainer.querySelectorAll('.panel-picker-checkbox').forEach(input => { input.checked = true; });
        updatePanelPickerSelection();
    });
    document.getElementById('clearPanelPickerBtn').addEventListener('click', () => {
        panelsListContainer.querySelectorAll('.panel-picker-checkbox').forEach(input => { input.checked = false; });
        updatePanelPickerSelection();
    });
    panelsModal.addEventListener('click', event => {
        if (event.target === panelsModal) closePanelPicker();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && panelsModal.style.display === 'flex') closePanelPicker();
    });

    // --- State Persistence ---
    const captureThemeInputs = Array.from(document.querySelectorAll('.batch-capture-theme'));

    function getCaptureTheme(groupId = 'captureThemeMain') {
        const value = document.querySelector(`#${groupId} input:checked`)?.value;
        return value === 'current' || value === 'dark' ? value : 'light';
    }

    function setCaptureTheme(value, groupId) {
        const normalized = value === 'current' || value === 'dark' ? value : 'light';
        document.querySelectorAll(`#${groupId} .batch-capture-theme`).forEach(input => {
            input.checked = input.value === normalized;
        });
    }

    // --- Per-panel transformation rules ---
    const dashUrl = document.getElementById('dashUrl');
    const batchPanelRules = document.getElementById('batchPanelRules');
    const batchPanelRulesStatus = document.getElementById('batchPanelRulesStatus');
    let batchPanelRulesLoadVersion = 0;
    const ruleOptionLabels = [
        ['removeFill', 'Убрать заливку графика'],
        ['thickenLines', 'Утолщить линии графика'],
        ['invertLegend', 'Переместить легенду: справа ↔ снизу'],
        ['invertIdle', 'Инвертировать CPU-график: Idle → Load'],
        ['convertMemToUsed', 'Конвертировать RAM-график в % Used']
    ];

    const setBatchPanelRulesStatus = message => { batchPanelRulesStatus.textContent = message; };
    const createBatchPanelRuleOption = (key, label, checked) => {
        const option = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.ruleField = key;
        input.checked = checked === true;
        option.append(input, document.createTextNode(label));
        return option;
    };
    const addBatchPanelRuleRow = (panelId = '', rule = {}) => {
        const row = document.createElement('article');
        row.className = 'batch-panel-rule';
        const idBox = document.createElement('div');
        idBox.className = 'batch-panel-rule-id';
        const idLabel = document.createElement('label');
        idLabel.textContent = 'ID панели';
        const idInput = document.createElement('input');
        idInput.type = 'number';
        idInput.min = '1';
        idInput.step = '1';
        idInput.inputMode = 'numeric';
        idInput.className = 'batch-panel-rule-id-input';
        idInput.value = panelId;
        idInput.placeholder = '12';
        idLabel.append(idInput);
        idBox.append(idLabel);

        const options = document.createElement('div');
        options.className = 'batch-panel-rule-options';
        ruleOptionLabels.forEach(([key, label]) => options.append(createBatchPanelRuleOption(key, label, rule[key])));
        const width = document.createElement('label');
        width.className = 'batch-panel-rule-width';
        width.append(document.createTextNode('Толщина '));
        const widthInput = document.createElement('input');
        widthInput.type = 'number';
        widthInput.min = '1';
        widthInput.max = '10';
        widthInput.step = '0.5';
        widthInput.dataset.ruleField = 'thickenLinesValue';
        widthInput.value = Number(rule.thickenLinesValue) || 1.5;
        width.append(widthInput);
        options.append(width);

        const thickenLinesInput = options.querySelector('[data-rule-field="thickenLines"]');
        const syncThicknessControl = () => {
            const enabled = thickenLinesInput?.checked === true;
            width.hidden = !enabled;
            widthInput.disabled = !enabled;
            widthInput.setAttribute('aria-hidden', String(!enabled));
        };
        thickenLinesInput?.addEventListener('change', syncThicknessControl);
        syncThicknessControl();

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn batch-panel-rule-remove';
        remove.textContent = 'Удалить';
        remove.addEventListener('click', () => { row.remove(); scheduleBatchPanelRulesSave(); });
        row.append(idBox, options, remove);
        row.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', scheduleBatchPanelRulesSave);
            input.addEventListener('change', scheduleBatchPanelRulesSave);
        });
        batchPanelRules.append(row);
    };
    const renderBatchPanelRules = (rules = {}) => {
        batchPanelRules.replaceChildren();
        Object.entries(rules).sort(([a], [b]) => Number(a) - Number(b)).forEach(([panelId, rule]) => addBatchPanelRuleRow(panelId, rule));
    };
    const collectBatchPanelRules = () => {
        const rules = {};
        batchPanelRules.querySelectorAll('.batch-panel-rule').forEach(row => {
            const panelId = row.querySelector('.batch-panel-rule-id-input')?.value.trim();
            if (!panelId) return;
            if (!/^\d+$/.test(panelId) || Number(panelId) < 1) throw new Error(`Некорректный ID панели: ${panelId}`);
            const rule = {};
            row.querySelectorAll('[data-rule-field]').forEach(input => {
                if (input.type === 'checkbox' && input.checked) rule[input.dataset.ruleField] = true;
            });
            if (rule.thickenLines) rule.thickenLinesValue = Number(row.querySelector('[data-rule-field="thickenLinesValue"]')?.value);
            rules[panelId] = rule;
        });
        return rules;
    };
    const loadBatchPanelRules = async () => {
        const url = dashUrl.value.trim();
        const loadVersion = ++batchPanelRulesLoadVersion;
        if (!parseGrafanaUrl(url)) {
            renderBatchPanelRules();
            setBatchPanelRulesStatus('Введите URL Grafana, чтобы загрузить правила этого дашборда.');
            return;
        }
        try {
            const rules = await BatchPanelRules.load(url);
            if (loadVersion !== batchPanelRulesLoadVersion || url !== dashUrl.value.trim()) return;
            renderBatchPanelRules(rules);
            document.getElementById('resetBatchPanelRulesBtn').hidden = !Object.keys(rules).length;
            setBatchPanelRulesStatus(Object.keys(rules).length ? `Загружено правил: ${Object.keys(rules).length}.` : 'Для этого дашборда правил пока нет.');
        } catch (error) {
            setBatchPanelRulesStatus(`Не удалось загрузить правила: ${error.message}`);
        }
    };

    let batchPanelRulesSaveTimer = null;
    const hasIncompleteBatchPanelRule = () => Array.from(batchPanelRules.querySelectorAll('.batch-panel-rule')).some(row => {
        const panelId = row.querySelector('.batch-panel-rule-id-input')?.value.trim();
        const hasSelectedTool = Array.from(row.querySelectorAll('input[type="checkbox"]')).some(input => input.checked);
        return !panelId || !/^\d+$/.test(panelId) || Number(panelId) < 1 || !hasSelectedTool;
    });
    const scheduleBatchPanelRulesSave = () => {
        clearTimeout(batchPanelRulesSaveTimer);
        const saveUrl = dashUrl.value.trim();
        setBatchPanelRulesStatus('Сохранение…');
        batchPanelRulesSaveTimer = setTimeout(async () => {
            if (saveUrl !== dashUrl.value.trim()) return;
            if (!parseGrafanaUrl(saveUrl)) return setBatchPanelRulesStatus('Введите URL Grafana, чтобы сохранить правила.');
            if (hasIncompleteBatchPanelRule()) return setBatchPanelRulesStatus('Укажите корректный ID панели и выберите хотя бы одну настройку.');
            try {
                const rules = await BatchPanelRules.save(saveUrl, collectBatchPanelRules());
                if (saveUrl !== dashUrl.value.trim()) return;
                document.getElementById('resetBatchPanelRulesBtn').hidden = !Object.keys(rules).length;
                setBatchPanelRulesStatus(Object.keys(rules).length ? `Сохранено правил: ${Object.keys(rules).length}.` : 'Нет сохранённых правил для этого дашборда.');
            } catch (error) {
                setBatchPanelRulesStatus(`Не удалось сохранить правила: ${error.message}`);
            }
        }, 350);
    };
    document.getElementById('addBatchPanelRuleBtn').addEventListener('click', () => { addBatchPanelRuleRow(); scheduleBatchPanelRulesSave(); });
    document.getElementById('resetBatchPanelRulesBtn').addEventListener('click', () => {
        renderBatchPanelRules();
        scheduleBatchPanelRulesSave();
    });
    dashUrl.addEventListener('change', () => { clearTimeout(batchPanelRulesSaveTimer); void loadBatchPanelRules(); });

    BatchPageState.bind();
    BatchPageState.restore().then(loadBatchPanelRules);
    document.getElementById('copyMainSettingsToSeriesBtn').addEventListener('click', () => {
        const mainUrl = dashUrl.value.trim();
        const mainSlices = document.getElementById('timestamps').value.trim();
        if (!mainUrl && !mainSlices) return showToast('В настройках сбора нет URL и временных срезов для копирования', 'info');
        document.getElementById('seriesDashUrl').value = mainUrl;
        document.getElementById('seriesTimestamps').value = mainSlices;
        resetSeriesDashboardSelection();
        BatchPageState.save();
        showToast('URL и временные срезы скопированы в Series', 'success');
    });
    let previousSeriesDashboardUrl = document.getElementById('seriesDashUrl').value.trim();
    const resetSeriesDashboardSelection = () => {
        const currentUrl = document.getElementById('seriesDashUrl').value.trim();
        if (currentUrl === previousSeriesDashboardUrl) return;
        previousSeriesDashboardUrl = currentUrl;
        seriesSelectedPanelIds = [];
        document.getElementById('seriesPanelsContainer').replaceChildren();
        document.getElementById('seriesPanelSelectionStatus').textContent = 'Панели ещё не выбраны';
        document.getElementById('loadSelectedSeriesBtn').hidden = true;
    };
    document.getElementById('seriesDashUrl').addEventListener('input', resetSeriesDashboardSelection);
    document.getElementById('seriesDashUrl').addEventListener('change', resetSeriesDashboardSelection);
    captureThemeInputs.forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) setCaptureTheme(input.value, input.closest('fieldset')?.id);
        });
    });

    // --- Helper API: Parse Grafana URL ---
    function parseGrafanaUrl(url) {
        return parseGrafanaDashboardUrl(url);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --- Get Panels Action ---
    document.getElementById('getPanelsBtn').addEventListener('click', () => {
        void openPanelPicker({ dashboardUrl: document.getElementById('dashUrl').value.trim(), context: 'main' });
    });

    // --- Engine State ---
    let isProcessing = false;
    const captureWindowRunner = createBatchCaptureWindowRunner();
    const loadBatchPanel = createBatchPanelLoader({ log: logMessage });
    async function getOrCreateCaptureWindow() {
        return captureWindowRunner.acquire();
    }

    async function closeCaptureWindow() {
        return captureWindowRunner.release();
    }


    // --- Helper APIs ---
    // Убиваем тултипы и курсор чтобы не мешали скриншоту
    // Запоминаем CSS классы и стили всех элементов легенды до клика
    // Ждем изменения классов/стилей (реакции React)

    async function capturePanelToZip(win, tabId, panelId, filename, archive, captureOptions = {}) {
        const captured = await captureGrafanaPanelImage({
            tabId,
            windowId: win.id,
            panelId,
            settleMs: 300,
            ...captureOptions
        });
        if (!captured) {
            logMessage(`Unable to capture panel: ${filename}`, true);
            return false;
        }
        const bytes = BatchCaptureUtils.base64ToUint8Array(captured.dataUrl.split(',')[1]);
        await archive.add(filename, bytes, bytes.byteLength);
        logMessage(`Saved: ${filename} (${bytes.length} bytes)`);
        return true;
    }

    async function getBatchCaptureOptions(toggleId) {
        const prepared = document.getElementById(toggleId)?.checked === true;
        if (!prepared) return { prepared: false };
        const stored = await chrome.storage.sync.get([
            'grafanaCompactExportWidth', 'grafanaCompactExportHeight'
        ]);
        const settings = normalizeGrafanaSettings(stored);
        return {
            prepared: true,
            outputWidth: settings.grafanaCompactExportWidth,
            outputHeight: settings.grafanaCompactExportHeight
        };
    }

    async function addBatchArchiveReport(archive, report) {
        const manifest = `${JSON.stringify({
            generatedAt: new Date().toISOString(),
            ...report
        }, null, 2)}\n`;
        const manifestBytes = new TextEncoder().encode(manifest);
        await archive.add('manifest.json', manifestBytes, manifestBytes.byteLength);
        if (report.errors?.length) {
            const errorText = `${report.errors.map(item => `${item.file}: ${item.reason}`).join('\n')}\n`;
            const errorBytes = new TextEncoder().encode(errorText);
            await archive.add('errors.txt', errorBytes, errorBytes.byteLength);
        }
    }

    // --- Управление флагом обработки и кнопкой отмены ---
    const cancelBtn = document.getElementById('cancelBtn');
    const startBtn = document.getElementById('startBtn');
    const startSeriesBtn = document.getElementById('startSeriesBtn');

    const updateActionVisibility = () => {
        const isMainTab = document.querySelector('.tab-btn.active')?.dataset.tab === 'tab-main';
        mainActionArea.hidden = !isMainTab && !isProcessing;
        startBtn.hidden = !isMainTab && isProcessing;
    };

    function setProcessing(active) {
        isProcessing = active;
        startBtn.disabled = active;
        startSeriesBtn.disabled = active;
        cancelBtn.hidden = !active;
        // inline-flex восстанавливаем вручную, т.к. hidden убирает display
        if (!active) cancelBtn.style.display = '';
        updateActionVisibility();
    }

    setProcessing(false);
    const cancelActiveBatchRun = async () => {
        if (!isProcessing) return false;
        BatchRunLifecycle.cancel();
        isProcessing = false;
        operationProgressController?.cancel();
        logMessage('⛔ Сбор отменён пользователем.');
        showToast('Сбор отменён', 'info');
        await closeCaptureWindow();
        setProcessing(false);
        return true;
    };
    operationProgressController = DashBridgeOperationProgress.create({ onCancel: cancelActiveBatchRun });
    const beginBatchRun = async ({ title, phase }) => {
        const runId = BatchRunLifecycle.begin();
        setProcessing(true);
        await operationProgressController.openPictureInPicture({ title, phase, width: 390, height: 300 });
        return runId;
    };
    const isBatchRunActive = runId => isProcessing && BatchRunLifecycle.isActive(runId);
    const finishBatchRun = async runId => {
        if (!BatchRunLifecycle.finish(runId)) return false;
        operationProgressController.finish();
        await closeCaptureWindow();
        setProcessing(false);
        return true;
    };

    cancelBtn.addEventListener('click', cancelActiveBatchRun);
    window.addEventListener('pagehide', () => { void operationProgressController?.release(); });

    // --- Main Capture Action ---
    startBtn.addEventListener('click', async () => {
        if (isProcessing) return showToast('Процесс уже запущен!', 'error');

        const urlStr = document.getElementById('dashUrl').value.trim();
        const timestampsText = document.getElementById('timestamps').value.trim();

        if (!urlStr || !timestampsText) return showToast('Заполните URL и диапазоны дат', 'error');

        const info = parseGrafanaUrl(urlStr);
        if (!info) return showToast('Неверный формат URL', 'error');

        const normalizedRanges = normalizeTimeRangesField({ fieldId: 'timestamps', notify: false });
        if (normalizedRanges.errors.length) {
            return showToast(`Не удалось распознать диапазоны в строках: ${normalizedRanges.errors.join(', ')}`, 'error');
        }
        const timestamps = normalizedRanges.ranges;
        // Баг исправлен: использовать тему из вкладки «Настройки сбора», а не Series
        const captureTheme = getCaptureTheme('captureThemeMain');
        const captureOptions = await getBatchCaptureOptions('compactCaptureMain');

        if (timestamps.length === 0) return showToast('Не удалось разобрать диапазоны дат', 'error');

        const runId = await beginBatchRun({ title: 'Массовый сбор скриншотов', phase: 'Получение списка панелей' });
        const captureFilename = BatchCaptureUtils.createFilenameFactory();
        logMessage('🚀 Начало работы массового сбора...');

        try {
            // Используем recovery для обработки ошибки 401 (истёкшая сессия)
            const dashboardResult = await getDashboardPanelsWithRecovery(urlStr);
            if (!isBatchRunActive(runId)) return;
            const panels = { ...dashboardResult.panels };
            const mainPanelRules = await BatchPanelRules.load(urlStr);
            if (!isBatchRunActive(runId)) return;

            // Применяем whitelist/blacklist
            const mode = document.getElementById('panelsMode').value;
            const uPanels = document.getElementById('userPanels').value.split(',').map(s => s.trim()).filter(s => s);
            const orderedPanelIds = dashboardResult.panelList?.length
                ? dashboardResult.panelList.map(panel => String(panel.id))
                : Object.keys(panels);
            const pids = orderedPanelIds.filter(panelId => {
                if (mode === 'whitelist' && uPanels.length > 0) return uPanels.includes(panelId);
                if (mode === 'blacklist' && uPanels.length > 0) return !uPanels.includes(panelId);
                return true;
            });
            if (pids.length === 0) throw new Error('Нет панелей для сбора после фильтрации');
            const totalJobs = pids.length * timestamps.length;
            let completedJobs = 0;
            let successfulJobs = 0;
            let failedJobs = 0;
            const captureErrors = [];
            updateBatchProgress({ done: 0, total: totalJobs, success: 0, failed: 0, phase: 'Сбор панелей' });

            const archiveName = `grafana_batch_${new Date().toISOString().slice(0, 10)}.zip`;
            const archive = createRollingZipArchive({ filename: archiveName, maxBytes: 300 * 1024 * 1024 });
            const win = await getOrCreateCaptureWindow();
            if (!isBatchRunActive(runId)) {
                await closeCaptureWindow();
                return;
            }
            const tabId = win.tabs[0].id;
            for (const pid of pids) {
                for (let rangeIndex = 0; rangeIndex < timestamps.length; rangeIndex++) {
                    const ts = timestamps[rangeIndex];
                    if (!isBatchRunActive(runId)) break;

                    const fullUrl = buildGrafanaPanelUrl(urlStr, pid, { ...ts, theme: captureTheme });
                    const filename = captureFilename({
                        panelId: pid,
                        label: panels[pid],
                        from: ts.from,
                        to: ts.to,
                        identity: fullUrl
                    });
                    const archivePath = BatchCaptureUtils.buildArchivePath({
                        filename, rangeIndex, rangeCount: timestamps.length, from: ts.from, to: ts.to
                    });
                    operationProgressController.update({
                        done: completedJobs,
                        total: totalJobs,
                        success: successfulJobs,
                        failed: failedJobs,
                        phase: `Панель ${pid}`,
                        message: `${ts.from} → ${ts.to}`
                    });

                    const rect = await loadBatchPanel(tabId, fullUrl, pid, null, null, BatchPanelRules.forPanel(mainPanelRules, pid), BatchRunLifecycle.signal(runId));
                    if (rect && rect.w > 5 && rect.h > 5) {
                        if (await capturePanelToZip(win, tabId, pid, archivePath, archive, captureOptions)) {
                            successfulJobs++;
                        } else {
                            failedJobs++;
                            captureErrors.push({ file: archivePath, reason: 'Не удалось захватить изображение панели' });
                            logMessage(`❌ Не удалось захватить панель: ${archivePath}`, true);
                        }
                    } else {
                        failedJobs++;
                        captureErrors.push({ file: archivePath, reason: 'Панель не найдена, не отрисована или имеет пустой размер' });
                        logMessage(`❌ Панель не найдена или пустая (w/h < 5): ${archivePath}`, true);
                    }
                    completedJobs++;
                    updateBatchProgress({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Сбор панелей' });
                }
            }

            if (isBatchRunActive(runId)) {
                if (!successfulJobs) {
                    logMessage('Сбор завершён без снимков. Архив не создан.', true);
                    showToast('Не удалось сохранить ни одной панели', 'error');
                } else {
                    logMessage('📦 Формирование ZIP архива...');
                    operationProgressController.update({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Формирование ZIP', message: 'Подготовка архива к скачиванию…' });
                    await addBatchArchiveReport(archive, {
                        kind: 'panels',
                        dashboard: info,
                        totalJobs,
                        successfulJobs,
                        failedJobs,
                        errors: captureErrors
                    });
                    await archive.finalize();
                    if (failedJobs) {
                        logMessage(`Сбор завершён частично: сохранено ${successfulJobs}, ошибок ${failedJobs}.`);
                        showToast(`Архив скачан: ${successfulJobs} успешно, ${failedJobs} с ошибкой`, 'info');
                    } else {
                        logMessage('🎉 Сбор успешно завершен!');
                        showToast('Архив скачан!', 'success');
                    }
                }
            }

        } catch (e) {
            if (isBatchRunActive(runId)) {
                logMessage(`💥 Ошибка сбора: ${e.message}`, true);
                showToast('Критическая ошибка', 'error');
            }
        } finally {
            await finishBatchRun(runId);
        }
    });

    // --- Independent Series Discovery Logic ---
    const seriesPanelIdFormatCache = new Map();
    const seriesDashboardIdentity = dashboardUrl => {
        const dashboard = parseGrafanaDashboardUrl(dashboardUrl);
        return dashboard ? `${dashboard.baseUrl}|org:${dashboard.orgId || 'default'}|${dashboard.uid}` : dashboardUrl;
    };
    const seriesPanelIdCandidates = (dashboardUrl, panelId) => {
        const format = seriesPanelIdFormatCache.get(seriesDashboardIdentity(dashboardUrl));
        if (format === 'prefixed') return [`panel-${panelId}`, String(panelId)];
        if (format === 'numeric') return [String(panelId), `panel-${panelId}`];
        return [`panel-${panelId}`, String(panelId)];
    };
    const rememberSeriesPanelIdFormat = (dashboardUrl, capturePanelId) => {
        seriesPanelIdFormatCache.set(seriesDashboardIdentity(dashboardUrl), String(capturePanelId).startsWith('panel-') ? 'prefixed' : 'numeric');
    };
    const buildSeriesCaptureUrl = (dashboardUrl, panelId, range, signatures) => {
        const url = new URL(buildGrafanaSoloPanelUrl(dashboardUrl, panelId, {
            from: range.from,
            to: range.to,
            theme: getCaptureTheme('captureThemeSeries')
        }));
        const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        url.searchParams.set('dashbridgeSeriesCapture', token);
        url.searchParams.set('dashbridgeSeriesTargets', JSON.stringify(signatures));
        return { url: url.toString(), token };
    };

    const navigateGrafanaSeriesCaptureTab = async (tabId, captureUrl, windowId = null) => {
        const registration = await ensureEarlyGrafanaRuntimeForUrl(captureUrl);
        if (!registration.ok) throw new Error('Не удалось подготовить ранний Grafana runtime');
        if (tabId) await chrome.tabs.update(tabId, { url: captureUrl });
        else {
            const tab = await chrome.tabs.create({
                url: captureUrl,
                active: true,
                ...(windowId ? { windowId } : {})
            });
            if (!tab.id) throw new Error('Не удалось открыть фоновую вкладку Grafana');
            tabId = tab.id;
        }
        return tabId;
    };

    const waitForCapturedSeries = (tabId, token, timeoutMs = 45000, signal = null) => new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let settled = false;
        let polling = false;
        const cleanup = () => {
            clearInterval(timer);
            signal?.removeEventListener('abort', abort);
        };
        const succeed = value => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };
        const fail = error => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const abort = () => fail(new DOMException('Batch run cancelled', 'AbortError'));
        const timer = setInterval(async () => {
            if (settled || polling) return;
            polling = true;
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId }, world: 'MAIN', args: [token],
                    func: expectedToken => {
                        const capture = window.__dashBridgeSeriesCapture;
                        return capture?.token === expectedToken ? capture : null;
                    }
                });
                const capture = results?.[0]?.result;
                const names = capture?.names;
                const settledAfterMatch = capture?.lastMatchAt && Date.now() - capture.lastMatchAt >= 400;
                const coverageComplete = !capture?.expectedCount || capture.matchedIdentities?.length >= capture.expectedCount;
                if (Array.isArray(names) && settledAfterMatch && coverageComplete) {
                    succeed(names);
                } else if (Date.now() - startedAt > timeoutMs) {
                    const debug = capture?.debug;
                    const reason = !capture
                        ? 'перехватчик DashBridge не запустился'
                        : !debug?.requests
                            ? 'Grafana не выполнила запрос данных во временной вкладке'
                            : 'ответы Grafana не совпали с запросами выбранной панели';
                    fail(new Error(`${reason} (запросов: ${debug?.requests || 0}, совпадений: ${debug?.matched || 0})`));
                }
            } catch (error) {
                fail(error);
            } finally {
                polling = false;
            }
        }, 250);
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
    });

    const discoverSeriesForSlice = async ({ dashboardUrl, panelId, range, signatures, tabId = null, signal = null, onTabId = null, discoveryWindowId = null }) => {
        let nextTabId = tabId;
        let lastError = null;
        for (const capturePanelId of seriesPanelIdCandidates(dashboardUrl, panelId)) {
            const capture = buildSeriesCaptureUrl(dashboardUrl, capturePanelId, range, signatures);
            nextTabId = await navigateGrafanaSeriesCaptureTab(nextTabId, capture.url, discoveryWindowId);
            onTabId?.(nextTabId);
            try {
                const names = await waitForCapturedSeries(nextTabId, capture.token, 15000, signal);
                rememberSeriesPanelIdFormat(dashboardUrl, capturePanelId);
                return { tabId: nextTabId, names };
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('Grafana не вернула серии');
    };

    const appendSeriesPanelCard = (panelId, panelTitle, panelUrl, signatures) => {
        const container = document.getElementById('seriesPanelsContainer');
        const card = document.createElement('div');
        card.className = 'batch-series-card';
        card.dataset.querySignatures = JSON.stringify(signatures || []);
        card.innerHTML = `<h3 style="margin-top:0; font-size:14px; color:var(--primary);">Панель ID: ${escapeHtml(panelId)} — ${escapeHtml(panelTitle)}</h3>
            <input type="hidden" class="series-panel-url" value="${escapeHtml(panelUrl)}">
            <p>Series будут определены для каждого временного среза и отфильтрованы по ключевым фразам.</p>`;
        container.appendChild(card);
    };
    const loadSelectedSeriesPanels = async () => {
        const dashboardUrl = document.getElementById('seriesDashUrl').value.trim();
        const panelIds = seriesSelectedPanelIds;
        if (!dashboardUrl) return showToast('Введите URL дашборда для Series', 'error');
        if (!panelIds.length) return showToast('Выберите хотя бы одну панель', 'error');
        const loader = document.getElementById('seriesLoaderStatus');
        loader.hidden = false;
        document.getElementById('seriesPanelsContainer').innerHTML = '';
        try {
            let loadedCards = 0;
            const { payload } = await fetchGrafanaDashboardDefinition(dashboardUrl);
            for (const panelId of panelIds) {
                const panelUrl = buildGrafanaPanelUrl(dashboardUrl, panelId, { theme: getCaptureTheme('captureThemeSeries') });
                try {
                    const panel = findGrafanaDashboardPanel(payload.dashboard, panelId);
                    if (!panel) throw new Error(`Панель ${panelId} не найдена в дашборде`);
                    const signatures = getGrafanaPanelQuerySignatures(panel);
                    if (!signatures.length) throw new Error('В панели нет активных запросов');
                    appendSeriesPanelCard(panelId, panel.title, panelUrl, signatures);
                    loadedCards++;
                } catch (error) {
                    logMessage(`Ошибка API для панели ${panelId}: ${error.message}`, true);
                }
            }
            if (loadedCards) showToast(`Подготовлено панелей: ${loadedCards}`, 'success');
            else showToast('Панели не подготовлены. Откройте журнал: в нём указана причина по каждой панели.', 'error');
        } catch (error) {
            logMessage(`Ошибка подготовки панелей: ${error.message}`, true);
            showToast('Не удалось подготовить панели', 'error');
        } finally {
            loader.hidden = true;
        }
    };
    document.getElementById('getSeriesPanelsBtn').addEventListener('click', () => {
        void openPanelPicker({ dashboardUrl: document.getElementById('seriesDashUrl').value.trim(), context: 'series' });
    });
    document.getElementById('loadSelectedSeriesBtn').addEventListener('click', loadSelectedSeriesPanels);

    document.getElementById('startSeriesBtn').addEventListener('click', async () => {
        if (isProcessing) return showToast('Процесс уже запущен!', 'error');

        const normalizedRanges = normalizeTimeRangesField({ fieldId: 'seriesTimestamps', notify: false });
        if (normalizedRanges.errors.length) {
            return showToast(`Не удалось распознать диапазоны в строках: ${normalizedRanges.errors.join(', ')}`, 'error');
        }
        const timestamps = normalizedRanges.ranges;

        if (timestamps.length === 0) return showToast('Не удалось разобрать диапазоны дат', 'error');

        const mode = document.getElementById('seriesCaptureMode').value;
        const captureTheme = getCaptureTheme('captureThemeSeries');
        const captureOptions = await getBatchCaptureOptions('compactCaptureSeries');
        const includePattern = document.getElementById('seriesIncludeFilter').value;
        const ignorePattern = document.getElementById('seriesIgnoreFilter').value;
        const cards = document.querySelectorAll('#seriesPanelsContainer .batch-series-card');
        if (cards.length === 0) return showToast('Нет панелей для сбора', 'error');

        const runId = await beginBatchRun({ title: 'Массовый сбор Series', phase: 'Подготовка фильтров Series' });
        const captureFilename = BatchCaptureUtils.createFilenameFactory();
        logMessage('🚀 Начало сбора изолированных метрик (Series)...');

        let seriesDiscoveryTabId = null;
        try {
            const batchPageTab = await chrome.tabs.getCurrent();
            const seriesDashboardUrl = document.getElementById('seriesDashUrl').value.trim();
            const seriesPanelRules = parseGrafanaUrl(seriesDashboardUrl)
                ? await BatchPanelRules.load(seriesDashboardUrl)
                : {};
            if (!isBatchRunActive(runId)) return;
            const archiveName = `grafana_series_${new Date().toISOString().slice(0, 10)}.zip`;
            const archive = createRollingZipArchive({ filename: archiveName, maxBytes: 300 * 1024 * 1024 });
            const win = await getOrCreateCaptureWindow();
            if (!isBatchRunActive(runId)) {
                await closeCaptureWindow();
                return;
            }
            const tabId = win.tabs[0].id;
            let totalJobs = 0;
            let completedJobs = 0;
            let successfulJobs = 0;
            let failedJobs = 0;
            const captureErrors = [];
            const recordSeriesJob = (success, file = '', reason = 'Снимок Series не создан') => {
                completedJobs++;
                if (success) successfulJobs++;
                else {
                    failedJobs++;
                    captureErrors.push({ file: file || `series-job-${completedJobs}`, reason });
                }
                updateBatchProgress({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Сбор Series' });
            };
            updateBatchProgress({ done: 0, total: totalJobs, success: 0, failed: 0, phase: 'Сбор Series' });

            for (const card of cards) {
                const urlStr = card.querySelector('.series-panel-url').value;
                const parsed = new URL(urlStr);
                const pid = new URLSearchParams(parsed.search).get('viewPanel') || 'Unknown';
                const signatures = JSON.parse(card.dataset.querySignatures || '[]');

                for (let rangeIndex = 0; rangeIndex < timestamps.length; rangeIndex++) {
                    const ts = timestamps[rangeIndex];
                    if (!isBatchRunActive(runId)) break;
                    operationProgressController.update({
                        done: completedJobs,
                        total: totalJobs,
                        success: successfulJobs,
                        failed: failedJobs,
                        phase: `Series панели ${pid}`,
                        message: `${ts.from} → ${ts.to}`
                    });

                    try {
                        const discovery = await discoverSeriesForSlice({
                            dashboardUrl: seriesDashboardUrl,
                            panelId: pid,
                            range: ts,
                            signatures,
                            tabId: seriesDiscoveryTabId,
                            signal: BatchRunLifecycle.signal(runId),
                            onTabId: value => { seriesDiscoveryTabId = value; },
                            discoveryWindowId: batchPageTab?.windowId || null
                        });
                        seriesDiscoveryTabId = discovery.tabId;
                        const selection = BatchSeriesSelection.resolvePatterns(discovery.names, includePattern, ignorePattern);
                        totalJobs += mode === 'group' ? (selection.matches.length ? 1 : 0) : selection.matches.length;
                        updateBatchProgress({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Сбор Series' });
                        if (!selection.matches.length) {
                            logMessage(`Для панели ${pid} нет Series, подходящих под фильтры, в срезе ${ts.from} → ${ts.to}`);
                            continue;
                        }

                        const fullUrl = buildGrafanaPanelUrl(urlStr, pid, { ...ts, theme: captureTheme });

                        if (mode === 'group') {
                            const filteredUrl = applyGrafanaCompleteHideSelection(
                                fullUrl,
                                selection.matches.map(series => series.name),
                                signatures
                            );
                            const filename = captureFilename({
                                panelId: pid,
                                label: 'Group',
                                from: ts.from,
                                to: ts.to,
                                identity: `${filteredUrl}\u0000${selection.matches.map(series => series.key).join('\u0000')}`
                            });
                            const archivePath = BatchCaptureUtils.buildArchivePath({
                                filename, rangeIndex, rangeCount: timestamps.length, from: ts.from, to: ts.to
                            });
                            const rect = await loadBatchPanel(tabId, filteredUrl, pid, null, null, BatchPanelRules.forPanel(seriesPanelRules, pid), BatchRunLifecycle.signal(runId));
                            if (rect && rect.w > 5) {
                                const captured = await capturePanelToZip(win, tabId, pid, archivePath, archive, captureOptions);
                                recordSeriesJob(captured, archivePath, 'Не удалось захватить изображение панели');
                                if (!captured) {
                                    logMessage(`❌ Не удалось захватить панель: ${archivePath}`, true);
                                }
                            } else {
                                recordSeriesJob(false, archivePath, 'Панель не найдена, не отрисована или имеет пустой размер');
                                logMessage(`❌ Панель не найдена или пустая: ${archivePath}`, true);
                            }
                        } else {
                            // standalone — каждая серия в отдельном файле
                            // prevSeriesName передаётся загрузчику для быстрого переключения без перезагрузки
                            let prevSeriesName = null;
                            let seriesIndex = 0;
                            for (const series of selection.matches) {
                                if (!isBatchRunActive(runId)) break;
                                const seriesName = series.name;
                                const occurrence = seriesIndex++;
                                const filename = captureFilename({
                                    panelId: pid,
                                    label: seriesName,
                                    from: ts.from,
                                    to: ts.to,
                                    identity: `${fullUrl}\u0000${series.key}`,
                                    occurrence
                                });
                                const archivePath = BatchCaptureUtils.buildArchivePath({
                                    filename, rangeIndex, rangeCount: timestamps.length, from: ts.from, to: ts.to
                                });

                                // Передаём prevSeriesName: загрузчик использует его чтобы пропустить
                                // перезагрузку страницы если URL не изменился
                                const rect = await loadBatchPanel(tabId, fullUrl, pid, null, prevSeriesName, BatchPanelRules.forPanel(seriesPanelRules, pid), BatchRunLifecycle.signal(runId));
                                prevSeriesName = seriesName;

                                if (rect && rect.w > 5) {
                                    const filterResult = await setGrafanaLegendVisibility({
                                        tabId,
                                        panelId: pid,
                                        selectedKeys: [series.key]
                                    });
                                    if (!filterResult.ok) {
                                        recordSeriesJob(false, archivePath, 'Не удалось применить фильтр легенды');
                                        logMessage(`Unable to apply the legend filter: ${seriesName}`, true);
                                        continue;
                                    }
                                    if (rect.missing && rect.missing.length > 0) {
                                        logMessage(`⚠️ Внимание: Серия не найдена или не кликабельна: ${rect.missing.join(', ')}`, true);
                                    }
                                    const captured = await capturePanelToZip(win, tabId, pid, archivePath, archive, captureOptions);
                                    recordSeriesJob(captured, archivePath, 'Не удалось захватить изображение Series');
                                    if (!captured) {
                                        logMessage(`❌ Не удалось захватить серию: ${archivePath}`, true);
                                    }
                                } else {
                                    recordSeriesJob(false, archivePath, 'Панель не найдена, не отрисована или имеет пустой размер');
                                    logMessage(`❌ Панель не найдена или пустая: ${archivePath}`, true);
                                }
                            }
                        }
                    } catch (error) {
                        logMessage(`Не удалось получить серии панели ${pid} для ${ts.from} → ${ts.to}: ${error.message}`, true);
                    }
                }
            }

            if (isBatchRunActive(runId)) {
                if (!successfulJobs) {
                    logMessage('Сбор Series завершён без снимков. Архив не создан.', true);
                    showToast('Не удалось сохранить ни одной Series', 'error');
                } else {
                    logMessage('📦 Формирование ZIP архива...');
                    operationProgressController.update({ done: completedJobs, total: totalJobs, success: successfulJobs, failed: failedJobs, phase: 'Формирование ZIP', message: 'Подготовка архива Series к скачиванию…' });
                    await addBatchArchiveReport(archive, {
                        kind: 'series',
                        dashboard: parseGrafanaUrl(seriesDashboardUrl),
                        totalJobs,
                        successfulJobs,
                        failedJobs,
                        errors: captureErrors
                    });
                    await archive.finalize();
                    if (failedJobs) {
                        logMessage(`Сбор Series завершён частично: сохранено ${successfulJobs}, ошибок ${failedJobs}.`);
                        showToast(`Архив скачан: ${successfulJobs} успешно, ${failedJobs} с ошибкой`, 'info');
                    } else {
                        logMessage('🎉 Сбор успешно завершен!');
                        showToast('Архив скачан!', 'success');
                    }
                }
            }
        } catch (e) {
            if (isBatchRunActive(runId)) logMessage(`💥 Ошибка: ${e.message}`, true);
        } finally {
            if (seriesDiscoveryTabId) await chrome.tabs.remove(seriesDiscoveryTabId).catch(() => undefined);
            await finishBatchRun(runId);
        }
    });
});
