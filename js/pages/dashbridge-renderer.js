const DashBridgeRenderer = {
    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    },
    clear(container) {
        if (container) container.replaceChildren();
    },
    renderProfileList({ profiles, activeProfileId, onSelect }) {
        const label = document.getElementById('profilePickerLabel');
        const list = document.getElementById('profileList');
        const active = profiles.find(profile => profile.id === activeProfileId) || profiles[0];
        if (label) label.textContent = active?.name || 'Default';
        if (!list) return;
        list.replaceChildren();
        profiles.forEach(profile => {
            const item = document.createElement('button');
            item.className = 'profile-list-item' + (profile.id === activeProfileId ? ' active' : '');
            item.innerHTML = `<span class="profile-item-name">${this.escapeHtml(profile.name)}</span>`;
            item.addEventListener('click', () => onSelect(profile.id));
            list.appendChild(item);
        });
    },
    createPausedPanelBody(panel) {
        const body = document.createElement('div');
        body.className = 'iframe-wrapper paused-panel-body';
        const title = this.escapeHtml(panel.title || 'Панель Grafana');
        body.innerHTML = `<div class="paused-placeholder"><span class="paused-panel-title">${title}</span></div><span class="paused-badge">На паузе</span>`;
        return body;
    },
    createLivePanelBody(panel, iframeSrc) {
        const body = document.createElement('div');
        body.className = 'iframe-wrapper';
        body.style.position = 'relative';
        const iframe = document.createElement('iframe');
        iframe.id = `iframe-${panel.id}`;
        iframe.name = 'dashbridge-iframe';
        iframe.dataset.src = iframeSrc;
        iframe.allowFullscreen = true;
        iframe.loading = 'eager';
        body.appendChild(iframe);
        return body;
    },
    createPanelCard({ panel, iframeSrc, icons, analysisType = null }) {
        const card = document.createElement('div');
        card.className = 'panel-card' + (panel.paused ? ' is-paused' : '');
        card.dataset.panelId = panel.id;
        card.dataset.panelSize = panel.width === '100%' ? 'full' : (panel.width === '33%' ? 'third' : 'half');
        card.dataset.heightMode = panel.height === '350px' ? 'auto' : 'fixed';
        card.draggable = false;
        card.style.height = panel.height;
        const actions = document.createElement('div');
        actions.className = 'panel-actions';
        const grip = document.createElement('span');
        grip.className = 'drag-handle';
        grip.title = 'Перетащить для изменения порядка';
        grip.innerHTML = icons.grip;
        actions.appendChild(grip);
        const addButton = (className, title, icon, data = {}) => {
            const button = document.createElement('button');
            button.className = `icon-btn ${className}`;
            button.type = 'button';
            button.title = title;
            button.setAttribute('aria-label', title);
            Object.assign(button.dataset, data);
            button.innerHTML = icon;
            actions.appendChild(button);
            return button;
        };
        if (panel.paused) {
            addButton('btn-resume', 'Возобновить', icons.resume, { id: panel.id });
        } else {
            addButton('btn-fullscreen', 'На весь экран', icons.expand, { id: panel.id });
            addButton('btn-refresh', 'Обновить', icons.refresh, { id: panel.id });
            addButton('btn-pause', 'Поставить на паузу', icons.pause, { id: panel.id });
            addButton('btn-capture-save', 'Сохранить снимок панели в PNG', icons.captureSave, { id: panel.id });
            addButton('btn-capture-copy', 'Скопировать снимок панели в буфер', icons.captureCopy, { id: panel.id });
            addButton('btn-panel-tools', 'Настройки графика', icons.panelSettings, { id: panel.id });
            const analysis = addButton('btn-analysis', analysisType === 'ram' ? 'Анализ RAM' : 'Анализ CPU', icons.analysis, {
                id: panel.id, analysisType: analysisType || ''
            });
            analysis.hidden = analysisType !== 'cpu' && analysisType !== 'ram';
            const iframeSettings = addButton('panel-extra-inline btn-iframe-settings', 'Настройки iframe', icons.iframeSettings, { id: panel.id });
            iframeSettings.hidden = true;
            const reportSettings = addButton('panel-extra-inline btn-report-settings', 'Фраза для сводного сообщения', icons.report || '✉', { id: panel.id });
            reportSettings.hidden = true;
            const open = addButton('panel-extra-inline btn-open', 'Открыть в Grafana', icons.open, { url: panel.src });
            open.hidden = true;
            const more = addButton('btn-more', 'Дополнительные действия', icons.more, { id: panel.id });
            more.setAttribute('aria-expanded', 'false');
        }
        addButton('delete btn-delete', 'Удалить', icons.delete, { id: panel.id });
        card.appendChild(actions);
        card.appendChild(panel.paused ? this.createPausedPanelBody(panel) : this.createLivePanelBody(panel, iframeSrc));
        return card;
    }
};
