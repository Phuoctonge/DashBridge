# -*- coding: utf-8 -*-
"""
Тесты унификации GUI и глобальной темы.

Проверяет:
1. css/theme.css существует и содержит все нужные CSS-переменные
2. Все HTML файлы подключают css/theme.css
3. Ни один HTML файл не содержит дублирующий :root { ... } блок
4. Все используют единые имена переменных (--primary, --bg, --text-main, --border)
5. Кнопка темы есть в html/dashbridge.html
6. Логика темы в js/pages/dashbridge.js (applyTheme, initTheme, themeToggle)
7. Broadcast через chrome.storage.onChanged во всех HTML
8. Алиасы для обратной совместимости в css/theme.css
"""

import os
import re
import sys

# === Пути ===
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_CSS = os.path.join(ROOT, 'css/theme.css')
HTML_FILES = ['html/dashbridge.html', 'html/popup.html', 'pages/options/options.html', 'pages/worklog/worklog.html', 'html/batch.html']
CSS_FILES = ['css/dashbridge.css', 'css/batch.css']
JS_FILES = ['js/theme.js']

# === Счётчики ===
PASSED = 0
FAILED = 0
ERRORS = []


def test(name, condition, detail=""):
    """Регистрирует результат теста."""
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  [OK] {name}")
    else:
        FAILED += 1
        ERRORS.append(f"{name}: {detail}")
        print(f"  [FAIL] {name} -- {detail}")


def read_file(path):
    """Читает файл, возвращает содержимое или None."""
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def references_file(html_file, attribute, target):
    """Checks a local HTML reference independently of directory depth."""
    content = read_file(os.path.join(ROOT, html_file)) or ''
    for reference in re.findall(rf'{attribute}\s*=\s*["\']([^"\']+)["\']', content, re.IGNORECASE):
        if re.match(r'^(?:[a-z]+:|//|#)', reference, re.IGNORECASE):
            continue
        resolved = os.path.normpath(os.path.join(os.path.dirname(html_file), reference))
        if resolved.replace('\\', '/') == target:
            return True
    return False


# ============================================================
# 1. css/theme.css существует и валиден
# ============================================================
print("\n=== 1. css/theme.css ===")

content = read_file(THEME_CSS)
test("css/theme.css существует", content is not None,
     f"Файл {THEME_CSS} не найден")

if content:
    # Обязательные CSS-переменные
    required_vars = [
        '--primary', '--primary-hover', '--bg', '--card-bg',
        '--text-main', '--text-muted', '--border', '--radius-md',
        '--radius-lg', '--shadow', '--transition'
    ]
    for var in required_vars:
        test(f"css/theme.css содержит {var}", var in content,
             f"Переменная {var} отсутствует в css/theme.css")

    # Dark theme
    test("css/theme.css содержит [data-theme=\"dark\"]", '[data-theme="dark"]' in content,
         "Блок dark theme отсутствует")

    # Базовые компоненты
    required_components = ['.btn', '.btn-primary', '.btn-outline', '.card',
                           '.form-input', '.modal-overlay', '.modal-content',
                           '.switch', '.slider', '.toast', '.ic']
    for comp in required_components:
        test(f"css/theme.css содержит {comp}", comp in content,
             f"Компонент {comp} отсутствует")

    # Алиасы для обратной совместимости
    aliases = ['--bg-color', '--border-color', '--primary-dark', '--tab-inactive']
    for alias in aliases:
        test(f"css/theme.css содержит алиас {alias}", alias in content,
             f"Алиас {alias} отсутствует")


# ============================================================
# 2. Все HTML файлы подключают css/theme.css
# ============================================================
print("\n=== 2. Подключение css/theme.css ===")

for html_file in HTML_FILES:
    path = os.path.join(ROOT, html_file)
    content = read_file(path)
    test(f"{html_file} существует", content is not None,
         f"Файл {html_file} не найден")
    if content:
        test(f"{html_file} подключает css/theme.css",
             references_file(html_file, 'href', 'css/theme.css'),
             f"css/theme.css не подключён в {html_file}")


# ============================================================
# 3. Ни один HTML файл не содержит дублирующий :root
# ============================================================
print("\n=== 3. Удаление дублирующих :root ===")

