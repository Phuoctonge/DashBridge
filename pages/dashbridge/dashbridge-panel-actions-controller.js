(function initDashBridgePanelActionsController(root) {
    'use strict';

    function create({ getPanels, setPanels, savePanels, showAlert, showConfirm,
        setPanelDataStatus, forceLoadPanel, applyPanelParamsToUrl, navigateDashboardFrame,
        findPanelCard, postToDashboardFrame, removePanelCard, replacePanelCard, updatePanelCard,
        panelAnalysis, closePanelAnalysis, panelTools, isSupportedPanelUrl, normalizePanelUrl,
        escapeHtml, runToolbarCapture, openPanelReportEditor, openPanelTools,
        syncPanelAnalysisAction,
        openPanelAnalysis, icons, documentRef = document,
        openWindow = (...args) => window.open(...args), now = () => Date.now(),
        ResizeObserverClass = root.ResizeObserver, requestFrame = root.requestAnimationFrame }) {
        const requiredFunctions = [
            getPanels, setPanels, savePanels, showAlert, showConfirm, setPanelDataStatus,
            forceLoadPanel, applyPanelParamsToUrl, navigateDashboardFrame, findPanelCard,
            postToDashboardFrame, removePanelCard, replacePanelCard, updatePanelCard,
            closePanelAnalysis, isSupportedPanelUrl, normalizePanelUrl, escapeHtml,
            runToolbarCapture, openPanelReportEditor, openPanelTools, syncPanelAnalysisAction,
            openPanelAnalysis,
        ];
        if (requiredFunctions.some(value => typeof value !== 'function')
            || typeof panelAnalysis?.isPanel !== 'function'
            || typeof panelTools?.removePanel !== 'function'
            || !icons?.expand || !icons?.collapse || typeof requestFrame !== 'function') {
            throw new TypeError('DashBridge panel actions controller dependencies are incomplete');
        }

        let fullscreenPanelId = null;

        const closeExtraActions = (except = null) => {
            documentRef.querySelectorAll('.panel-actions.extra-actions-open').forEach(actions => {
                if (actions === except) return;
                actions.classList.remove('extra-actions-open');
                actions.querySelectorAll('.panel-extra-inline').forEach(button => { button.hidden = true; });
                actions.querySelector('.btn-more')?.setAttribute('aria-expanded', 'false');
            });
        };

        const toggleExtraActions = button => {
            const actions = button?.closest('.panel-actions');
            if (!actions) return;
            const opening = !actions.classList.contains('extra-actions-open');
            closeExtraActions(opening ? actions : null);
            actions.classList.toggle('extra-actions-open', opening);
            actions.querySelectorAll('.panel-extra-inline').forEach(extra => { extra.hidden = !opening; });
            button.setAttribute('aria-expanded', String(opening));
        };

        const deletePanel = async id => {
            if (!await showConfirm('Удалить панель?')) return;
            setPanels(getPanels().filter(panel => panel.id !== id));
            savePanels();
            removePanelCard(id);
        };

        const refreshPanel = id => {
            const panel = getPanels().find(item => item.id === id);
            if (panel) setPanelDataStatus(panel, null);
            const iframe = forceLoadPanel(id);
            if (iframe?.src) {
                const url = new URL(applyPanelParamsToUrl(panel, iframe.src));
                url.searchParams.set('_t', now());
                navigateDashboardFrame(iframe, url.toString());
            }
        };

        const refreshPanelThresholdLayout = id => {
            const panel = getPanels().find(item => item.id === id);
            const iframe = documentRef.getElementById('iframe-' + id);
            if (!panel?.tools?.thresholdEnabled || !iframe) return;
            let notified = false;
            let observer = null;
            const notifyAfterLayout = () => {
                if (notified) return;
                notified = true;
                observer?.disconnect();
                requestFrame(() => requestFrame(() => {
                    postToDashboardFrame(iframe, { action: 'refreshPanelThresholdLayout' });
                }));
            };
            if (typeof ResizeObserverClass === 'function') {
                observer = new ResizeObserverClass(notifyAfterLayout);
                observer.observe(iframe);
            }
            requestFrame(() => requestFrame(notifyAfterLayout));
        };

        const toggleFullscreen = id => {
            const card = findPanelCard(id);
            if (!card) return;
            const isCurrentlyFullscreen = fullscreenPanelId === id;
            if (fullscreenPanelId) {
                const previousCard = findPanelCard(fullscreenPanelId);
                if (previousCard) {
                    previousCard.classList.remove('fullscreen');
                    const previousButton = previousCard.querySelector('.btn-fullscreen');
                    if (previousButton) {
                        previousButton.innerHTML = icons.expand;
                        previousButton.title = 'На весь экран';
                    }
                }
                fullscreenPanelId = null;
            }
            if (!isCurrentlyFullscreen) {
                card.classList.add('fullscreen');
                const button = card.querySelector('.btn-fullscreen');
                if (button) {
                    button.innerHTML = icons.collapse;
                    button.title = 'Свернуть (Esc)';
                }
                fullscreenPanelId = id;
                forceLoadPanel(id);
            }
            refreshPanelThresholdLayout(id);
        };

        const exitFullscreen = () => {
            if (!fullscreenPanelId) return false;
            toggleFullscreen(fullscreenPanelId);
            return true;
        };

        const openIframeSettings = panel => {
            const selectedGrafanaTheme = ['light', 'dark'].includes(panel.grafanaTheme)
                ? panel.grafanaTheme : 'follow';
            const overlay = documentRef.createElement('div');
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
            documentRef.body.appendChild(overlay);
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
                let url;
                try {
                    url = normalizePanelUrl(rawUrl);
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
                updatePanelCard(panel.id, {
                    reloadFrame: previousSrc !== panel.src
                        || previousGrafanaTheme !== panel.grafanaTheme,
                });
            });
        };

        const togglePanelPause = async id => {
            const panel = getPanels().find(item => item.id === id);
            if (!panel) return;
            if (panelAnalysis.isPanel(panel)) closePanelAnalysis();
            panel.paused = !panel.paused;
            savePanels();
            replacePanelCard(panel.id);
        };

        const bindPanelActions = (card, panel, iframe) => {
            card.querySelector('.btn-fullscreen')?.addEventListener('click', () => toggleFullscreen(panel.id));
            card.querySelector('.btn-refresh')?.addEventListener('click', () => refreshPanel(panel.id));
            card.querySelector('.btn-pause')?.addEventListener('click', () => togglePanelPause(panel.id));
            card.querySelector('.btn-resume')?.addEventListener('click', () => togglePanelPause(panel.id));
            card.querySelector('.btn-capture-save')?.addEventListener('click', event => {
                void runToolbarCapture(panel, iframe, 'download', event.currentTarget);
            });
            card.querySelector('.btn-capture-copy')?.addEventListener('click', event => {
                void runToolbarCapture(panel, iframe, 'copy', event.currentTarget);
            });
            card.querySelector('.btn-iframe-settings')?.addEventListener('click', () => openIframeSettings(panel));
            card.querySelector('.btn-report-settings')?.addEventListener('click', () => {
                closeExtraActions();
                openPanelReportEditor(panel);
            });
            card.querySelector('.btn-panel-tools')?.addEventListener('click', () => openPanelTools(panel, iframe));
            card.querySelector('.btn-more')?.addEventListener('click', event => {
                event.stopPropagation();
                syncPanelAnalysisAction(panel, card);
                toggleExtraActions(event.currentTarget);
            });
            card.querySelector('.btn-analysis')?.addEventListener('click', event => {
                const type = event.currentTarget.dataset.analysisType;
                if (!['cpu', 'ram'].includes(type)) return;
                openPanelAnalysis(panel, iframe, type);
                closeExtraActions();
            });
            card.querySelector('.btn-open')?.addEventListener('click', event => {
                openWindow(
                    applyPanelParamsToUrl(panel, event.currentTarget.dataset.url),
                    '_blank',
                    'noopener,noreferrer'
                );
            });
            card.querySelector('.btn-delete')?.addEventListener('click', () => deletePanel(panel.id));
        };

        const handlePanelRemoved = panelId => {
            if (panelAnalysis.isPanel(panelId)) closePanelAnalysis();
            panelTools.removePanel(panelId);
            if (fullscreenPanelId === panelId) fullscreenPanelId = null;
        };

        return Object.freeze({
            bindPanelActions,
            deletePanel,
            refreshPanel,
            toggleFullscreen,
            exitFullscreen,
            openIframeSettings,
            togglePanelPause,
            handlePanelRemoved,
            closeExtraActions,
            toggleExtraActions,
        });
    }

    root.DashBridgePanelActionsController = Object.freeze({ create });
})(globalThis);
