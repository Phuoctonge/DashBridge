(function initDashBridgeDragController(root) {
    'use strict';

    function create({ getPanels, setPanels, savePanels, documentRef = document }) {
        if (typeof getPanels !== 'function' || typeof setPanels !== 'function' || typeof savePanels !== 'function') {
            throw new TypeError('DashBridge drag controller dependencies are incomplete');
        }
        let draggedId = null;
        let draggedElement = null;
        let targetElement = null;
        let dropSide = null;

        const clearMarkers = () => {
            targetElement?.classList.remove('drag-over-left', 'drag-over-right');
            targetElement = null;
            dropSide = null;
        };

        const saveOrder = container => {
            const panelsById = new Map(getPanels().map(panel => [panel.id, panel]));
            setPanels([...container.querySelectorAll('.panel-card')]
                .map(card => panelsById.get(card.dataset.panelId))
                .filter(Boolean));
            savePanels();
        };

        const setup = () => {
            const container = documentRef.getElementById('dashboard');
            container.addEventListener('dragover', event => {
                if (!draggedElement) return;
                const target = event.target.closest('.panel-card');
                if (!target || target === draggedElement || !container.contains(target)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                clearMarkers();
                targetElement = target;
                dropSide = event.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2 ? 'left' : 'right';
                target.classList.add(dropSide === 'left' ? 'drag-over-left' : 'drag-over-right');
            });
            container.addEventListener('dragleave', event => {
                if (event.target === container && !container.contains(event.relatedTarget)) clearMarkers();
            });
            container.addEventListener('drop', event => {
                if (!draggedElement || !targetElement || !dropSide) return;
                event.preventDefault();
                if (dropSide === 'left') container.insertBefore(draggedElement, targetElement);
                else container.insertBefore(draggedElement, targetElement.nextSibling);
                saveOrder(container);
                clearMarkers();
            });
        };

        const bindCard = (card, panel, container) => {
            const handle = card.querySelector('.drag-handle');
            handle.addEventListener('mousedown', () => { card.draggable = true; });
            handle.addEventListener('mouseup', () => { card.draggable = false; });
            card.addEventListener('dragstart', event => {
                draggedId = panel.id;
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
                clearMarkers();
                draggedId = null;
                draggedElement = null;
            });
        };

        return Object.freeze({ setup, bindCard });
    }

    root.DashBridgeDragController = Object.freeze({ create });
})(globalThis);
