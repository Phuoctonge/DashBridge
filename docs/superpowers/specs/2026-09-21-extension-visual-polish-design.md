# DashBridge Extension Visual Polish Design

> **Статус на 2026-10-13:** Основные Worklog/Options CSS-решения реализованы. Восьмиразмерный sweep и все пользовательские focus состояния остаются отдельным acceptance; зелёный smoke с локальной paused fixture не закрывает внешний iframe autofocus.
> Действующее поведение: [архитектура](../../architecture.md), команды и проверки: [разработка](../../development-guide.md), незавершённые направления: [roadmap](../../roadmap.md).

## Goal

Improve desktop responsive behavior and visual clarity across extension pages from 1024px through 8K, with priority on Worklog, Options, and DashBridge, while preserving existing lifecycle, storage, and Grafana runtime contracts.

## Scope

- Keep all existing page owners and classic-script order.
- Prefer CSS and existing UI controllers; do not create a new runtime module.
- Make scroll ownership explicit for wide tables and long forms.
- Preserve light/dark themes, `uiScale`, modal focus trapping, Escape behavior, and existing extension-page contracts.
- Add browser checks for desktop viewport sizes, horizontal overflow, and key page affordances.
- Defer the two known functional smoke failures to a separate final task.

## Design decisions

1. Worklog keeps a scrollable table rather than collapsing operational columns into unreadable text. The scroll container gets stable scrollbar geometry and contained horizontal overscroll.
2. Options remains a centered form, but gains a wider readable cap on very large desktop viewports so 4K/8K does not produce an unnecessarily narrow column.
3. DashBridge empty/login/error iframe states remain owned by the existing card controller; this pass only adjusts visual affordances and does not alter iframe transport or authentication behavior.
4. The browser matrix is 1024×768, 1280×800, 1366×768, 1440×900, 1920×1080, 2560×1440, 3840×2160, and 7680×4320. Mobile sizes are out of scope.

## Acceptance criteria

- No page-level horizontal overflow at any matrix size.
- Worklog horizontal scrolling is contained inside its table wrapper and does not chain to the document.
- Options remains readable and centered at 4K/8K without changing storage behavior.
- Existing modal/focus browser smoke remains green except for the two explicitly deferred functional failures.
- `node scripts/check-module-boundaries.js`, unit tests, lint, and browser smoke are run after changes.
