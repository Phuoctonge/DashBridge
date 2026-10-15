# Архитектура DashBridge

> Документация рабочей версии 2.4.4; пересверена 2026-10-13 по исходникам и
> тестовым контрактам. Это дата ревизии текста, а не нового live-прогона. Здесь описан фактически работающий код. Незавершённые
> направления вынесены в `docs/roadmap.md`, ключевые прежние решения — в
> `docs/history/architecture-decisions.md`.

DashBridge — Chrome MV3-расширение, включающее инструменты обычной
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
│   ├── confluence-report/      # Сканирование, сопоставление и явная замена вложений отчёта
│   ├── dashbridge/             # Единый дашборд: renderer, profiles, time
│   ├── options/                # HTML, CSS и контроллер настроек
│   ├── popup/                  # Основной Popup: HTML, CSS и page-модули
│   ├── recorder/               # Traffic Recorder: HTML, CSS и контроллер
│   ├── shared/                 # Общая тема и окно прогресса extension pages
│   ├── test-runner/            # Живые E2E: UI, probe, suite, report
│   └── worklog/                # Jira Worklog: HTML, CSS и контроллер
├── js/background.js            # MV3 service worker
├── js/shared/                  # Контракты, storage, URL, capture
├── js/content/                 # MAIN/isolated runtime сайтов
├── test/                       # Node/Python behavior, browser smoke, probes
├── package.json                # Только dev-анализ: ESLint и Playwright
├── docs/architecture.md        # Источник истины по runtime и владельцам
├── docs/module-design.md       # Границы и бюджеты JavaScript-модулей
└── docs/roadmap.md             # Только актуальный незавершённый roadmap
```

`vendor/jszip.min.js` — сторонняя библиотека; вручную не изменять.

## Почему используются нестандартные механизмы

Ниже — причины действующего выбора, его владельцы и проверки. Эти механизмы
не следует удалять только из-за их внешнего сходства с инъекцией или обходом
ограничений. Обоснование не делает отсутствующий guard безопасным: если код
расходится с указанной областью или cleanup, это самостоятельная находка.

### MAIN-инъекция и ранняя загрузка

Преобразования должны читать объекты renderer и ответ, который получает сама
Grafana. Isolated world разделяет DOM, но не JS-глобалы страницы; одна правка
DOM после загрузки не меняет исходные данные, статистики и следующий repaint.
Поэтому [syncRegistration/backfillOpenFrames](../js/background-grafana-infrastructure.js)
загружают упорядоченный [runtime manifest](../js/shared/grafana-runtime-manifest.js)
в MAIN. Chrome API остаются в service worker/isolated world. Код поставляется
в расширении, а не скачивается как исполняемый скрипт.

Постоянная регистрация ограничена настроенными HTTP(S) hosts и dashboard
routes; explicit loader имеет отдельно описанный session scope. Проверки:
[registration](../test/grafana_runtime_registration_behavior.js),
[manifest](../test/grafana_runtime_manifest_behavior.js) и
[port scope](../test/grafana_runtime_port_scope_behavior.js).
Удаление регистрации не выгружает уже исполненный код документа. При проверке
обновлённого MAIN нужен новый документ с актуальной регистрацией; после обновления
unpacked расширения проверенный в этой локальной среде путь — полный restart
отдельного браузера. Одна перезагрузка Grafana здесь могла снова выполнить прежнюю
регистрацию; это не универсальное требование Chromium для любого обновления.

### Fetch/XHR до renderer

[installDataInterceptor](../js/content/grafana-panel-data-runtime.js) нужен для
Idle → Load, RAM → Used %, удаления отфильтрованных рядов и согласованных
report metadata. Запрос напрямую из extension page создал бы второй сбор данных,
а дорисовка текста поверх графика оставила бы native легенду и SLA несогласованными.
Wrapper сохраняет native вызов для запросов вне query scope; ответ выбранного
запроса сопоставляется с панелью/refIds. Dashboard variables не становятся
панельными данными. Неизвестный shape или ошибка decode не дают права преобразовать
произвольный ответ. Общий [network adapter](../js/content/grafana-network.js)
создаёт изменённый Response и снимает устаревшие content-length/content-encoding.

Wrappers устанавливаются один раз на документ; меняется привязка к текущему
`__dashbridgePanelDataOwner`. Cleanup снимает только свою привязку; UI callbacks
завершений in-flight запросов обращаются к текущему владельцу. Это не обещание
восстановить fetch/XHR при каждом OFF, а намеренный lifecycle-контракт.
Проверки: [transport scope](../test/grafana_panel_transport_scope_behavior.js),
[generation](../test/grafana_panel_data_generation_behavior.js),
[network](../test/grafana_network_behavior.js) и
[runtime](../test/grafana_panel_data_runtime_behavior.js).

### DNR для единого дашборда

Некоторые Grafana запрещают embedding через X-Frame-Options/CSP. Простая
вставка iframe тогда не создаёт рабочую карточку; серверная настройка embedding
была бы альтернативой при доступе к конфигурации Grafana. Текущий клиентский
вариант — [planSessionRules](../js/shared/dnr-rules.js) и
[syncRules/getDashBridgeTabIds](../js/background-grafana-infrastructure.js).
Правила требуют разрешённый exact hostname (запись без порта допускает его порты,
запись с портом ограничивает этот порт), `sub_frame`, tab ID страницы DashBridge
и extension initiator. Навигация с DashBridge, закрытие/замена вкладки
вызывают пересинхронизацию; чужой pendingUrl исключается.

Действие **удаляет весь заголовок CSP**, а не только `frame-ancestors`, и XFO;
остальные директивы удалённого CSP в этом ответе также теряются. Это реальная
цена выбранного решения, поэтому tab/host/initiator scope обязателен.
Правила не выдают login, cookies или права datasource и не снимают same-origin
policy; связь parent/iframe остаётся через origin/source guards. Проверки:
[session rules](../test/dnr_session_rules_behavior.js) и browser workflow
`inspectSecurityBoundaries` в [общем smoke](../test/run-extension-browser-smoke.js).

### Внутренние renderer/React объекты и временный layout

Grafana не предоставляет расширению универсальный публичный API для изменения
всех вариантов uPlot/Flot/Table. [Visual engine](../js/content/grafana-visual-engine.js),
[legend visuals](../js/content/grafana-legend-visuals.js) и
[compact layout](../js/content/grafana-compact-layout.js) используют обнаруженный
renderer/DOM. Это совместимость с конкретными shapes, а не гарантия для всех
плагинов. Для виртуализированной Table видимые DOM-строки неполны;
[collectGrafanaTableData](../js/content/grafana-table-report.js) ограниченно читает
committed React DataFrame выбранного grid, без вызовов getters/React функций и
без обхода всего dashboard. Caps и completeness определяют, допустим ли SLA.

При PNG renderer нужно действительно перестроить под целевой размер; обрезка
готового canvas не возвращает скрытые подписи или строки. Владельцы
[panel capture](../js/content/grafana-panel-capture-runtime.js) и compact layout
сохраняют baseline, перестраивают панель, затем восстанавливают DOM/styles и
наблюдателей. Снимок проверяют по результату и restore, а не только по наличию
canvas. Проверки: [layout](../test/grafana_capture_layout_behavior.js),
[compact](../test/grafana_compact_layout_behavior.js),
[Table](../test/grafana_table_report_behavior.js),
[browser visual](../test/support/browser-dashboard-visual.js).
Compact helper переиспользует поиск uPlot из visual engine и принимает только
renderer с root внутри выбранной панели. У Grafana 12 таблица легенды может иметь
только generated class, поэтому её `LegendRow` исключает ветку native Table:
иначе измеренный flex-контейнер сохраняет прежний размер и выносит легенду за PNG.
Списочная легенда распознаётся по native `VizLegend series` и её `ul`.
Временный observer удерживает только выбранную цепочку контейнеров и её transform:
React grid может переписать смещение уже после reparenting. Дочерние renderer
элементы получают только min-width, их высотой продолжает владеть uPlot.
Restore отключает observer и возвращает значения и priorities inline-стилей.
Перенос легенды в `grafana-legend-visuals.js` также распознаёт native элементы
`VizLegend series`, когда общие legacy-селекторы не нашли записей. Их общий
предок определяет контейнер легенды до изменения flex direction; без этого
список мог закрыть график. Ветка общая для direct Grafana и DashBridge iframe,
возврат OFF и resize-контракт проверяет
[legend resize](../test/grafana_legend_resize_behavior.js).
При восстановлении layout сохраняются текущие width/height обычного priority:
ими владеет Grafana и React может изменить их при View/возврате на dashboard.
Собственные размерные overrides используют `!important` и снимаются по snapshot;
возврат всего старого style без этой границы восстанавливал ширину маленькой панели.
Неудовлетворённая полнота возвращает явную ошибку; произвольные internals не
считаются доверенными только потому, что находятся на странице Grafana.

### Refresh Off и временный период отчёта

Отсутствие `refresh` в URL может вернуть сохранённый dashboard refresh.
[Refresh policy](../js/content/grafana-refresh-policy.js) выражает Off через
fragment именованного iframe и узкий one-shot hook dashboard definition;
legacy SoloPanel fallback ограничивает только известный scheduler stack.
Direct Grafana и остальные timers сохраняют native поведение. Проверка:
[refresh policy](../test/grafana_refresh_policy_behavior.js).

[beginReport](../pages/dashbridge/dashbridge-time-controller.js) выдаёт временный
lease с одним абсолютным периодом и новым документом iframe. Это защищает сбор
от старых ответов и относительного периода, который менялся бы между снимками.
Release восстанавливает только всё ещё принадлежащие lease навигации;
профиль не получает временный `_t`. Сверка snapshots не объявляет datasource
транзакционным. Проверки: [time controller](../test/dashbridge_time_controller_behavior.js)
и [report integration](../test/dashbridge_report_integration_behavior.js).

Причины CDP/секретов Recorder описаны в [DashFlow v2](dashflow-v2.md), полномочия
clipboard/downloads и известные ограничения — в [permission map](permission-map.md).
Источник истины для будущей правки — текущий владелец функции и его проверки,
а не старые номера строк в аудитах или универсальный совет из импортированного skill.

## Контексты и границы доверия

| Контекст | Основные файлы | Ответственность |
|---|---|---|
| Service worker | `js/background.js`, `js/background-grafana-infrastructure.js`, `js/background-profile-storage.js`, `js/background-gui-capture.js`, `js/background-update-indicator.js` | Единый message dispatcher; изолированные владельцы MAIN-регистрации/tab-scoped DNR, сериализованных profile/storage commits, GUI capture lifecycle и постоянного action-индикатора обновления. |
| Isolated content world | `content.js`, `grafana-iframe.js` | Мост Chrome API, Confluence, iframe time/crosshair/title и вывод снимка. |
| Grafana MAIN world | Файлы runtime manifest | fetch/XHR, данные, visual state, меню, легенда, threshold, vCPU и подготовка снимка. |
| Extension pages | Popup, Options, DashBridge, Batch, Worklog, Confluence Report | UI, команды и долговечное состояние. Confluence Report читает REST storage/attachments и по явному Apply загружает вложения, обновляет страницу и проверяет результат через executeScript в её origin. |
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
   `grafana-capture-output.js`, `analytics-client.js`, `content.js` и
   `grafana-time-picker-clipboard.js` в isolated world верхнего документа.
   Конкретные функции дополнительно ограничены доменом и сценарием. Clipboard
   time picker активируется по опубликованному UI scope Grafana
   и выполняет read/write по клику пользователя; ограничение scope описано ниже.
   До записи любого input clipboard-парсер проверяет обе границы: Grafana `now`
   datemath, корректное локальное календарное время, ISO с zone либо 13-значный
   epoch milliseconds. Неверный тип, календарная дата, время или offset отклоняют
   весь диапазон без input/change событий. ISO/epoch переводятся в прежний локальный
   формат с секундами; relative выражения не вычисляются, Apply остаётся native.
   Clipboard-модуль владеет снимаемыми обработчиками native Copy/Paste и legacy
   кнопками. Отзыв UI scope и pagehide снимают только его listeners, возвращают
   исходные title/marker/classes и отменяют feedback timers; DOM remount очищает
   устаревшие привязки. Перед clipboard action и после async read/write проверяются
   текущий scope, привязка, документ, picker и inputs. Позднее завершение после
   cleanup не меняет inputs и не сообщает success/error; pageshow восстанавливает
   UI по актуальному scope. При выключенном scope native Grafana action проходит
   без вмешательства DashBridge и остаётся ответственностью Grafana.
   Разрешение capture и изменения общей настройки снимка в `content.js`
   хранится в isolated closure и не берётся из DOM. Dataset публикует UI scope
   для MAIN и отдельного isolated time-picker clipboard модуля. Последний
   использует dataset для включения UI, без независимой проверки host в
   clipboard handlers; это ограничение, а не защищённая граница.
   Capture и изменение общей настройки снимка требуют активного пользовательского
   действия, а service worker повторно проверяет sender host и dashboard route.
2. `grafana-time.js`, `grafana-panel-bootstrap.js`, `grafana-iframe.js` и
   `grafana-variables-bridge.js` во всех
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
grafana-variables-runtime.js
grafana-legend-selection.js
grafana-capture-output.js
grafana-dom.js
grafana-panel-state.js
grafana-panel-analysis.js
grafana-series-capture.js
grafana-panel-definition.js
grafana-unit.js
grafana-table-report.js
grafana-legend-visibility-adapters.js
grafana-legend-visuals.js
grafana-threshold-visuals.js
grafana-report-snapshot.js
grafana-series-styles.js
grafana-visual-engine.js
grafana-compact-layout.js
grafana-panel-settings-modal.js
bounded-journal.js
grafana-network.js
grafana-cpu-capacity-filter.js
grafana-cpu-capacity-legend.js
grafana-panel-capture-runtime.js
grafana-panel-data-transforms.js
grafana-panel-data-runtime.js
grafana-panel-menu-runtime.js
grafana-panel-tools.js
```

