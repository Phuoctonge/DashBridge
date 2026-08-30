# Архитектура DashBridge

> Сверено с версией 2.4.1, исходным кодом и тестами 2026-08-29. Здесь описан
> фактически работающий код. Незавершённые
> направления вынесены в `plans/README.md`, ключевые прежние решения — в
> `docs/history/architecture-decisions.md`.

DashBridge — Chrome MV3-расширение с шестью контурами: инструменты обычной
Grafana, единый дашборд `dashbridge.html`, пакетный экспорт `batch.html`, Jira
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
├── popup.html                  # Основной Popup
├── options.html                # Настройки, импорт/экспорт
├── dashbridge.html             # Единый дашборд Grafana
├── batch.html                  # Пакетный PNG/ZIP и серии
├── worklog.html                # Jira worklog
├── test-runner.html            # Живые E2E-сценарии
├── recorder.html               # Traffic record/replay и .dashflow
├── js/background.js            # MV3 service worker
├── js/theme.js                 # Общая light/dark тема
├── js/shared/                  # Контракты, storage, URL, capture
├── js/content/                 # MAIN/isolated runtime сайтов
├── js/popup/                   # Модули Popup
├── js/pages/                   # Контроллеры extension pages
├── js/test-runner/             # E2E runner и отчёты
├── css/                        # Общие и постраничные стили
├── test/                       # Node behavior, Python smoke, probes
├── docs/                       # Действующие пояснения и краткая история
└── plans/README.md             # Только актуальный незавершённый roadmap
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
потребителем. `js/theme.js` находится в `<head>` до `<body>`, синхронно читает
`localStorage`, затем согласует тему с `chrome.storage.sync`, исключая FOWT.

`theme.js` тем же ранним путём применяет `uiScale`. Общие размеры контролов,
иконок, отступов и читаемых областей принадлежат `css/theme.css` и задаются в
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
| Profiles | `dashbridge-profile-store.js` | `dashbridge.js`. |
| Версия данных DashBridge | `dashbridge-data-migration.js` | Startup `dashbridge.js`. |
| Import/recovery | `local-state-schema.js` | Options, Worklog, profiles. |
| Local writes | `storage-writer.js` | Profiles, Worklog, Batch. |
| Sync input writes | `sync-input-writer.js` | Частые поля UI. |
| Bounded diagnostics | `bounded-journal.js` | MAIN и test tooling. |
| ZIP/лимиты | `archive-download.js`, `archive-budget.js` | Batch, exports. |
| Анализ CPU/RAM | `grafana-panel-analysis.js` | Расчёт, thresholds и clipboard-формат кнопок CPU Usage/Memory. |
| Grafana time | `grafana-time.js` | DashBridge, iframe. |
| Clipboard диапазона | `grafana-time-picker-clipboard.js`, `dashbridge-time-state.js` | Direct Grafana, DashBridge. |
| Theme и UI scale | `theme.js`, `css/theme.css` | Все extension pages. |
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
  → dashbridge.js
     ├── dashbridge-renderer.js
     ├── dashbridge-time-state.js
     └── dashbridge-crosshair.js
  ↔ postMessage конкретного iframe
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

DNR создаётся только для открытых вкладок `dashbridge.html` и разрешённых
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

Один pipeline работает в direct Grafana и `dashbridge.html`.

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
  ├── UI/state/lifecycle
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

`recorder.html` владеет жизненным циклом контролируемой вкладки и CDP attach.
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

`package.json` в репозитории нет. Канонические dependency-free runners:

```powershell
node test/run-js-tests.js
node test/run-python-smoke-tests.js
```

На 2026-08-29: 97 JavaScript behavior-файлов и 41 исполняемый Python
smoke/security/audit-файл. Все 78 production JavaScript-файлов проходят
`node --check`.
`DASHBRIDGE_PYTHON` задаёт Python, если он не находится автоматически.

Дополнительно: `test-runner.html` запускает живые E2E на Grafana. По user action
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

- Popup UI: `js/popup/` + порядок `popup.html`.
- Новая page: HTML + `js/pages/` + CSS + ранний `theme.js`.
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
