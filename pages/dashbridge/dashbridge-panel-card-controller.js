(function initDashBridgePanelCardController(root) {
    'use strict';

    function createPanelActions({ getPanels, setPanels, savePanels, showAlert, showConfirm,
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
            if (!await showConfirm('Удалить панель?')) {
                root.DashBridgeAnalytics?.outcome('dashbridge.panel_deleted', 'cancelled');
                return;
            }
            setPanels(getPanels().filter(panel => panel.id !== id));
            savePanels();
            removePanelCard(id);
            root.DashBridgeAnalytics?.outcome('dashbridge.panel_deleted', 'success');
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
                    root.DashBridgeAnalytics?.outcome('dashbridge.panel_iframe_settings_changed', 'invalid_input');
                    return;
                }
                if (!Number.isFinite(height) || height < 180 || height > 3000) {
                    await showAlert('Высота должна быть от 180 до 3000 px.');
                    root.DashBridgeAnalytics?.outcome('dashbridge.panel_iframe_settings_changed', 'invalid_input');
                    return;
                }
                let url;
                try {
                    url = normalizePanelUrl(rawUrl);
                } catch (error) {
                    await showAlert(error.message || 'Укажите ссылку Grafana вида /d/... или /d-solo/....');
                    root.DashBridgeAnalytics?.outcome('dashbridge.panel_iframe_settings_changed', 'invalid_input');
                    return;
                }
                const previousSrc = panel.src;
                const previousGrafanaTheme = panel.grafanaTheme || 'follow';
                const previousWidth = panel.width;
                const previousHeight = panel.height;
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
                root.DashBridgeAnalytics?.outcome('dashbridge.panel_iframe_settings_changed', 'success');
                if (previousWidth !== panel.width || previousHeight !== panel.height) {
                    root.DashBridgeAnalytics?.track('dashbridge.panel_layout_changed', 'changed', {});
                }
            });
        };

        const togglePanelPause = async id => {
            const panel = getPanels().find(item => item.id === id);
            if (!panel) return;
            if (panelAnalysis.isPanel(panel)) closePanelAnalysis();
            panel.paused = !panel.paused;
            savePanels();
            replacePanelCard(panel.id);
            root.DashBridgeAnalytics?.outcome(panel.paused
                ? 'dashbridge.panel_paused' : 'dashbridge.panel_resumed', 'success');
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

    function create({ renderer, getPanels, setPanels, savePanels, getActiveProfile, applyPanelParamsToUrl,
        navigateDashboardFrame, findPanelCard, getPanelAnalysisType,
        syncPanelAnalysisAction, closePanelAnalysis, isPanelAnalysisOpen,
        escapeHtml, icons, actionDependencies, runtimeScopeId, documentRef = document }) {
        if (!renderer?.createPanelCard || typeof getPanels !== 'function'
            || typeof setPanels !== 'function' || typeof savePanels !== 'function'
            || typeof getActiveProfile !== 'function' || typeof applyPanelParamsToUrl !== 'function'
            || typeof navigateDashboardFrame !== 'function' || typeof findPanelCard !== 'function'
            || typeof getPanelAnalysisType !== 'function'
            || typeof syncPanelAnalysisAction !== 'function' || typeof closePanelAnalysis !== 'function'
            || typeof isPanelAnalysisOpen !== 'function'
            || typeof escapeHtml !== 'function' || !icons?.collapse || !actionDependencies
            || typeof runtimeScopeId !== 'string' || !runtimeScopeId) {
            throw new TypeError('DashBridge panel card controller dependencies are incomplete');
        }

        let draggedElement = null;
        let targetElement = null;
        let dropSide = null;
        let panelActions = null;

        const clearDragMarkers = () => {
            targetElement?.classList.remove('drag-over-left', 'drag-over-right');
            targetElement = null;
            dropSide = null;
        };

        const saveCardOrder = container => {
            const panelsById = new Map(getPanels().map(panel => [panel.id, panel]));
            setPanels([...container.querySelectorAll('.panel-card')]
                .map(card => panelsById.get(card.dataset.panelId))
                .filter(Boolean));
            savePanels();
        };

        const setupDrag = () => {
            const container = documentRef.getElementById('dashboard');
            container.addEventListener('dragover', event => {
                if (!draggedElement) return;
                const target = event.target.closest('.panel-card');
                if (!target || target === draggedElement || !container.contains(target)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                clearDragMarkers();
                targetElement = target;
                dropSide = event.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2
                    ? 'left' : 'right';
                target.classList.add(dropSide === 'left' ? 'drag-over-left' : 'drag-over-right');
            });
            container.addEventListener('dragleave', event => {
                if (event.target === container && !container.contains(event.relatedTarget)) clearDragMarkers();
            });
            container.addEventListener('drop', event => {
                if (!draggedElement || !targetElement || !dropSide) return;
                event.preventDefault();
                if (dropSide === 'left') container.insertBefore(draggedElement, targetElement);
                else container.insertBefore(draggedElement, targetElement.nextSibling);
                saveCardOrder(container);
                root.DashBridgeAnalytics?.track('dashbridge.panel_reordered', 'used', {});
                clearDragMarkers();
            });
        };

        const bindCardDrag = (card, panel, container) => {
            const handle = card.querySelector('.drag-handle');
            handle.addEventListener('mousedown', () => { card.draggable = true; });
            handle.addEventListener('mouseup', () => { card.draggable = false; });
            card.addEventListener('dragstart', event => {
                draggedElement = card;
                card.classList.add('dragging');
                container.classList.add('is-dragging');
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', panel.id);
            });
            card.addEventListener('dragend', () => {
                card.draggable = false;
                card.classList.remove('dragging');
                container.classList.remove('is-dragging');
                clearDragMarkers();
                draggedElement = null;
            });
        };

        const forceLoadPanel = id => {
            const iframe = documentRef.getElementById('iframe-' + id);
            if (!iframe) return null;
            const pendingSrc = iframe.dataset.src;
            if (pendingSrc && !iframe.src) {
                navigateDashboardFrame(iframe, pendingSrc);
                iframe.removeAttribute('data-src');
            }
            return iframe;
        };

        const updatePanelCard = (panelId, { reloadFrame = true } = {}) => {
            const panel = getPanels().find(item => item.id === panelId);
            if (!panel) return;
            const card = findPanelCard(panelId);
            if (!card) return;
            card.dataset.panelSize = panel.width === '100%'
                ? 'full' : (panel.width === '33%' ? 'third' : 'half');
            card.dataset.heightMode = panel.height === '350px' ? 'auto' : 'fixed';
            card.style.height = panel.height;
            const openButton = card.querySelector('.btn-open');
            if (openButton) openButton.dataset.url = panel.src;
            if (!panel.paused && reloadFrame) {
                const iframe = card.querySelector('iframe');
                if (iframe) {
                    const nextSrc = applyPanelParamsToUrl(panel);
                    if (iframe.src !== nextSrc && iframe.dataset.src !== nextSrc) {
                        if (iframe.src) {
                            iframe.removeAttribute('data-src');
                            navigateDashboardFrame(iframe, nextSrc);
                        } else {
                            iframe.dataset.src = nextSrc;
                        }
                    }
                }
            }
        };

        const createPanelCard = (panel, container) => {
            const card = renderer.createPanelCard({
                panel,
                iframeSrc: applyPanelParamsToUrl(panel),
                analysisType: getPanelAnalysisType(panel),
                icons,
            });
            const iframe = card.querySelector('iframe');
            const profileId = String(getActiveProfile()?.id || '');
            card.dataset.profileId = profileId;
            card.dataset.dashbridgeScopeId = runtimeScopeId;
            iframe.dataset.dashbridgeProfileId = profileId;
            iframe.dataset.dashbridgeScopeId = runtimeScopeId;
            if (!panel.paused) {
                navigateDashboardFrame(iframe, iframe.dataset.src);
                iframe.removeAttribute('data-src');
            }
            bindCardDrag(card, panel, container);
            panelActions.bindPanelActions(card, panel, iframe);
            return card;
        };

        const replacePanelCard = panelId => {
            const panel = getPanels().find(item => item.id === panelId);
            const currentCard = findPanelCard(panelId);
            const container = documentRef.getElementById('dashboard');
            if (!panel || !currentCard || !container) return;
            const wasFullscreen = currentCard.classList.contains('fullscreen');
            const replacement = createPanelCard(panel, container);
            if (wasFullscreen) {
                replacement.classList.add('fullscreen');
                const button = replacement.querySelector('.btn-fullscreen');
                if (button) {
                    button.innerHTML = icons.collapse;
                    button.title = 'Свернуть (Esc)';
                }
            }
            currentCard.replaceWith(replacement);
        };

        const appendPanelCards = addedPanels => {
            const container = documentRef.getElementById('dashboard');
            if (!container || !Array.isArray(addedPanels) || !addedPanels.length) return;
            container.querySelector('.empty-state')?.remove();
            const fragment = documentRef.createDocumentFragment();
            addedPanels.forEach(panel => fragment.appendChild(createPanelCard(panel, container)));
            container.appendChild(fragment);
        };

        const renderDashboard = async () => {
            closePanelAnalysis();
            const container = documentRef.getElementById('dashboard');
            container.querySelectorAll('.panel-card').forEach(card => {
                panelActions.handlePanelRemoved(card.dataset.panelId);
            });
            container.innerHTML = '';
            const panels = getPanels();
            if (panels.length === 0) {
                const profile = getActiveProfile();
                container.innerHTML = `<div class="empty-state">
                    <h2>Профиль «${escapeHtml(profile?.name || 'Default')}» пуст</h2>
                    <p style="margin-top: 10px; opacity: 0.7;">Нажмите «Добавить панель» и вставьте ссылку Embed из Grafana.</p>
                </div>`;
                return;
            }
            const fragment = documentRef.createDocumentFragment();
            panels.forEach(panel => fragment.appendChild(createPanelCard(panel, container)));
            container.appendChild(fragment);
        };

        const removePanelCard = panelId => {
            panelActions.handlePanelRemoved(panelId);
            findPanelCard(panelId)?.remove();
            if (getPanels().length === 0) void renderDashboard();
        };

        const panelFrameSignature = panel => {
            try {
                return JSON.stringify({
                    src: panel?.src || '',
                    grafanaTheme: panel?.grafanaTheme || 'follow',
                    paused: !!panel?.paused,
                    tools: panel?.tools || {},
                });
            } catch {
                return '';
            }
        };

        const adoptPanelState = (target, source) => {
            Object.keys(target).forEach(key => {
                if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
            });
            Object.assign(target, source);
            return target;
        };

        const reconcilePanelCards = (previousPanels = []) => {
            const container = documentRef.getElementById('dashboard');
            if (!container) return;
            const panels = getPanels();
            if (panels.length === 0) {
                void renderDashboard();
                return;
            }
            container.querySelector('.empty-state')?.remove();
            const previousById = new Map(previousPanels.map(panel => [panel.id, panel]));
            const nextIds = new Set(panels.map(panel => panel.id));
            container.querySelectorAll('.panel-card').forEach(card => {
                if (!nextIds.has(card.dataset.panelId)) removePanelCard(card.dataset.panelId);
            });
            panels.forEach(panel => {
                const previous = previousById.get(panel.id);
                let card = findPanelCard(panel.id);
                const previousSignature = previous?.frameSignature ?? panelFrameSignature(previous);
                const frameChanged = previous && previousSignature !== panelFrameSignature(panel);
                const pausedTitleChanged = previous?.paused && previous.title !== panel.title;
                if (!card) {
                    card = createPanelCard(panel, container);
                } else if (frameChanged || pausedTitleChanged) {
                    if (isPanelAnalysisOpen(panel)) closePanelAnalysis();
                    replacePanelCard(panel.id);
                    card = findPanelCard(panel.id);
                } else {
                    updatePanelCard(panel.id, { reloadFrame: false });
                    syncPanelAnalysisAction(panel, card);
                }
                if (card) container.appendChild(card);
            });
        };

        panelActions = createPanelActions({
            getPanels,
            setPanels,
            savePanels,
            showAlert: actionDependencies.showAlert,
            showConfirm: actionDependencies.showConfirm,
            setPanelDataStatus: actionDependencies.setPanelDataStatus,
            forceLoadPanel,
            applyPanelParamsToUrl,
            navigateDashboardFrame,
            findPanelCard,
            postToDashboardFrame: actionDependencies.postToDashboardFrame,
            removePanelCard,
            replacePanelCard,
            updatePanelCard,
            panelAnalysis: actionDependencies.panelAnalysis,
            closePanelAnalysis,
            panelTools: actionDependencies.panelTools,
            isSupportedPanelUrl: actionDependencies.isSupportedPanelUrl,
            normalizePanelUrl: actionDependencies.normalizePanelUrl,
            escapeHtml,
            runToolbarCapture: actionDependencies.runToolbarCapture,
            openPanelReportEditor: actionDependencies.openPanelReportEditor,
            openPanelTools: actionDependencies.openPanelTools,
            syncPanelAnalysisAction,
            openPanelAnalysis: actionDependencies.openPanelAnalysis,
            icons,
            documentRef,
            openWindow: actionDependencies.openWindow,
            now: actionDependencies.now,
            ResizeObserverClass: actionDependencies.ResizeObserverClass,
            requestFrame: actionDependencies.requestFrame,
        });

        return Object.freeze({
            ...panelActions,
            forceLoadPanel,
            setupDrag,
            updatePanelCard,
            createPanelCard,
            replacePanelCard,
            appendPanelCards,
            removePanelCard,
            panelFrameSignature,
            adoptPanelState,
            reconcilePanelCards,
            renderDashboard,
        });
    }

    root.DashBridgePanelCardController = Object.freeze({ create });
})(globalThis);