`background-grafana-infrastructure.js` регистрирует список через `registerContentScripts` с
`world: 'MAIN'`, `runAt: 'document_start'`, `allFrames: true`. Регистрация
покрывает только хосты из `grafanaIframeDomains` и маршруты `/d/`, `/d-solo/`,
включая Grafana под base path. После установки, запуска или изменения доменов
открытые Grafana-фреймы проверяются и при необходимости дозагружаются.
Регистрация и backfill сохраняют явно указанный порт: `host:8443` не разрешает
тот же hostname на другом порту; запись без порта по-прежнему покрывает его
порты. Chromium принимает порт в отдельных `http://host:port/...` и
`https://host:port/...` patterns, но отклоняет `*://host:port/...`; manifest
helper формирует обе явные схемы. ID временной регистрации учитывает полный
host с портом, проверка готовой регистрации требует покрытия всех маршрутов.
Если helper не может представить host (в частности, IPv6 literal), явная ранняя
регистрация возвращает `unsupported-host`, а не считает пустой набор покрытым.

`grafana-runtime.js` запускает тот же список по явной команде extension page.
Явные loader-вызовы Batch/Test Runner проверяют HTTP(S) dashboard route,
но не требуют присутствия URL в `grafanaIframeDomains`. Ранняя explicit
регистрация действует на matches выбранного host/порта в браузерной сессии
(`persistAcrossSessions: false`), а не только в одной вкладке. Это отличается
от постоянной регистрации и backfill по списку подключений.
Повторная загрузка обязана быть безопасной: generation/cleanup не допускает
накопления observers и transport wrappers.

### Extension pages

Порядок обычных `<script>` в HTML значим: dependency ставится перед
потребителем. `pages/shared/theme.js` находится в `<head>` до `<body>`, синхронно читает
`localStorage`, затем согласует тему с `chrome.storage.sync`, исключая FOWT.

`theme.js` тем же ранним путём применяет `uiScale`. Общие tokens, размеры
контролов, иконок, отступов и читаемых областей принадлежат
`pages/shared/theme.css`; ограниченный слой legacy/dark compatibility находится
в загружаемом следом `pages/shared/theme-compat.css`. Стили Options принадлежат
`pages/options/options.css`. Все размеры задаются в `rem`; точные размеры capture
остаются независимыми CSS-пикселями. Рабочие
страницы реагируют на доступный viewport/container, а не на `screen.width` или
физическое разрешение монитора. DashBridge хранит legacy `33%`/`50%`/`100%`,
но renderer отображает их как семантические spans 12-колоночной CSS Grid.
Шрифты статических extension pages, включая подписи, таблицы и подсказки,
выражены в rem: масштаб 100% сохраняет прежнюю геометрию, увеличение uiScale
не оставляет отдельные подписи в фиксированных px. Базовый размер root остаётся
в px и принадлежит общей теме. Отдельные окна описания и диагностики E2E
наследуют размер root при открытии и выбранную тему; описание использует общий
theme.css. Theme listeners этих окон снимаются при unload, длинные пути
исходников переносятся внутри карточек.

Параметры Recorder, включение блоков сводного сообщения и SLA-фильтр снимков
используют нативный checkbox с `role="switch"` и общими `.switch/.slider`.
Общая тема показывает фокус на дорожке, disabled и учитывает reduced motion.
Замена представления сохраняет прежние checked, обработчики и момент записи:
настройки запуска применяются при запуске, черновики окон — после Save.

`pages/shared/modal-accessibility.js` принадлежит документу extension page и
подключён в DashBridge, Batch, Popup и Worklog. Он отслеживает видимые HTML-
диалоги, удерживает Tab внутри верхнего окна и возвращает фокус при закрытии.
Escape вызывает существующую кнопку отмены/закрытия владельца, не удаляет
окно самостоятельно и не применяет настройки. Нативный dialog переменных
сохраняет собственный keyboard lifecycle.

Cross-origin iframe может получить программный фокус при загрузке, не послав
`focusin` в родительский document; поэтому одного Tab trap недостаточно.
`onWindowBlur` ждёт один animation frame, чтобы браузер завершил переход фокуса,
и возвращает его в последнее доступное поле верхнего диалога. Проверка действует
только если `activeElement` — iframe вне этого диалога. Нативный `dialog:modal`
имеет приоритет; iframe внутри самого окна и фокус вне браузера не перехватываются.
Без доступного прежнего поля используется первый control. Чтение DOM Grafana,
новые permissions и polling не нужны. `stop` отменяет отложенный frame и снимает
MutationObserver/listeners на pagehide; `start` на pageshow заново запоминает
текущий фокус для возврата к opener. Регрессия в
[Chromium-тесте окон](../test/dashbridge_iframe_settings_browser.cjs) проверяет
реальную cross-origin навигацию, ввод/курсор, вложенные окна, native dialog,
закрытие, доступность iframe после закрытия и stop/start. Это локальный стенд,
а не доказательство загрузки данных в каждой рабочей Grafana.
Модальные поверхности, меню и общий `--card-bg` используют непрозрачный фон
в обеих темах; плавающая панель сохранения Options также непрозрачна.
Полупрозрачным остаётся затемнение страницы за диалогом.
В Batch шапка, массовый выбор и footer не сжимаются списком панелей;
при нехватке высоты остаётся доступна прокрутка окна. Меню профилей шире кнопки
(17.5rem, не шире viewport); page UI controller смещает его внутрь окна при
открытии, resize и изменении размеров шапки/меню. ResizeObserver и resize
listener снимаются на pagehide и восстанавливаются на pageshow.
Таблица CPU/RAM имеет минимальную читаемую высоту; если шапка и действия
не помещаются вместе с таблицей, прокручивается также внешний диалог.

Служебное окно «Тест на свежесть кода» декодирует выбранный файл перед заменой
видимого изображения (`loadPhoto` в `pages/debug-easter-egg/debug-easter-egg.js`).
Повреждённый файл освобождает свой Blob URL, сохраняет прежнее фото и показывает
ошибку в существующей подсказке. Новый корректный файл позволяет повторить действие.
«Очистить» отменяет только эффекты; фото остаётся. Это локальный lifecycle окна,
без storage/внешней сети; browser smoke проверяет два отказа, retry и очистку эффектов.

## Владельцы логики

| Возможность | Владелец | Потребители |
|---|---|---|
| Grafana defaults | `grafana-settings.js` | Popup, Options, DashBridge, content, background. |
| MAIN список/порядок | `grafana-runtime-manifest.js` | Background, Popup, Batch, runner. |
| Bootstrap transform/refresh | `grafana-panel-bootstrap.js`, `grafana-refresh-policy.js` | DashBridge iframe MAIN startup. |
| Запуск runtime | `background.js`, `grafana-runtime.js` | Все Grafana-сценарии. |
| Команда в MAIN | `grafana-command.js` | Batch; единый transport и применение настроек panel tools. |
| Поиск панели/DOM | `grafana-dom.js` | Tools, capture, visual engine. |
| Live panel state | `grafana-panel-state.js` | Tools, visual engine. |
| Transport adapter | `grafana-network.js` | CPU/RAM, фильтры, diagnostics. |
| Ответ до renderer | `grafana-series-capture.js` | Batch series mode. |
| Определение панели и query signatures | `grafana-panel-definition.js` | Visual engine, panel tools, test runner. |
| Разбор и согласование единиц Grafana | `grafana-unit.js` | Visual engine: axis/panel units, threshold, table report, uPlot/Flot. |
| Чтение Grafana Table | `grafana-table-report.js` | Ограниченный DOM-снимок, read-only чтение текущего renderer DataFrame по явному report request и shape response frames для Visual engine report snapshot. |
| uPlot/Flot visuals | `grafana-visual-engine.js` | Direct Grafana, DashBridge; стабильный facade и renderer lifecycle. |
| Снимок данных панели для отчёта | `grafana-report-snapshot.js` | `grafana-visual-engine.js`; чистая агрегация Flot/uPlot/Table без собственного observer lifecycle. |
| Локальные стили серий | `grafana-series-styles.js` | `grafana-visual-engine.js`; fill/line-width, panel-scoped reapply observer, renderer reflow и диагностика с единым cleanup. |
| Threshold visuals | `grafana-threshold-visuals.js` | `grafana-visual-engine.js`; линии и highlight overlays Flot/uPlot, unit lookup, data/layout observers, RAF и полный cleanup. |
| Legend renderer adapters | `grafana-legend-visibility-adapters.js` | Flot/uPlot visibility, native legend interaction и renderer-specific reset без layout/palette ownership. |
| Legend columns | grafana-legend-columns.js | Чистый расчёт статистик и выбранных колонок легенды без DOM/observer lifecycle; потребитель — visual engine. |
| Legend visuals | `grafana-legend-visuals.js` | `grafana-visual-engine.js`; layout, palette, facade renderer adapters и единый реестр legacy observer cleanup. |
| Настройки панели | `grafana-panel-settings-modal.js` | Direct Grafana, DashBridge. |
| Видимость функций панели | `grafana-panel-analysis.js`, `grafana-settings.js` | Host policy и title-gated/full режимы для CPU/RAM/Load controls. |

