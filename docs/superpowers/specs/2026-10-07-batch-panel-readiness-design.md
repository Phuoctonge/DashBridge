# Batch panel readiness and capture reliability — Design

> **Статус на 2026-10-13:** Основной путь реализован и позднее уточнён. Для ordinary panel нужна подтверждённая визуализация и завершение наблюдаемых запросов; одной positive outer geometry недостаточно. Native Table readiness, compact geometry и Series navigation guards добавлены в `a2de993`, `efaa0fa`, `6ad4460`, `7dbf2b4`. Ниже — исходный дизайн; современный контракт проверять по architecture.
> Действующее поведение: [архитектура](../../architecture.md), команды и проверки: [разработка](../../development-guide.md), незавершённые направления: [roadmap](../../roadmap.md).

## Goal

Сделать Batch устойчивым к штатной канонизации URL и медленной отрисовке Grafana: не пропускать ещё не готовую панель, но и не блокировать обычный снимок из-за необязательных диагностических признаков. При этом сохранить преобразования CPU/RAM/vCPU, Series-фильтры, отмену операции и текущие режимы Direct Grafana/DashBridge.

## Context and observed failure

Старая Batch-версия после `tab.status === 'complete'` проверяла фактический DOM панели, loader и геометрию. Текущая версия дополнительно требует строгого соответствия `expectedUrl` и фактического URL, а затем использует data/render evidence. Grafana штатно меняет epoch-время `from/to` на ISO-время и добавляет служебный `_t`. В логе коллеги после этого появляется `navigation-rejected`, после чего управление переходит к следующей панели до появления графика.

Это не означает, что все современные проверки нужно удалить. Generation, отмена, bounded timeout, cleanup и специальные проверки для активных преобразований защищают от гонок и белых снимков. Проблема — в том, что необязательные сигналы становятся фатальными для обычной панели.

## Design principles

1. Источником истины для обычного снимка является фактическая панель в текущем document: её identity, видимость, loader и геометрия.
2. URL сравнивается по устойчивой identity страницы, а не побайтово.
3. Data evidence применяется только когда выбранный инструмент действительно меняет данные или требует подтверждения результата.
4. Готовность панели и успешность получения PNG — разные состояния и разные диагностические этапы.
5. Все ожидания bounded, отменяемы и очищаются владельцем одной попытки.
6. Batch-specific изменения не меняют общий renderer-код Direct Grafana и DashBridge iframe.

## Proposed lifecycle

Для каждой работы Batch loader использует состояния:

```text
queued → navigating → document-ready → panel-found → rendering → ready
                                                   → render-timeout
ready → capturing → captured
                 → capture-failed
```

Дополнительные конечные состояния: `navigation-failed`, `wrong-document`, `panel-not-found`, `cancelled`.

`ready` означает, что получена валидная геометрия панели и разрешено начинать capture. `captured` означает, что capture API вернул изображение с валидными размерами и запись передана архивному контроллеру.

## Navigation identity

В `pages/batch/batch-panel-loader.js` вводится нормализованный identity объект:

```js
{
    origin,
    route,          // /d/... или /d-solo/...
    dashboardUid,   // когда доступен из route
    panelId         // numeric и panel-N приводятся к одной форме
}
```

Из identity исключаются `from`, `to`, `_t`, порядок query-параметров и служебные DashBridge-параметры. Сравнение результатов:

- identity совпадает — продолжить ожидание;
- URL канонизирован Grafana — продолжить и залогировать `canonicalized-url`;
- dashboard/route/панель не совпадают — завершить `wrong-document`;
- URL невалиден — завершить `unsupported-url`.

Полный expected и actual URL сохраняются только в bounded diagnostic log; они не становятся условием успеха.

## Readiness policy

### Ordinary panel

Обычная панель считается готовой после всех условий:

- вкладка завершила навигацию;
- identity текущего документа соответствует требуемой панели;
- панель найдена через существующий `grafana-dom` и fallback для single-panel route;
- видимый loader/spinner отсутствует;
- ширина и высота панели больше минимального порога;
- геометрия стабильна в коротком bounded settle-window.

Не являются обязательными условиями `request-complete`, наличие uPlot/Flot points, SVG path или наличие конкретного interceptor event. Это сохраняет поддержку table/stat/no-data/canvas/plugin панелей.

### Transform panel

Если включены `invertIdle`, `convertMemToUsed`, `forceMemByteUnit`, `trimDomainEnabled`, `seriesQueryFilterEnabled`, `cpuCapacityFilterEnabled`, threshold или активный Series/legend filter, добавляется специальная готовность:

- применённый инструмент подтверждён своим diagnostic state;
- datasource/interceptor завершил relevant request либо зафиксирован допустимый `filtered_empty`;
- renderer/data evidence соответствует выбранному типу преобразования.

Невозможность применить Refresh не блокирует первый валидный render для single-panel/view routes, если инструмент не требует обязательного повторного запроса.

## Capture contract

Текущий `loadPanel` сохраняет совместимый результат геометрии для существующих контроллеров. Диагностика дополняется этапами:

```text
[Batch ready] panelId=... identity=...
[Batch capture-start] panelId=...
[Batch capture-success] panelId=... width=... height=...
[Batch capture-failed] panelId=... reason=...
```

Проверка актуальности вкладки внутри `js/shared/grafana-panel-capture.js` также использует ту же устойчивую identity, а не `tab.url === expectedUrl`. Иначе loader сможет принять штатно канонизированный Grafana URL, но capture-фаза снова отклонит его по исходной строке URL.

`batch-operation-controller.js` различает:

- loader не достиг `ready`;
- панель готова, но `captureGrafanaPanelImage` не вернул PNG;
- PNG получен, но архивная запись не выполнена.

Это исключает ложное сообщение «панель пустая», когда проблема произошла уже на этапе screenshot/archive.

## Compatibility boundaries

Изменяются только Batch navigation/readiness/diagnostic consumers и их tests. Не изменяются:

- `js/content/grafana-visual-engine.js`;
- общий Grafana panel tools runtime;
- Direct Grafana lifecycle;
- DashBridge iframe lifecycle;
- manifest permissions и host access.

Series Batch использует тот же loader, но обязан сохранить previous-series switching и legend filter. Main Batch обязан сохранить partial ZIP result и cancellation.

## Verification requirements

Перед реализацией обновить GitNexus index и проверить upstream impact для `createBatchPanelLoader`, `captureGrafanaPanelImage` и потребителей batch operation. Реализация начинается с failing behavior tests для:

1. epoch → ISO canonicalization in loader and capture;
2. `_t` and query-order changes in loader and capture;
3. wrong dashboard/panel rejection;
4. delayed panel mount and white/loader state;
5. ordinary panel without data interceptor;
6. transform readiness and filtered-empty;
7. refresh-unavailable fallback;
8. separate capture failure after `ready`;
9. stale generation result, abort and timeout cleanup;
10. Main and Series partial result handling.

Required checks after implementation: module boundaries, dependency contracts, targeted Node behavior tests, Python smoke tests, full `test:all`, `git diff --check`, GitNexus `detect-changes`, and live direct/iframe Grafana checks for uPlot and Flot where available.

## Explicit non-goals

- Полный откат к legacy Batch-коду.
- Изменение общего поведения Refresh в обычной Grafana.
- Автоматическое ожидание бесконечной загрузки datasource.
- Признание любой канонизации URL ошибкой.
- Переписывание panel DOM/runtime ради одной Grafana.