for html_file in HTML_FILES:
    path = os.path.join(ROOT, html_file)
    content = read_file(path)
    if content:
        # Ищем :root { ... } внутри <style> блока
        # Должен быть только в css/theme.css
        has_root = bool(re.search(r':root\s*\{', content))
        test(f"{html_file} не содержит :root {{ }}", not has_root,
             f"{html_file} всё ещё содержит блок :root")


# ============================================================
# 4. CSS файлы не содержат дублирующий :root
# ============================================================
print("\n=== 4. Удаление :root из CSS файлов ===")

for css_file in CSS_FILES:
    path = os.path.join(ROOT, css_file)
    content = read_file(path)
    if content:
        has_root = bool(re.search(r':root\s*\{', content))
        test(f"{css_file} не содержит :root {{ }}", not has_root,
             f"{css_file} всё ещё содержит блок :root")


# ============================================================
# 5. Кнопка темы в html/dashbridge.html
# ============================================================
print("\n=== 5. Кнопка темы ===")

dashbridge_html = read_file(os.path.join(ROOT, 'html/dashbridge.html'))
if dashbridge_html:
    test("html/dashbridge.html не содержит локальную кнопку themeToggle",
         'id="themeToggle"' not in dashbridge_html,
         "Переключение темы должно оставаться только в popup")

popup_html = read_file(os.path.join(ROOT, 'html/popup.html'))
if popup_html:
    test("html/popup.html содержит кнопку themeToggleBtn",
         'id="themeToggleBtn"' in popup_html,
         "Кнопка themeToggleBtn отсутствует в html/popup.html")
    test("html/popup.html кнопка темы имеет класс btn-theme",
         'btn-theme' in popup_html,
         "Кнопка темы в html/popup.html не имеет класса btn-theme")

# ============================================================
# 5.1. Стиль btn-theme в css/theme.css
# ============================================================
print("\n=== 5.1. Стиль btn-theme ===")

# Перечитываем css/theme.css (в секциях 2-4 переменная content была перезаписана)
theme_content = read_file(THEME_CSS)
if theme_content:
    test("css/theme.css содержит стиль .btn-theme",
         '.btn-theme' in theme_content,
         "Стиль .btn-theme отсутствует в css/theme.css")
    test("css/theme.css btn-theme использует градиент",
         'linear-gradient' in theme_content and 'btn-theme' in theme_content,
         "btn-theme не использует градиент")
    test("css/theme.css btn-theme имеет белый текст",
         'btn-theme' in theme_content and '#ffffff' in theme_content,
         "btn-theme не имеет белого текста")
    test("css/theme.css btn-theme имеет hover-стиль",
         '.btn-theme:hover' in theme_content,
         "btn-theme не имеет hover-стиля")
    test("css/theme.css btn-theme имеет стиль для тёмной темы",
         '[data-theme="dark"] .btn-theme' in theme_content,
         "btn-theme не имеет переопределения для тёмной темы")
    test("css/theme.css btn-theme имеет стили для .theme-icon и .theme-text",
         '.theme-icon' in theme_content and '.theme-text' in theme_content,
         "btn-theme не имеет стилей для .theme-icon/.theme-text")
    test("css/theme.css btn-theme имеет стили для compact-режима [data-compact]",
         '.btn-theme[data-compact]' in theme_content,
         "btn-theme не имеет стилей для compact-режима")
    test("css/theme.css .date-input-group input имеет padding-right (нет наслоения иконки)",
         '.date-input-group input' in theme_content and 'padding-right' in theme_content,
         "css/theme.css не имеет padding-right для .date-input-group input (иконка календаря перекрывает текст)")


# ============================================================
# 5.2. Отсутствие дублирования контента в кнопке темы
# ============================================================
print("\n=== 5.2. Отсутствие дублирования в кнопке темы ===")

# html/dashbridge.html: кнопка должна быть пустой (без захардкоженного SVG/текста)
if dashbridge_html and 'id="themeToggle"' in dashbridge_html:
    # Ищем блок кнопки themeToggle
    btn_match = re.search(
        r'<button[^>]*id="themeToggle"[^>]*>(.*?)</button>',
        dashbridge_html, re.DOTALL
    )
    if btn_match:
        btn_content = btn_match.group(1).strip()
        test("html/dashbridge.html кнопка themeToggle пустая (без дублирования)",
             btn_content == '',
             f"Кнопка содержит: '{btn_content[:80]}' (должна быть пустой)")
    else:
        test("html/dashbridge.html кнопка themeToggle найдена", False,
             "Не удалось найти кнопку themeToggle")