В обычной Grafana видимость type-specific функций панели определяется общей
host policy. Для `mon-dc.mos.ru` по умолчанию сохраняется точная классификация
по настроенным названиям CPU/RAM/Load; для других валидных HTTP(S) host
показывается полный набор существующих controls. Настройка
`grafanaShowAllPanelFunctions` явно включает полный набор для любого host.
Невалидный URL использует безопасный title-gated fallback. Panel ID остаётся
ключом состояния и сохранённых настроек, но не является семантическим
classifier. Полный режим только показывает controls и не включает
преобразования автоматически.
| Allowlist легенды | `grafana-legend-selection.js` | Tools, карточки. |
| Load по vCPU | `grafana-cpu-capacity-filter.js` | Transport pipeline. |
| vCPU в легенде и отчёте | `grafana-cpu-capacity-legend.js` | MAIN: сопоставление series с capacity, колонка/сортировка легенды и ограниченный remount observer; создаётся `grafana-panel-tools.js`, который сохраняет порядок reflow/threshold и владеет cleanup поколения. |
| Compact renderer | `grafana-compact-layout.js` | Capture prepare/restore. |
| Panel capture lifecycle | `grafana-panel-capture-runtime.js` | MAIN: временная перестройка панели, Batch API, ожидание результата и гарантированный restore; создаётся `grafana-panel-tools.js`. |
| Panel response transforms | `grafana-panel-data-transforms.js` | MAIN: CPU/RAM conversion, Table/series collection, threshold/vCPU extraction и response filtering без собственного transport lifecycle. |
| Panel data/transport lifecycle | `grafana-panel-data-runtime.js` | MAIN: scoped fetch/XHR interception, request correlation, response diagnostics и calculated title; создаёт transforms и сам создаётся `grafana-panel-tools.js`. |
| Panel menu/analysis UI lifecycle | `grafana-panel-menu-runtime.js` | MAIN: toolbar mount/remount, CPU/RAM dialog, embedded analysis updates и observer cleanup; создаётся `grafana-panel-tools.js`. |
| Crop/PNG/clipboard | `grafana-capture-output.js` | Isolated Grafana, DashBridge. |
| Batch legend | `grafana-legend-engine.js` | Batch. |
| Tab capture/crop | `grafana-panel-capture.js` | Batch/legacy Popup flow. |
| URL/dashboard API | `grafana-url.js`, `grafana-dashboard-api.js` | Batch. |
| Batch presets | `grafana-batch-panel-rules.js` | Batch. |
| Confluence report live schema/client | `confluence-report-live-schema.js`, `confluence-report-live-client.js` | Extension page «Замена изображений в отчёте»; нормализация REST storage/attachments и bounded read-only scan. |
| Confluence report storage scanner | `confluence-report-scanner.js` | Extension page; строит test/group/image snapshot из storage-разметки без записи во внешний сайт. |
| Confluence replacement preview | `confluence-report-preview.js` | Extension page; извлекает метрики из attachment names, строит детерминированный план «было → станет» и запрещает молчаливое применение неоднозначных строк. |
| Confluence report apply | `confluence-report.js`, `confluence-report-storage.js`, `confluence-report-apply.js` | Page controller владеет выбранными связями и REST transport; storage преобразует исходную разметку; apply загружает вложения, выполняет page update и post-save verification. |
| Profiles storage | `dashbridge-profile-store.js` | `dashbridge-profile-controller.js`. |
| Profiles UI/lifecycle | `dashbridge-profile-controller.js` | `dashbridge.js`; tab-local selection, cross-tab sync, panel-state checkpoint. |
| DashBridge iframe transport | `dashbridge-iframe-message-controller.js` | Двусторонняя trust boundary: guarded post/navigation reset, проверка source + exact origin, dispatch report/analysis/capture/tools/crosshair и iframe ready/rendered lifecycle. |
| DashBridge time/URL lifecycle | `dashbridge-time-controller.js` | Profile-owned range/refresh, controls, clipboard, theme-aware panel URL, iframe time broadcast and Refresh Off transition. |
| DashBridge panel tools/status | `dashbridge-panel-tools-controller.js` | Нормализация tools, settings modal, correlated title/legend/threshold requests, threshold state and notifications. |
| DashBridge card/iframe/action lifecycle | `dashbridge-panel-card-controller.js` | Создание и точечная замена карточек, drag/reorder, eager iframe navigation, refresh/pause/fullscreen/delete/settings actions, reconciliation и единый cleanup удаления. |
| Верхний UI DashBridge | `dashbridge-page-ui-controller.js` | Header/dropdown, профильные действия, capture и crosshair controls, делегирование setup добавления/transfer и закрытие transient UI по Escape/outside click. |
| DashBridge panel analysis UI | `dashbridge-panel-analysis-controller.js` | Классификация и toolbar-action панели, CPU/RAM modal, exact iframe/request correlation, retry after iframe readiness и cancel cleanup. |
| Неблокирующие модальные диалоги DashBridge | `dashbridge-modal.js` | Профили, импорт/экспорт, настройки и capture в `dashbridge.js`. |
| URL и идентичность панелей DashBridge | `dashbridge-panel-url.js`, `grafana-panel-identity.js` | Нормализация URL и поиск дублей для добавления, импорта и iframe-настроек. |
| Добавление панелей DashBridge | `dashbridge-panel-addition-controller.js` | Одиночный URL, список ID и dashboard picker; безопасный inventory, дедупликация и применение к активному профилю. |
| JSON transfer панелей DashBridge | `dashbridge-panel-transfer.js`, `dashbridge-panel-transfer-controller.js` | Полный export payload, строгая нормализация import, новые ID, FileReader/download lifecycle и применение результата к профилю. |
| UI сводного отчёта и SLA | `dashbridge-report-ui.js` | Настройка профиля, редактор фраз панели, валидация warning/critical и modal cleanup; состояние передаётся через явные callbacks `dashbridge.js`. |
| Transport сводного отчёта | `dashbridge-report-transport.js` | Ожидание iframe, request ID, timeout/abort и точная корреляция ответа. |
| Orchestration сводного отчёта | `dashbridge-report-controller.js` | SLA панели, параллельный сбор, карточки ошибок, preview и общий live collector Message Test Runner. |
| Вложения сводного сообщения | `dashbridge-report-attachments.js` | Extension-page preview: выбор панелей, отмена, PNG в памяти, частичные результаты, clipboard/download и cleanup Blob URL. |
| Сборка коллажа | `dashbridge-report-collage.js` | Ограниченная сборка готовых PNG в Canvas без доступа к Grafana, storage или transport; вызывается владельцем вложений. |
| Аудит сводного отчёта | `dashbridge-report-audit.js` | Чистый анализ переменных, `panel:key`, семантической применимости живых значений по каждой включённой панели и итогового текста без UI и записей. |
| Message Test Runner | `dashbridge-report-test-runner.js` | Детерминированные сценарии всех ветвей рендера и один живой интеграционный прогон активного профиля через общий collector `dashbridge.js`. |
| TDM export | `popup-tdm.js`, `popup-tdm-page-export.js` | Popup владеет пользовательским действием, настройками и download lifecycle; отдельная самодостаточная функция исполняется через `chrome.scripting.executeScript` внутри активной TDM-страницы. |
| Снимки DashBridge | `dashbridge-capture.js` | Общий prepared-toggle, broadcast размеров, одиночный save/copy, последовательный ZIP, throttling и восстановление карточки. |
| Версия данных DashBridge | `dashbridge-data-migration.js` | Startup `dashbridge.js`. |
| Import/recovery | `local-state-schema.js` | Options, Worklog, profiles. |
| Options config transfer | `options-config-transfer.js` | Options: allowlist/schema, validation, backup, FileReader/Blob URL и import/export lifecycle. |
| Local writes | `storage-writer.js` | Profiles, Worklog, Batch. |
| Worklog Jira transport | `worklog-jira-client.js` | Auth/issue/worklog HTTP, timezone serialization и Jira payload; page controller владеет таблицей/cache/history. |
| Sync input writes | `sync-input-writer.js` | Частые поля UI. |
| Bounded diagnostics | `bounded-journal.js` | MAIN и test tooling. |
| ZIP/лимиты | `archive-download.js`, `archive-budget.js` | Batch, exports. |
| Batch panel-rules UI | `batch-panel-rules-ui.js` | `batch.js`; editor, validation, delayed persistence and stale-load guard. |
| Batch operation lifecycle | `batch-operation-controller.js` | `batch.js`; cancellation, progress, capture-window ownership and archive helpers. |
| Batch page UI/state | `batch-page-controller.js` | Вкладки, уведомления, журнал, режим панелей, progress UI, темы снимков, нормализация диапазонов, синхронизация полей Main/Series и переключатель подробного `batch-debug.jsonl` в шапке. Настройка читается перед первым запуском и сохраняется в `chrome.storage.sync`; по умолчанию подробные логи включены. |
| Batch main run | `batch-main-run-controller.js` | Валидация и последовательный сбор полного dashboard, panel rules, PNG/ZIP manifest и частичный результат через общий operation lifecycle. |
| Batch Series discovery | `batch-series-discovery-controller.js` | Dashboard API/query signatures, временная Grafana-вкладка, ранний MAIN capture, bounded settle/timeout, abort cleanup и fallback `panel-ID`/numeric ID. |
| Batch Series run | `batch-series-run-controller.js` | Group/standalone selection, legend filtering, sequential capture, ZIP manifest, partial result и cleanup discovery tab через общий operation lifecycle. |
| Recorder network capture | `recorder-network-capture.js` | CDP request/response correlation, bounded body/stream/page capture и completeness; session transport передаётся явно. |
| Recorder session transport | `recorder-session-transport.js` | Lifecycle port/heartbeat, CDP attach/detach/configuration, controlled/incognito window и scoped scenario injection. |
| Recorder settings | `recorder-settings.js` | Persistent site/network-mode settings, debounced save и one-shot draft восстановления после incognito permission reload. |
| Recorder action capture | `recorder-action-capture.js` | Navigation/action normalization, stable locator priority, duplicate change/submit suppression и request-to-step attribution. |
| Recorder session orchestration | `recorder-session-controller.js` | Record Start/Stop, pending body settlement, ephemeral-window cleanup и аварийная финализация без владения CDP transport. |
| Recorder DashFlow orchestration | `recorder-dashflow-controller.js` | Save preflight, manifest/network/HAR/body assembly, download URL lifecycle и atomic validated import commit. |
| Recorder replay | `recorder-replay.js` | `recorder.js`; step normalization/execution, navigation and network-idle waits. |
| Анализ CPU/RAM | `grafana-panel-analysis.js` | Расчёт, thresholds и clipboard-формат кнопок CPU Usage/Memory. |
| Grafana time | `grafana-time.js` | DashBridge, iframe. |
| Clipboard диапазона | `grafana-time-picker-clipboard.js`, `dashbridge-time-state.js` | Direct Grafana, DashBridge. |
| Theme и UI scale | `pages/shared/theme.js`, `pages/shared/theme.css`, `pages/shared/theme-compat.css` | Все extension pages; compatibility CSS загружается между core theme и page stylesheet. |
| Проверка обновлений | `update-check.js`, `popup-updates.js`, `background-update-indicator.js` | Popup проверяет доверенные release metadata; service worker владеет action icon/title и их восстановлением. |
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

#### Автоматические переменные Grafana

Добавление одиночного URL, списка ID и выбор панелей дашборда проходят
проверку подключения в `dashbridge-panel-addition-controller.js`. Неизвестный
хост предлагается добавить в «Grafana → Подключение»; отмена сохраняет форму
и не добавляет панели. Команда `dashbridge-grafana-connection` принимается
service worker только от точной страницы DashBridge. Владелец
`background-grafana-infrastructure.js` проверяет HTTP(S), отсутствие credentials
и dashboard route, сериализует добавления и сохраняет только нормализованный
host в `grafanaIframeDomains`, с пределом 100 подключений. Ответ дожидается
MAIN registration и tab-scoped DNR перед первой навигацией iframe.
Повторное добавление не создаёт дубль; ошибка не добавляет панель. Если запись
подключения прошла, а настройка runtime не удалась, сохранённый хост остаётся
в Options, повторная попытка заново согласует инфраструктуру.

`dashbridge-variables-controller.js` (extension page) создаёт группы полей из
панелей активного профиля; ключ группы — origin, base path, dashboard UID и
orgId. `dashbridge-variables-state.js` владеет чистой валидацией снимка и URL
codec: повторяющиеся `var-*`, All и сохранение остальных параметров. Выбор
хранится в существующих `panel.src`, поэтому legacy schema и panel JSON export
не требуют нового хранилища. Варианты остаются в памяти страницы.
Поля используют общую именованную группу HTML details: одновременно открыт
только один список переменных, включая открытие с клавиатуры.

`grafana-variables-bridge.js` (isolated, только именованный iframe) принимает
`dashbridgeVariablesRequest` от exact extension origin + parent, допускает
один запрос и передаёт correlated `dashbridgeVariablesResponse`. MAIN-модуль
`grafana-variables-runtime.js` читает живые Scenes objects через ограниченный
React ancestor traversal либо `@grafana/runtime.getTemplateSrv()`. Он не
реализует datasource queries и не создаёт дополнительные dashboard iframe.
Списки ограничены 100 переменными, 5000 вариантами на поле и длиной JSON
не более 2 000 000 единиц UTF-16 (`String.length`), а не 2 MB UTF-8.
Все listeners/watchdogs принадлежат документу и очищаются при pagehide.
Обычный `read` возвращает готовый непустой список без искусственного окна
стабилизации; пока native-поля имеют признак loading, runtime проверяет их
каждые 200 мс с общим пределом 20 секунд. Мутации и пустой реестр при старте
требуют трёх стабильных интервалов; пустой список не ждёт полного таймаута.

Изменение выбора навигирует одну панель с новым значением и без старых
URL-значений зависимых полей, давая Grafana пересчитать зависимости при загрузке.
Этот путь одинаков для Scenes и legacy: предварительный `changeValueTo` не
вызывается, чтобы не запускать дополнительный цикл запросов и перерисовки.
Затем контроллер записывает согласованные значения в URL панелей группы и
пересоздаёт остальные через штатный card lifecycle. Исходная панель уже прошла
навигацию и сохраняется; у её карточки обновляется ссылка открытия.
Пересоздание остальных панелей необходимо
для legacy SoloPanel, где location-only update меняет адрес, но не template
state. Ошибка до commit сохраняет прежние URL; другие профили не меняются.
Последующие refresh, смена темы и абсолютного времени строят URL из сохранённого
`panel.src`: атрибут `iframe.src` после native Scenes update может быть устаревшим.
Reset удаляет URL-значения транзитивно зависимых переменных, найденных
по штатным `$name`, `${name:format}`, `[[name:format]]` ссылкам в query,
datasource, regex и definition. Их новые значения выбирает Grafana при загрузке.
Обычное чтение не записывает выбранные значения. Явное обновление вариантов
может изменить недопустимый выбор штатным механизмом Grafana и согласовать
его с остальными панелями группы.
Пауза не снимается фильтрами; card creation допускает отсутствие iframe. Новая панель существующей группы наследует её
выбор; удаление последней панели убирает группу.

Поддерживаются URL-синхронизируемые query, datasource, custom, interval и
textbox поля. Hidden/constant не показываются. Ad hoc, пользовательские типы
и skipUrlSync пока представлены как неподдерживаемые с переходом в исходную
Grafana: их семантика не имитируется. Scenes refresh использует штатный метод,
legacy refresh — загрузку панели. Списки показывают все полученные варианты,
поиск фильтрует их без дополнительного лимита отображения. Это граница текущей совместимости,
а не обещание поддержки всех будущих внутренних API Grafana.

При обновлении legacy-полей карточка пересоздаётся, даже если URL не изменился:
присваивание того же URL с fragment не гарантирует новое событие готовности.
Ожидание коррелируется с новым iframe; старые ready/response отклоняются.

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
dashbridge-iframe-message-controller.js
  → dashbridge.js ↔ двусторонний postMessage конкретного iframe
dashbridge-panel-analysis-controller.js
  → dashbridge.js ↔ выбранный iframe CPU/RAM analysis
dashbridge-panel-tools-controller.js
  → dashbridge.js ↔ настройки, legend/title/threshold ответы конкретного iframe
