# DashBridge — краткий план завершения проверок Grafana

Дата: 16 сентября 2026

## Вывод по текущему Test Runner

Контур `pages/test-runner/**` уже является не просто заготовкой для скриншотных сравнений. Он отправляет команды через production-bridge, ждёт подтверждение команды, целевой query lifecycle и устойчивость renderer, при первом включении набора настроек делает повторный Refresh для проверки сохранения состояния, а затем требует семантически доказанный reset. Если reset или сценарий по таймауту небезопасен, оставшиеся тесты URL помечаются `NOT RUN`, а не продолжаются в загрязнённом состоянии.

Это уже покрывает основной риск для изменений графика: не только «изменились пиксели», а цепочку «команда → refresh → ответ панели → renderer → инвариант → повторный refresh → восстановление». Матрица включает заливку, толщину линий, легенду, видимость серий, CPU Idle → Load, RAM → % Used, фильтр серий и порог. Для них есть lifecycle-, pairwise- и high-risk сценарии.

Скриншоты в текущем Runner — сильное диагностическое доказательство: захват вкладки, crop с DPR, canvas/pixel/hash evidence, forensic escalation, OPFS-спул, дедупликация и потоковый экспорт. Но это не проверка пользовательской функции «сохранить/скопировать снимок панели». В реестре feature scenarios нет самостоятельной семьи для prepared capture, download/copy, итоговых размеров PNG, двух транспортов и failure cleanup.

## Что уже можно считать покрытым

| Область | Статус | Что доказывается |
|---|---|---|
| Удаление заливки | Есть | Состояние серий и визуального style owner после ON/OFF и reset; не только canvas. |
| Толщина линий | Есть | Изменение и возврат ширины renderer series. |
| Легенда и скрытие серий | Есть | Перемещение/восстановление легенды, видимость выбранной серии, устойчивость комбинаций. |
| Трансформации и фильтр | Есть | Целевой запрос, видимые calculated labels, intentional empty, возврат нативных данных. |
| Порог | Есть | Установка и снятие, включая совместную работу с визуальными изменениями и фильтром. |
| Повторное применение и reset | Есть | Persistence proof на втором refresh, чистая финальная база или карантин URL. |
| Диагностические PNG | Есть | DPR-aware crop, hashes/pixels, forensic evidence, bounded OPFS export. |
| Пользовательский panel capture | Нет как сценарий Runner | Функция существует в production, но не входит в `E2E_FEATURE_REGISTRY`. |

## Подтверждённая карта screenshot capture

Прямой Grafana: действие в меню панели → `runPanelCapture()` в MAIN world → при необходимости `prepareNativePanelCapture()` → DOM event `dashbridgePanelCaptureRequest` → isolated content bridge → guarded background `captureVisibleTab`/download → correlated `dashbridgePanelCaptureResult` → `finally` восстанавливает DOM, стили, renderer, scroll, host и capture mode.

DashBridge iframe: действие в Grafana iframe → `postMessage(dashbridgePanelCaptureRequest)` к родителю → iframe message controller проверяет source, origin и текущую panel-card → `DashBridgeCapture.capturePanel()` → crop/output → correlated result обратно в iframe → `finally` восстанавливает card, scroll и layout.

Production source уже содержит важные защиты: user activation для прямого захвата, проверку доверенного sender для background download/capture, точную валидацию source/origin для iframe, ограничение размеров 100…4096, DPR crop, fallback copy → download, защиту от параллельных захватов и `finally`-restore. Это source-level наблюдение, а не live-подтверждение в конкретной Grafana.

## Минимальный следующий slice: Capture profile

Добавить в Test Runner отдельную feature family `panelCapture`, не смешивая её с диагностическими изображениями. Ей нужен собственный результат capture-команды: stage, requestId, output action, prepared mode, фактические width/height, fallback и семантический snapshot до/после restore. Не надо хранить полный PNG в памяти: сохранять его через уже существующий OPFS spool как отдельный content-addressed asset.

Первый набор сценариев должен быть небольшим и детерминированным.

| ID | Сценарий | Критерий PASS |
|---|---|---|
| C1 | Direct Grafana, обычное «Сохранить» | При user gesture получен correlated success; crop не пуст; native panel DOM/scroll/styles/renderer совпали с baseline. |
| C2 | Direct Grafana, prepared «Сохранить» 1000×520 | PNG декодируется ровно в 1000×520; temporary frame/anchor/capture mode отсутствуют после результата; baseline восстановлен. |
| C3 | Direct Grafana, «Копировать» | Успех Clipboard либо явный `fallback: download`; отсутствие fallback без ошибки — FAIL. |
| C4 | DashBridge iframe, обычное «Сохранить» | Корректная relay-цепочка, requestId, output и cleanup card/layout/scroll. |
| C5 | DashBridge iframe, prepared «Сохранить» | Точный размер, корректный DPR crop, cleanup и возврат iframe layout. |
| C6 | Ошибка crop/output | Инъецированная контролируемая ошибка приводит к result с stage/error и к доказанному restore; последующие capture tests на URL не запускаются, если baseline не доказан. |
| C7 | Timeout/навигация/переключение tab | Захват отменяется как `capture-target-changed` или timeout; не создаёт ложный success; cleanup обязателен. |

