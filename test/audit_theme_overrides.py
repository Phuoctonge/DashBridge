# -*- coding: utf-8 -*-
"""
Визуальный аудит: находит все захардкоженные цвета в HTML-файлах
и проверяет, что для каждого проблемного селектора есть переопределение в css/theme.css.
"""
import re
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_FILES = ['dashbridge.html', 'popup.html', 'options.html', 'worklog.html', 'batch.html']
THEME_CSS = os.path.join(WORKSPACE, 'css/theme.css')

# Цвета, которые точно нужно переопределять в тёмной теме
NEEDS_OVERRIDE = {
    '#fff', '#ffffff', '#f8f9fa', '#fdfdfd', '#fafbfc', '#f4f5f7',
    '#f1f5f9', '#f8fafc', '#ebecf0', '#dfe1e6', '#e2e8f0',
    '#6b778c', '#172b4d', '#1e293b', '#0f172a', '#334155', '#475569',
    '#64748b', '#94a3b8', '#a5adba',
    '#deebff', '#b3d4ff', '#0747a6', '#0052cc',
    '#e3fcef', '#006644', '#22c55e',
    '#ffebe6', '#bf2600', '#ff5252', '#fff8f8',
    '#fef2f2', '#fee2e2',
}

def find_problem_selectors(html_path):
    """Находит селекторы с захардкоженными цветами, которые нужно переопределить."""
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()

    style_blocks = re.findall(r'<style[^>]*>(.*?)</style>', content, re.DOTALL)

    problems = []  # (selector, color)

    for block in style_blocks:
        rules = re.findall(r'([^{]+)\{([^}]+)\}', block)

        for selector, props in rules:
            selector = selector.strip()
            # Пропускаем составные селекторы с запятой
            for sel in selector.split(','):
                sel = sel.strip()
                # Пропускаем :root, @media, @keyframes
                if sel.startswith(':root') or sel.startswith('@') or sel.startswith('*'):
                    continue
                # Пропускаем псевдоклассы для базовых элементов
                if sel in ('html', 'body'):
                    continue

                # Ищем цвета в свойствах
                for match in re.finditer(r'#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\b|rgba?\([^)]+\)', props):
                    color = match.group(0).lower()
                    if color in NEEDS_OVERRIDE:
                        problems.append((sel, color))

    return problems

def get_dark_selectors(theme_content):
    """Извлекает все селекторы из секций [data-theme="dark"]."""
    # Находим все правила внутри [data-theme="dark"] ...
    dark_rules = re.findall(r'\[data-theme="dark"\]\s+([^{]+)\s*\{', theme_content)

    selectors = set()
    for rule in dark_rules:
        for sel in rule.split(','):
            sel = sel.strip()
            # Извлекаем последний класс/элемент из селектора
            # Например: "[data-theme="dark"] .auth-dot" -> ".auth-dot"
            # "[data-theme="dark"] [style*="..."]" -> "[style*="..."]"
            selectors.add(sel)

    return selectors

def main():
    print("=" * 70)
    print("ВИЗУАЛЬНЫЙ АУДИТ: захардкоженные цвета в HTML")
    print("=" * 70)

    with open(THEME_CSS, 'r', encoding='utf-8') as f:
        theme_content = f.read()

    dark_selectors = get_dark_selectors(theme_content)
    print(f"\n[*] Найдено селекторов в [data-theme=\"dark\"]: {len(dark_selectors)}")

    total_issues = 0

    for html_file in HTML_FILES:
        html_path = os.path.join(WORKSPACE, html_file)
        if not os.path.exists(html_path):
            continue

        problems = find_problem_selectors(html_path)

        # Группируем по селекторам
        by_selector = {}
        for sel, color in problems:
            if sel not in by_selector:
                by_selector[sel] = set()
            by_selector[sel].add(color)

        print(f"\n=== {html_file} ===")
        print(f"  Проблемных селекторов: {len(by_selector)}")

        # Проверяем, какие селекторы не переопределены
        unfixed = []
        for sel, colors in by_selector.items():
            # Проверяем, есть ли этот селектор (или его часть) в dark_selectors
            sel_base = sel.split(':')[0].split(' ')[-1] if ' ' in sel else sel
            if sel not in dark_selectors and sel_base not in dark_selectors:
                unfixed.append((sel, colors))

        if unfixed:
            print(f"  [!] НЕ ПЕРЕОПРЕДЕЛЕНЫ ({len(unfixed)}):")
            for sel, colors in unfixed[:15]:
                print(f"      {sel}: {', '.join(list(colors)[:3])}")
            if len(unfixed) > 15:
                print(f"      ... и ещё {len(unfixed) - 15}")
            total_issues += len(unfixed)
        else:
            print(f"  [OK] Все селекторы переопределены")

    print("\n" + "=" * 70)
    print(f"ИТОГО непереопределённых селекторов: {total_issues}")
    print("=" * 70)

    return total_issues

if __name__ == '__main__':
    issues = main()
    sys.exit(0 if issues == 0 else 1)
