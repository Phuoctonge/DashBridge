# Политика отображения функций панели по host Grafana

> **Статус на 2026-10-13:** Основная host policy реализована в settings/analysis/shared modal и consumers. Ниже сохранён исходный дизайн; функция меняет видимость controls, без автоматического включения transforms. Полный live acceptance всех комбинаций не заявляется.
> Действующее поведение: [архитектура](../../architecture.md), команды и проверки: [разработка](../../development-guide.md), незавершённые направления: [roadmap](../../roadmap.md).

## Статус

Исходный статус: проект согласован пользователем для review перед implementation plan.

## Цель

Сделать отображение функций CPU/RAM/Load совместимым с разными Grafana:

- сохранить текущую классификацию по названиям для `mon-dc.mos.ru`;
- для других Grafana показывать полный набор функций;
- добавить явный переключатель, отключающий ограничение по названию для всех host;
- не использовать ID панели для определения её семантического типа.

## Пользовательский результат

В Options появится настройка «Показывать полный набор функций для всех Grafana».
Она выключена по умолчанию. При выключенной настройке host `mon-dc.mos.ru`
использует названия CPU, RAM и Load из существующих Options. Все остальные
Grafana показывают полный набор функций. При включённой настройке полный набор
показывается везде.

Функции включают существующие преобразования и фильтры, в частности:

- CPU Idle → Load;
- RAM → `% Used`;
- фильтр Load Average по vCPU;
- остальные уже поддерживаемые panel tools.

## Границы и контекст исполнения

### Extension Options

Настройка хранится вместе с остальными Grafana settings и проходит существующую
нормализацию, импорт и экспорт конфигурации.

### Isolated content runtime

Content runtime получает текущие настройки и публикует их в существующем
контракте анализа Grafana. Host определяется из текущего HTTP(S) URL. В policy
используется только hostname `mon-dc.mos.ru`; query-параметры, dashboard UID,
orgId, временной диапазон, refresh и panelId не меняют policy.

### Grafana MAIN runtime

Panel settings modal запрашивает классификацию панели через общий анализатор и
показывает либо type-specific controls, либо полный набор controls. Уже
сохранённые boolean-настройки runtime продолжают применяться к конкретной
панели и не получают новую автоматическую привязку по названию.

## Данные и обратная совместимость

Новый ключ настройки имеет значение по умолчанию `false`. Отсутствие ключа в
старом storage/import трактуется как `false`, поэтому старые конфигурации не
меняют поведение `mon-dc.mos.ru`.

Существующие ключи остаются без переименования:

- `grafanaCpuPanelTitle`;
- `grafanaMemPanelTitle`;
- `grafanaLoadPanelTitle`.

Они используются только в title-gated режиме для `mon-dc.mos.ru`.

ID панели продолжает использоваться как ключ состояния конкретной панели,
маршрута и сохранённого профиля. Он не используется как CPU/RAM/Load
classifier.

## Policy API

Будет добавлен чистый helper в существующий settings/analysis boundary:

```text
getPanelFunctionVisibilityPolicy({ url, settings })
  -> { mode: 'title-gated' | 'all', host: string }
```

`classifyPanelTitle(value, settings, policy)` сохраняет текущую точную
классификацию в `title-gated` режиме и возвращает доступный полный набор в
`all` режиме. UI не дублирует host-проверку.

Полный набор не должен подменять сохранённые значения controls: он меняет только
видимость/доступность полей, а не значения и не применяет функции автоматически.

## Обработка ошибок и безопасность

- Невалидный или отсутствующий URL использует безопасный legacy-режим
  (`title-gated`), а не полный набор.
- Сравнение host выполняется через `URL`, без substring-проверок, чтобы
  `evil-mon-dc.mos.ru` не совпал с разрешённым host.
- Новая настройка не расширяет host permissions и не меняет MAIN/isolated
  trust boundary.
- Существующие ограничения mutually exclusive для response filters сохраняются.

## Файлы и владельцы

- `js/shared/grafana-settings.js` — schema/defaults/normalization/import keys.
- `pages/options/options.html` — control and explanatory text.
- `pages/options/options.js` — load/save binding.
- `js/shared/grafana-panel-analysis.js` — policy-aware classification.
- `js/shared/grafana-panel-settings-modal.js` — rendering full/type-specific
  controls.
- `js/content/content.js` — publishing normalized policy settings to the
  existing analysis-settings dataset/event.
- Relevant migration/config-transfer tests and panel-analysis tests.

Не менять Batch rules, Batch capture lifecycle или screenshot readiness в рамках
этой функции.

## Проверки

Обязательные поведенческие сценарии:

1. Missing new key + `mon-dc.mos.ru` + `CPU Usage` → CPU controls.
2. `mon-dc.mos.ru` + nonmatching title → title-specific controls hidden.
3. Other host + arbitrary title → all controls.
4. Any host + explicit full-functions setting → all controls.
5. `panelId` changes without title/policy changes → classification unchanged.
6. Old import/export payload without the new key round-trips safely.
7. Invalid URL/host cannot enable full mode accidentally.

После реализации:

- `node scripts/check-module-boundaries.js`;
- `node scripts/check-dependency-contracts.js`;
- targeted Node tests for settings, panel analysis and modal rendering;
- `git diff --check`;
- полный `npm run test:all` с явным `DASHBRIDGE_PYTHON`, если среда доступна.

Для MAIN/renderer изменения дополнительно требуется доступная browser smoke
проверка direct Grafana и DashBridge iframe. Без live Grafana результат будет
помечен как частично проверенный.

## Открытые решения, закрытые этим дизайном

- Default: title-gated для `mon-dc.mos.ru`, all для остальных host.
- Full mode не включает функции автоматически; он только показывает controls.
- Query-параметры и panel ID не участвуют в host policy.
- Новая настройка глобальная, без отдельной таблицы host overrides.