C1–C5 должны проверять оба renderer: хотя бы один uPlot dashboard и один legacy Flot dashboard. Для CPU/RAM/threshold достаточно включить по одному representative panel в prepared C2/C5, чтобы подтвердить reflow и overlay repaint в capture geometry; не нужно размножать всю визуальную матрицу на каждый capture action.

## Профили запуска

**Fast smoke.** Один стабильный direct uPlot URL. A1–A9, H1_1 (заливка), H4_1 (видимость), H8_1 (порог), C1 и C2. Цель — быстро обнаружить поломку injection, базового визуального перехода или capture restore.

**Full lifecycle.** Нынешняя полная H-матрица для заранее подготовленных CPU/RAM/dashboard URLs плюс C1–C3. Цель — regression coverage визуальных и data-path функций; избегать случайного выбора панели по title.

**Capture compatibility.** Direct uPlot, direct Flot/Grafana 10.1.10, DashBridge iframe uPlot, DashBridge iframe Flot. На каждом: C1, C2, один copy/fallback и проверка restore. Это не должна быть матрица всех feature combinations.

**Failure/transport.** Только тестовые controlled failure hooks: crop error, download rejection, Clipboard rejection, timeout, active-tab switch, loading navigation, wrong iframe source/origin/requestId. Никаких реальных пользовательских PNG или сетевых данных в артефакте.

## Условия остановки и доказательства

После таймаута, неудачного cleanup или недоказанного baseline URL немедленно карантинируется. Все оставшиеся capture tests получают `NOT RUN` с причиной, а не FAIL-каскад. Для capture это особенно важно: временный frame либо перемещённый node способны исказить следующие assertions.

PASS capture-сценария должен включать: accepted request с ожидаемым action/prepared; результат с тем же requestId; non-empty PNG; для prepared — точные dimensions; отсутствие временных marker/frame/anchor/classes; восстановленные DOM position, inline styles, scroll и renderer geometry; отсутствие DashBridge runtime error. Визуальный hash полезен как evidence, но не является единственным verdict.

В экспорт попадать должны только минимальные метаданные, normalized diagnostics и хэш/OPFS reference PNG. Исключить raw network payloads, cookies, credentials, request headers и данные clipboard. Существующие OPFS, Web Locks и streaming export можно переиспользовать без новой in-memory коллекции изображений.

## Порядок реализации и оптимизации

Сначала выделить capture scenario adapter, который вызывает production transport, а не повторно реализует MAIN-world логику. Затем добавить C1–C5 и только после их стабильного прохождения failure hooks C6–C7. После этого добавить один совместный prepared case с threshold и один с legacy Flot.

Только после работающего Capture profile имеет смысл оптимизировать Runner: вынести общие command/result correlation и baseline/restore assertions в маленькие adapters, оставить `test-runner-transitions.js` владельцем визуальной матрицы, а capture в отдельном файле. Не разделять compatibility-heavy production runtime и не дублировать runtime manifest: Test Runner должен продолжать проходить через тот же `ensureEarlyGrafanaRuntimeForUrl()` и тот же production capture API.

## Статическая проверка в ходе обзора

Запущен `npm run test:unit` без live Grafana. Большая часть набора, включая test-runner, capture layout, background GUI capture и iframe controller contracts, проходит. Итоговая команда завершилась с двумя существующими несоответствиями за пределами самого Runner: `grafana_panel_transport_scope_behavior.js` (9 transport cases) и `grafana_runtime_manifest_behavior.js` (ожидание старого manifest без `grafana-panel-data-transforms-runtime.js`). Это следует исправить или согласовать отдельно до использования полного unit-suite как release gate; live Grafana E2E в ходе данного обзора не запускался.

## Практический результат

Сейчас разумно не переписывать Test Runner. Нужна узкая достройка: превратить уже существующий production panel capture в отдельную тестируемую feature family, сохранить текущую семантическую transition-модель и добавить четыре compatibility surfaces. После этого у Runner появится честная проверка всех ключевых Grafana-функций: визуальные ON/OFF изменения, data transforms/filtering, фон/заливка, восстановление и реальный save/copy screenshot workflow.