grafana-iframe.js (isolated) ↔ grafana-panel-tools.js (MAIN)
```

Кнопка копирования в меню профилей вызывает `cloneProfile` владельца
`dashbridge-profile-controller.js`: глубокая копия настроек и текущих панелей,
новые ID профиля/панелей и перенос `report.panelOrder`. Отмена имени не меняет
состояние; подтверждение переключает вкладку на копию через штатное сохранение
и сброс runtime отчётов. Общих изменяемых объектов с оригиналом нет.
Добавление панели по ссылке, списку ID и через picker ожидает результат
profile commit перед закрытием формы и success. При ошибке добавленные карточки
остаются dirty draft, форма и выбранные значения сохраняются. Повтор той же
формы сохраняет существующий draft без повторного добавления карточек.
Параллельные сохранения формы блокируются; поздний commit после закрытия,
смены ввода или профиля не завершает устаревшую форму.

Поддерживаются профили, drag-and-drop, ширина 33/50/100%, высота, fullscreen,
тема iframe `follow`/light/dark, пауза, общий период/refresh, копирование и
вставка диапазона, курсор `line`/`off`, настройки, одиночные снимки и ZIP всех
активных панелей текущего профиля.
Абсолютный диапазон в header отображается компактно до минут; редактор и tooltip
сохраняют секунды. DashBridge не вводит собственный timezone профиля и не
удаляет существующий параметр `timezone` из URL панелей.
`DashBridgeTimeState.formatForUrl` передаёт абсолютные границы в epoch
milliseconds для навигации и `DASHBRIDGE_TIME_UPDATE`, независимо от формата
сохранённой ссылки. В живой Grafana 12.2.0 ISO-границы `/d-solo/` были
проигнорированы: datasource получил текущий fallback-период вместо выбранного.
Миллисекунды сохраняют тот же момент с учётом offset и дробной части секунд;
выражения `now` остаются без изменений. Исходная ссылка профиля не переписывается.
Проверка реального codec — [time state](../test/dashbridge_time_state_behavior.js).
`parseGrafanaAbsoluteTime` в `js/shared/grafana-time.js` проверяет календарные
компоненты числовых дат и ISO до преобразования: 30 февраля не переносится
молча в март. Валидируются високосный год, часы, минуты, секунды и zone offset.
DashBridge Apply и чтение истории используют этот parser до изменения state.
Batch подключает helper перед `grafana-url.js` и вызывает его с
`numericDates: true`: `dd/mm/yyyy` и дата без времени означают локальный ввод.
Без этой опции стандартная ISO-дата без времени сохраняет прежнюю UTC-семантику.
Unix seconds в Batch и произвольный числовой epoch-ввод DashBridge остаются
адаптерами их владельцев; относительные выражения не вычисляются парсером.
`normalizeGrafanaTimeRanges` отклоняет начало позже окончания для абсолютных
границ до открытия capture URL. Равные границы и смешанные/относительные
периоды сохраняют прежний контракт. Проверки: [Batch ranges](../test/grafana_time_ranges_behavior.js),
[Apply/history](../test/dashbridge_time_controller_behavior.js) и
[ZIP integration](../test/batch_confluence_period_integration_behavior.js).
История выбора времени принадлежит `dashbridge-time-controller.js`: четыре
последних уникальных диапазона с хотя бы одной абсолютной границей, новые
сверху. Клик применяет диапазон штатным путём один раз. Локальный ключ
`dashbridge.timepicker.history` общий для профилей этой установки, не входит
в экспорт профиля и перечитывается при открытии picker. Epoch milliseconds
сохраняют точный момент; подписи используют часовой пояс браузера. Относительные
границы смешанного диапазона остаются выражениями `now`. Ошибка хранения не
блокирует время; чтение ограничено 4 КиБ, записи валидируются и дедуплицируются.
Образец поведения — Grafana v12.1.0 `TimePickerWithHistory.tsx` и
`TimePickerContent.tsx`; код компонента Grafana не включён в расширение.
Кнопка «Переменные дашборда» открывает нативный modal dialog без индикатора
на кнопке. Сохранённый в памяти список показывается сразу; если снимок старше
минуты, отсутствует либо предыдущая попытка завершилась ошибкой, открытие
перечитывает все поля из живого iframe без навигации и записи выбора. Уже
выполняющаяся операция не дублируется. Отдельной кнопки «Обновить поля» нет;
«Обновить варианты» внутри поля сохраняет принудительное обновление через
Grafana. Статусы ожидания и ошибок остаются внутри групп. Закрытие кнопкой,
по фону или Escape не останавливает transport и синхронизацию; Escape сначала
закрывает раскрытый список, затем окно, возвращая фокус кнопке. Смена профиля
и stop закрывают окно; все его listeners принадлежат контроллеру переменных
и снимаются при stop. Без доступных групп кнопка скрыта.
Выпадающие переменные размещаются внутри viewport контроллером переменных;
его resize/scroll listeners удаляются при stop. Список ограничен доступной
высотой и прокручивается независимо. Внутренняя прокрутка списка и его кнопок
не запускает пересчёт положения того же меню: иначе resize scrollport может
снова скрыть кнопку «Применить». Прокрутка окна и диалога по-прежнему
перепозиционирует меню. Название источника на тесной раскладке
занимает отдельную строку. Выбор времени закрывается явной кнопкой и Escape
с возвратом фокуса к кнопке открытия. Эти изменения extension-page UI не
меняют Grafana renderer, URL переменных и сохранённые размеры панелей.

Набор профилей и их сохранённые настройки синхронизируются между вкладками
через `chrome.storage.local`, но выбор активного профиля принадлежит вкладке и
восстанавливается из `sessionStorage`. Live threshold-состояния, уведомления,
report waiters и итоговый текст существуют только в JS/DOM runtime своей
вкладки и через storage не передаются. Смена активного профиля отменяет
незавершённый сбор и закрывает preview сообщения прежнего профиля.

Profile commit передаёт `expectedProfiles`: fingerprints нормализованных
профилей из базового снимка вкладки (null для нового ID). Background broker
проверяет ожидания внутри своей очереди до любых изменений; устаревший upsert
или delete отклоняется атомарно. Повтор уже применённой записи/checkpoint
идемпотентен. Это проверка целого профиля, а не автоматическое слияние полей.
Устаревший клиент без expectedProfiles должен обновить страницу.
Ошибка сохранения видима пользователю, не помечается success в profile analytics
и останавливает storage reload, чтобы не потерять локальный черновик. Повтор
после временной ошибки разрешён; конфликт требует сохранения черновика и
перечитывания актуального состояния. Редакторы сообщения остаются открытыми
при ошибке и проверяют ID/базовую конфигурацию перед применением; одинаковая
конфигурация в новом объекте профиля сохраняется в актуальный объект.
Каждый новый save отменяет принятие уже начатых storage reads. При синхронизации
store возвращает нормализованный снимок без изменения CAS baseline; controller
принимает baseline вместе со снимком только после проверки актуальности.
Поэтому запоздавшее чтение не стирает успешную правку или несохранённый черновик
и не разрешает конфликтующему повтору перезаписать данные другой вкладки.

Окно настроек графика также проверяет profile ID, panel ID, URL и исходные
tools перед сохранением, заново находя актуальный объект панели. Эквивалентная
замена объекта допустима; удаление, смена профиля или настроек отклоняют Save.
Ошибка остаётся в открытом окне вместе с черновиком; повторный Save заблокирован
до окончания записи. Общий modal закрывается после успешного callback;
результат `false` сохраняет окно, прежний `undefined` direct Grafana остаётся
успехом. Смена профиля во время первоначальной загрузки отменяет открытие окна.

Options хранит базовый список Grafana-подключений. Общая кнопка Save не пишет
его, если поле не менялось. Изменённый список проходит команду
`dashbridge-grafana-connections-replace` и compare-and-set в той же очереди,
что configureConnection. Конфликт не удаляет подключения, добавленные другой
вкладкой; явное удаление с актуальной базой поддерживается.
Каждый iframe помечается ID активного профиля и уникальным ID runtime конкретной
вкладки DashBridge. Сообщение принимается только при совпадении обоих значений;
после переключения старый iframe отклоняется до dispatch, даже если другой
профиль повторно использует UUID панели. Полный render выполняет cleanup
threshold-состояния и уведомлений каждой прежней карточки до удаления DOM.
Правая легенда адаптивна и не резервирует половину ширины графика.

Пока MAIN показывает пояснение пустого ответа/ошибки, `grafana-dom.js`
создаёт принадлежащий поколению panel-tools контроллер скрытия native `No data`.
Он не зависит от включённых CPU/RAM/series transforms и отслеживает позднюю
вставку, изменение текстового узла и замену панели через MutationObserver с
одним RAF. В обычной Grafana область ограничена найденной панелью; только в
именованном DashBridge iframe допустим поиск по его body. Текстовые контейнеры
div/span/p поддерживают вложенную разметку; кнопки, заголовки и легенда не
скрываются. Собственные style-изменения не наблюдаются. При восстановлении
данных, изменении текста или cleanup исходный inline visibility восстанавливается,
observer отключается при отсутствии пояснения, отложенный RAF отменяется.

`Refresh Off` не может быть выражен простым отсутствием query-параметра:
Grafana тогда восстанавливает refresh, сохранённый в dashboard model. Поэтому
DashBridge передаёт намерение `off` во fragment, который не уходит в HTTP, а
ранний самодостаточный `grafana-refresh-policy.js` читает fragment напрямую и
только в именованном DashBridge iframe одноразово перехватывает первый
same-origin GET определения dashboard, меняя только `dashboard.refresh`. Он не
зависит от загрузки общего bootstrap helper и не использует несовместимый между
версиями Grafana query-параметр `refresh=off`. В SoloPanel-сборках, где
dashboard definition вообще не запрашивается, тот же ранний guard подавляет
только interval с сигнатурой `SoloPanelPage → setupIntervalTimer`; остальные
таймеры, запросы, direct Grafana и интервалы, отличные от Off, проходят без
изменений.

Профиль также хранит шаблон сводного сообщения и контекст теста, а панель —
SLA-карточку с источником `graph`/`custom`/`none`, режимом агрегации,
предупредительным и критическим уровнями, шаблоном строки списка и
формулировками. `profile.report.panelOrder` независимо задаёт порядок фраз в
сводке: drag-and-drop в настройках сообщения не переставляет карточки основного
дашборда, неизвестные или удалённые ID игнорируются, а новые панели добавляются
в конец в порядке дашборда. По
команде пользователя `dashbridge.js` параллельно отправляет каждому активному
iframe запрос `collectPanelReportSnapshot`. MAIN-runtime читает видимые серии
uPlot/Flot. Для видимой table-panel он сохраняет ограниченный DOM-снимок с
исходными отображаемыми строками и предпочитает точные числовые значения из
текущего renderer DataFrame выбранной таблицы; наличие DOM-таблицы служит guard, чтобы
однозначные Stat/графики не классифицировались как Table. Если response shape
не распознан, числовая агрегация использует существующие response metadata либо
полный DOM-набор; частичный DOM не подтверждает SLA всей таблицы. Снимок таблицы
доступен шаблону как `{{tableMarkdown}}`, а размеры — как
`{{tableRowCount}}` и `{{tableColumnCount}}`; Markdown сохраняет подписи Grafana,
экранирует управляющие символы и ограничен 20 колонками и 100 строками.
MAIN возвращает коррелированный `panelReportSnapshot`; родитель
проверяет точные `origin`, `source` и iframe до принятия ответа. Timeout,
отсутствие данных, пауза и ошибка конфигурации являются неизвестным результатом,
а не успешным прохождением SLA. Шаблоны обрабатываются как простой текст без
`eval` и HTML-рендеринга.

Повторное чтение snapshot после `dashbridgePanelDataSettled` или DOM mutation
объединяется одноразовым timer, а не animation frame: Chromium может остановить
RAF у iframe вне viewport. Timer принадлежит конкретному запросу и очищается
вместе с observer/listener при ответе, отмене, deadline и смене MAIN generation.
Постоянный polling и принудительная прокрутка для чтения данных не добавляются.

Контроллер `dashbridge-report-controller.js` обрабатывает ошибки настройки SLA.
Ошибка (`dataStatus: configuration_error`), например выбранный выключенный порог графика, показывается
в результатах проверки сообщения и предупреждениях preview с названием панели
и причиной. Она не создаёт overlay поверх работающего графика и не меняет
настройки порога; результат SLA остаётся ошибкой, а не успешной проверкой.
`setPanelDataStatus` оставляет parent overlay только для timeout, отсутствующего
iframe и ошибки отправки запроса. Проверки:
`test/dashbridge_report_controller_behavior.js` и
`test/dashbridge_report_test_runner_behavior.js`.

Проверка сообщения получает промежуточные результаты того же параллельного
сбора: `collect` передаёт вторым аргументом `onProgress` список панелей,
`completed`/`total` и, после ответа, `panel`/`snapshot`. Первый текстовый аргумент
сохранён для preview. Проверка показывает готовые результаты и ожидающие панели
до завершения всего сбора; ошибка настройки появляется без ожидания остальных
iframe. Пока сбор идёт, итог не объявляет общий успех. Полный аудит шаблонов и
сборки сообщения выполняется после всех ответов. Промежуточные результаты не
сохраняются в профиль. Закрытие отменяет сбор; поздние ответы не обновляют UI.
Обновления сохраняют раскрытые результаты и фокус на их заголовках.
Контракты проверяют `test/dashbridge_report_controller_behavior.js` и сценарий
с готовой, ошибочной и задержанной панелями в
`test/support/browser-dashboard-visual.js`.

Общий запуск «Сформировать текст и скриншоты» принадлежит
`dashbridge-report-controller.js`. `dashbridge-time-controller.js.beginReport`
выдаёт временный lease: один момент времени переводит относительные границы в
абсолютные, затем активные iframe навигируются с существующим Refresh Off.
Старые документы и их незавершённые запросы не участвуют в новом сборе.
Каждый запуск добавляет временный уникальный `_t`, как штатное обновление
панели: даже при уже абсолютном периоде и Refresh Off браузер создаёт новый
документ. Повторное присваивание того же URL с fragment может сохранить старый
документ без нового iframe-ready; сбрасывать готовность при таком переходе нельзя.
Параметр принадлежит lease и не сохраняется в профиль.
Постоянный time state и storage не меняются; iframe-ready сообщения используют
временный период. Release идемпотентен и восстанавливает только iframe,
которые всё ещё принадлежат временной навигации, не перезаписывая чужую смену URL.
Контроллер освобождает lease в finally при успехе, ошибке и отмене; общий
watchdog ограничивает операцию четырьмя минутами, pagehide закрывает preview.
Сбор ждёт load новых документов с отдельным лимитом 90 секунд и отменой.
Перед принятием коллажа повторно читаются snapshots включённых в сообщение
панелей: при первом расхождении весь сбор повторяется один раз внутри того же
lease, повторное расхождение отклоняет коллаж. Это проверка отчётных
значений, а не атомарная транзакция datasource и не сравнение всех точек графика.
Поддерживаются абсолютные границы и простая относительная арифметика s/m/h/d/w;
календарное округление требует явного абсолютного периода. Повтор съёмки из UI
собирает новый текст и весь выбранный набор; успешную часть можно принять явно.

Кнопка «Обновить данные» в общей шапке preview повторяет сбор при открытии:
обновляет текст и SLA панелей, сбрасывает прежний коллаж и сохраняет выбранную
вкладку. Ручной текст сохраняется с отдельным новым вариантом.
Название профиля и период не добавляются в коллаж; галочки заголовка нет.
Legacy-поле attachments.heading принимается при импорте для совместимости,
но не включает заголовок нового PNG.

Настройки скриншотов автоматически сохраняются
в `profile.report.attachments`: `slaOnly`, `heading`, `layout`, `panelOrder`,
`selectedIds` и `forcedIds`. Отсутствующий `forcedIds` означает пустой список;
не более восьми уникальных ID задают «Всегда добавлять скриншот». Неприостановленные
обязательные панели выбираются независимо от SLA и текстового report.enabled,
получая места до обычного отбора; итог сохраняет порядок скриншотов.
Значение selectedIds=null означает автоматический выбор подходящих панелей
на оставшиеся места, [] — явный пустой обычный выбор. Кнопка «Снять обычный выбор»
сохраняет обязательные панели; исключить их можно их переключателями.
Пауза исключает снимок, но не удаляет сохранённое обязательное включение.
Ручной выбор сохраняется
при временном отсутствии нарушения SLA; неподходящие панели не снимаются.
Если восемь сохранённых ручных ID уже заняты, явный выбор новой панели вытесняет
одно из сейчас невыбранных намерений (сначала без «Всегда»), чтобы новый выбор
сохранился при повторном открытии. Снятие «Всегда» сохраняет прежний ручной выбор.
Импорт и клонирование переносят ссылки на новые ID панелей. PNG и результаты
проверки SLA остаются только в текущем preview. Ошибка сохранения показывается.
Сравнение профилей при синхронизации и проверка конфликта записи не зависят от
порядка JSON-ключей: Chrome может переупорядочить их при передаче через storage.
Это не закрывает preview после собственного сохранения и не создаёт ложный
конфликт при следующем клике. Старые fingerprints открытых страниц принимаются
после нормализации порядка ключей; различие значений по-прежнему отклоняется.
Редактирование текста во время сбора не затирается: новый вариант показывается
отдельно и применяется по кнопке. Смена параметров во время сбора отклоняется.
Во время capture весь overlay скрыт через display, чтобы descendant styles не
возвращали его кнопки в снимок; исходные display/visibility/inert восстанавливаются.

Для `period_max` отчёт считает отображаемую колонку Max из легенды каноническим
набором отчётных рядов. Это исключает служебные uPlot-ряды, которые остаются на
графике, но скрыты из легенды, и не требует позиционного сопоставления: легенда
может быть отсортирована, а несколько внутренних рядов могут называться
одинаково (`Value`). При отсутствии Max в легенде используется renderer data.
Единица `percent` означает сырые `0…100`, а `percentunit` —
сырые `0…1`; оба варианта возвращаются в отчёт как отображаемые проценты.
Max из легенды пересчитывается из единицы каждой ячейки в единицу отчёта
через `grafana-unit.js`: смешанные ms/s/mins, SI/IEC bytes и компактные K/M/Mil
не сравниваются как голые числа. Неизвестные несовместимые суффиксы дают
явную ошибку единиц. DOM Metric/Value таблицы используют тот же пересчёт;
числа response-таблиц проходят коэффициент единицы исходных данных.
Суффикс `Mil` формата Grafana 12 `short` означает миллион, а не единицу
измерения; осевой коэффициент также учитывает этот масштаб. Без заданной
единицы table-parser распознаёт только поддержанные каноническим parser
count, bytes, duration и percent; неизвестный суффикс не получает factor 1.
DOM-снимок Metric/Value передаёт полноту разбора через `table.numericParse`
(`complete`, `numeric`, `invalidRows`), сохраняя публичный массив records.
При числовых данных или заданном SLA неразобранная/отсутствующая ячейка либо
пустое имя строки дают `configuration_error` / `table_numeric_incomplete`
с исходной таблицей, без частичного успешного SLA. Полностью текстовая таблица
с `source: none` остаётся информационной без выдуманных числовых значений.
Известные строки итогов Data Grid (`rdg-summary-row`, `rdg-bottom-summary-row`,
`rdg-top-summary-row`) не входят в DOM-таблицу и отчётные серии; само имя
`Total` не исключает обычный ряд. DOM по-прежнему ограничен видимыми строками.
По явному report request Table adapter ограниченно читает ancestor chain
выбранного grid, разрешая устаревший React DOM fiber через committed
`HostRoot.current` и membership его child chain. Grid rows length и
`column.field` identity должны совпасть с renderer DataFrame; поиск
останавливается до plugin/panel owner, без обхода dashboard, вызовов
React-функций или getters. Массивы, typed arrays и legacy Vector.get читаются
не более чем для 5000 строк. Полный текущий frame имеет приоритет над response
metadata; null/пустые/нечисловые значения не становятся нулём. Raw unit берётся
из numeric field.config.unit либо panel definition. Превышение cap или
частичный DOM без подтверждённого native frame возвращает
`configuration_error` / `table_data_incomplete`, без успешного SLA.
Полнота fallback учитывает aria-rowcount, header/summary rows и лимит
DOM-снимка; неизвестная полнота grid не считается полным набором. Response
metadata на границе 5000 записей также не доказывают полноту.
Metric/Value response metadata отклоняются целиком при пустом имени или
отсутствующем/нечисловом значении строки: частичный набор не обходит проверку
полноты DOM. Null и пустые строки исключаются до Number также в reduced-series
и числовом фильтре таблицы; настоящий ноль остаётся данными.
Literal таблица с source:none сохраняет информационный режим. Native records временные и не
входят в публичный table payload; Markdown остаётся снимком видимых строк,
totalRows/truncated учитывают известный полный размер. Наблюдение fetch/XHR
при всех выключенных tools, refresh для отчёта и постоянный polling не добавлены.
Сохранённая единица SLA пересчитывает значения, а не только подпись.
Анализ Memory различает десятичные KB/MB/GB и двоичные KiB/MiB/GiB.

Редактор фразы показывает источник «По фильтру Load Average» только для
панелей типа Load Average. Сохранение фразы сохраняет единицу SLA при неизменном
источнике и режим `issue_only` (предупреждение или нарушение).
Лимит `panel.report.listLimit` задаётся отдельно для панели: null или отсутствие
означает отсутствие ограничения, целое 1–50 ограничивает каждый список.
`breachesList` получает один лимит на объединение критических и предупредительных
рядов. Скрытая часть обозначается количеством записей и диапазоном значений;
агрегаты и счётчики по-прежнему относятся ко всему набору.
В строках с `{{unit}}` длительности автоматически отображаются в мкс, мс, с,
мин, ч или днях по величине значения. Каждая граница диапазона скрытых строк
форматируется отдельно; одинаковая единица указывается один раз в конце.
Числовая сортировка и SLA остаются в исходной общей шкале snapshot.
Шаблон строки без `{{unit}}` сохраняет исходный масштаб числа. Общие агрегаты,
пороги и таблицы сохраняют прежние единицы; другие типы метрик не масштабируются.
Стандартный блок подробностей `{{stateQuote}}` не добавляется повторно, если
основной шаблон уже содержит список соответствующего состояния или его надмножество.
Пользовательский шаблон подробностей сохраняется. Редактор не включает
`detailsEnabled` принудительно при сохранении лимита или текста.

Редактор фразы показывает источник «По фильтру Load Average» только для
панелей, распознанных общим `classifyPanelTitle` как `load`, с учётом настроенного
названия и суффикса `calculated`. На Load-панели без включённого фильтра источник
виден как ненастроенный; на остальных панелях отсутствует.

Общий контекст (`profileName`, `testName`, `environment`,
начала и длительности теста/стабильной нагрузки, `period`, `generatedAt`)
доступен в общем шаблоне, фразах, подробностях и строках списков. Владелец
`dashbridge-report-controller.js` передаёт его из активного профиля и вычисляет
обе длительности на один момент формирования. `{{panels}}` и именованные
`{{panel:ключ}}` — только вставки общего шаблона: фразы не раскрывают сводку
рекурсивно. Подставленные значения остаются текстом.

Message Test Runner проверяет fixtures для полного
каталога переменных, normal/warning/critical/no-threshold, недоступности,
режимов включения, именованных ссылок и 2500 серий. Затем он ровно один раз
получает реальные снимки активного профиля и отдельно проверяет конфигурацию,
каждый snapshot, фразу панели, живые значения и итоговый `compose`. UI явно
показывает краткий пользовательский итог и найденные ошибки; полный список
PASS/FAIL/WARN/SKIP, длительность, evidence и таблица только используемых
переменных доступны в сворачиваемой технической диагностике. Живые переменные
показываются отдельно по включённым панелям. Пустое значение не считается
потерей данных, если переменная семантически неприменима: например, unit у
безразмерной метрики, SLA-поля при `source: none` или списки отсутствующих
warning/critical рядов. Исключённые текущим include mode панели не создают
предупреждений о live-значениях. Runner ничего
не записывает в storage, а закрытие окна отменяет только принадлежащие ему запросы.

Профильный JSON экспортирует полные объекты панелей, включая `tools`, тему и
паузу. Импорт назначает новые ID, валидирует известные поля и сохраняет
неизвестные совместимые поля; legacy-поля игнорируются без delete-миграций.
`report.panelOrder` переносится на новые ID принятых панелей; ссылки на
отброшенные панели удаляются, неоднозначный старый ID относится к первой
принятой панели. Отдельный `showImportChoice` возвращает replace/create/null:
«Отмена», Escape и backdrop не изменяют профиль и не запускают сохранение.
Общий контракт `showConfirm` остаётся прежним.

Агрегация отчёта пропускает null/undefined/пустые строки до преобразования
в число; latest означает последнее доступное конечное значение, настоящий
ноль остаётся данными. Обогащение vCPU сохраняет ошибочные и неизвестные
состояния снимка. Пустой результат считается нормой только при явном
`filteredEmpty: true` и `dataStatus: filtered_empty`.

Перед чтением профилей `dashbridge-data-migration.js` выполняет идемпотентную
миграцию schema v0→v1: переносит legacy time state в каждый профиль,
нормализует выбранные Grafana settings и включает byte unit для подходящих
legacy memory-панелей. Исходное состояние один раз сохраняется в
`dashbridge_migration_backup_v0_to_v1`; schema marker записывается последним,
поэтому частичный сбой безопасно повторяется при следующем открытии. Модуль,
его script tag, startup-вызов, backup и marker удаляются только вместе после
контролируемого rollout.

Активные панели входят в ограниченную начальную очередь независимо от viewport.
`dashbridge-frame-load-controller.js` владеет очередью по точному origin внутри
вкладки: первая панель запускается сразу, остальные после подтверждения загрузки
её документа по ожидаемой идентичности панели, страницы login или общего
таймаута 30 секунд. Событие iframe load и correlated location probe с
`documentReady: true` подтверждают завершение навигации; canvas, таблица и ответы
datasource для освобождения очереди не требуются. Разные origins
независимы. Это уменьшает одновременные запросы обновления Grafana-сессии;
между отдельными вкладками сериализации нет. Пауза полностью исключает iframe.

Владелец отслеживает также явные refresh/time/report навигации, сохраняя их
синхронный запуск. `grafana-iframe.js` в isolated world отвечает на
`dashbridgeInspectLocation` только точному extension parent; ответ
`dashbridgeFrameLocation` содержит request ID, URL без fragment и отдельные
признаки готовности документа, Home и панельного DOM. Родитель проверяет source, origin, профиль, runtime scope,
поколение навигации, base path и идентичность панели. Подтверждённая главная
Grafana по ожидаемому base path вызывает ровно один повтор исходного URL.
Повторный Home или таймаут возврата к нужному документу показывает ошибку с кнопкой повтора;
login остаётся интерактивным и автоматически не перезагружается. Home/login
не отправляют обычные ready/title/rendered сообщения и не запускают панельный UI.
Проверка DOM не требует нахождения графика в viewport и не подтверждает готовность
данных для отчёта: у report/capture остаются собственные ожидания snapshot.

Освобождение очереди не завершает наблюдение за перенаправлениями: до появления
панельного DOM или deadline сохраняется однократное восстановление после Home.
Подтверждённый возврат к нужному документу снимает уведомление восстановления;
медленный renderer после этого не считается ошибкой навигации. Отдельный
`/api/user` или прямой вызов ротации cookies расширением не выполняется.

Load listeners, probes каждые 500 мс и общий deadline принадлежат записи iframe;
завершение останавливает таймеры, удаление/замена карточки отменяет запись,
полный render/pagehide очищает очередь. BFCache pageshow пересоздаёт карточки.
Устаревший ответ не может перезагрузить новую панель. Временный report lease
сохраняет также отложенный URL ещё не запущенного iframe и восстанавливает его
штатной явной навигацией. Изменение времени/темы до запуска обновляет отложенный
URL; очередь читает его при освобождении, а не запускает старый снимок настроек.
Новых storage keys и permissions нет.

DNR создаётся только для открытых вкладок `pages/dashbridge/dashbridge.html` и разрешённых
Grafana-хостов. Правила дополнительно требуют extension initiator. Закрытие,
замена вкладки и навигация с DashBridge запускают пересинхронизацию session
rules; вкладки с чужим pendingUrl не включаются в новый набор.

Host в DNR сопоставляется точным экранированным HTTP(S) regex, без неявного
разрешения поддоменов. Запись hostname без порта покрывает порты этого host;
запись host:port — только указанный порт, как у privileged sender guards.
Один regex объединяет все разрешённые tabIds для хоста: число правил зависит
от подключений, а не от произведения подключений и вкладок. Planner ограничен
1000 regex rules и сообщает truncation; tab/initiator/sub_frame guards сохранены.

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
- очистка helper принадлежит отправленному запросу: выключение фильтра или
  смена target до ответа не отменяют её и не удаляют чужие datasource refs;
- числовой фильтр и vCPU-фильтр взаимоисключающие;
- переключение вызывает штатный refresh, а не polling.

Один pipeline работает в direct Grafana и `pages/dashbridge/dashbridge.html`.

### Легенда

При перемещённой легенде `grafana-legend-visuals.js` согласует размер uPlot
с доступной chart branch после native View/dashboard resize и записи размеров
renderer. Panel-scoped ResizeObserver использует тот же RAF, что существующий
MutationObserver; совпадающие размеры не вызывают setSize повторно. OFF,
повторное применение и cleanup поколения отключают наблюдение размеров и
отменяют отложенный RAF. Наблюдение не меняет данные и не запускает refresh.
Пока compact capture владеет `__dashBridgeCompactSize`, пересчёт легенды
не переопределяет его временный размер; после restore обычное согласование
размеров возобновляется.

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

Подсвеченные участки серий рисуются body-level SVG поверх renderer. Последним
элементом этого SVG владелец threshold visuals добавляет `foreignObject` с
визуальной копией линии порога и её подписи, проецируя исходный DOM rect в
координаты overlay. Поэтому подсветка не закрывает порог даже в плотном графике.
Оригинал остаётся в панели и сохраняет единственный семантический marker;
копия помечена `aria-hidden`, не получает marker и не перехватывает мышь.
Проекция использует существующий repaint/scroll/resize/capture lifecycle SVG,
удаляется вместе с ним и не добавляет timers/listeners. Расчёты SLA не меняются.

Порог и числовой фильтр серий имеют независимые группы единиц ввода. Каждая
группа показывает до трёх соседних единиц, а без сохранённого выбора включает
среднюю; смена radio не переписывает число, а меняет его интерпретацию. Runtime всегда
сравнивает `thresholdRawValue`/`seriesQueryFilterRawValue`. Совместимые
`thresholdValue`/`seriesQueryFilterValue` остаются выражены в текущей единице
графика, а выбранное представление хранится отдельно в `thresholdInputUnit` и
`seriesQueryFilterInputUnit`. Семантическая единица сначала берётся из
`DataFrame field.config.unit`, если scoped response содержит одно семейство,
затем из `fieldConfig`/legacy panel definition; подпись оси используется для
текущего масштаба и как последний fallback. Неизвестные семейства единиц не
расширяются эвристически.

Превышение рассчитывается только по видимым сериям. Исторический ключ
`thresholdIncludeHidden` может оставаться в старом профиле, но runtime его
игнорирует; отдельная storage-миграция ради него намеренно не выполняется.

Уведомления порога в DashBridge и direct Grafana снимаются при получении
статуса без превышения, отключении порога или уведомлений. В direct Grafana
единственный toast помечен ключом панели: восстановление другой панели его
не закрывает. Повторный статус превышения не создаёт дубликат; после возврата
в норму новое превышение снова уведомляет. Подпись линии (Flot/uPlot, включая
снимки) и direct toast используют 12 значащих цифр, как поле настройки, чтобы
не показывать двоичный шум вида `3.9999999999999996 s`. Это форматирование
текста: raw-порог, сравнения, масштаб единиц и геометрия линии не округляются.

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
В `d-solo` Grafana параллельно с panel query выполняет `metricFindQuery` для
dashboard variables. Эти запросы проходят нативно и не входят даже в panel
loading/settlement cycle, поэтому запоздавшая переменная не может оставить
панель в `loading`, задержать Table report или перезаписать `data` ложным
`filtered_empty`/`empty_source`.
Это относится и к visual-only режиму iframe: fetch body читается для распознавания
`metricFindQuery` до изменения panel status. При полностью выключенном наблюдении
fetch по-прежнему проходит нативно без чтения body.

### Снимок панели

Окно «Сводное сообщение» содержит вкладки «Текст» и «Скриншоты»;
переключение сохраняет текст, выбор панелей и готовый коллаж. Report controller
владеет вкладками и навигацией стрелками/Home/End. Заголовок, вкладки и нижние
действия закреплены; на узком экране настройки и предпросмотр прокручиваются
внутри рабочей области. Предпросмотр вписывается в доступное место, а кнопка
«Увеличить» открывает native dialog с исходным размером и закрытием по Escape.
Владелец вложений закрывает dialog и освобождает его URL вместе с результатом.
Счётчик показывает выбор и лимит, подсказка — итоговую раскладку. По умолчанию
включён фильтр «Только панели с нарушением SLA»: выбираются первые восемь
неприостановленных панелей с `warning`/`critical` (legacy `breached`) по снимкам
последнего сформированного сообщения. Фильтр использует результат SLA панели,
а не её текстовый include mode; без SLA, в норме или без подтверждённых данных
панель не выбирается, причина показана в списке. Переключатель «Всегда добавлять скриншот»
обходит этот фильтр и текстовое включение, но не паузу и общий лимит восьми снимков.
Снятие фильтра позволяет выбрать
любые неприостановленные панели. «Выбрать доступные» ограничивается первыми
восемью подходящими панелями; ручной выбор более восьми блокирует формирование.
Порядок начинается с порядка отчёта и меняется отдельно в окне скриншотов
перетаскиванием за маркер. Перестановка уже полученных PNG
пересобирает коллаж без повторного захвата, не меняет порядок графиков или текста
и сохраняется в profile.report.attachments. Обновление сообщения пересматривает SLA и сбрасывает
прежний коллаж; изменение контекста снимает доверие к прежним SLA-результатам
до нового сбора на вкладке «Текст». Текст остаётся
отдельным clipboard-действием. `dashbridge-report-attachments.js` владеет
выбором, AbortController, UI, входными PNG и URL предпросмотра до закрытия окна.
Настройки вложений валидируются при импорте, ссылки selectedIds/forcedIds/panelOrder
переносятся на новые ID при импорте и клонировании. Изображения не сохраняются в storage
и не передаются в Telegram или аналитику.

`DashBridgeCapture.captureSelection` принимает выбранные панели, AbortSignal,
необязательный `waitForData(panel, signal)` и callbacks. Для отчёта controller
задаёт ожидание snapshot каждой выбранной панели независимо от report.enabled.
Ожидание выполняется после переноса карточки в видимую область, перед паузой
для layout и захватом. Используются source:none и evaluation:latest: проверка
готовности не зависит от порога SLA и не требует согласования Max смешанных осей.
Ошибка snapshot становится ошибкой конкретного снимка; AbortSignal проходит через
существующий транспорт с его таймаутом и cleanup. Одиночный снимок и ZIP не задают
этот callback и сохраняют прежний путь подготовки.
Живая проверка Grafana KNS 2026-09-10: задержка datasource на 15 секунд,
третья обязательная панель вне viewport и отключена от текста, PNG 1032×1768
содержит все три графика, scroll восстановлен в 0.

`DashBridgeCapture.captureSelection` также принимает
проверку контекста и callbacks прогресса/видимости. Lease принадлежит capture
controller и блокирует одиночный захват и ZIP до окончания восстановления.
Новая внутренняя output action `image` возвращает PNG только вызывающей
extension page; iframe получает прежний короткий результат без изображения.
Панели снимаются последовательно в prepared размере 1000×520 без изменения
глобального prepared preference. Используются существующий layout-change
мост и background broker с active-tab/URL guards. Во время захвата отчёт
скрыт, остальные области страницы inert; локальный progress скрывается на
время снимка, Escape отменяет очередь. Удаление/навигация iframe, смена
профиля или параметров отменяет либо отклоняет устаревший результат.

Сборщик декодирует по одному локальному PNG, рисует подписи и сетку, затем
освобождает bitmap и Canvas. Лимиты: 8 панелей, 64 МиБ входных PNG и итогового
PNG, 16 миллионов пикселей результата. Авто: от одной до трёх панелей вертикально,
от четырёх — две колонки; доступны явные column/grid. Подсказка UI использует
тот же расчёт geometry. Три панели дают 1032×1768 PNG, четыре — 2048×1184 без
общего заголовка. Смена раскладки переиспользует снимки. Частичный
результат требует явного выбора «Использовать успешные» либо повтора только
ошибочных панелей. Copy использует готовый Blob по отдельному клику;
ошибка не уничтожает PNG, доступно сохранение. Закрытие/смена контекста
освобождает ресурсы. Общий сбор использует описанный выше временный lease
с фиксированным периодом и Refresh Off; снимки последовательны, а сверка
отчётных значений не является атомарной транзакцией datasource.

```text
click в Grafana document
  → скрытие меню и при необходимости подготовка 1000×520
  → перестройка uPlot либо legacy Flot
  → isolated world / родительский DashBridge
  → captureVisibleTab → crop по DPR
  → download PNG либо Clipboard.write
  → finally: восстановление стилей, размеров, renderer и меню
