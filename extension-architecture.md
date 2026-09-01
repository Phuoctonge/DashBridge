# Архитектура DashBridge

> Сверено с версией 2.4.1, исходным кодом и тестами 2026-08-29. Здесь описан
> фактически работающий код; структура и dependency graph повторно проверены
> 2026-08-30. Незавершённые
> направления вынесены в `docs/roadmap.md`, ключевые прежние решения — в
> `docs/history/architecture-decisions.md`.

DashBridge — Chrome MV3-расширение с шестью контурами: инструменты обычной
Grafana, единый дашборд `pages/dashbridge/dashbridge.html`, пакетный экспорт `pages/batch/batch.html`, Jira
worklog, Traffic Recorder и Popup-инструменты для Grafana/Jira/Confluence/TDM.

Основные принципы:

1. Изменение данных и renderer Grafana выполняется в MAIN world.
2. Popup, Batch и DashBridge не дублируют Grafana-runtime.
3. Совместимость определяется фактическим DOM/renderer, а не только версией.
4. Временные изменения панели при снимке всегда восстанавливаются.
5. Наблюдатели, перехватчики и iframe имеют явный lifecycle; постоянного
   polling для панельных функций нет.

## Карта репозитория

```text
manifest.json
├── AGENTS.md                   # Обязательная точка входа для AI-анализа
├── pages/                      # Feature-папки полноразмерных extension pages
│   ├── batch/                  # Пакетный PNG/ZIP: UI и lifecycle-модули
│   ├── dashbridge/             # Единый дашборд: renderer, profiles, time
│   ├── options/                # HTML, CSS и контроллер настроек
│   ├── popup/                  # Основной Popup: HTML, CSS и page-модули
│   ├── recorder/               # Traffic Recorder: HTML, CSS и контроллер
│   ├── shared/                 # Общая тема и окно прогресса extension pages
│   ├── test-runner/            # Живые E2E: UI, probe, suite, report
│   ├── worklog/                # Jira Worklog: HTML, CSS и контроллер
│   └── debug-easter-egg/       # Изолированная пасхалка и замаскированные assets
├── js/background.js            # MV3 service worker
├── js/shared/                  # Контракты, storage, URL, capture
├── js/content/                 # MAIN/isolated runtime сайтов
├── test/                       # Node/Python behavior, browser smoke, probes
├── package.json                # Только dev-анализ: ESLint и Playwright
├── docs/                       # Действующие пояснения и краткая история
└── docs/roadmap.md             # Только актуальный незавершённый roadmap
```

`vendor/jszip.min.js` — сторонняя библиотека; вручную не изменять.

## Контексты и границы доверия

| Контекст | Основные файлы | Ответственность |
|---|---|---|
| Service worker | `js/background.js` | MAIN-регистрация, tab-scoped DNR, downloads, GUI capture, доверенные storage commits. |
| Isolated content world | `content.js`, `grafana-iframe.js` | Мост Chrome API, Confluence, iframe time/crosshair/title и вывод снимка. |
| Grafana MAIN world | Файлы runtime manifest | fetch/XHR, данные, visual state, меню, легенда, threshold, vCPU и подготовка снимка. |
| Extension pages | Popup, Options, DashBridge, Batch, Worklog | UI, команды и долговечное состояние. |
| Внешние сайты | Grafana, Jira, TDM, Confluence | Недоверенные URL, DOM, API и текст. |

MAIN и isolated world не смешиваются. Связь идёт через
`chrome.scripting.executeScript`, DOM `CustomEvent`, `postMessage` между
DashBridge и конкретным iframe либо `chrome.runtime.sendMessage`. Для
`postMessage` задаётся точный target origin; получатель проверяет `origin`, а
DashBridge ещё и `source === iframe.contentWindow`.

## Загрузка

### Статические content scripts

`manifest.json` на `document_start` подключает:

1. `grafana-settings.js`, `grafana-panel-identity.js`,
   `grafana-capture-output.js`, `content.js` и
   `grafana-time-picker-clipboard.js` в isolated world верхнего документа.
   Конкретные функции дополнительно ограничены доменом и сценарием. Clipboard
   time picker активируется только после установки разрешённого Grafana scope
   и выполняет read/write исключительно по клику пользователя.
   Разрешённый Grafana scope хранится в closure isolated world: опубликованный
   в DOM dataset нужен только MAIN UI и не является источником полномочий.
   Capture и изменение общей настройки снимка требуют активного пользовательского
   действия, а service worker повторно проверяет sender host и dashboard route.
2. `grafana-time.js`, `grafana-panel-bootstrap.js`, `grafana-iframe.js` во всех
   фреймах. Iframe-runtime активен только при
   `window.name === 'dashbridge-iframe'`; управляющие сообщения дополнительно
   принимаются только от `window.parent` с точным extension origin. Уникальное
   имя является частью контракта создаваемого DashBridge iframe и не должно
   использоваться сторонними фреймами.

### Grafana MAIN-runtime

Единственный список и порядок принадлежат
`js/shared/grafana-runtime-manifest.js`:

```text
grafana-panel-bootstrap.js
grafana-refresh-policy.js
grafana-legend-selection.js
grafana-capture-output.js
grafana-dom.js
grafana-panel-state.js
grafana-panel-analysis.js
grafana-series-capture.js
grafana-panel-definition.js
grafana-unit.js
grafana-table-report.js
grafana-visual-engine.js
grafana-compact-layout.js
grafana-panel-settings-modal.js
bounded-journal.js
grafana-network.js
grafana-cpu-capacity-filter.js
grafana-panel-tools.js
```

`background.js` регистрирует список через `registerContentScripts` с
`world: 'MAIN'`, `runAt: 'document_start'`, `allFrames: true`. Регистрация
покрывает только хосты из `grafanaIframeDomains` и маршруты `/d/`, `/d-solo/`,
включая Grafana под base path. После установки, запуска или изменения доменов
открытые Grafana-фреймы проверяются и при необходимости дозагружаются.