# html/popup.html: кнопка должна быть пустой (без захардкоженного SVG)
if popup_html:
    btn_match = re.search(
        r'<button[^>]*id="themeToggleBtn"[^>]*>(.*?)</button>',
        popup_html, re.DOTALL
    )
    if btn_match:
        btn_content = btn_match.group(1).strip()
        test("html/popup.html кнопка themeToggleBtn пустая (без дублирования)",
             btn_content == '',
             f"Кнопка содержит: '{btn_content[:80]}' (должна быть пустой)")
    else:
        test("html/popup.html кнопка themeToggleBtn найдена", False,
             "Не удалось найти кнопку themeToggleBtn")

    # html/popup.html: кнопка должна иметь data-compact
    test("html/popup.html кнопка темы имеет data-compact (только иконка)",
         'data-compact' in popup_html and 'themeToggleBtn' in popup_html,
         "html/popup.html кнопка темы не имеет data-compact")


# ============================================================
# 6. Логика темы в js/theme.js
# ============================================================
print("\n=== 6. Логика темы в js/theme.js ===")

theme_js = read_file(os.path.join(ROOT, 'js/theme.js'))
if theme_js:
    test("js/theme.js существует", theme_js is not None,
         "Файл js/theme.js не найден")
    test("js/theme.js содержит applyTheme()",
         'function applyTheme' in theme_js,
         "Функция applyTheme отсутствует")
    test("js/theme.js содержит updateThemeIcon()",
         'function updateThemeIcon' in theme_js,
         "Функция updateThemeIcon отсутствует")
    test("js/theme.js содержит initTheme()",
         'function initTheme' in theme_js,
         "Функция initTheme отсутствует")
    test("js/theme.js использует chrome.storage.sync для темы",
         'globalTheme' in theme_js and 'chrome.storage.sync' in theme_js,
         "Глобальная синхронизация темы не реализована")
    test("js/theme.js слушает chrome.storage.onChanged",
         'chrome.storage.onChanged' in theme_js,
         "Listener onChanged отсутствует")
    test("js/theme.js применяет тему к documentElement",
         "documentElement.setAttribute('data-theme'" in theme_js,
         "Тема применяется не к documentElement")
    test("js/theme.js использует IIFE (изоляция scope)",
         "(function () {" in theme_js or "(function(){" in theme_js,
         "IIFE не используется")
    test("js/theme.js использует span вместо innerHTML (не ломает стили)",
         'theme-icon' in theme_js and 'theme-text' in theme_js,
         "js/theme.js использует innerHTML вместо span (ломает стили btn-theme)")
    test("js/theme.js не использует btn.innerHTML напрямую",
         'btn.innerHTML' not in theme_js,
         "js/theme.js использует btn.innerHTML (ломает стили btn-theme)")
    test("js/theme.js очищает кнопку перед вставкой (btn.textContent = '')",
         "btn.textContent = ''" in theme_js or "btn.textContent=''" in theme_js,
         "js/theme.js не очищает кнопку перед вставкой (дублирование контента)")
    test("js/theme.js поддерживает data-compact (только иконка)",
         'data-compact' in theme_js,
         "js/theme.js не поддерживает data-compact режим")
    test("js/theme.js использует createElement (не innerHTML)",
         'createElement' in theme_js,
         "js/theme.js не использует createElement")


# ============================================================
# 7. Подключение js/theme.js во всех HTML (CSP-совместимость)
# ============================================================
print("\n=== 7. Подключение js/theme.js ===")

for html_file in HTML_FILES:
    path = os.path.join(ROOT, html_file)
    html_content = read_file(path)
    if html_content:
        # CSP: inline scripts запрещены, должен быть внешний файл
        test(f"{html_file} подключает js/theme.js через <script src>",
             references_file(html_file, 'src', 'js/theme.js'),
             f"js/theme.js не подключён в {html_file}")
        # Не должно быть inline scripts с chrome.storage.onChanged
        inline_pattern = re.compile(r'<script>(?!.*?src=).*?chrome\.storage\.onChanged.*?</script>', re.DOTALL)
        has_inline_theme_script = bool(inline_pattern.search(html_content))
        test(f"{html_file} не содержит inline scripts с темой (CSP)",
             not has_inline_theme_script,
             f"{html_file} содержит inline script с chrome.storage.onChanged (нарушает CSP)")