```

Перед `captureVisibleTab` direct Grafana, DashBridge и MAIN-подготовка панели
используют общий `grafana-capture-output.js` checkpoint `waitForStableLayout`.
Он сравнивает геометрию панели, canvas и известных renderer-узлов в нескольких
кадрах браузера; смена узла или размера сбрасывает устойчивость. Проверка имеет
только верхний watchdog и является advisory: `deadline`, скрытый документ или
неизвестная геометрия продолжают захват, а отмена/pagehide освобождает все
listeners и RAF. Фиксированные задержки перед первым снимком не являются частью
контракта; отдельный rate-limit между частыми вызовами и correlation timeout
сохраняются как защита ресурсов и устаревших ответов.

Prepared mode сохраняет пропорции и вписывается в viewport. В DashBridge
временно меняются карточка и вложенная панель. Для legacy `.graph-panel`/Flot
обновляются container и plot; это нужно в том числе Grafana 10.1.10.
Native Table/Grid распознаётся до переноса панели, пока доступен её видимый
текст. Временный controller удерживает размеры контейнеров и положение панели;
полный список положительных pixel tracks Grid с совпавшим `aria-colcount`
переводится в пропорциональные tracks, чтобы значения не ушли за край снимка.
Observer снимается, исходные inline-размеры, transform и tracks возвращаются
в общем restore, в том числе при ошибке подготовки или снимка.

Copy выполняется максимально близко к клику из сфокусированного Grafana
document. Для долгого renderer isolated content bridge резервирует одноразовое
разрешение по `requestId` в момент клика, до ожидания adaptive layout checkpoint;
токен очищается после одного запроса или через bounded cleanup. Это сохраняет
защиту от произвольного DOM-события и не требует, чтобы transient user
activation жила всё время загрузки Grafana. Ошибка capture/crop/download/clipboard
также проходит восстановление.

Direct Grafana и DashBridge обращаются к общей очереди background capture.
Broker проверяет активную вкладку до и после ожидания и снимка; переключение
вкладки, document navigation или закрытие во время операции отменяют выдачу
изображения с `capture-target-changed`. URL-only изменения History API не
считаются навигацией: Grafana и DashBridge могут менять query/hash, сохраняя
тот же document. Слушатели снимаются в `finally`.
Перед `captureVisibleTab` service worker после повторной проверки отправителя
идемпотентно восстанавливает `grafana-capture-output.js` в isolated world именно
запросившего document. Это закрывает рассинхронизацию поколений MAIN/isolated
runtime в уже открытой вкладке после обновления расширения.

Popup-отчёт удалённой диагностики сохраняет последнюю ограниченную стадию
panel capture (`user-activation`, `capture-visible-tab`, `crop`, `download`,
`clipboard` либо `complete`), готовность MAIN/capture runtime и инвентарь
известных DOM-маркеров Grafana 9–13. Он маскирует значения dashboard variables
и секретные query-параметры, не читает cookies, ответы запросов и значения
временных рядов.

Если PNG уже создан, но Image Clipboard недоступен (в частности, на HTTP),
copy fail-open сохраняет тот же PNG через Downloads. MAIN capture runtime
показывает неблокирующий `role=status` toast с ручным закрытием и пятсекундным
таймером; смена runtime generation удаляет уведомление и timer. Решение
опирается на capability/error, а не на версию Grafana.

### Popup CPU/RAM

Сохранённые ссылки Popup переносят только параметры из `grafanaKeepParams`.
`openGrafana` заменяет каждый присутствующий параметр всеми его значениями
в исходном порядке: многозначная переменная Grafana кодируется повторяющимися
ключами. Отсутствующий параметр сохраняет значение целевой ссылки.
После очистки статусов при переключении вкладок `setupGrafanaTimestampTool`
снимает inline-скрытие перед новым результатом, оставляя отображение CSS.
Регрессии: [передача параметров и статус времени](../test/grafana_timestamp_clipboard_behavior.js).

```text
Popup → panel-tools bridge → command → ensure runtime + MAIN executeScript
      → общий transport → idle→load либо Total/Available→% Used