`grafana-runtime.js` запускает тот же список по явной команде Popup/Batch.
Повторная загрузка обязана быть безопасной: generation/cleanup не допускает
накопления observers и transport wrappers.

### Extension pages

Порядок обычных `<script>` в HTML значим: dependency ставится перед
потребителем. `pages/shared/theme.js` находится в `<head>` до `<body>`, синхронно читает
`localStorage`, затем согласует тему с `chrome.storage.sync`, исключая FOWT.

`theme.js` тем же ранним путём применяет `uiScale`. Общие размеры контролов,
иконок, отступов и читаемых областей принадлежат `pages/shared/theme.css` и задаются в
`rem`; точные размеры capture остаются независимыми CSS-пикселями. Рабочие
страницы реагируют на доступный viewport/container, а не на `screen.width` или
физическое разрешение монитора. DashBridge хранит legacy `33%`/`50%`/`100%`,
но renderer отображает их как семантические spans 12-колоночной CSS Grid.

## Владельцы логики

| Возможность | Владелец | Потребители |
|---|---|---|
| Grafana defaults | `grafana-settings.js` | Popup, Options, DashBridge, content, background. |
| MAIN список/порядок | `grafana-runtime-manifest.js` | Background, Popup, Batch, runner. |
| Bootstrap transform/refresh | `grafana-panel-bootstrap.js`, `grafana-refresh-policy.js` | DashBridge iframe MAIN startup. |
| Запуск runtime | `background.js`, `grafana-runtime.js` | Все Grafana-сценарии. |
| Команда в MAIN | `grafana-command.js`, `grafana-panel-tools-bridge.js` | Popup, Batch. |
| Поиск панели/DOM | `grafana-dom.js` | Tools, capture, visual engine. |
| Live panel state | `grafana-panel-state.js` | Tools, visual engine. |
| Transport adapter | `grafana-network.js` | CPU/RAM, фильтры, diagnostics. |
| Ответ до renderer | `grafana-series-capture.js` | Batch series mode. |
| Определение панели и query signatures | `grafana-panel-definition.js` | Visual engine, panel tools, test runner. |
| Разбор и согласование единиц Grafana | `grafana-unit.js` | Visual engine: axis/panel units, threshold, table report, uPlot/Flot. |
| Чтение Grafana Table | `grafana-table-report.js` | Response frame shape, Visual engine report snapshot. |
| uPlot/Flot visuals | `grafana-visual-engine.js` | Direct Grafana, DashBridge. |
| Настройки панели | `grafana-panel-settings-modal.js` | Direct Grafana, DashBridge. |
| Allowlist легенды | `grafana-legend-selection.js` | Tools, карточки. |
| Load по vCPU | `grafana-cpu-capacity-filter.js` | Transport pipeline. |
| Compact renderer | `grafana-compact-layout.js` | Capture prepare/restore. |
| Crop/PNG/clipboard | `grafana-capture-output.js` | Isolated Grafana, DashBridge. |
| Batch legend | `grafana-legend-engine.js` | Batch. |
| Tab capture/crop | `grafana-panel-capture.js` | Batch/legacy Popup flow. |
| URL/dashboard API | `grafana-url.js`, `grafana-dashboard-api.js` | Batch. |
| Batch presets | `grafana-batch-panel-rules.js` | Batch. |
| Profiles storage | `dashbridge-profile-store.js` | `dashbridge-profile-controller.js`. |
| Profiles UI/lifecycle | `dashbridge-profile-controller.js` | `dashbridge.js`; tab-local selection, cross-tab sync, panel-state checkpoint. |
| DashBridge iframe transport | `dashbridge-frame-controller.js` | `dashbridge.js`; trusted origin, ready state and navigation reset. |
| Входящие сообщения iframe DashBridge | `dashbridge-iframe-message-controller.js` | Проверка source + exact origin, dispatch report/analysis/capture/tools/crosshair и iframe ready/rendered lifecycle. |
| DashBridge time/URL lifecycle | `dashbridge-time-controller.js` | Profile-owned range/refresh, controls, clipboard, theme-aware panel URL, iframe time broadcast and Refresh Off transition. |
| DashBridge panel tools/status | `dashbridge-panel-tools-controller.js` | Нормализация tools, settings modal, correlated title/legend/threshold requests, threshold state and notifications. |
| DashBridge card drag lifecycle | `dashbridge-drag-controller.js` | Drag enable/reset, drop markers, DOM reorder and persisted panel order. |
| DashBridge card/iframe lifecycle | `dashbridge-panel-card-controller.js` | Создание и точечная замена карточек, eager iframe navigation активных панелей, layout-only update, reconciliation и cleanup удаления. |
| Действия карточек DashBridge | `dashbridge-panel-actions-controller.js` | Refresh, pause, fullscreen, удаление, iframe settings и привязка toolbar-кнопок; сохраняет точечный update без общего remount. |
| Верхний UI DashBridge | `dashbridge-page-ui-controller.js` | Header/dropdown, профильные действия, capture и crosshair controls, делегирование setup добавления/transfer и закрытие transient UI по Escape/outside click. |
| DashBridge panel analysis UI | `dashbridge-panel-analysis-controller.js` | CPU/RAM modal, exact iframe/request correlation, retry after iframe readiness and cancel cleanup. |
| Неблокирующие модальные диалоги DashBridge | `dashbridge-modal.js` | Профили, импорт/экспорт, настройки и capture в `dashbridge.js`. |
| URL и идентичность панелей DashBridge | `dashbridge-panel-url.js`, `grafana-panel-identity.js` | Нормализация URL и поиск дублей для добавления, импорта и iframe-настроек. |
| Добавление панелей DashBridge | `dashbridge-panel-addition-controller.js` | Одиночный URL, список ID и dashboard picker; безопасный inventory, дедупликация и применение к активному профилю. |
| JSON transfer панелей DashBridge | `dashbridge-panel-transfer.js`, `dashbridge-panel-transfer-controller.js` | Полный export payload, строгая нормализация import, новые ID, FileReader/download lifecycle и применение результата к профилю. |
| UI сводного отчёта и SLA | `dashbridge-report-ui.js` | Настройка профиля, редактор фраз панели, валидация warning/critical и modal cleanup; состояние передаётся через явные callbacks `dashbridge.js`. |
| Transport сводного отчёта | `dashbridge-report-transport.js` | Ожидание iframe, request ID, timeout/abort и точная корреляция ответа. |
| Orchestration сводного отчёта | `dashbridge-report-controller.js` | SLA панели, параллельный сбор, карточки ошибок, preview и общий live collector Message Test Runner. |
| Аудит сводного отчёта | `dashbridge-report-audit.js` | Чистый анализ переменных, `panel:key`, живых значений и итогового текста без UI и записей. |
| Message Test Runner | `dashbridge-report-test-runner.js` | Детерминированные сценарии всех ветвей рендера и один живой интеграционный прогон активного профиля через общий collector `dashbridge.js`. |
| Снимки DashBridge | `dashbridge-capture.js` | Одиночный save/copy, последовательный ZIP, throttling и восстановление карточки. |
| Версия данных DashBridge | `dashbridge-data-migration.js` | Startup `dashbridge.js`. |
| Import/recovery | `local-state-schema.js` | Options, Worklog, profiles. |
| Local writes | `storage-writer.js` | Profiles, Worklog, Batch. |
| Sync input writes | `sync-input-writer.js` | Частые поля UI. |
| Bounded diagnostics | `bounded-journal.js` | MAIN и test tooling. |
| ZIP/лимиты | `archive-download.js`, `archive-budget.js` | Batch, exports. |
| Batch panel-rules UI | `batch-panel-rules-ui.js` | `batch.js`; editor, validation, delayed persistence and stale-load guard. |
| Batch operation lifecycle | `batch-operation-controller.js` | `batch.js`; cancellation, progress, capture-window ownership and archive helpers. |
| Batch page UI/state | `batch-page-controller.js` | Вкладки, режим панелей, progress UI, темы снимков, нормализация диапазонов и синхронизация полей Main/Series. |
| Batch main run | `batch-main-run-controller.js` | Валидация и последовательный сбор полного dashboard, panel rules, PNG/ZIP manifest и частичный результат через общий operation lifecycle. |
| Batch Series discovery | `batch-series-discovery-controller.js` | Dashboard API/query signatures, временная Grafana-вкладка, ранний MAIN capture, bounded settle/timeout, abort cleanup и fallback `panel-ID`/numeric ID. |
| Batch Series run | `batch-series-run-controller.js` | Group/standalone selection, legend filtering, sequential capture, ZIP manifest, partial result и cleanup discovery tab через общий operation lifecycle. |
| Recorder replay | `recorder-replay.js` | `recorder.js`; step normalization/execution, navigation and network-idle waits. |
| Анализ CPU/RAM | `grafana-panel-analysis.js` | Расчёт, thresholds и clipboard-формат кнопок CPU Usage/Memory. |
| Grafana time | `grafana-time.js` | DashBridge, iframe. |
| Clipboard диапазона | `grafana-time-picker-clipboard.js`, `dashbridge-time-state.js` | Direct Grafana, DashBridge. |
| Theme и UI scale | `pages/shared/theme.js`, `pages/shared/theme.css` | Все extension pages. |
| Проверка обновлений | `update-check.js`, `popup-updates.js` | Popup. |
| Windows install/update | `scripts/Install-DashBridge.ps1` | Отдельный пользовательский процесс, не extension runtime. |

