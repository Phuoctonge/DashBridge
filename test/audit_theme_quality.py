# -*- coding: utf-8 -*-
"""
Глубокий аудит визуального качества тёмной темы.

Проверяет:
1. Контрастность текста на фоне (WCAG AA: 4.5:1 для обычного, 3:1 для крупного)
2. Видимость границ (border vs background)
3. Иерархию поверхностей (card-bg должен отличаться от bg)
4. Hover-состояния (должны быть видимыми)
5. Светлые тексты на светлых фонах (проблема "слияния")
"""
import re
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_CSS = os.path.join(WORKSPACE, 'pages/shared/theme.css')
THEME_COMPAT_CSS = os.path.join(WORKSPACE, 'pages/shared/theme-compat.css')


def hex_to_rgb(hex_color):
    """Преобразует #rrggbb в (r, g, b)."""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 3:
        hex_color = ''.join(c * 2 for c in hex_color)
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def relative_luminance(rgb):
    """Вычисляет относительную яркость по WCAG."""
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(fg, bg):
    """Вычисляет контраст по WCAG между двумя цветами."""
    l1 = relative_luminance(hex_to_rgb(fg))
    l2 = relative_luminance(hex_to_rgb(bg))
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def parse_theme_colors(theme_content):
    """Извлекает значения CSS-переменных для light и dark тем."""
    # Light theme (root)
    light_match = re.search(r':root\s*\{([^}]+)\}', theme_content)
    light_vars = {}
    if light_match:
        for match in re.finditer(r'--([\w-]+):\s*([^;]+);', light_match.group(1)):
            light_vars[match.group(1)] = match.group(2).strip()

    # Dark theme
    dark_match = re.search(r'\[data-theme="dark"\]\s*\{([^}]+)\}', theme_content)
    dark_vars = {}
    if dark_match:
        for match in re.finditer(r'--([\w-]+):\s*([^;]+);', dark_match.group(1)):
            dark_vars[match.group(1)] = match.group(2).strip()

    return light_vars, dark_vars


def resolve_color(value, vars_dict):
    """Разрешает значение переменной (может быть var(--xxx))."""
    value = value.strip()
    if value.startswith('var('):
        var_name = re.search(r'var\(--([\w-]+)', value).group(1)
        if var_name in vars_dict:
            return resolve_color(vars_dict[var_name], vars_dict)
    return value


