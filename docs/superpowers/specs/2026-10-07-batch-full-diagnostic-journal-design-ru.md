# Полный диагностический журнал Batch

Дата: 2026-10-07  
Статус: утверждено пользователем, перед реализацией

## Результат для пользователя

Batch сохраняет текущий короткий журнал на странице и, при включённой настройке
`batchDetailedLogging`, добавляет в каждый ZIP полный причинный журнал
`batch-debug.jsonl`. Журнал должен позволять восстановить последовательность от
создания временной вкладки до сохранения PNG или отказа readiness/capture.

## Владелец и границы

Единственный владелец журнала — `BatchOperationController`. Loader и capture
получают узкий callback `record(event)` и не знают о ZIP, storage или UI.
События из Grafana MAIN runtime читаются через существующие диагностические
снимки; второй interceptor и второй lifecycle не создаются.

Потребители: Batch main run, Batch Series run, `batch-panel-loader.js`,
`grafana-panel-capture.js` только через переданный callback. Обычная Grafana,
DashBridge iframe, Popup и Recorder не получают обязательную зависимость от
Batch-журнала.

## Настройка

Добавляется sync-настройка `batchDetailedLogging`, первоначально включённая.
При `true` ZIP содержит `batch-debug.jsonl`; при `false` файл не создаётся.
Короткий UI-лог, `manifest.json` и `errors.txt` не зависят от настройки.

## Формат события

Каждая строка — самостоятельный JSON-объект:

```json
{
  "seq": 148,
  "at": "2026-10-07T15:02:11.431Z",
  "elapsedMs": 1842,
  "runId": "...",
  "jobId": "main-panel-6-range-1",
  "panelId": "6",
  "panelTitle": "Memory",
  "stage": "readiness",
  "event": "waiting",
  "requestedUrl": "...",
  "actualUrl": "...",
  "details": {}
}
```

Порядок событий определяется `seq`; время и elapsed используются для анализа
гонок и долгих ожиданий.

## Минимальный каталог событий

- run: started, settings, finished, cancelled;
- window/tab: created, acquired, released, closed;
- navigation: requested, updated, loading, complete, canonicalized,
  navigation-rejected, remount, frame-replaced;
- runtime: registration-start, registered, failed, probe;
- tools: apply-start, applied, refresh-start, refresh-complete,
  refresh-unavailable, failed;
- panel: lookup-start, candidate, found, not-found, geometry;
- readiness: check, waiting, loading, no-data, data-settled, ready, timeout;
- network: snapshot, request-start, request-complete, error, scope-mismatch;
- renderer: snapshot, points-found, canvas-painted, empty;
- capture: started, layout-check, crop, png-exported, failed;
- archive: png-added, report-added, finished;
- error: unexpected, cleanup-failed.

## MAIN snapshot

Журнал использует существующие `__dashbridgeDataInterceptorDiagnostic` и
`__dashbridgePanelToolsVisualMetadata`. В журнал не записываются cookies,
authorization headers, токены, тела datasource-ответов и бинарные PNG-данные.
URL сохраняется для диагностики навигации.

## ZIP

При включённом режиме:

```text
batch-debug.jsonl
manifest.json
errors.txt       # только при ошибках
*.png
```

Ограничение размера журнала не вводится. Запись выполняется в памяти одного
запуска и сериализуется один раз при добавлении отчёта в архив. Если операция
отменена, журнал сохраняется только если ZIP уже формируется; обычный UI-лог
остаётся доступным всегда.

## Проверки

Нужны regression-тесты на:

1. порядок и обязательные поля событий;
2. включённый/выключенный `batchDetailedLogging`;
3. события успешного PNG;
4. panel-not-found, empty-data, timeout, navigation-rejected и capture-failed;
5. snapshot data-runtime без секретов и тел ответов;
6. main и Series workflows;
7. отсутствие влияния на обычную Grafana и существующий capture API.