Похожий код остаётся раздельным при разном lifecycle. Например, Batch работает
в отдельном окне для ZIP, а панельные кнопки временно перестраивают одну живую
панель и восстанавливают её в том же document.

## Основные потоки

### Обычная Grafana

```text
document_start MAIN-runtime
  → transport adapters и panel lifecycle
  → installPanelMenu()
  → compact | сохранить PNG | копировать | сохранить в профиль | DashBridge | меню
  → modal settings
  → visual/data transforms только выбранной панели
```

«Сохранить в профиль» открывает выбор существующего профиля и создание нового,
после чего изолированный content-мост передаёт проверенный panel ID фоновому
воркеру. Воркер повторно проверяет домен Grafana и сериализует изменение
`dashbridge_profiles`; повторный URL одной панели не создаёт дубль. Уже открытая
страница DashBridge подписана на изменения профилей в `storage.local`, поэтому
добавленная из Grafana панель сразу попадает в её актуальный массив и renderer.
Идентичность панели задают Grafana origin, base path, UID дашборда, `orgId` и
числовой panel ID. Поэтому `/d/?viewPanel=panel-N` и
`/d-solo/?panelId=N` считаются одной панелью; slug, `var-*`, временной диапазон,
refresh, timezone и тема на идентичность не влияют. Этот же общий контракт
используют все входы добавления в DashBridge: URL вручную, список ID, выбор из
дашборда и кнопка на живой панели Grafana.
Модал выбора профиля рисуется внутри документа Grafana, поэтому содержит
изолированную копию канонических UI-токенов DashBridge и читает общий
`globalTheme`; открытое окно реагирует на смену темы без собственного toggle.
Выбор профиля использует системный `select` с компактной геометрией DashBridge;
disabled-пункты показывают профили, в которых панель уже сохранена.
Кнопка настроек DashBridge — самая правая. Состояние компактного снимка синхронизируется
для всех панелей через `grafanaCompactScreenshot`; panel state нормализует
состояние конкретного графика.

### DashBridge