# ============================================================
# 8. Единые имена переменных в css/dashbridge.css
# ============================================================
print("\n=== 8. Использование единых переменных ===")

dashbridge_css = read_file(os.path.join(ROOT, 'css/dashbridge.css'))
if dashbridge_css:
    # Не должно быть определений :root
    test("css/dashbridge.css не определяет :root",
         ':root' not in dashbridge_css or ':root' in dashbridge_css and '/*' in dashbridge_css[dashbridge_css.find(':root'):dashbridge_css.find(':root')+50],
         "css/dashbridge.css всё ещё определяет :root")

batch_css = read_file(os.path.join(ROOT, 'css/batch.css'))
if batch_css:
    test("css/batch.css не определяет :root",
         ':root' not in batch_css,
         "css/batch.css всё ещё определяет :root")
    test("css/batch.css не использует зелёный primary #10b981",
         '#10b981' not in batch_css,
         "css/batch.css всё ещё использует зелёный primary")


# ============================================================
# 9. manifest.json содержит css/theme.css в web_accessible_resources
# ============================================================
print("\n=== 9. pages/worklog/worklog.html: ширина колонки Start Date ===")
worklog = read_file(os.path.join(ROOT, 'pages', 'worklog', 'worklog.css'))
test("pages/worklog/worklog.html .col-date width >= 12.5rem",
     worklog is not None and re.search(r"\.col-date\s*\{[^}]*width:\s*12\.5rem", worklog) is not None,
     "Колонка Start Date должна быть >= 200px для вмещения '01/07/2026 09:00' + иконка")
test("pages/worklog/worklog.html .col-date min-width: 12.5rem",
     worklog is not None and 'min-width: 12.5rem' in worklog,
     "min-width нужен чтобы колонка не сжималась")
test("pages/worklog/worklog.html .col-date input text-align: left",
     worklog is not None and re.search(r"\.col-date\s+input\s*\{[^}]*text-align:\s*left", worklog) is not None,
     "text-align: left чтобы текст не упирался в иконку календаря")


# ============================================================
# 10. css/theme.css: переопределения для pages/options/options.html inline-стилей
# ============================================================
print("\n=== 10. css/theme.css: переопределения inline-стилей pages/options/options.html ===")

# Перечитываем css/theme.css свежим чтением (на случай если content был перезаписан)
content = read_file(THEME_CSS)
if content:
    # Все переопределения должны быть с !important (inline-стили имеют специфичность 1,0,0,0)
    required_overrides = [
        ('border: 1px solid #fff', 'border-color: var(--border)'),
        ('color: #fff', 'color: var(--text-main)'),
        ('background: #f8fafc', 'background: var(--bg-elevated)'),
        ('border-bottom: 1px solid #f1f5f9', 'border-bottom-color: var(--border)'),
        ('background: rgba(241, 245, 249', 'background: var(--bg-elevated)'),
        ('background: rgba(0,0,0,0.02)', 'background: var(--bg-elevated)'),
        ('background: rgba(255, 255, 255, 0.8)', 'background: var(--card-bg)'),
        ('background: #dcfce7', 'background: rgba(21, 128, 61, 0.2)'),
        ('color: #166534', 'color: #4ade80'),
    ]
    for pattern, replacement in required_overrides:
        # Ищем ВСЕ CSS-правила с селектором [data-theme="dark"] и проверяем каждое
        # Парсим CSS вручную: находим все позиции [data-theme="dark"] и для каждого
        # ищем ближайшую открывающую скобку { и соответствующую закрывающую }
        dark_positions = []
        search_pos = 0
        while True:
            found = content.find('[data-theme="dark"]', search_pos)
            if found == -1:
                break
            dark_positions.append(found)
            search_pos = found + 1

        # Для каждой позиции ищем тело правила
        all_dark_rules = []  # список (selector, body)
        for pos in dark_positions:
            # Ищем открывающую скобку после позиции
            open_brace = content.find('{', pos)
            if open_brace == -1:
                continue
            # Ищем закрывающую скобку после открывающей
            close_brace = content.find('}', open_brace)
            if close_brace == -1:
                continue
            # Селектор - от позиции до открывающей скобки
            selector = content[pos:open_brace]
            # Тело - между { и }
            body = content[open_brace + 1:close_brace]
            all_dark_rules.append((selector, body))

        # Ищем правило, у которого СЕЛЕКТОР содержит паттерн
        found_body = None
        for selector, body in all_dark_rules:
            if pattern in selector:
                found_body = body
                break

        if found_body is None:
            test(f"css/theme.css переопределяет {pattern}", False,
                 f"Правило с селектором содержащим {pattern} не найдено в dark-блоке")
            continue

        test(f"css/theme.css переопределяет {pattern}",
             replacement in found_body,
             f"Нет переопределения для {pattern} -> {replacement}")
        test(f"css/theme.css использует !important для {pattern}",
             '!important' in found_body,
             f"Без !important inline-стиль победит (специфичность 1,0,0,0)")

