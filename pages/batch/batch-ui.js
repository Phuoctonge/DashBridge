// Batch DOM-only UI helpers; workflow orchestration remains in batch.js.
const BatchPageUi = {
    createNotifier(container) {
        return (message, type = 'info') => {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            const icons = {
                success: '<svg class="ic toast-icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
                error: '<svg class="ic toast-icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
                info: '<svg class="ic toast-icon-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
            };
            const icon = document.createElement('span');
            icon.innerHTML = icons[type] || icons.info;
            const text = document.createElement('span');
            text.textContent = String(message);
            toast.append(icon, text);
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.animation = 'toastFadeOut 0.3s ease-out forwards';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        };
    },
    createLogger(container) {
        return (message, isError = false) => {
            const entry = document.createElement('div');
            entry.className = `log-entry ${isError ? 'log-error' : ''}`;
            const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
            const timestamp = document.createElement('span');
            timestamp.className = 'log-time';
            timestamp.textContent = `[${time}]`;
            entry.append(timestamp, document.createTextNode(` ${String(message)}`));
            container.appendChild(entry);
            container.scrollTop = container.scrollHeight;
        };
    }
};