```text
dashbridge-profile-store.js
  → dashbridge-profile-controller.js
     → dashbridge.js
     ├── dashbridge-renderer.js
     ├── dashbridge-report-transport.js
     ├── dashbridge-report-controller.js
     ├── dashbridge-report-audit.js
     ├── dashbridge-report-test-runner.js
     ├── dashbridge-capture.js
     ├── dashbridge-time-state.js
     ├── dashbridge-time-controller.js
     └── dashbridge-crosshair.js
dashbridge-frame-controller.js
  → dashbridge.js ↔ postMessage конкретного iframe
dashbridge-panel-analysis-controller.js
  → dashbridge.js ↔ выбранный iframe CPU/RAM analysis
dashbridge-panel-tools-controller.js
  → dashbridge.js ↔ настройки, legend/title/threshold ответы конкретного iframe
grafana-iframe.js (isolated) ↔ grafana-panel-tools.js (MAIN)
```

Поддерживаются профили, drag-and-drop, ширина 33/50/100%, высота, fullscreen,
тема iframe `follow`/light/dark, пауза, общий период/refresh, копирование и
вставка диапазона, курсор `line`/`off`, настройки, одиночные снимки и ZIP всех
активных панелей текущего профиля.
Правая легенда адаптивна и не резервирует половину ширины графика.

`Refresh Off` не может быть выражен простым отсутствием query-параметра:
Grafana тогда восстанавливает refresh, сохранённый в dashboard model. Поэтому
DashBridge передаёт намерение `off` во fragment, который не уходит в HTTP, а
ранний `grafana-refresh-policy.js` только в именованном DashBridge iframe
одноразово перехватывает первый same-origin GET определения dashboard и меняет
только `dashboard.refresh`. Остальные запросы, direct Grafana и интервалы,
отличные от Off, проходят без изменений.

Профиль также хранит шаблон сводного сообщения и контекст теста, а панель —
SLA-карточку с источником `graph`/`custom`/`none`, режимом агрегации,
предупредительным и критическим уровнями, шаблоном строки списка и
формулировками. По
команде пользователя `dashbridge.js` параллельно отправляет каждому активному
iframe запрос `collectPanelReportSnapshot`. MAIN-runtime читает видимые серии
uPlot/Flot, а для table-panel — уже отрисованные строки таблицы, и возвращает
коррелированный `panelReportSnapshot`; родитель
проверяет точные `origin`, `source` и iframe до принятия ответа. Timeout,
отсутствие данных, пауза и ошибка конфигурации являются неизвестным результатом,
а не успешным прохождением SLA. Шаблоны обрабатываются как простой текст без
`eval` и HTML-рендеринга.

Message Test Runner сначала прогоняет детерминированные fixtures для полного
каталога переменных, normal/warning/critical/no-threshold, недоступности,
режимов включения, именованных ссылок и 2500 серий. Затем он ровно один раз
получает реальные снимки активного профиля и отдельно проверяет конфигурацию,
каждый snapshot, фразу панели, живые значения и итоговый `compose`. UI явно
маркирует источник каждого сценария как тестовые или реальные данные и
показывает PASS/FAIL/WARN/SKIP, длительность и evidence. Runner ничего не
записывает в storage, а закрытие окна отменяет только принадлежащие ему запросы.

Профильный JSON экспортирует полные объекты панелей, включая `tools`, тему и
паузу. Импорт назначает новые ID, валидирует известные поля и сохраняет
неизвестные совместимые поля; legacy-поля игнорируются без delete-миграций.

Перед чтением профилей `dashbridge-data-migration.js` выполняет идемпотентную
миграцию schema v0→v1: переносит legacy time state в каждый профиль,
нормализует выбранные Grafana settings и включает byte unit для подходящих
legacy memory-панелей. Исходное состояние один раз сохраняется в
`dashbridge_migration_backup_v0_to_v1`; schema marker записывается последним,
поэтому частичный сбой безопасно повторяется при следующем открытии. Модуль,
его script tag, startup-вызов, backup и marker удаляются только вместе после
контролируемого rollout.

Активные панели загружаются сразу: типичный профиль содержит 5–7 графиков, а
отложенная загрузка делала невидимые threshold/данные непредсказуемыми. Пауза
остаётся явным долговременным способом полностью исключить iframe и запросы.

DNR создаётся только для открытых вкладок `pages/dashbridge/dashbridge.html` и разрешённых
Grafana-хостов. Закрытие вкладки удаляет её session rules.

### Фильтр Load Average по vCPU

Статической таблицы VM нет. Для подходящего `/api/ds/query` capacity текущих
`instance` получается в том же datasource и request scope:

```text
node_load1/5/15{... instance=...}
  + count by (instance) (
      node_cpu_seconds_total{... тот же selector ..., mode="user"}
    )
  → instance ↔ vCPU
  → индивидуальный порог = vCPU × coefficient
  → решение по VM
  → helper result удаляется до Grafana renderer
```

Контракты:

- default: коэффициент `0.8`, режим `max`, только Load 1m;
- Load 1m/5m/15m включаются независимо;
- `max` проверяет диапазон, `last` — последнее конечное значение;
- если выбранный Load VM превышен, её выбранные Load-серии остаются группой;
- неизвестный vCPU — fail-open, серия не скрывается;
- запрос без `instance` selector не расширяется до всего datasource;
- helper refId уникален и не попадает в renderer/легенду;
- числовой фильтр и vCPU-фильтр взаимоисключающие;
- переключение вызывает штатный refresh, а не polling.

Один pipeline работает в direct Grafana и `pages/dashbridge/dashbridge.html`.

### Легенда

Visual hide меняет вид существующих рядов. «Удаление неактивных серий» хранит
allowlist полного скрытия: серии, появившиеся после сохранения, не должны сами
добавляться. Нельзя подменять allowlist текущим списком легенды при refresh.

Batch различает дубли occurrence-ключом `name\x00N`. Direct/DashBridge allowlist
и её версия принадлежат `grafana-legend-selection.js`.

### Threshold и уведомления

`thresholdEnabled` управляет линией, `thresholdNotifyEnabled` — уведомлениями.
Уведомления зависят от активного порога, но preference не сбрасывается при
временном выключении линии. Порог за диапазоном удерживается внутри drawable
plot area и получает указатель направления. Direct Grafana показывает toast;
DashBridge получает status конкретной карточки.