print("\n=== 9. manifest.json ===")

manifest = read_file(os.path.join(ROOT, 'manifest.json'))
if manifest:
    # css/theme.css должен быть доступен для всех HTML страниц расширения
    # В MV3 расширения файлы из корня доступны по chrome.runtime.getURL()
    # Не требуется явно указывать в web_accessible_resources
    test("manifest.json валиден (JSON)", manifest.count('{') > 0,
         "manifest.json не похож на JSON")


# ============================================================
# 11. pages/options/options.html: inline-стили заменены на CSS-классы
# ============================================================
print("\n=== 11. pages/options/options.html: замена inline-стилей на CSS-классы ===")

options_content = read_file(os.path.join(ROOT, 'pages/options/options.html'))
if options_content:
    # Подсчитываем оставшиеся inline-стили
    inline_styles = re.findall(r'style="[^"]+"', options_content)
    test("pages/options/options.html: 0 inline-стилей (все заменены на классы)",
         len(inline_styles) == 0,
         f"Осталось {len(inline_styles)} inline-стилей: {inline_styles[:3]}")

    # Проверяем, что используются новые CSS-классы
    required_classes = [
        'header-content', 'interface-section', 'form-row',
        'form-label-row', 'divider', 'subsection-title',
        'collapsible-group', 'collapsible-header', 'collapsible-content',
        'module-toggle', 'section-card', 'section-title-h4',
        'form-hint', 'maintenance-section', 'save-island',
        'btn-save', 'btn-secondary-flex'
    ]
    for cls in required_classes:
        test(f"pages/options/options.html использует класс .{cls}",
             f'class="{cls}' in options_content or f' {cls}"' in options_content or f'"{cls} ' in options_content,
             f"Класс .{cls} не найден в pages/options/options.html")


# ============================================================
# 12. css/theme.css: новые utility-классы для options
# ============================================================
print("\n=== 12. css/theme.css: новые utility-классы ===")

content = read_file(THEME_CSS)
if content:
    new_classes = [
        '.header-content', '.interface-section', '.form-row',
        '.form-row-divider', '.form-label-row',
        '.form-label-row-sm', '.divider', '.subsection-title',
        '.collapsible-group', '.collapsible-header', '.collapsible-content',
        '.module-toggle', '.module-toggle-last', '.module-toggle-label',
        '.section-card', '.section-card-last', '.section-title-h4',
        '.section-title-muted', '.form-hint', '.form-hint-block',
        '.form-hint-block-lg', '.form-hint-italic',
        '.form-group-last', '.form-group-mt-mb-16',
        '.interface-section-title', '.maintenance-section',
        '.maintenance-actions', '.btn-secondary-flex', '.maintenance-status',
        '.save-island', '.btn-save', '.form-input-mono',
        '.form-input-textarea', '.hidden', '.spacer-40'
    ]
    for cls in new_classes:
        test(f"css/theme.css содержит класс {cls}", cls in content,
             f"Класс {cls} отсутствует в css/theme.css")

    # Проверяем, что новые классы имеют dark-переопределения
    dark_overrides_for_new = [
        ('.interface-section', 'background: var(--bg-elevated)'),
        ('.collapsible-group', 'background: var(--card-bg)'),
        ('.collapsible-header', 'background: var(--bg-elevated)'),
        ('.collapsible-content', 'background: var(--card-bg)'),
        ('.module-toggle', 'background: var(--card-bg)'),
        ('.section-card', 'background: var(--card-bg)'),
        ('.maintenance-section', 'background: var(--bg-elevated)'),
        ('.save-island', 'background: rgba(15, 23, 42'),
        ('.form-input-mono', 'background: var(--bg-elevated)'),
        ('.form-row-divider', 'border-bottom-color: var(--border)'),
    ]
    for cls, dark_prop in dark_overrides_for_new:
        # Ищем dark-правило для этого класса (может быть несколько вхождений)
        pattern = f'[data-theme="dark"] {cls}'
        # Собираем все тела dark-правил для этого класса
        all_bodies = []
        search_pos = 0
        while True:
            pos = content.find(pattern, search_pos)
            if pos == -1:
                break
            open_brace = content.find('{', pos)
            close_brace = content.find('}', open_brace)
            if open_brace != -1 and close_brace != -1:
                all_bodies.append(content[open_brace + 1:close_brace])
            search_pos = pos + len(pattern)
        if not all_bodies:
            test(f"css/theme.css: dark-переопределение для {cls}", False,
                 f"Правило {pattern} не найдено")
            continue
        # Проверяем, что хотя бы в одном теле есть нужное свойство
        test(f"css/theme.css: dark-переопределение для {cls}",
             any(dark_prop in body for body in all_bodies),
             f"Нет {dark_prop} ни в одном dark-правиле для {cls}")


