# Ревизия документации DashBridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Согласовать документацию с текущим расширением и сохранить причины нестандартных технических решений для последующих изменений.

**Architecture:** Контракты и обоснования принадлежат архитектуре и профильным руководствам. Roadmap содержит незавершённое; планы, specs и аудиты сохраняют дату и отделяют исходное намерение от текущего результата.

**Tech Stack:** Markdown, MV3, MAIN/isolated worlds, Chrome API, Git, Node documentation checker.

**Spec:** Запрос пользователя от 13 октября 2026; [AGENTS.md](../../../AGENTS.md), [архитектура](../../architecture.md), [карта документов](../../README.md).

## Ограничения

- Текущая ветка; checkpoint `663afff` создан до редактирования.
- Изменяются только проектные Markdown-документы; runtime и настройки не меняются.
- Обоснование не заменяет guard и тест. «Единственный вариант» допустим только при доказанном ограничении API.
- Внешние отправки и новые live-прогоны не входят в эту ревизию.
- Импортированные `.agents/skills/` — общие справочники; фактические контракты проекта проверяются по исходникам и профильной документации.

## Задачи

- [x] Прочитать проектные руководства, планы/specs, UX-аудиты и историю; проверить функции, команды и даты по исходникам.
- [x] Согласовать README, development/installer/module guidance и документы интеграций.
- [x] Описать MAIN injection, transport interception, DNR, renderer/DOM, capture, CDP и storage: функция, причина, scope, cleanup, тесты и остаточные ограничения.
- [x] Согласовать текущие статусы планов и roadmap; не превращать исторические ошибки и гипотезы в открытые дефекты.
- [x] Проверить итоговый diff и ссылки, затем сохранить ревизию отдельным коммитом.

Проверка prose и ссылок:

```powershell
node scripts/check-documentation-links.js
git diff --check
```

Для ссылок на runtime дополнительно сверяются `manifest.json`, общий runtime manifest,
владельцы функций и соответствующие behavior/browser tests. Это проверка документации,
а не новый результат `npm run test:all`.