Превышение рассчитывается только по видимым сериям. Исторический ключ
`thresholdIncludeHidden` может оставаться в старом профиле, но runtime его
игнорирует; отдельная storage-миграция ради него намеренно не выполняется.

Фильтр отображаемых серий может намеренно удалить все серии: состояние
`filtered_empty`, отсутствие canvas и легенды в этом случае не являются
ошибкой. Сохранённый порог не рисует ложную линию и не сообщает превышение,
пока данных нет. После выключения фильтра `grafana-panel-tools.js` ждёт первый
полный ответ и новый uPlot/Flot renderer, затем повторно применяет порог;
намерение не считается восстановленным, пока threshold engine не определён.
В старом Flot пустой ответ временно удаляет строки легенды, а canvas может
исчезнуть либо остаться пустым без доступного plot.
Явная команда восстановления видимости поэтому остаётся отложенной до первого
полного ответа даже после очистки флага `filtered_empty`; отсутствие легенды до
этого ответа не является ошибкой команды, но следующий renderer обязан
подтвердить восстановление.

### Снимок панели

```text
click в Grafana document
  → скрытие меню и при необходимости подготовка 1000×520
  → перестройка uPlot либо legacy Flot
  → isolated world / родительский DashBridge
  → captureVisibleTab → crop по DPR
  → download PNG либо Clipboard.write
  → finally: восстановление стилей, размеров, renderer и меню
```

Prepared mode сохраняет пропорции и вписывается в viewport. В DashBridge
временно меняются карточка и вложенная панель. Для legacy `.graph-panel`/Flot
обновляются container и plot; это нужно в том числе Grafana 10.1.10.

Copy выполняется максимально близко к клику из сфокусированного Grafana
document. Ошибка capture/crop/download/clipboard также проходит восстановление.

### Popup CPU/RAM

```text
Popup → panel-tools bridge → command → ensure runtime + MAIN executeScript
      → общий transport → idle→load либо Total/Available→% Used
```

CPU и RAM разделяют transport, но не расчёт и шаблоны.
Предупредительный и критический пороги валидируются как пары `0..100`, где
warning строго меньше critical. Если для TOP-3 доступно меньше трёх серверов,
копирование использует построчный шаблон полного списка и не оставляет
неразрешённые placeholders.

### Batch

```text
batch.js
  ├── UI/page state
  ├── batch-panel-rules-ui.js
  ├── batch-operation-controller.js
  ├── panel loader/series selection
  ├── capture utils/runner
  → dashboard API + legend + capture
  → archive budget + JSZip + download
```

Batch использует отдельное окно, ждёт нужную панель, ограничивает PNG/ZIP и
освобождает Blob URL. Перед удалением массового iframe он переводится на
`about:blank`, чтобы освободить контекст.
Пустой whitelist является ошибкой и останавливает запуск; только явный режим
«Все панели» может расширить выбор до полного дашборда.

При нескольких временных диапазонах каждый абсолютный диапазон получает
отдельную читаемую папку ZIP: `01 [26.08] 23h00-23h48` внутри одного дня и
`01 [26.08 23h00] - [27.08 00h48]` при смене даты. Формат использует только
допустимые в Windows символы; относительные Grafana-диапазоны сохраняют
технические значения `from`/`to`, поскольку календарной даты у них нет.

### Worklog, Jira, TDM, Confluence

- Worklog хранит черновики/cache локально; import/recovery идут через schema.
- Jira REST URL и перенос записей проверяются до операции.
- TDM проверяет домен через `url-validation.js` до `executeScript`.
- Confluence активен только для настроенных wiki-доменов. Его синхронный
  observer предотвращает скачок редактора и намеренно не debounce-ится.
- Внешние строки назначаются через DOM API/`textContent` либо экранируются.

### Traffic Recorder

`pages/recorder/recorder.html` владеет жизненным циклом контролируемой вкладки и CDP attach.
Lifecycle-port с heartbeat удерживает service worker доступным для аварийного
detach, если Recorder закрыт или перезагружен.
Обобщённый `scenario-recorder.js` динамически инжектируется только в эту
вкладку и её доступные frames; он не входит в статический all-URL manifest.
Network metadata и bodies собираются через `chrome.debugger`. Каноническим
источником является `network.json`; `traffic.har` строится из него как
совместимое представление, `streams.json` хранит ограниченные WebSocket/SSE/
WebTransport-события, а `bodies/` — проверяемые по SHA-256 тела ответов.
Действия находятся в Chrome Recorder-подобном `flow.json`; канонические
`_dashbridge.locator` и frame metadata требуют трансляции и не являются
drop-in совместимыми с Chrome Recorder. Всё упаковывается JSZip в `.dashflow`
v2 с manifest, окружением, лимитами и показателями полноты. Полный контракт и
границы конвертации описаны в `docs/dashflow-v2.md`.
`recorder-dashflow-io.js` владеет ZIP-границей формата. При экспорте он
сериализует уже подготовленные manifest/flow/network/HAR/streams, проверяет
memory/body budget и создаёт DEFLATE-контейнер. При импорте до возврата
результата он проверяет ZIP-структуру, распакованные размеры, schema, пути тел,
суммарные лимиты и SHA-256. `recorder-view.js` владеет DOM-rendering сценария,
трафика, деталей запроса и сравнения, включая редактирование чувствительных
значений и ограниченный render-cycle. `recorder.js` сохраняет CDP/session/
download lifecycle и применяет подготовленный импорт к живому state только
после успешного завершения всех проверок.
`recorder-replay.js` владеет replay lifecycle: нормализует шаги, ожидает DOM,
навигацию и network idle, проверяет отмену и завершает сравнение. Он получает
live session/CDP зависимости явно от `recorder.js`, который остаётся владельцем
контролируемой вкладки, debugger attach/detach и общего состояния сессии.
`recorder-dashflow-export.js` является чистой проекцией live CDP-запросов в
канонический `network.json` и производный HAR 1.2: нормализует headers/cookies,
query, body metadata, timings, cache/TLS/initiator и страницы сценария, не
изменяя живые request-объекты.
Replay принимает только v2, открывает новое окно и повторяет поддерживаемые
шаги. Переключатель `Disable Cache` перед
первой навигацией record/replay вызывает CDP `Network.setCacheDisabled` и
`Network.setBypassServiceWorker`; в выключенном состоянии cache работает
штатно. `Disable Cookies` не удаляет данные обычного профиля: он требует
разрешить расширение в incognito, проверяет отсутствие других incognito-окон,
создаёт чистое off-the-record окно и закрывает его после Stop/replay. Cookies
работают внутри одного запуска (это необходимо авторизации), но исчезают после
закрытия последнего incognito-окна. При выключенном переключателе используется
обычный Chrome-профиль с его текущей сессией.

