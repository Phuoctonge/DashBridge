// Persistent UI state for the Batch page. Capture orchestration stays in batch.js.
const BatchPageState = {
    fields: ['dashUrl', 'panelsMode', 'userPanels', 'timestamps', 'compactCaptureMain', 'seriesDashUrl', 'seriesTimestamps', 'seriesIncludeFilter', 'seriesIgnoreFilter', 'seriesCaptureMode', 'compactCaptureSeries'],
    saveTimer: null,
    // Группы radio-кнопок, которые нужно сохранять отдельно (по имени атрибута name)
    radioGroups: ['captureThemeMain', 'captureThemeSeries'],
    writer: DashBridgeStorageWriter.createLocal(),
    async restore() {
        const stored = await chrome.storage.local.get(['batchState']);
        const batchState = DashBridgeLocalStateSchema.normalizeBatchState(stored.batchState || {}, { mode: 'load' });
        this.fields.forEach(id => {
            const element = document.getElementById(id);
            if (!element || batchState[id] === undefined) return;
            if (element.type === 'checkbox') element.checked = batchState[id] === true;
            else element.value = batchState[id];
            element.dispatchEvent(new Event('change'));
        });
        // Восстанавливаем radio-группы
        this.radioGroups.forEach(name => {
            const saved = batchState[`radio_${name}`];
            if (!saved) return;
            const input = Array.from(document.querySelectorAll(`input[name="${name}"]`))
                .find(candidate => candidate.value === saved);
            if (input) input.checked = true;
        });
    },
    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.saveNow(), 300);
    },
    saveNow() {
        const batchState = {};
        this.fields.forEach(id => {
            const element = document.getElementById(id);
            if (element) batchState[id] = element.type === 'checkbox' ? element.checked : element.value;
        });
        // Сохраняем radio-группы
        this.radioGroups.forEach(name => {
            const checked = document.querySelector(`input[name="${name}"]:checked`);
            if (checked) batchState[`radio_${name}`] = checked.value;
        });
        return this.writer.write({ batchState });
    },
    flush() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.saveNow();
        }
        return this.writer.flush();
    },
    checkpoint() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.saveNow();
        }
        return this.writer.checkpoint();
    },
    bind() {
        this.fields.forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            element.addEventListener('input', () => this.save());
            element.addEventListener('change', () => this.save());
        });
        // Подписываемся на radio-изменения
        this.radioGroups.forEach(name => {
            document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
                input.addEventListener('change', () => this.save());
            });
        });
    }
};
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void BatchPageState.flush().catch(() => undefined);
});
window.addEventListener('pagehide', () => { void BatchPageState.checkpoint().catch(() => undefined); });