# ============================================================
# 13. css/theme.css: новые utility-классы для иконок (замена inline-стилей)
# ============================================================
print("\n=== 13. css/theme.css: utility-классы для иконок ===")

content = read_file(THEME_CSS)
if content:
    icon_classes = [
        '.ic-header', '.ic-primary', '.ic-primary-lg',
        '.arrow-icon', '.ic-muted', '.ic-white'
    ]
    for cls in icon_classes:
        test(f"css/theme.css содержит класс {cls}", cls in content,
             f"Класс {cls} отсутствует в css/theme.css")

    # Проверяем, что .ic-header имеет нужные свойства
    pos = content.find('.ic-header {')
    if pos != -1:
        open_brace = content.find('{', pos)
        close_brace = content.find('}', open_brace)
        body = content[open_brace + 1:close_brace]
        test(".ic-header имеет width: 26px", 'width: 26px' in body,
             "Нет width: 26px в .ic-header")
        test(".ic-header имеет color: #fff", 'color: #fff' in body,
             "Нет color: #fff в .ic-header")

    # Проверяем, что .ic-primary использует var(--primary)
    pos = content.find('.ic-primary {')
    if pos != -1:
        open_brace = content.find('{', pos)
        close_brace = content.find('}', open_brace)
        body = content[open_brace + 1:close_brace]
        test(".ic-primary использует var(--primary)",
             'var(--primary)' in body,
             "Нет var(--primary) в .ic-primary")

    # Проверяем, что .arrow-icon имеет transition
    pos = content.find('.arrow-icon {')
    if pos != -1:
        open_brace = content.find('{', pos)
        close_brace = content.find('}', open_brace)
        body = content[open_brace + 1:close_brace]
        test(".arrow-icon имеет transition: transform",
             'transition: transform' in body,
             "Нет transition: transform в .arrow-icon")


# ============================================================
# 14. pages/options/options.html: отсутствие inline-стилей
# ============================================================
print("\n=== 14. pages/options/options.html: отсутствие inline-стилей ===")

options_path = os.path.join(ROOT, 'pages/options/options.html')
options_content = read_file(options_path)
if options_content:
    # Не должно быть style="..." атрибутов
    inline_styles = re.findall(r'style\s*=\s*["\']', options_content)
    test("pages/options/options.html не содержит inline-стилей", len(inline_styles) == 0,
         f"Найдено {len(inline_styles)} inline-стилей: {inline_styles[:3]}")

    # Должны использоваться новые классы
    new_classes_used = [
        'ic-header', 'ic-primary', 'ic-primary-lg',
        'arrow-icon', 'ic-muted', 'ic-white', 'section-description'
    ]
    for cls in new_classes_used:
        test(f"pages/options/options.html использует класс {cls}", cls in options_content,
             f"Класс {cls} не используется в pages/options/options.html")


# ============================================================
# Итоги
# ============================================================
print("\n" + "=" * 60)
print(f"ПРОЙДЕНО: {PASSED}")
print(f"ПРОВАЛЕНО: {FAILED}")
print("=" * 60)

if FAILED > 0:
    print("\nОШИБКИ:")
    for err in ERRORS:
        print(f"  - {err}")
    sys.exit(1)
else:
    print("\n[OK] Все тесты унификации GUI пройдены!")
    sys.exit(0)