Импортированный `network.json` остаётся baseline, а replay собирается в отдельную карту.
Comparator сопоставляет occurrence запросов по step + method + полному URL и
классифицирует unchanged/changed/added/removed по status, MIME и SHA-256 body.
Отсутствие сопоставимого body capture считается отличием, а не ложным
`unchanged`. Отличия показываются цветной таблицей.
Replay ожидает `navigationUrl` клика и до 15 секунд ищет DOM target в записанном
frame URL. Recorder отменяет отложенный input snapshot на нативном change и
выбирает узкий интерактивный элемент из composed path.
Окно Recorder обязано оставаться
открытым: его закрытие отсоединяет debugger и прекращает сессию.

Chrome запрещает `debugger` в optional permissions, поэтому permission
объявлен при установке, хотя attach выполняется только по Record/Replay.
Request/response body ограничены 5 МиБ на запрос и 100 МиБ каждого типа на
сессию; streams — 20 МиБ, metadata — 50 тысяч запросов, flow — 20 тысяч шагов.
Перед сохранением и импортом применяется общий memory preflight. `.dashflow` намеренно содержит введённые
password values и auth/cookie headers открыто и исключён из Git.

## Storage и состояние

| Область | Данные | Контракт |
|---|---|---|
| `storage.sync` | Grafana/Options, домены, compact capture, Popup, тема | Небольшие настройки; частые inputs debounce + flush. |
| `storage.local` | Profiles, backups, Worklog/cache, Batch, diagnostics/status | Долговечные/объёмные данные. |
| `storage.session` | `grafanaVisualState:<tabId>` | Служебное состояние вкладки, удаляется при закрытии. |
| `localStorage` | Тема page | Синхронно до paint, затем sync reconciliation. |
| MAIN `Map` | Live state по `panelKey` | Только document, переживает React DOM repair. |

Profile Store сериализует записи через `storage-writer.js`. Повреждённые записи
пропускаются, исходное значение один раз сохраняется в rejected backup. Import
Options строже и отклоняет неправильные URL, ID, размеры и tools types.

Storage keys — межмодульный контракт; переименование требует миграции и
обновления import/export schema.

## Совместимость Grafana

Поддержка определяется renderer/DOM:

- modern time series: uPlot и React fiber;
- legacy `.graph-panel`: jQuery/Flot, в том числе в Grafana 10.1.10;
- `/d/`, `/d-solo/` и base-path deployments;
- panel key через `data-viz-panel-key`, `data-panelid`, URL/fiber fallback;
- fallback-селекторы, canvas/SVG, bottom/right legend;
- occurrence keys повторяющихся имён там, где нужны.

Fallback нельзя удалять по результату одной Grafana. Renderer-specific правки
проверяются отдельно на modern uPlot и legacy Flot.

## Безопасность и permissions

Полная карта: `docs/permission-map.md`.

- `<all_urls>` нужен из-за неизвестных корпоративных доменов, но Grafana MAIN
  ограничен разрешёнными hosts и route guard.
- DNR session rules снимают XFO/CSP только в конкретных вкладках DashBridge;
  глобальное правило запрещено.
- URL: только HTTP(S), без credentials, после нормализации.
- Sensitive messages проверяют sender extension origin и allowlist keys.
- Web-accessible только `inject.js` и mark icon.
- Import, diagnostics и archives имеют schema/caps.
- `unlimitedStorage` сохранён для существующих больших профилей; удалять его
  можно только после измерения пользовательских данных.

## Намеренно необычные реализации и их границы

| Механизм | Почему это функция | Ограничения и проверяемый контракт |
|---|---|---|
| MAIN fetch/XHR adapters | Преобразование ответа должно произойти до Grafana renderer. | Только настроенные Grafana hosts/routes; panel/request scope; generation cleanup; собственный wrapper не оборачивается повторно; helper-данные удаляются до renderer. |
| `grafana-refresh-policy.js` меняет dashboard response | Иначе сохранённый Grafana refresh отменяет выбранный в DashBridge `Off`. | Только `dashbridge-iframe`, fragment policy `off`, same-origin GET `/api/dashboards/uid|db/...`, одно успешное применение; direct Grafana и datasource responses не затрагиваются. |
| DNR снимает XFO/CSP | Иначе разрешённые Grafana dashboards нельзя встроить в DashBridge. | Только session rules, конкретный tab DashBridge и allowlisted Grafana host; закрытие вкладки удаляет rules; глобальное правило запрещено. |
| `debugger`/CDP | Нужен Traffic Recorder для network bodies, streams и replay. | Attach только по Record/Replay к созданной Recorder вкладке; явные caps; detach при Stop, закрытии и lifecycle-разрыве; `.dashflow` предупреждает о секретах. |
| Clipboard read/write | Перенос диапазона времени между Grafana 10/12 и DashBridge, копирование текста/PNG. | Только пользовательское действие и сфокусированный документ; time payload нормализуется и валидируется; ошибка не меняет диапазон. |
| Временная перестройка renderer | Нужен предсказуемый PNG 1000×520 для uPlot и legacy Flot. | Изменяется только выбранная панель; исходные DOM/styles/renderer sizes сохраняются и восстанавливаются в `finally` при успехе и ошибке. |
| Версионированная миграция storage | Нужен одноразовый переход существующих профилей без потери настроек. | Backup до commit, идемпотентная нормализация, marker последним, безопасный повтор после частичного сбоя. |

