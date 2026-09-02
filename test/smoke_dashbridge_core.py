# -*- coding: utf-8 -*-
"""
Тесты для Фазы 1 оптимизации pages/dashbridge/dashbridge.js
Проверяют:
1. setupTimeControls вызывается только один раз
2. card.draggable сбрасывается после mouseup, не отменяя drag при mouseleave
3. window.open использует noopener,noreferrer
4. panel.src экранируется через escapeHtml
5. showAlert/showConfirm/showPrompt принадлежат отдельному модулю и возвращают Promise
6. Все нативные alert/confirm/prompt заменены на кастомные
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DASHBRIDGE_JS = ROOT / "pages/dashbridge/dashbridge.js"
DASHBRIDGE_MODAL_JS = ROOT / "pages/dashbridge/dashbridge-modal.js"
DASHBRIDGE_PANEL_URL_JS = ROOT / "pages/dashbridge/dashbridge-panel-url.js"
DASHBRIDGE_PANEL_TRANSFER_JS = ROOT / "pages/dashbridge/dashbridge-panel-transfer.js"
DASHBRIDGE_HTML = ROOT / "pages/dashbridge/dashbridge.html"

passed = 0
failed = 0
results = []


def test(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        results.append(f"  [OK]   {name}")
    else:
        failed += 1
        results.append(f"  [FAIL] {name} {detail}")


def read_file():
    return DASHBRIDGE_JS.read_text(encoding="utf-8") \
        + (ROOT / "pages/dashbridge/dashbridge-profile-controller.js").read_text(encoding="utf-8") \
        + (ROOT / "pages/dashbridge/dashbridge-panel-card-controller.js").read_text(encoding="utf-8") \
        + (ROOT / "pages/dashbridge/dashbridge-panel-transfer-controller.js").read_text(encoding="utf-8") \
        + (ROOT / "pages/dashbridge/dashbridge-panel-addition-controller.js").read_text(encoding="utf-8") \
        + (ROOT / "pages/dashbridge/dashbridge-page-ui-controller.js").read_text(encoding="utf-8")


print("=" * 70)
print("ТЕСТЫ ФАЗЫ 1: pages/dashbridge/dashbridge.js — критичные баги")
print("=" * 70)

content = read_file()
renderer = (ROOT / "pages/dashbridge/dashbridge-renderer.js").read_text(encoding="utf-8")
modal_content = DASHBRIDGE_MODAL_JS.read_text(encoding="utf-8")
panel_url_content = DASHBRIDGE_PANEL_URL_JS.read_text(encoding="utf-8")
panel_transfer_content = DASHBRIDGE_PANEL_TRANSFER_JS.read_text(encoding="utf-8")
panel_addition_content = (ROOT / "pages/dashbridge/dashbridge-panel-addition-controller.js").read_text(encoding="utf-8")
panel_card_content = (ROOT / "pages/dashbridge/dashbridge-panel-card-controller.js").read_text(encoding="utf-8")
panel_actions_content = panel_card_content
dashbridge_html = DASHBRIDGE_HTML.read_text(encoding="utf-8")

# ════════════════════════════════════════════════════════
# 1.1. setupTimeControls вызывается только один раз
# ════════════════════════════════════════════════════════
print("\n--- 1.1. setupTimeControls ---")

# Должен быть только один вызов setupTimeControls() (исключая определение функции)
setup_time_calls = re.findall(r"(?<!function )setupTimeControls\(\)", content)
test(
    "setupTimeControls() вызывается ровно 1 раз",
    len(setup_time_calls) == 1,
    f"найдено {len(setup_time_calls)} вызовов"
)

# Не должно быть отдельного DOMContentLoaded для setupTimeControls
separate_dom_loaded = re.findall(
    r"document\.addEventListener\(['\"]DOMContentLoaded['\"],\s*setupTimeControls\)",
    content
)
test(
    "Нет отдельного DOMContentLoaded для setupTimeControls",
    len(separate_dom_loaded) == 0,
    f"найдено {len(separate_dom_loaded)}"
)

# setupTimeControls должен вызываться внутри основного DOMContentLoaded.
# The initializer contains nested promise callbacks, so a [^}]* regex would
# stop at the first callback rather than at the end of the listener.
main_dom_start = content.find("document.addEventListener('DOMContentLoaded', async () => {")
main_dom_end = content.find("function getCompactCaptureDimensions", main_dom_start)
main_dom_loaded = main_dom_start >= 0 and main_dom_end > main_dom_start \
    and "setupTimeControls()" in content[main_dom_start:main_dom_end]
test(
    "setupTimeControls() вызывается внутри основного DOMContentLoaded",
    main_dom_loaded
)

# ════════════════════════════════════════════════════════
# 1.2. card.draggable сбрасывается после mouseup
# ════════════════════════════════════════════════════════
print("\n--- 1.2. card.draggable сброс ---")

# Должен быть обработчик mouseup
mouseup_handler = re.search(
    r"handle\.addEventListener\(['\"]mouseup['\"],\s*\(\)\s*=>\s*\{\s*card\.draggable\s*=\s*false",
    content
)
test(
    "Есть обработчик mouseup для сброса draggable",
    mouseup_handler is not None
)

# mouseleave отменяет нативный drag до dragstart, поэтому обработчика быть не должно.
test(
    "mouseleave не отменяет начало перетаскивания",
    "handle.addEventListener('mouseleave'" not in content and 'handle.addEventListener("mouseleave"' not in content
)

# ════════════════════════════════════════════════════════
# 1.3. window.open использует noopener,noreferrer
# ════════════════════════════════════════════════════════
print("\n--- 1.3. window.open безопасность ---")

# window.open должен иметь noopener,noreferrer (с учётом вложенных скобок)
window_open_safe = re.search(
    r"openWindow\([\s\S]*?applyPanelParamsToUrl\([^\n]+\),[\s\S]*?['\"]_blank['\"],[\s\S]*?['\"]noopener,noreferrer['\"]",
    panel_actions_content
)
test(
    "window.open использует noopener,noreferrer",
    window_open_safe is not None
)

# Не должно быть window.open без noopener
unsafe_window_open = re.findall(
    r"window\.open\([^)]*['\"]_blank['\"](?!\s*,\s*['\"]noopener)",
    content
)
test(
    "Нет window.open без noopener",
    len(unsafe_window_open) == 0,
    f"найдено {len(unsafe_window_open)} небезопасных вызовов"
)

# ════════════════════════════════════════════════════════
# 1.4. panel.src экранируется через escapeHtml
# ════════════════════════════════════════════════════════
print("\n--- 1.4. XSS защита panel.src ---")

# Dynamic URL values are assigned through dataset instead of parsed HTML.
safe_src_var = "{ url: panel.src }" in renderer
test(
    "panel.src назначается через DOM dataset",
    safe_src_var
)

safe_iframe_src = "iframe.dataset.src = iframeSrc" in renderer
test(
    "iframe URL назначается через DOM dataset",
    safe_iframe_src
)

inner_html_uses_safe = 'data-url="${panel.src}' not in renderer and 'data-url="${safeSrc}' not in renderer
test(
    "panel.src не интерполируется в innerHTML",
    inner_html_uses_safe
)

iframe_uses_safe = '<iframe' not in renderer and "document.createElement('iframe')" in renderer
test(
    "iframe создаётся через DOM API",
    iframe_uses_safe
)

# ════════════════════════════════════════════════════════
# 1.5. Кастомные модалки вместо alert/confirm/prompt
# ════════════════════════════════════════════════════════
print("\n--- 1.5. Кастомные модалки ---")

# showAlert должен существовать
show_alert_def = re.search(
    r"function\s+showAlert\s*\([^)]*\)\s*\{[^}]*return\s+new\s+Promise",
    modal_content,
    re.DOTALL
)
test(
    "showAlert() определена и возвращает Promise",
    show_alert_def is not None
)

# showConfirm должен существовать
show_confirm_def = re.search(
    r"function\s+showConfirm\s*\([^)]*\)\s*\{[^}]*return\s+new\s+Promise",
    modal_content,
    re.DOTALL
)
test(
    "showConfirm() определена и возвращает Promise",
    show_confirm_def is not None
)

# Общий конструктор обязан явно показывать новый экземпляр после добавления в DOM.
test(
    "Кастомные модальные окна становятся видимыми",
    "overlay.style.display = 'flex';" in modal_content
)

# showPrompt должен существовать
show_prompt_def = re.search(
    r"function\s+showPrompt\s*\([^)]*\)\s*\{[^}]*return\s+new\s+Promise",
    modal_content,
    re.DOTALL
)
test(
    "showPrompt() определена и возвращает Promise",
    show_prompt_def is not None
)

# Не должно быть нативных alert(
native_alert = re.findall(r"(?<![\w.])alert\(", content + modal_content)
test(
    "Нет нативных alert()",
    len(native_alert) == 0,
    f"найдено {len(native_alert)}"
)

# Не должно быть нативных confirm(
native_confirm = re.findall(r"(?<![\w.])confirm\(", content + modal_content)
test(
    "Нет нативных confirm()",
    len(native_confirm) == 0,
    f"найдено {len(native_confirm)}"
)

# Не должно быть нативных prompt(
native_prompt = re.findall(r"(?<![\w.])prompt\(", content + modal_content)
test(
    "Нет нативных prompt()",
    len(native_prompt) == 0,
    f"найдено {len(native_prompt)}"
)

test(
    "Модальный модуль загружается до основного контроллера",
    dashbridge_html.find('src="dashbridge-modal.js"')
    < dashbridge_html.find('src="dashbridge.js"')
)

test(
    "Основной контроллер использует единый модальный API",
    "const { showAlert, showConfirm, showPrompt } = window.DashBridgeModal;" in content
    and "function showAlert(" not in content
    and "function showConfirm(" not in content
    and "function showPrompt(" not in content
)

# deleteProfile должен быть async
delete_profile_async = re.search(
    r"(?:async\s+function\s+deleteProfile\s*\(|const\s+deleteProfile\s*=\s*async)",
    content
)
test(
    "deleteProfile() — async",
    delete_profile_async is not None
)

# deletePanel должен быть async
delete_panel_async = re.search(
    r"const\s+deletePanel\s*=\s*async\s+id\s*=>",
    panel_actions_content
)
test(
    "deletePanel() — async",
    delete_panel_async is not None
)

# exportPanels должен быть async
export_panels_async = re.search(
    r"const\s+exportPanels\s*=\s*async\s*\(",
    content
)
test(
    "exportPanels() — async",
    export_panels_async is not None
)

# importPanels должен быть async
import_panels_async = re.search(
    r"const\s+importPanels\s*=\s*async\s+file\s*=>",
    content
)
test(
    "importPanels() — async",
    import_panels_async is not None
)

test(
    "Экспорт профиля сохраняет полный объект панели",
    "panels: panels.map(p => ({ src: p.src, width: p.width, height: p.height }))" not in content
    and "version: 3" in panel_transfer_content
    and "panels," in panel_transfer_content
)

test(
    "Импорт профиля сохраняет настройки и нормализует полный объект",
    "const candidate = {" in panel_transfer_content
    and "...source," in panel_transfer_content
    and "DashBridgeLocalStateSchema.normalizeProfiles" in panel_transfer_content
)

test(
    "Legacy-поля панели игнорируются без delete-миграции",
    "delete panel.frameSettings" not in content
    and "delete panel.pausedSnapshotAt" not in content
)

# savePanelBtn обработчик должен быть async
save_panel_async = re.search(
    r"getElementById\(['\"]savePanelBtn['\"]\)\.addEventListener\(['\"]click['\"],\s*async",
    content
)
test(
    "savePanelBtn обработчик — async",
    save_panel_async is not None
)

# newProfileBtn обработчик должен быть async
new_profile_async = re.search(
    r"getElementById\(['\"]newProfileBtn['\"]\)\.addEventListener\(['\"]click['\"],\s*async",
    content
)
test(
    "newProfileBtn обработчик — async",
    new_profile_async is not None
)

# renameProfileBtn обработчик должен быть async
rename_profile_async = re.search(
    r"getElementById\(['\"]renameProfileBtn['\"]\)\.addEventListener\(['\"]click['\"],\s*async",
    content
)
test(
    "renameProfileBtn обработчик — async",
    rename_profile_async is not None
)

# ════════════════════════════════════════════════════════
# Нормализация URL Grafana (единая для добавления и правки)
# ════════════════════════════════════════════════════════
print("\n--- Нормализация URL Grafana ---")

# Общий нормализатор должен существовать
test(
    "Есть функция normalizeGrafanaPanelUrl",
    "function normalizeGrafanaPanelUrl(" in panel_url_content
)

# Нормализатор должен приводить ссылку к режиму одиночной панели без хрома Grafana
normalize_body = re.search(
    r"function normalizeGrafanaPanelUrl\(value\)\s*\{(.*?)\n\}",
    panel_url_content,
    re.S
)
test(
    "normalizeGrafanaPanelUrl найден и разобран",
    normalize_body is not None
)
normalize_src = normalize_body.group(1) if normalize_body else ""

test(
    "normalizeGrafanaPanelUrl переводит /d/ в /d-solo/ при наличии panelId",
    "replace('/d/', '/d-solo/')" in normalize_src
)
test(
    "normalizeGrafanaPanelUrl возвращает /d-solo/ в /d/ без panelId",
    "replace('/d-solo/', '/d/')" in normalize_src
)
test(
    "normalizeGrafanaPanelUrl переносит viewPanel в panelId",
    "searchParams.delete('viewPanel')" in normalize_src
    and "searchParams.set('panelId', panelId)" in normalize_src
)
test(
    "normalizeGrafanaPanelUrl выставляет kiosk=tv",
    "searchParams.set('kiosk', 'tv')" in normalize_src,
    "без kiosk=tv карточка показывает верхнюю панель настроек Grafana"
)
test(
    "normalizeGrafanaPanelUrl выставляет метку dashbridge=1",
    "searchParams.set('dashbridge', '1')" in normalize_src
)

# Нормализация должна оставаться в двух потоках: через инъекцию контроллеру
# добавления и напрямую при правке URL iframe.
normalize_calls = re.findall(r"(?<!function )normalizeGrafanaPanelUrl\(", content)
test(
    "normalizeGrafanaPanelUrl обслуживает добавление и правку URL",
    len(normalize_calls) == 0
    and content.count("normalizePanelUrl: normalizeGrafanaPanelUrl") == 2
    and "url = normalizePanelUrl(url)" in panel_addition_content,
    f"прямых вызовов найдено {len(normalize_calls)}"
)

# Обработчик savePanelBtn обязан использовать общий нормализатор,
# а не собственную копию логики
save_panel_handler = re.search(
    r"getElementById\(['\"]savePanelBtn['\"]\)\.addEventListener\(['\"]click['\"],\s*async.*?\n\s*\}\);",
    panel_addition_content,
    re.S
)
test(
    "Обработчик savePanelBtn найден и разобран",
    save_panel_handler is not None
)
save_panel_src = save_panel_handler.group(0) if save_panel_handler else ""

test(
    "savePanelBtn нормализует URL через normalizeGrafanaPanelUrl",
    "normalizePanelUrl(" in save_panel_src
)
test(
    "savePanelBtn не дублирует нормализацию вручную",
    "replace('/d/', '/d-solo/')" not in save_panel_src,
    "инлайн-копия логики разъезжается с правкой URL"
)

# Обработчик сохранения в «Настройки iframe» — источник исходного бага:
# ранее он писал panel.src напрямую из поля ввода
iframe_save_handler = re.search(
    r"\.iframe-settings-save['\"]\)\.addEventListener\(['\"]click['\"],\s*async.*?\n\s*\}\);",
    panel_actions_content,
    re.S
)
test(
    "Обработчик .iframe-settings-save найден и разобран",
    iframe_save_handler is not None
)
iframe_save_src = iframe_save_handler.group(0) if iframe_save_handler else ""

test(
    "Настройки iframe читают введённый URL в rawUrl",
    "const rawUrl = overlay.querySelector('#iframeSettingsUrl').value.trim();" in iframe_save_src
)
test(
    "Настройки iframe нормализуют URL перед сохранением",
    "normalizePanelUrl(rawUrl)" in iframe_save_src,
    "без нормализации карточка показывает полный дашборд Grafana"
)
test(
    "Настройки iframe не пишут в panel.src сырое значение поля",
    "panel.src = rawUrl" not in iframe_save_src
    and "panel.src = url;" in iframe_save_src
)
# Нормализация должна идти после валидации и до присваивания
if iframe_save_src:
    normalize_at = iframe_save_src.find("normalizePanelUrl(rawUrl)")
    assign_at = iframe_save_src.find("panel.src = url;")
    test(
        "Нормализация выполняется до присваивания panel.src",
        0 <= normalize_at < assign_at,
        f"normalize={normalize_at}, assign={assign_at}"
    )

# ════════════════════════════════════════════════════════
# updatePanelCard: точечное обновление карточки
# ════════════════════════════════════════════════════════
print("\n--- updatePanelCard ---")

update_card = re.search(
    r"const updatePanelCard = \(panelId, \{ reloadFrame = true \} = \{\}\) => \{(.*?)\n        \};",
    panel_card_content,
    re.S
)
test(
    "Функция updatePanelCard найдена и разобрана",
    update_card is not None
)
update_card_src = update_card.group(1) if update_card else ""

test(
    "updatePanelCard синхронизирует data-url кнопки «Открыть в Grafana»",
    ".btn-open" in update_card_src and "dataset.url = panel.src" in update_card_src,
    "иначе кнопка открывает старый адрес"
)
test(
    "updatePanelCard уводит загруженный iframe через navigateDashboardFrame",
    "navigateDashboardFrame(iframe, nextSrc)" in update_card_src
)
test(
    "updatePanelCard снимает data-src у уже загруженного iframe",
    "iframe.removeAttribute('data-src')" in update_card_src,
    "data-src означает «ещё не загружен» и вызвал бы повторную загрузку"
)
test(
    "updatePanelCard выставляет data-src ровно один раз (ветка ожидания)",
    update_card_src.count("iframe.dataset.src = nextSrc") == 1,
    f"найдено {update_card_src.count('iframe.dataset.src = nextSrc')}"
)
test(
    "updatePanelCard не перезагружает iframe при неизменном URL",
    "iframe.src !== nextSrc" in update_card_src
    and "iframe.dataset.src !== nextSrc" in update_card_src
)

# ════════════════════════════════════════════════════════
# Дополнительные проверки
# ════════════════════════════════════════════════════════
print("\n--- Дополнительные проверки ---")

# Скобки должны быть сбалансированы
braces_open = content.count("{")
braces_close = content.count("}")
test(
    "Фигурные скобки сбалансированы",
    braces_open == braces_close,
    f"{braces_open} / {braces_close}"
)

parens_open = content.count("(")
parens_close = content.count(")")
test(
    "Круглые скобки сбалансированы",
    parens_open == parens_close,
    f"{parens_open} / {parens_close}"
)

brackets_open = content.count("[")
brackets_close = content.count("]")
test(
    "Квадратные скобки сбалансированы",
    brackets_open == brackets_close,
    f"{brackets_open} / {brackets_close}"
)

# await должно быть только в async функциях
# В одной async функции может быть несколько await, поэтому просто проверяем
# что есть хотя бы одна async функция и хотя бы один await
async_count = content.count("async ")
await_count = content.count("await ")
test(
    "Есть async функции и await вызовы",
    async_count > 0 and await_count > 0,
    f"async={async_count}, await={await_count}"
)

# ════════════════════════════════════════════════════════
# Итоги
# ════════════════════════════════════════════════════════
print("\n" + "=" * 70)
for r in results:
    print(r)
print("=" * 70)
print(f"ИТОГО: {passed} пройдено, {failed} провалено из {passed + failed}")
print("=" * 70)

sys.exit(0 if failed == 0 else 1)
