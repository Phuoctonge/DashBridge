// Extension-page keyboard/focus lifecycle. Modal owners retain save/cancel logic.
(function initModalAccessibility(root) {
    'use strict';
    const create = (documentRef = document) => {
        const windowRef = documentRef.defaultView;
        const selector = '.modal-overlay, #modalOverlay, .dashbridge-panel-settings-overlay';
        const cancelSelector = [
            '.modal-cancel', '.modal-ok', '.iframe-settings-cancel', '.panel-tools-cancel',
            '.dashbridge-panel-settings .cancel', '.report-panel-editor-close', '.report-close',
            '.report-audit-close', '.dashboard-panel-analysis-close', '.worklog-confirm-cancel',
            '#closeModalBtn', '#closeQuickAddModalBtn', '#closeDashboardPanelPickerBtn',
            '#cancelDashboardPanelPickerBtn', '#cancelPanelPickerBtn', '#closeModal', '[data-action="cancel"]'
        ].join(',');
        const opened = new Map();
        let observer = null;
        let pending = false;
        let running = false;
        let lastFocused = documentRef.activeElement;
        const visible = node => node.isConnected && node.getClientRects().length > 0
            && windowRef.getComputedStyle(node).visibility !== 'hidden';
        const top = () => [...opened.keys()].filter(visible).sort((a, b) =>
            (Number(windowRef.getComputedStyle(a).zIndex) || 0)
            - (Number(windowRef.getComputedStyle(b).zIndex) || 0)).at(-1);
        const controls = overlay => [...overlay.querySelectorAll(
            'button, input:not([type="hidden"]), select, textarea, a[href], summary, [tabindex]'
        )].filter(node => visible(node) && !node.disabled && node.tabIndex >= 0);
        const focusInside = overlay => {
            const control = controls(overlay)[0];
            if (control) control.focus({ preventScroll: true });
            else { overlay.tabIndex = -1; overlay.focus({ preventScroll: true }); }
        };
        const sync = () => {
            pending = false;
            if (!running) return;
            for (const [overlay, opener] of [...opened].reverse()) {
                if (visible(overlay)) continue;
                opened.delete(overlay);
                const target = opener?.closest?.('#profileDropdown') && !visible(opener)
                    ? documentRef.getElementById('profilePickerBtn') : opener;
                if (target?.isConnected && visible(target)
                    && (documentRef.activeElement === documentRef.body
                        || overlay.contains(documentRef.activeElement))) target.focus({ preventScroll: true });
            }
            for (const overlay of documentRef.querySelectorAll(selector)) {
                if (!visible(overlay) || opened.has(overlay)) continue;
                opened.set(overlay, documentRef.activeElement);
            }
            if (documentRef.querySelector('dialog[open]')) return;
            const overlay = top();
            if (overlay && !overlay.contains(documentRef.activeElement)) focusInside(overlay);
        };
        const schedule = () => {
            if (pending) return;
            pending = true;
            windowRef.queueMicrotask(sync);
        };
        const onFocus = event => {
            const overlay = event.target.closest?.(selector);
            if (overlay && !opened.has(overlay) && visible(overlay)) opened.set(overlay, lastFocused);
            lastFocused = event.target;
        };
        const onKey = event => {
            // Native modal dialogs (variables) own their own focus and Escape contract.
            if (documentRef.querySelector('dialog[open]')) return;
            const overlay = top();
            if (!overlay) return;
            if (event.key === 'Escape') {
                const cancel = [...overlay.querySelectorAll(cancelSelector)].find(visible);
                if (!cancel || cancel.disabled) return;
                event.preventDefault(); event.stopImmediatePropagation();
                cancel.click();
            } else if (event.key === 'Tab') {
                const items = controls(overlay);
                const first = items[0], last = items.at(-1);
                const active = documentRef.activeElement;
                if (!items.length || !overlay.contains(active)
                    || (!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first)?.focus();
                }
            }
        };
        const start = () => {
            if (running || !documentRef.body) return;
            running = true;
            // Ignore table rows, clocks and chart updates: only modal visibility/lifecycle matters.
            const containsModal = node => node.nodeType === 1
                && (node.matches(selector) || node.querySelector(selector));
            observer = new windowRef.MutationObserver(records => {
                if (records.some(record => record.type === 'attributes' ? containsModal(record.target)
                    : [...record.addedNodes, ...record.removedNodes].some(containsModal))) schedule();
            });
            observer.observe(documentRef.body, { childList: true, subtree: true,
                attributes: true, attributeFilter: ['style', 'hidden'] });
            documentRef.addEventListener('keydown', onKey, true);
            documentRef.addEventListener('focusin', onFocus, true);
            sync();
        };
        const stop = () => {
            running = false;
            observer?.disconnect(); observer = null;
            documentRef.removeEventListener('keydown', onKey, true);
            documentRef.removeEventListener('focusin', onFocus, true);
            opened.clear();
        };
        return Object.freeze({ start, stop });
    };
    root.DashBridgeModalAccessibility = Object.freeze({ create });
    const controller = create();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', controller.start, { once: true });
    else controller.start();
    root.addEventListener('pagehide', controller.stop);
    root.addEventListener('pageshow', controller.start);
})(globalThis);