Наличие механизма в этой таблице не является автоматическим доказательством
безопасности. При ревью guards и cleanup сверяются с текущим кодом и
отрицательными тестами; расхождение считается дефектом документации или кода.

## Производительность и lifecycle

1. Повторная MAIN-установка очищает предыдущую generation.
2. Observer меню один на document и disconnect-ится при cleanup.
3. Threshold watcher принадлежит панели и удаляется с runtime/menu.
4. Панель на паузе не создаёт iframe; активные панели загружаются eager.
5. ZIP-снимки выполняются последовательно и не конкурируют за viewport.
6. vCPU helper входит в текущий запрос и не создаёт polling.
7. Network wrapper не оборачивает собственный wrapper повторно.
8. Diagnostics bounded; response bodies не копятся без лимита.
9. Частые storage writes объединяются и flush-ятся на blur/pagehide.
10. Capture styles и renderer sizes восстанавливаются в `finally`.
11. Backfill вкладок последовательный, чтобы не перегружать browser IPC.

## Проверки

Канонические dependency-free runners не требуют npm-пакетов:

```powershell
node test/run-js-tests.js
node test/run-python-smoke-tests.js
```

На 2026-08-31: 105 JavaScript behavior-файлов и 41 исполняемый Python
smoke/security/audit-файл. Все 84 production JavaScript-файла проходят
`node --check`.
`DASHBRIDGE_PYTHON` задаёт Python, если он не находится автоматически.

Дополнительный dev-контур устанавливается через `npm ci --ignore-scripts` и
не участвует в runtime расширения. `npm run lint` выполняет строгие
статические correctness-проверки, а `npm run test:browser` загружает unpacked
extension в отдельный временный профиль официального Playwright Chromium и
проверяет все HTML-страницы на ошибки console, page и загрузки ресурсов.
Профиль удаляется после прогона; JSON-диагностика пишется в игнорируемый
`test-results/`. `scripts/build-release.ps1` использует whitelist, поэтому
package-файлы, `node_modules` и результаты тестов не входят в extension ZIP.
Тестовый Chromium устанавливается отдельно командой
`npm run browser:install` и не использует пользовательский Chrome-профиль.
Живые Grafana E2E используют один отдельный постоянный профиль в
`%LOCALAPPDATA%\DashBridge\E2E\browser-profile`; обе авторизации выполняются
вручную один раз внутри браузера, без передачи credentials тестовому коду.
`scripts/run-live-grafana-e2e.js` является внешним Playwright-оркестратором, а
не вторым владельцем сценариев: он открывает существующий extension Test Runner,
передаёт ему один или два dashboard URL и ждёт его публичный snapshot. Fast и
Full матрицы, OFF→ON/reset, повторный refresh, uPlot/Flot invariants и cleanup
остаются во владельце `pages/test-runner/test-runner-suite.js`. Оркестратор
пишет полный локальный JSON и компактный failure-report в игнорируемый
`test-results/`; в Node-процесс передаются только bounded console/network
evidence и диагностика проваленных тестов без изображений и крупных payload.
Снимок создаётся только при фатальной ошибке внешнего запуска.

`pages/test-runner/test-runner-suite.js` также является единым каталогом
стабильных ID, человекочитаемых названий, описаний, шагов и владельцев кода для
каждого E2E-сценария. Основное окно передаёт выбранные ID в core после
ограничения по Fast/Full и URL, а `test-selector.html` позволяет выбрать весь
профиль, быстрые сценарии, последние FAIL, последние NOT RUN или произвольный
набор. Выбор хранится в `storage.local`; пустой набор не запускается.

После завершения UI сохраняет только компактную историю результатов по тестам
и не более 20 последних запусков. Она нужна для понятных имён в истории и
повторного запуска проблемного набора; полная диагностическая evidence
по-прежнему принадлежит OPFS/локальному JSON, а не `storage.local`.

Full не удаляет причинные проверки ради скорости. Успешный финальный reset
матричного сценария может стать входной границей следующего сценария на той же
панели. Перед повторным использованием runner заново снимает semantic state,
проверяет native legend и all-OFF invariant. При любом расхождении он
автоматически возвращается к обычному `resetAllSettings + Refresh`.

Диагностические уровни ограничивают пиковую память, но не семантические
инварианты. Semantic сохраняет DOM/canvas hashes, bounded pixel statistics и
последние resource timings; canvas сохраняет собственный PNG. Panel и forensic
не дублируют этот PNG, потому что уже содержат crop всей панели, а forensic —
также viewport, полный DOM и полный список resource timings. Pixel hash во всех
режимах вычисляется по одинаковой уменьшенной поверхности не более 160×90,
поэтому сравнение остаётся стабильным без многократных полноразмерных RGBA и
base64-аллокаций внутри длинного матричного сценария.
Raw результат сценария не добавляется в публичный `runnerState`, пока awaited
OPFS hook не вернул компактную строку с `diagnosticRef`. Поэтому UI и внешний
Playwright-оркестратор не могут случайно сериализовать многосотмегабайтный
промежуточный объект через `getSnapshot()`; после публикации полная evidence
доступна лениво только через OPFS.
Flot diagnostic разрешает renderer тем же контрактом, что production visual
engine: ищет chart host и читает `$(host).data('plot')`. Он не использует
несуществующий в Grafana 10 `$.plot.getPlot()`, поэтому заливка и толщина линий
проверяются по живым series вместо ложного renderer-unsupported SKIP.

Внутри одного matrix-сценария второй Refresh без повторной команды доказывает
persistence один раз для каждого уникального непустого active set. Если тот же
active set появляется повторно ради идемпотентности или порядка отключения,
runner всё равно отправляет команду, делает причинный Refresh и проверяет все
инварианты, но не дублирует уже полученное persistence-доказательство. Для
нового active set второй Refresh обязателен; isolation и финальный reset не
сокращаются.