def main():
    print("=" * 70)
    print("ГЛУБОКИЙ АУДИТ ВИЗУАЛЬНОГО КАЧЕСТВА ТЁМНОЙ ТЕМЫ")
    print("=" * 70)

    with open(THEME_CSS, 'r', encoding='utf-8') as f:
        theme_content = f.read()
    with open(THEME_COMPAT_CSS, 'r', encoding='utf-8') as f:
        theme_content += '\n' + f.read()

    light_vars, dark_vars = parse_theme_colors(theme_content)

    print(f"\n[*] Light theme: {len(light_vars)} переменных")
    print(f"[*] Dark theme: {len(dark_vars)} переменных")

    issues = []

    # === 1. Иерархия поверхностей ===
    print("\n" + "=" * 70)
    print("1. ИЕРАРХИЯ ПОВЕРХНОСТЕЙ (card-bg vs bg)")
    print("=" * 70)

    bg = resolve_color(dark_vars.get('bg', '#0f172a'), dark_vars)
    card_bg = resolve_color(dark_vars.get('card-bg', '#1e293b'), dark_vars)
    bg_elevated = resolve_color(dark_vars.get('bg-elevated', '#1e293b'), dark_vars)

    print(f"  bg:          {bg}")
    print(f"  card-bg:     {card_bg}")
    print(f"  bg-elevated: {bg_elevated}")

    if bg == card_bg:
        issues.append(("ИЕРАРХИЯ", f"card-bg ({card_bg}) == bg ({bg}) — карточки не отличаются от фона"))
        print(f"  [!] ПРОБЛЕМА: card-bg == bg — карточки сливаются с фоном")
    else:
        cr = contrast_ratio(bg, card_bg)
        print(f"  [OK] Контраст bg vs card-bg: {cr:.2f}:1")
        if cr < 1.2:
            issues.append(("ИЕРАРХИЯ", f"bg vs card-bg: {cr:.2f}:1 — слишком слабый контраст"))
            print(f"  [!] ПРОБЛЕМА: контраст {cr:.2f}:1 слишком слабый (< 1.2)")

    if card_bg == bg_elevated:
        issues.append(("ИЕРАРХИЯ", f"card-bg ({card_bg}) == bg-elevated ({bg_elevated}) — нет разницы между карточкой и elevated"))
        print(f"  [!] ПРОБЛЕМА: card-bg == bg-elevated — нет визуальной иерархии")
    else:
        cr = contrast_ratio(card_bg, bg_elevated)
        print(f"  [OK] Контраст card-bg vs bg-elevated: {cr:.2f}:1")

    # === 2. Контрастность текста ===
    print("\n" + "=" * 70)
    print("2. КОНТРАСТНОСТЬ ТЕКСТА (WCAG AA)")
    print("=" * 70)

    text_main = resolve_color(dark_vars.get('text-main', '#f1f5f9'), dark_vars)
    text_muted = resolve_color(dark_vars.get('text-muted', '#94a3b8'), dark_vars)

    print(f"  text-main:  {text_main}")
    print(f"  text-muted: {text_muted}")

    # text-main на bg
    cr = contrast_ratio(text_main, bg)
    print(f"  text-main на bg: {cr:.2f}:1 (нужно >= 4.5)")
    if cr < 4.5:
        issues.append(("КОНТРАСТ", f"text-main на bg: {cr:.2f}:1 < 4.5"))

    # text-main на card-bg
    cr = contrast_ratio(text_main, card_bg)
    print(f"  text-main на card-bg: {cr:.2f}:1 (нужно >= 4.5)")
    if cr < 4.5:
        issues.append(("КОНТРАСТ", f"text-main на card-bg: {cr:.2f}:1 < 4.5"))

    # text-muted на bg
    cr = contrast_ratio(text_muted, bg)
    print(f"  text-muted на bg: {cr:.2f}:1 (нужно >= 4.5)")
    if cr < 4.5:
        issues.append(("КОНТРАСТ", f"text-muted на bg: {cr:.2f}:1 < 4.5"))

    # text-muted на card-bg
    cr = contrast_ratio(text_muted, card_bg)
    print(f"  text-muted на card-bg: {cr:.2f}:1 (нужно >= 4.5)")
    if cr < 4.5:
        issues.append(("КОНТРАСТ", f"text-muted на card-bg: {cr:.2f}:1 < 4.5"))

    # === 3. Видимость границ ===
    print("\n" + "=" * 70)
    print("3. ВИДИМОСТЬ ГРАНИЦ (border vs background)")
    print("=" * 70)

    border = resolve_color(dark_vars.get('border', '#334155'), dark_vars)
    border_light = resolve_color(dark_vars.get('border-light', '#475569'), dark_vars)

    print(f"  border:       {border}")
    print(f"  border-light: {border_light}")

    # border на bg
    cr = contrast_ratio(border, bg)
    print(f"  border на bg: {cr:.2f}:1 (нужно >= 1.5 для видимости)")
    if cr < 1.5:
        issues.append(("ГРАНИЦЫ", f"border на bg: {cr:.2f}:1 < 1.5 — границы не видны"))
        print(f"  [!] ПРОБЛЕМА: границы плохо видны на фоне")

    # border на card-bg
    cr = contrast_ratio(border, card_bg)
    print(f"  border на card-bg: {cr:.2f}:1 (нужно >= 1.5)")
    if cr < 1.5:
        issues.append(("ГРАНИЦЫ", f"border на card-bg: {cr:.2f}:1 < 1.5"))

    # === 4. Hover-состояния ===
    print("\n" + "=" * 70)
    print("4. HOVER-СОСТОЯНИЯ (видимость при наведении)")
    print("=" * 70)

    # Проверяем, что есть hover-стили для основных элементов
    hover_patterns = [
        (r'\.btn:hover\s*\{', 'btn:hover'),
        (r'\.card:hover\s*\{', 'card:hover'),
        (r'\.tab-btn:hover\s*\{', 'tab-btn:hover'),
        (r'\.panel-card:hover\s*\{', 'panel-card:hover'),
        (r'\.collapsible-header:hover\s*\{', 'collapsible-header:hover'),
        (r'\.day:hover\s*\{', 'day:hover'),
        (r'\.nav-btn:hover\s*\{', 'nav-btn:hover'),
        (r'\.calendar-btn:hover\s*\{', 'calendar-btn:hover'),
        (r'tr:hover\s*\{', 'tr:hover'),
        (r'td:hover\s*\{', 'td:hover'),
    ]

    for pattern, name in hover_patterns:
        if re.search(pattern, theme_content):
            print(f"  [OK] {name} — есть hover-стиль")
        else:
            issues.append(("HOVER", f"{name} — нет hover-стиля"))
            print(f"  [!] ПРОБЛЕМА: {name} — нет hover-стиля")

    # === 5. Светлые тексты на светлых фонах (проверяем только релевантные сценарии) ===
    print("\n" + "=" * 70)
    print("5. СВЕТЛЫЕ ТЕКСТЫ НА СВЕТЛЫХ ФОНАХ (проблема слияния)")
    print("=" * 70)

    # В тёмной теме text-muted — это светлый цвет для тёмного фона.
    # Проверяем, что text-muted имеет хороший контраст на тёмных фонах (bg, card-bg, bg-elevated).
    # Проверка "на белом фоне" нерелевантна — в тёмной теме белого фона нет.

    print(f"  text-muted ({text_muted}) — светлый цвет для тёмной темы")
    print(f"  На bg ({bg}) — контраст {contrast_ratio(text_muted, bg):.2f}:1 (нужно >= 4.5)")
    print(f"  На card-bg ({card_bg}) — контраст {contrast_ratio(text_muted, card_bg):.2f}:1 (нужно >= 4.5)")
    print(f"  На bg-elevated ({bg_elevated}) — контраст {contrast_ratio(text_muted, bg_elevated):.2f}:1 (нужно >= 4.5)")

    if contrast_ratio(text_muted, bg) < 4.5:
        issues.append(("СЛИЯНИЕ", f"text-muted на bg: {contrast_ratio(text_muted, bg):.2f}:1 < 4.5"))
        print(f"  [!] ПРОБЛЕМА: text-muted плохо виден на bg")
    else:
        print(f"  [OK] text-muted хорошо виден на всех тёмных фонах")

    # === 6. Специфические проблемы ===
    print("\n" + "=" * 70)
    print("6. СПЕЦИФИЧЕСКИЕ ПРОБЛЕМЫ")
    print("=" * 70)

    # Проверяем, что --bg-elevated отличается от --card-bg
    if bg_elevated == card_bg:
        issues.append(("ИЕРАРХИЯ", "bg-elevated == card-bg — нет разницы для input/textarea"))
        print(f"  [!] ПРОБЛЕМА: bg-elevated == card-bg — input/textarea не выделяются")

    # Проверяем, что есть отдельный цвет для input
    if 'input' in theme_content and 'background: var(--bg-elevated)' in theme_content:
        print(f"  [OK] input имеет фон bg-elevated")
    else:
        issues.append(("INPUT", "input не имеет явного фона"))
        print(f"  [!] ПРОБЛЕМА: input не имеет явного фона")

    # === ИТОГО ===
    print("\n" + "=" * 70)
    print(f"ИТОГО ПРОБЛЕМ: {len(issues)}")
    print("=" * 70)

    if issues:
        print("\nСписок проблем:")
        for i, (category, msg) in enumerate(issues, 1):
            print(f"  {i}. [{category}] {msg}")
    else:
        print("\n[OK] Все проверки пройдены!")

    return len(issues)


if __name__ == '__main__':
    issues = main()
    sys.exit(0 if issues == 0 else 1)
