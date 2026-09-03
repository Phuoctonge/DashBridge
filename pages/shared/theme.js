// ============================================================
// DashBridge — Глобальная тема (light/dark)
// Подключается во все HTML файлы расширения.
// ============================================================

(function () {
    'use strict';

    const STORAGE_KEY = 'dashbridge-theme';
    const SYNC_KEY = 'globalTheme';
    const UI_SCALE_STORAGE_KEY = 'dashbridge-ui-scale';
    const UI_SCALE_SYNC_KEY = 'uiScale';
    const UI_SCALES = new Set(['auto', '90', '100', '110', '125', '150']);

    function normalizeUiScale(value) {
        const normalized = String(value || 'auto');
        return UI_SCALES.has(normalized) ? normalized : 'auto';
    }

    function applyUiScale(value) {
        const scale = normalizeUiScale(value);
        document.documentElement.setAttribute('data-ui-scale', scale);
    }

    /**
     * Применяет тему к documentElement и обновляет иконку кнопки.
     * @param {string} theme - 'light' или 'dark'
     */
    function applyTheme(theme) {
        const previousTheme = document.documentElement.getAttribute('data-theme');
        document.documentElement.setAttribute('data-theme', theme);
        updateThemeIcon(theme);
        if (previousTheme !== theme) {
            window.dispatchEvent(new CustomEvent('dashbridge-theme-change', { detail: { theme } }));
        }
    }

    /**
     * Обновляет иконку и текст кнопки переключения темы.
     * Полностью управляет содержимым кнопки (очищает перед вставкой).
     * @param {string} theme - 'light' или 'dark'
     */
    function updateThemeIcon(theme) {
        const btn = document.getElementById('themeToggle') || document.getElementById('themeToggleBtn');
        if (!btn) return;

        // Определяем режим: compact (только иконка) или full (иконка + текст)
        const isCompact = btn.hasAttribute('data-compact');

        // Очищаем кнопку от старого содержимого (HTML мог содержать захардкоженный SVG/текст)
        btn.textContent = '';

        // Создаём span для иконки
        const iconSpan = document.createElement('span');
        iconSpan.className = 'theme-icon';
        btn.appendChild(iconSpan);

        // В full-режиме добавляем span для текста
        let textSpan = null;
        if (!isCompact) {
            textSpan = document.createElement('span');
            textSpan.className = 'theme-text';
            btn.appendChild(textSpan);
        }

        const sunIcon = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
        const moonIcon = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

        if (theme === 'dark') {
            // В тёмной теме показываем sun (предлагает переключить на светлую)
            iconSpan.innerHTML = sunIcon;
            if (textSpan) textSpan.textContent = ' Светлая';
            btn.title = 'Переключить на светлую тему';
        } else {
            // В светлой теме показываем moon (предлагает переключить на тёмную)
            iconSpan.innerHTML = moonIcon;
            if (textSpan) textSpan.textContent = ' Тёмная';
            btn.title = 'Переключить на тёмную тему';
        }
    }

    /**
     * Переключает тему и сохраняет в chrome.storage.sync.
     */
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = current === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        try {
            localStorage.setItem(STORAGE_KEY, newTheme);
        } catch (e) { /* localStorage недоступен */ }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set({ [SYNC_KEY]: newTheme });
        }
        globalThis.DashBridgeAnalytics?.track('ui.theme_changed', 'changed', { theme: newTheme });
    }

    function bindThemeToggle() {
        const btn = document.getElementById('themeToggle') || document.getElementById('themeToggleBtn');
        if (!btn || btn.__dashbridgeThemeBound) return;
        btn.__dashbridgeThemeBound = true;
        updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'light');
        btn.addEventListener('click', toggleTheme);
    }

    /**
     * Инициализирует тему: загружает из chrome.storage.sync,
     * подписывается на изменения, навешивает обработчик на кнопку.
     */
    function initTheme() {
        // Применяем кэшированную тему сразу (предотвращает flash)
        let cached = 'light';
        try {
            cached = localStorage.getItem(STORAGE_KEY) || 'light';
        } catch (e) { /* localStorage недоступен */ }
        applyTheme(cached);
        let cachedUiScale = 'auto';
        try {
            cachedUiScale = normalizeUiScale(localStorage.getItem(UI_SCALE_STORAGE_KEY));
        } catch (e) { /* localStorage недоступен */ }
        applyUiScale(cachedUiScale);

        // Синхронизация с chrome.storage.sync
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get([SYNC_KEY, UI_SCALE_SYNC_KEY], (result) => {
                if (result[SYNC_KEY] && result[SYNC_KEY] !== cached) {
                    applyTheme(result[SYNC_KEY]);
                    try {
                        localStorage.setItem(STORAGE_KEY, result[SYNC_KEY]);
                    } catch (e) { /* ignore */ }
                }
                const storedScale = normalizeUiScale(result[UI_SCALE_SYNC_KEY]);
                if (storedScale !== cachedUiScale) {
                    applyUiScale(storedScale);
                    try { localStorage.setItem(UI_SCALE_STORAGE_KEY, storedScale); } catch (e) { /* ignore */ }
                }
            });

            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'sync' && changes[SYNC_KEY]) {
                    const newTheme = changes[SYNC_KEY].newValue;
                    if (newTheme) {
                        applyTheme(newTheme);
                        try {
                            localStorage.setItem(STORAGE_KEY, newTheme);
                        } catch (e) { /* ignore */ }
                    }
                }
                if (area === 'sync' && changes[UI_SCALE_SYNC_KEY]) {
                    const scale = normalizeUiScale(changes[UI_SCALE_SYNC_KEY].newValue);
                    applyUiScale(scale);
                    try { localStorage.setItem(UI_SCALE_STORAGE_KEY, scale); } catch (e) { /* ignore */ }
                }
            });
        }

        // Навешиваем обработчик на кнопку
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bindThemeToggle, { once: true });
        } else {
            bindThemeToggle();
        }
    }

    // Запускаем сразу (до DOMContentLoaded) — применяем тему до отрисовки
    initTheme();
})();