```

CPU и RAM разделяют transport, но не расчёт и шаблоны.
RAM-преобразование в `grafana-panel-data-transforms.js` атомарно заменяет
полные пары Total/Available (либо Total/Used при явном режиме Used) на
рассчитанный Used с единицей `percent` и согласованными display names.
В режиме Available отдельный исходный Used в bytes/default unit удаляется
только при совпадении подписи без роли метрики и всех labels, кроме
Prometheus `__name__`, с обоими источниками пары. Временные оси тройки должны
совпадать; несколько подходящих Used либо несовместимые оси оставляют весь
ответ без RAM-преобразования. Отсутствующая пара также оставляет ответ
неизменным. Несвязанные поля, другой label scope и явные процентные Used
сохраняются. Исходный Used не обязан численно равняться Total−Available:
пользовательская формула по Available остаётся `(Total−Available)/Total*100`.
Процентные фильтры и threshold ожидают успешного преобразования; OFF получает
исходный ответ и восстанавливает byte-unit штатным путём.
Предупредительный и критический пороги валидируются как пары `0..100`, где
warning строго меньше critical. Если для TOP-3 доступно меньше трёх серверов,
копирование использует построчный шаблон полного списка и не оставляет
неразрешённые placeholders.

### Batch

Готовность панели принадлежит `batch-panel-loader.js` и проверяется в MAIN.
Явное `No data` допускается; без него нужны завершённые наблюдаемые запросы
(`activeRequests === 0`, без обязательного диагностического `request-complete`)
и подтверждение визуализации. Для native Table/Data Grid подтверждением служит
видимая таблица с заголовками и непустыми строками через `grafana-table-report.js`;
таблицы легенды исключены, завершение запросов по-прежнему обязательно.
При compact capture native Table/Data Grid временно удерживает размеры panel
container и его предков внутри capture frame, а также сбрасывает grid transform.
Guard начинается до асинхронного resize, чтобы виртуализация не убрала строки
после смещения за viewport; restore снимает observer и возвращает inline styles.
Наличие произвольного SVG или его геометрии
не означает готовность: SVG принимается только для геометрии известных
series-контейнеров (series/line/area/bar, Recharts, Plotly, Highcharts), вне
осей, легенды и кнопок, в SVG размером более 50×50 CSS px.
Неизвестный SVG-плагин без остальных признаков renderer остаётся неготовым;
по deadline Batch возвращает ошибку вместо белого PNG. Это ограничение
эвристики, а не классификация панели по её названию или ID.
Series discovery перед MAIN waiter ждёт `complete` именно новой вкладки и URL
с текущим capture token. Это относится и к fallback между `panel-N` и numeric
ID: Promise `tabs.update` ещё не означает commit нового документа. Ожидание
ограничено 30 секундами; завершение, ошибка и отмена снимают listener и timer.

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

Окном захвата владеет `js/background-batch-capture.js` в service worker.
`batch-capture-runner.js` сохраняет facade acquire/release/id, но запрашивает
окно через порт `dashbridge-batch-capture` с exact sender страницы Batch.
Воркер создаёт окно сам: переданный клиентом windowId не даёт права закрыть
чужое окно. Disconnect закрывает только окно этой сессии, включая поздний
результат windows.create. Идентификаторы принадлежащих воркеру окон хранятся
в storage.session `dashbridgeBatchCaptureWindows`; при перезапуске воркера
оставшиеся окна закрываются. Клиент поддерживает активную аренду сообщением
каждые 20 секунд, только пока окно используется; interval снимается при release,
disconnect и pagehide. На pagehide также отменяется BatchRunLifecycle.
Перед закрытием подавляется только BeforeUnloadEvent, обычный Event.preventDefault
не меняется. Новый владелец не затрагивает Recorder/CDP и Test Runner windows.
Редактор правил показывает настройки отдельными блоками с переключателями.
Batch сохраняет также числовой фильтр отображаемых серий (max/last и подсветка),
фильтр Load Average по vCPU (коэффициент, max/last, Load 1m/5m/15m и
подсветка) и порог графика. Значения задаются в единицах исходных данных; после
CPU/RAM преобразования используются проценты 0–100. Это отдельный фильтр от
выбора имён Series. Фильтры Series и vCPU взаимоисключающие; RAM `% Used` и
принудительный byte-mode также взаимоисключающие. Порог не включает уведомления в временном окне сбора. Loader
ожидает применение порога к выбранной панели, а для числового фильтра — новый
преобразованный ответ после Refresh. Готовность renderer проверяется по canvas,
а не по скрытым SVG-иконкам меню перед графиком.
После компактной перестройки общий Batch capture повторно рисует включённый
порог в capture frame по окончательным размерам. В finally наблюдение временного
frame отключается до восстановления исходной панели.
Толщина задаётся постоянно видимым ползунком 0,5–5 с шагом 0,5 и подписью +N.N, как в DashBridge;
при выключенном утолщении ползунок отключён. На широком экране используются три
колонки: преобразования, фильтр серий и порог. На узком — одна колонка под ID
панели и кнопкой удаления.
Подробная диагностика пишется только для неуспешной панели: этап, категория
ошибки, panel ID/title, длительности, искомые селекторы, bounded DOM-контекст
соседних элементов, размеры/видимость canvas/uPlot/Flot/SVG, loading markers,
bounded network status и результат восстановления. URL, response body, cookies
и credentials в этот отчёт не попадают; manifest/error entry ограничены 100
записями.
Пустой whitelist является ошибкой и останавливает запуск; только явный режим
«Все панели» может расширить выбор до полного дашборда.

Каждый временной диапазон, включая единственный, получает
отдельную читаемую папку ZIP: `01 [26.08] 23h00-23h48` внутри одного дня и
`01 [26.08 23h00] - [27.08 00h48]` при смене даты. Формат использует только
допустимые в Windows символы; относительные Grafana-диапазоны сохраняют
технические значения `from`/`to`, поскольку календарной даты у них нет.

Batch и оба режима Batch Series передают метаданные задания в
`BatchOperationController.capturePanelToZip`: `panelId`, `panelTitle`, `from`,
`to`, нулевой `rangeIndex`; отдельная серия также несёт `seriesName` и
`occurrence`. `manifest.json` версии 3 хранит эти поля рядом с `file`.
Confluence группирует по `rangeIndex`, а не по имени папки: повторённые
одинаковые периоды остаются отдельными диапазонами. Папка служит читаемой
подписью; имя PNG не является источником дат или идентичности панели.
Schema отклоняет неполные записи и разные периоды внутри одного `rangeIndex`.
Архивы прежних версий нужно создать заново; обратная совместимость не требуется.
Preview использует метаданные manifest. Распознавание существующих изображений
на целевой странице Confluence по caption/filename остаётся отдельным контрактом.

### Worklog, Jira, TDM, Confluence

- Worklog хранит черновики/cache локально; import/recovery идут через schema.
- Worklog проверяет локальную календарную дату через `DashBridgeWorklogMetrics.parseDate`
  в контроллере страницы; этот же разбор используют итоги и подготовка даты для Jira.
  Календарь владеет одним обработчиком закрытия: capture-клик проверяется до замены
  DOM месяца, Escape/выбор даты/открытие другого календаря снимают обработчики.
  Переход месяца начинается с первого числа и сохраняет введённые часы/минуты;
  неверное время не меняет запись. Проверка: `test/support/browser-worklog-ui.js`.
- Название Jira-задачи обновляет только подпись и ссылку строки, сохраняя поля,
  фокус и нативную историю ввода. Ответ применяется только к тому же объекту
  записи и поколению изменения ключа. Редактирование отправленной записи,
  включая календарь, переводит её в черновик и сразу обновляет badge; Undo/Redo
  подтверждённой отправки сохраняют отдельный контракт acknowledgeHistory.
  Клонирование/удаление обновляют сумму видимой группы без полной перерисовки;
  Ctrl+Z/Y внутри редактора остаются нативными, вне редактора управляют строками.
- Jira REST URL и перенос записей проверяются до операции.
- TDM проверяет домен через `url-validation.js` до `executeScript`.
- Самодостаточный TDM export имеет общий десятиминутный watchdog. Ожидание
  image fetch, body, FileReader, scroll delays и передачи фото ограничено тем же
  deadline; timeout прерывает загрузку/чтение и проходит восстановление scroll
  в `finally`. Обычная ошибка загрузки сохраняет canvas fallback, timeout не
  маскируется этим fallback. Таймеры и abort listeners освобождаются владельцем.
- Confluence активен только для настроенных wiki-доменов. Его синхронный
  observer предотвращает скачок редактора и намеренно не debounce-ится.
- Внешние строки назначаются через DOM API/`textContent` либо экранируются.

Confluence Report — отдельная extension page. Scan читает REST storage и
attachments в сессии открытой страницы, без записи. Явная кнопка Apply после
сопоставления с Batch ZIP выполняет attachment POST, затем page PUT с версией
исходного снимка + 1 и контрольное GET. Конфликт версии или ошибка проверки
не объявляются успехом; уже загруженные вложения автоматически не откатываются.
Read-only live client остаётся владельцем чтения, requestTab page controller —
владельцем записи. Они исполняют запросы в origin выбранной HTTP(S) страницы
без credentials в URL; настройки wiki editor не ограничивают этот отдельный UI.
«Очистить связи» отключает Apply до нового сопоставления. Прямое соединение
и добавление графика/группы/раздела через `refreshMappingAfterAdd` восстанавливают
доступность кнопки. Этот UI lifecycle проверяет
[`browser-confluence-target.js`](../test/support/browser-confluence-target.js)
на локальном стенде, без записи в рабочую Confluence.

Точечная замена несёт offset изображения из исходного storage scan, а не
локальный occurrence группы. Все replacement selectors разрешаются на одной
исходной разметке до изменения: совпадение filename обязательно, конфликтующие
замены одной цели отклоняются, новые имена не становятся целями следующих замен.
Legacy occurrence означает индекс среди исходных изображений с тем же filename.
Specific-связь имеет приоритет над общей metric-связью; aggregate источник
выбирается по диапазону соответствующего теста. Якорь добавления сохраняет
идентичность исходного изображения при его одновременной замене.
Post-save verification сверяет версию, итоговую последовательность структурных
ссылок изображений, включая невыбранные, и расположение подписей добавлений.

### Traffic Recorder

Network capture применяет maxRequests также к ранним ExtraInfo placeholders
и redirect-записям. Бюджет тел резервируется до асинхронного SHA-256, чтобы
параллельные ответы не превышали общий cap. Ошибка или завершение сессии
отменяет незавершённую запись; резерв возвращается только своей сессии.

`pages/recorder/recorder.html` загружает session transport, который владеет
контролируемой вкладкой и CDP attach/detach.
Lifecycle-port с heartbeat поддерживает worker для best-effort аварийного
detach, если Recorder закрыт или перезагружен. Этот fallback не закрывает
incognito window и не восстанавливает реестр сессий после restart worker;
штатный cleanup и аварийный путь имеют разные гарантии, подробнее в
[DashFlow v2](dashflow-v2.md#владелец-записи-и-границы-cdp).
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
значений и ограниченный render-cycle. `recorder-session-transport.js` владеет
lifecycle-port, CDP attach/detach, controlled/incognito window и scoped
injection. `recorder-session-controller.js` владеет Record Start/Stop,
settlement незавершённых body capture, закрытием ephemeral window и аварийной
финализацией. `recorder-dashflow-controller.js` владеет save preflight,
сборкой архива, download URL lifecycle и атомарным применением полностью
проверенного импорта. `recorder.js` связывает session, replay и UI-контроллеры.
`recorder-replay.js` владеет replay lifecycle: нормализует шаги, ожидает DOM,
навигацию и network idle, проверяет отмену и завершает сравнение. Он получает
live session/CDP зависимости явно от `recorder.js`; transport остаётся
единственным владельцем контролируемой вкладки и debugger attach/detach, а
session controller — владельцем переходов Record/Stop и аварийной финализации.
Replay и Record устанавливают общий `state.starting` до первого await,
исключая конкурирующий старт и импорт. Stop во время подготовки помечает отмену;
после каждого шага PiP/permission/create/attach владелец проверяет её и запускает
cleanup через session controller. Ошибка подготовки снимает блокировку и
разрешает повтор, а `state.stopping` исключает новый старт до окончания cleanup.
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
Recorder показывает «Запись и трафик» и «Результаты перепроверки» как две
вкладки вверху страницы. `recorder-view.js` владеет переключением, keyboard
навигацией стрелками/Home/End и фокусом. Построение сравнения (также частичного
после остановки replay) открывает результаты автоматически; обычный render и
фильтрация не меняют выбранную вкладку. Сводные счётчики показывают весь
результат, таблица и Excel — выбранные фильтры. До первого сравнения доступна
подсказка; готовое сравнение без запросов имеет отдельное пустое состояние.
Новая сессия и успешный импорт сбрасывают вкладку и фильтры сравнения.
Состояние вкладок принадлежит документу и не сохраняется в storage.
Comparator сопоставляет occurrence запросов по step + method + полному URL и
классифицирует unchanged/changed/added/removed по status, MIME и SHA-256 body.
Отсутствие body в обоих ответах без иных отличий даёт `incomplete`
(«Недостаточно данных»), а не `unchanged`. Если доступность capture изменилась,
сохраняется `changed` с причиной `body capture`. Два явно пустых тела сравнимы.
Новый статус учитывается в UI-фильтре, счётчиках и формулах XLSX.
Replay ожидает `navigationUrl` клика и до 15 секунд ищет DOM target в записанном
frame URL. Recorder отменяет отложенный input snapshot на нативном change и
выбирает узкий интерактивный элемент из composed path.
Transport получает ID корневого CDP frame через `Page.getFrameTree`, включая
исходный `about:blank`; более новое корневое `Page.frameNavigated` имеет приоритет.
`Page.navigatedWithinDocument` создаёт flow navigation только для известного
корневого frame. События дочернего или пока неизвестного frame остаются в page
diagnostics и не становятся `navigate`/`navigationUrl` основной вкладки.
Окно Recorder обязано оставаться
открытым: его закрытие отсоединяет debugger и прекращает сессию.

Chrome запрещает `debugger` в optional permissions, поэтому permission
объявлен при установке, хотя attach выполняется только по Record/Replay.
Request/response body ограничены 5 МиБ на запрос и 100 МиБ каждого типа на
сессию; streams — 20 МиБ, metadata — 50 тысяч запросов, flow — 20 тысяч шагов.
Перед сохранением и импортом применяется общий memory preflight. `.dashflow` намеренно содержит введённые
password values и auth/cookie headers открыто и исключён из Git.

## Storage и состояние

Panel data runtime сопоставляет structured queries по полной сигнатуре либо
совпадению с шаблоном сохранённого target. Совпадения datasource/refId и легенды
недостаточно при явном несовпадении запросов. Dashboard-definition fetch
сохраняет base path Grafana; `/d-solo/`, включая подпапки, не вызывает этот API.
Повторный `open()` одного XHR очищает предыдущие слушатели, флаги завершения
и собственные response overrides; DONE и синхронная ошибка send завершают cleanup.

MAIN panel-state хранится в памяти с ключом из origin, base path, dashboard
UID, orgId и panel ID. Переход SPA на другой dashboard не применяет настройки
одноимённой панели. Публичный `keyFor` сохраняет renderer-контракт `panel-N`;
внутренний Map ограничен 500 записями с вытеснением старейшей записи по времени
записи.

| Область | Данные | Контракт |
|---|---|---|
| `storage.sync` | Grafana/Options, домены, compact capture, Popup, тема | Небольшие настройки; частые inputs debounce + flush. |
| `storage.local` | Profiles, backups, Worklog/cache, Batch, diagnostics/status, `dashbridgeUpdateIndicator`, `dashbridgeInstallationId` | Долговечные/объёмные данные, отдельный псевдоним аналитики и служебная версия доступного обновления. |
| `storage.session` | `grafanaVisualState:<tabId>`, `dashbridgeBatchCaptureWindows` | Состояние визуальных вкладок и реестр Batch capture windows для восстановления cleanup после перезапуска worker; это не постоянные пользовательские профили. |
| `localStorage` | Тема page, `dashbridge.timepicker.history` | Тема до paint с sync reconciliation; история времени локальная, до четырёх диапазонов. |
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

- `<all_urls>` нужен из-за неизвестных корпоративных доменов. Постоянная MAIN
  регистрация и backfill ограничены настроенными hosts/routes; explicit loader
  использует выбранный HTTP(S) dashboard URL, как описано в разделе загрузки.
- DNR session rules снимают XFO/CSP только в конкретных вкладках DashBridge;
  глобальное правило запрещено.
- URL: только HTTP(S), без credentials, после нормализации.
- Sensitive messages проверяют sender extension origin и allowlist keys.
- Web-accessible только `inject.js` и mark icon.
- Import, diagnostics и archives имеют schema/caps.
- `unlimitedStorage` сохранён для существующих больших профилей; удалять его
  можно только после измерения пользовательских данных.

Причины нестандартных механизмов и ссылки на их проверки собраны в разделе
[«Почему используются нестандартные механизмы»](#почему-используются-нестандартные-механизмы).
Описание намерения не заменяет проверку текущих guards и cleanup.

## Производительность и lifecycle

1. Повторная MAIN-установка очищает предыдущую generation.
2. Observer меню один на document и disconnect-ится при cleanup.
3. Threshold watcher принадлежит панели и удаляется с runtime/menu.
4. Панель на паузе не создаёт iframe; активные панели используют eager iframe
   после ограниченного начального ожидания первой панели своего origin.
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

Актуальное количество production-файлов и проверок печатают канонические
runners; документация намеренно не дублирует быстро устаревающие счётчики.
Все production JavaScript-файлы проходят синтаксическую проверку, а
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
`.dashbridge-local/e2e/browser-profile`; обе авторизации выполняются
вручную один раз внутри браузера, без передачи credentials тестовому коду.
`scripts/run-live-grafana-e2e.js` является внешним Playwright-оркестратором, а
не вторым владельцем сценариев: он открывает существующий extension Test Runner,
передаёт ему один или два dashboard URL и ждёт его публичный snapshot. Захват
evidence принадлежит `test-runner-diagnostics.js`, чистое bounded-сравнение
двух runtime snapshots — `test-runner-diagnostic-diff.js`, причинный
OFF→ON/reset и повторный refresh — `test-runner-transitions.js`, а стабильные ID и generated
Fast/Full матрицы — `test-runner-suite.js`. Оркестратор
пишет полный локальный JSON и компактный failure-report в игнорируемый
`test-results/`; в Node-процесс передаются только bounded console/network
evidence и диагностика проваленных тестов без изображений и крупных payload.
Снимок создаётся только при фатальной ошибке внешнего запуска.

UI Test Runner координирует запуск и таблицу в `test-runner-ui.js`.
Галочка «Сохранять скриншоты» включена по умолчанию и хранится в
`storage.local.trScreenshotsEnabled`. Значение фиксируется на запуск (во время
работы галочка отключена) и экспортируется как `screenshotsEnabled`.
При false diagnostics не создаёт canvas/panel/viewport PNG и не переиспользует
изображения; хеши, pixel statistics, DOM и семантические проверки сохраняются.
Поэтому OPFS, просмотр диагностики и JSON этого запуска не содержат снимков.
Изменение галочки после завершения относится к следующему запуску и не удаляет
изображения уже собранного отчёта.
`test-runner-diagnostic-viewer.js` владеет отдельными окнами описания/diagnostics,
theme listener и Blob URL одного теста; `test-runner-export-controller.js` владеет
Markdown/clipboard и потоковой записью полного OPFS diagnostic export.
`test-runner-visual-audit.js` владеет чистой классификацией outcome/reason и
проверкой полноты visual/semantic evidence; `test-runner-report-analysis.js`
агрегирует health, failure clusters и рекомендации; `test-runner-report.js`
остаётся стабильным facade compaction и artifact composition.

`pages/test-runner/test-runner-suite.js` также является единым каталогом
стабильных ID, человекочитаемых названий, описаний, шагов и владельцев кода для
каждого E2E-сценария. Основное окно передаёт выбранные ID в core после
ограничения по Fast/Full и URL, а `test-selector.html` позволяет выбрать весь
профиль, быстрые сценарии, последние FAIL, последние NOT RUN или произвольный
набор. Выбор хранится в `storage.local`; пустой набор не запускается.

`test-runner-spool.js` владеет OPFS lifecycle и дедупликацией evidence, а
`test-runner-artifact-serialization.js` — потоковой JSON-сериализацией без
удержания полного результата в памяти. После завершения UI сохраняет только компактную историю результатов по тестам
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
Оба painter используют один исходный fill/width на каждой серии, включая Flot:
повторный repaint не принимает уже применённую толщину или снятую заливку за
native baseline. Новая серия получает собственный baseline, OFF восстанавливает
исходные значения независимо от порядка применения painter.

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
Node/Python-тесты, ESLint и Chromium browser smoke под Xvfb, требует
совпадения тега с версией `manifest.json`, собирает
ZIP расширения, Windows installer и SHA-256 через `scripts/build-release.ps1`,
затем публикует GitHub Release с автоматически сформированными notes.

Popup при открытии запрашивает только `releases/latest` репозитория
`Phuoctonge/DashBridge`; успешный результат кэшируется в `storage.local` на один
час. Draft/prerelease, неожиданный тег, GitHub URL и отсутствие точных
ZIP/installer assets отклоняются. При более новой версии показывается ссылка на
installer. Popup сохраняет в `dashbridgeUpdateIndicator` только проверенную
семантическую версию, затем отправляет service worker узкую команду применения
и дожидается ответа. Команда принимается только от точного popup URL. Service
worker меняет action icon и title, следит за storage-ключом и восстанавливает
индикатор после своего или браузерного перезапуска; если Chrome отклоняет
динамическую иконку, остаётся красный badge `!`. Установка остаётся явным
действием пользователя; после установки актуальной версии устаревшее состояние
и индикатор удаляются автоматически.

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

Installer сериализует обычные запуски mutex-ом Windows-сессии. Путь проверяется
также по родителям: reparse points, вложенный Git checkout и drive-relative
пути не допускаются. ZIP имеет лимит распакованного размера и проверку entries
до extraction. Ошибки подготовки staging проходят cleanup; swap сохраняет
rollback. Подсказка первой регистрации зависит от обнаружения пути в браузере,
а не от одного наличия файлов; noninteractive не открывает UI и не выбирает
произвольную папку при нескольких найденных установках.

Analytics collector также развёртывается отдельно от extension runtime.
`scripts/Start-AnalyticsDev.ps1` владеет локальным watch и синтетической SQLite,
а `scripts/Publish-Analytics.ps1` — проверкой и загрузкой ограниченного release.
VPS helper принимает только server/contract/public, запрещает symlink и
небезопасные archive paths, сохраняет backup и откатывается при неуспешном
health-check. Production SQLite принадлежит отдельному `/data`; UI-assets
читаются на запрос и обновляются без restart ingestion, backend — коротким
restart постоянного bind-mounted Node container без Docker build.

## Куда добавлять функцию

### Обезличенная аналитика

`js/background-analytics.js` — единственный владелец installation ID, почасовой
агрегации, дневного snapshot, очереди, retry и отправки. Service worker создаёт
единственный jittered `chrome.alarms` wake-up и отправляет не более одной пачки
в час; пустая очередь не вызывает сеть. Extension pages и
isolated content script используют fail-open facade
`js/shared/analytics-client.js`; MAIN сообщает только закрытые действия через
CustomEvent, а isolated bridge повторно переводит их в разрешённые feature ID.
Service worker проверяет sender отдельно для extension pages, настроенной
Grafana и Confluence. Полный контракт и запрет данных: `docs/analytics.md`.

Владелец аналитики проверяет сохранённую очередь по ограничениям collector,
разделяет версии в агрегатах и сохраняет последнюю отклонённую HTTP 400 пачку
в ограниченном локальном карантине, учитывая её в потерях. Options читает
локальное состояние доставки по открытию страницы/явной кнопке, без отправки
и polling. Админка collector принимает только последний ответ выбранных
фильтров. Охват учитывает установки с любым выбранным сигналом; неподдерживаемые сигналы показаны прочерком. Таблицы используют серверную сортировку и пагинацию, временная шкала — календарные дни UTC с нулями. Подтверждение общего apply учитывает только включённые функции и зависимые от включённых родителей настройки; prepared capture подтверждает владелец снимка. Абсолютное время и вход в fullscreen регистрируют их контроллеры, без делегированного дублирования.

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

Batch устанавливает блокировку операции до асинхронного чтения capture settings.
Ошибка этого чтения проходит общий finally владельца запуска. Подтверждение
`panelToolsApplied` принимается только от текущего окна, с совпавшим requestId
и `commandStatus: applied`. Для CPU/RAM после Refresh мост ожидает в ограниченном
журнале transport новый request-start, соответствующий transform и успешный
request-complete; прежние ответы не подтверждают применение. Ошибка запроса,
неприменённое RAM-преобразование или timeout запрещают снимок. Затем loader
отдельно проверяет готовность DOM/размеров панели. Это не проверка пиксельного
совпадения renderer с преобразованными данными.
При исключении в Series оставшиеся задания текущего среза учитываются как
ошибки в progress и ZIP manifest; ошибка discovery до определения серий
учитывается как одно неуспешное задание. Отмена не записывается как ошибка среза.

### Контракты исправлений помодульного аудита

- MAIN registration сравнивает JS в исходном порядке; matches остаются набором.
- Batch Series использует `queryMatchesConfiguredTarget` из panel-definition
  (в callback ответа, после загрузки runtime) и извлекает только совпавшие refs.
  Ошибочные bootstrap JSON не устанавливают transport; пустой список targets
  не разрешает захват произвольного datasource. Пустой отсутствующий alias
  нормализуется для совместимости с Grafana.
- Definition cache разделён по origin/base path/org/UID/panel; API получает orgId.
  Публичный `getPanelLocation` и solo-ограничение сохранены.
- Batch rules сериализуются через Web Lock `batchPanelToolRules` между страницами.
  Без Web Locks запись отклоняется, а не выполняется с небезопасной локальной очередью.
- Test Runner держит Web Lock `dashbridge-spool:<directory>` до очистки или
  уничтожения документа, включая время просмотра/экспорта завершённого запуска.
  Уборка OPFS удаляет только run directories без живого lease; при отсутствии
  Web Locks уборка ничего не удаляет, новый запуск сообщает ошибку.
- Общий extension-page helper `captureGrafanaVisibleTab` в `grafana-panel-capture.js`
  проверяет активную вкладку, URL, pending navigation и принадлежность окну до/после
  снимка. Event guards снимаются в finally. Его используют Batch и Test Runner;
  переключение вкладок в других окнах не отменяет захват.
- Worklog блокирует конфликтующий ввод во время batch, отправляет snapshot по
  stable ID и ожидает storage commit каждого результата до следующего POST.
  Ошибка локальной записи останавливает batch с предупреждением о проверке Jira.
  Атомарности между Jira POST и локальным storage нет: авария ровно между ними
  требует сверки сервера перед повтором. Перенос Jira собирает pagination до
  подтверждения, отклоняет повторяющиеся ID/непродвигающуюся страницу и >50000 записей.
- Recorder синхронно блокирует повторный start до PiP/permission await, сериализует
  stop; cancel во время starting откладывает cleanup до окончания шага старта.
- Импорт panels ограничен 16 МиБ до FileReader и 500 записями до нормализации.
  Это новый ограничитель входного импорта, не удаление уже сохранённых профилей.

### Дополнительные контракты асинхронного состояния

- Подтверждение Jira POST в Worklog синхронно сохраняет `sent` для stable ID
  во всех существующих Undo/Redo snapshots до ожидания локального commit.
  История может восстановить поля черновика или удалённую строку, но не отменяет
  уже выполненную отправку. Явное редактирование строки сохраняет прежний
  пользовательский контракт; ошибка локального commit по-прежнему требует сверки Jira.
- Batch Series preparation принадлежит поколению запроса. Изменение URL,
  повторный prepare и открытие picker инвалидируют предыдущую подготовку;
  результат дополнительно сверяет URL и выбранные panel IDs. Поздние success,
  error и finally не возвращают старые карточки и не скрывают новый loader.
- Миграция страницы и background profile broker разделяют origin-scoped Web Lock
  `dashbridge-profile-storage`. Он удерживается от чтения до backup/sync/local
  marker commit и сериализует миграцию с CAS, direct panel saves и generic commits.
  Внутри lock нет повторного enqueue; при отсутствии API запись отклоняется.
  Частичная ошибка не повышает marker, retry читает свежие данные под lock,
  сохраняя первоначальный backup.
- Iframe settings принадлежат открывшему их профилю и конфигурации панели.
  Эквивалентная замена объекта допустима; смена профиля, удаление панели или
  изменение URL/theme/size запрещают применение устаревшего draft. Save ожидает
  commit до закрытия/навигации и сохраняет поля с ошибкой для retry. Неудачная
  запись остаётся общим dirty profile draft, как в tools editor; Cancel закрывает
  редактор, но не откатывает этот draft и смежные изменения.
- Fullscreen-карточка находится выше page header и ниже settings/confirm/report
  overlays (100/150/200+); общая modal accessibility сохраняет focus/Escape lifecycle.
- URL из переменных ограничен теми же 4096 символами, что persisted panel.src.
  Все разрешённые Grafana dependent values проверяются до замены snapshot и
  изменения панели. Превышение оставляет прежний принятый snapshot и возвращает
  исходный iframe к сохранённому URL; transport snapshot caps не повышаются.
- Fetch/XHR wrappers panel-data-runtime принадлежат документу и устанавливаются
  один раз. `__dashbridgePanelDataOwner` связывает callbacks с текущим поколением
  panel-tools, включая завершение in-flight запросов. Cleanup снимает только
  собственную привязку; поздний install уже очищенной factory ничего не меняет.
  Старый документ с wrapper предыдущей версии без этой привязки нужно перезагрузить.
- MAIN variables request имеет настоящий deadline 20 секунд, охватывающий
  System.import, refreshOptions и polling. Timeout/stop освобождают busy;
  поздние continuations не меняют переменные и не отвечают от старой операции.
- Flot visibility rebind из очереди microtasks проверяет владение root в WeakMap.
  После reset/замены controller он не оборачивает новый renderer и не возвращает
  снятый фильтр.
- Test Runner синхронно удерживает startup/run guard до завершения операции;
  диагностические callbacks используют spool именно своего запуска. Cancel
  во время storage/OPFS/PiP подготовки не запускает Grafana после завершения await.
  Следующий запуск освобождает прошлый completed spool. Export захватывает
  snapshot и spool до первого await, не допускает второй export и блокирует
  Run/Clear до success/error/cancel. Pagehide отменяет запуск, а очистка данных
  ожидает владельца активной записи/экспорта; при уничтожении документа оставшиеся
  OPFS-сессии освобождаются штатной уборкой следующего открытия.

### Остальные ограничения

- Plans и копии проекта не являются runtime dependency.
- Popup, panel и Batch capture делят helpers, но не lifecycle controller.
- CPU/RAM transformations не объединяются в один расчёт.
- Числовой и vCPU-фильтры не включаются одновременно: порядок двух удаляющих
  преобразований неоднозначен.
- Missing vCPU — fail-open, иначе ошибка helper скроет проблемную VM.
- Clipboard требует focus/user activation; copy остаётся близко к клику.
- Автотесты проверяют контракты, но разные Grafana требуют живой проверки.
