(function initDashBridgePanelCardController(root) {
    'use strict';

    function create({ renderer, getPanels, setPanels, savePanels, getActiveProfile, applyPanelParamsToUrl,
        navigateDashboardFrame, bindPanelActions, findPanelCard, getPanelAnalysisType,
        syncPanelAnalysisAction, closePanelAnalysis, isPanelAnalysisOpen, onPanelRemoved,
        escapeHtml, icons, documentRef = document }) {
        if (!renderer?.createPanelCard || typeof getPanels !== 'function'
            || typeof setPanels !== 'function' || typeof savePanels !== 'function'
            || typeof getActiveProfile !== 'function' || typeof applyPanelParamsToUrl !== 'function'
            || typeof navigateDashboardFrame !== 'function'
            || typeof bindPanelActions !== 'function' || typeof findPanelCard !== 'function'
            || typeof getPanelAnalysisType !== 'function'
            || typeof syncPanelAnalysisAction !== 'function' || typeof closePanelAnalysis !== 'function'
            || typeof isPanelAnalysisOpen !== 'function' || typeof onPanelRemoved !== 'function'
            || typeof escapeHtml !== 'function' || !icons?.collapse) {
            throw new TypeError('DashBridge panel card controller dependencies are incomplete');
        }

        let draggedElement = null;
        let targetElement = null;
        let dropSide = null;

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
            if (!panel.paused) {
                navigateDashboardFrame(iframe, iframe.dataset.src);
                iframe.removeAttribute('data-src');
            }
            bindCardDrag(card, panel, container);
            bindPanelActions(card, panel, iframe);
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
            onPanelRemoved(panelId);
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

        return Object.freeze({
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
