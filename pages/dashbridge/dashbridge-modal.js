'use strict';

(() => {
    function appendElement(parent, tagName, className = '') {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        parent.appendChild(element);
        return element;
    }

    function createModal(message, { prompt = false, confirm = false, defaultValue = '' } = {}) {
        const overlay = appendElement(document.body, 'div', 'modal-overlay');
        const content = appendElement(overlay, 'div', 'modal-content');
        content.style.maxWidth = '400px';

        const group = appendElement(content, 'div', 'form-group');
        group.style.marginBottom = '16px';

        let input = null;
        if (prompt) {
            const label = appendElement(group, 'label');
            label.style.display = 'block';
            label.style.marginBottom = '8px';
            label.style.color = 'var(--text-main)';
            label.textContent = String(message ?? '');

            input = appendElement(group, 'input', 'form-input modal-input');
            input.type = 'text';
            input.value = String(defaultValue ?? '');
            input.style.width = '100%';
        } else {
            const paragraph = appendElement(group, 'p');
            paragraph.style.margin = '0';
            paragraph.style.color = 'var(--text-main)';
            if (confirm) paragraph.style.whiteSpace = 'pre-line';
            paragraph.textContent = String(message ?? '');
        }

        const actions = appendElement(content, 'div', 'modal-actions');
        let cancelButton = null;
        if (confirm || prompt) {
            cancelButton = appendElement(actions, 'button', 'btn btn-outline modal-cancel');
            cancelButton.type = 'button';
            cancelButton.textContent = 'Отмена';
        }
        const okButton = appendElement(actions, 'button', 'btn btn-primary modal-ok');
        okButton.type = 'button';
        okButton.textContent = 'OK';

        overlay.style.display = 'flex';
        return { overlay, input, okButton, cancelButton };
    }

    function showAlert(message) {
        return new Promise((resolve) => {
            const { overlay, okButton } = createModal(message);
            const close = () => { overlay.remove(); resolve(true); };
            okButton.addEventListener('click', close);
            overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
            okButton.focus();
        });
    }

    function showConfirm(message) {
        return new Promise((resolve) => {
            const { overlay, okButton, cancelButton } = createModal(message, { confirm: true });
            const onOk = () => { overlay.remove(); resolve(true); };
            const onCancel = () => { overlay.remove(); resolve(false); };
            okButton.addEventListener('click', onOk);
            cancelButton.addEventListener('click', onCancel);
            overlay.addEventListener('click', (event) => { if (event.target === overlay) onCancel(); });
            okButton.focus();
        });
    }

    function showPrompt(message, defaultValue = '') {
        return new Promise((resolve) => {
            const { overlay, input, okButton, cancelButton } = createModal(message, {
                prompt: true,
                defaultValue,
            });
            const onOk = () => { const value = input.value; overlay.remove(); resolve(value); };
            const onCancel = () => { overlay.remove(); resolve(null); };
            okButton.addEventListener('click', onOk);
            cancelButton.addEventListener('click', onCancel);
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') onOk();
                else if (event.key === 'Escape') onCancel();
            });
            overlay.addEventListener('click', (event) => { if (event.target === overlay) onCancel(); });
            input.focus();
            input.select();
        });
    }

    window.DashBridgeModal = Object.freeze({ showAlert, showConfirm, showPrompt });
})();