Автоматический Playwright failure-report не перечитывает test value из OPFS:
один проваленный high-risk сценарий может содержать гигабайты повторяющихся
структур ещё до разворачивания assets. Он использует опубликованные вместе со
строкой результата `details`, `reasonCode`, `shortReason`, `analysisUnit` и
`visualAudit`. Полная гидратация сохранена в `readTest()` и выполняется только
по явному открытию одного теста в интерактивном viewer.
Компактная `diagnosticRef` также содержит фактический размер test JSON в OPFS,
чтобы memory/disk regressions обнаруживались по отчёту без гидратации файла.
Settlement использует каждый animation frame для live verdict, но в JSON
сохраняет максимум 64 записи: первый frame и новейшее bounded-окно. Общие
`observedFrames`, `droppedSamples` и mutation counters не ограничиваются. Это
не меняет quiet/stable/timeout решение и устраняет сотни повторов длинной Flot
легенды в каждом Refresh.

Наличие `legendVisibility` в generated command не само по себе означает native
legend work. Пустая карта является no-op, если предыдущая карта не скрывала ни
одной серии; карта с `false`, явный `null` и пустая карта после скрытого
состояния остаются реальными командами. В `filtered_empty` visibility intent
доказывается сохранённым tools/transport-state без требования repaint
несуществующей легенды; первый полный ответ после снятия фильтра по-прежнему
обязан доказать native restore.

Combined visual-команды (`seriesConfig` и/или `invertLegend`) сначала выполняют
legacy layout/visibility painter, затем заново применяют только локальные
fill/width-настройки к текущему Flot/uPlot и оставляют узкий replacement guard.
Это необходимо, потому что перестройка легенды может заменить Flot plot после
того, как legacy painter изменил старый instance; guard не вмешивается в цвета,
layout или visibility.

Дополнительно: `pages/test-runner/test-runner.html` запускает живые E2E на Grafana. По user action
он открывает общий Document Picture-in-Picture progress controller с количеством
завершённых/запланированных тестов, PASS/FAIL, общим временем и аварийной
остановкой; при отсутствии Document PiP основной in-page прогресс остаётся
рабочим. Отдельное focused Grafana-окно по-прежнему принадлежит core runner;
`test/devtools-e2e-*-diagnostics.js` — диагностические probes, не CI tests;
`test/fixtures/` содержит статические modern/legacy fixtures.

Минимум после изменения:

1. Проверить пути manifest, `importScripts` и `<script src>`.
2. Запустить оба runner.
3. MAIN-правку проверить в direct Grafana и DashBridge iframe.
4. Renderer-правку проверить на uPlot и Flot.
5. Capture: save/copy, prepared on/off и restore после успеха/ошибки.
6. Storage/import: legacy, повреждённый и новый state.
7. Permissions/DNR: сверить `docs/permission-map.md`.

Практическая матрица влияния изменений и checklist ревью находятся в
`docs/development-guide.md`.

## Выпуски и уведомления об обновлениях

Push тега `vX.Y.Z` запускает `.github/workflows/release.yml`. Workflow выполняет
полный набор тестов, требует совпадения тега с версией `manifest.json`, собирает
ZIP расширения, Windows installer и SHA-256 через `scripts/build-release.ps1`,
затем публикует GitHub Release с автоматически сформированными notes.

Popup при открытии запрашивает только `releases/latest` репозитория
`Phuoctonge/DashBridge`; успешный результат кэшируется в `storage.local` на один
час. Draft/prerelease, неожиданный тег, GitHub URL и отсутствие точных
ZIP/installer assets отклоняются. При более новой версии показывается ссылка на
installer. Его запуск остаётся явным действием пользователя.

`scripts/Install-DashBridge.ps1` работает вне extension trust boundary: выбирает
установленный Chrome/Edge/Яндекс Браузер, best-effort ищет прежний unpacked path
в browser `Preferences`, либо использует `%LOCALAPPDATA%\DashBridge\Extension`.
Он принимает только точный stable release, сверяет SHA-256 и manifest version,
обновляет через sibling staging и сохраняет backup. Git checkout, корни диска и
непустые чужие папки отклоняются; browser preferences не меняются, а процессы
не завершаются принудительно. После live swap popup сравнивает загруженный
manifest с файлом на диске и предлагает штатный `chrome.runtime.reload()`;
локальная готовая версия имеет приоритет над повторным remote download notice.
Первичная регистрация через **Загрузить распакованное** остаётся ручной. Полный
контракт: `docs/installer.md`.

## Куда добавлять функцию

- Popup UI: `pages/popup/` + порядок `pages/popup/popup.html`.
- Новая page: feature-каталог в `pages/`, общие UI-зависимости из `pages/shared/`, ранний `theme.js`.
- Общая чистая логика pages: `js/shared/`.
- Данные/renderer Grafana: MAIN-модуль `js/content/`, runtime manifest, UI-команда.
- Chrome API для Grafana: isolated script и узкий event/message bridge.
- Поле profile/worklog: schema, import/export, migration.
- Permission: минимальный сценарий и permission map.
- Grafana setting: canonical default в `grafana-settings.js`.

Если функция нужна direct Grafana и DashBridge, её нельзя реализовать только в
`dashbridge.js` или Popup.

## Намеренные ограничения

- Plans и копии проекта не являются runtime dependency.
- Popup, panel и Batch capture делят helpers, но не lifecycle controller.
- CPU/RAM transformations не объединяются в один расчёт.
- Числовой и vCPU-фильтры не включаются одновременно: порядок двух удаляющих
  преобразований неоднозначен.
- Missing vCPU — fail-open, иначе ошибка helper скроет проблемную VM.
- Clipboard требует focus/user activation; copy остаётся близко к клику.
- Автотесты проверяют контракты, но разные Grafana требуют живой проверки.
