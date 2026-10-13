# Read-only аудит DashBridge

> **Статус документа на 2026-10-13:** Исторический снимок 16 сентября, не текущий inventory API и не новый список findings. Размеры, budget failures, file:line и недоступность GitNexus относятся к среде исходного аудита; на текущей станции GitNexus доступен по инструкции AGENTS.md. Рекомендации требуют повторной проверки runtime-пути и тестов.
> Текущие контракты: [архитектура](../architecture.md), проверки: [разработка](../development-guide.md), остатки работы: [roadmap](../roadmap.md).

Дата аудита: 16 сентября 2026 г.  
Версия manifest: 2.4.4  
Режим: только чтение; production-код, конфигурация и тесты не изменялись.

## Краткий вывод

DashBridge имеет зрелую контекстную архитектуру для расширения Chrome MV3: service worker владеет привилегированными операциями, isolated scripts выполняют мостовую и пользовательскую работу, Grafana-инструменты исполняются в MAIN world, а extension pages являются композиционными точками интерфейса. Для наиболее рискованных потоков уже применены полезные меры: точные проверки `origin`/`source`, correlation ID, ownership cleanup, `AbortController`, generation/run ID, ограниченные таймеры, очереди и восстановление UI в `finally`.

Главные подтверждённые проблемы находятся не в базовой Grafana-совместимости, а на границах длительных операций и доверия к сообщениям: GUI-сбор скриншотов принимает readiness/resize сообщения без проверки точной extension page и без привязки к транзакции; TDM photo-export имеет коллизионный идентификатор с точностью до минуты; импорт Options обходит broker профилей и не имеет протокола восстановления между двумя storage areas; Batch продолжает побочные действия после отдельных `await` при отмене; Recorder непоследовательно маскирует URL в представлении; Worklog принимает невозможные календарные даты через нормализацию `Date`.

Крупные Grafana-модули являются реальным долгом по размеру, однако из одного размера не следует безопасная механическая декомпозиция. Их сложность в значительной мере оправдана поддержкой modern Grafana, legacy Flot/Angular, uPlot, React remount, `d`/`d-solo`, iframe и data-frame вариантов.

## Область и ограничения

Проверялись production-модули расширения, manifest, архитектурные и permission-документы, а также статические контракты classic-script загрузки. В объём включены service worker, `js/shared/**`, `js/content/**`, Popup, DashBridge, Batch, Recorder, Worklog, Options, Jira/TDM и shared extension-page utilities.

Из продуктовых выводов полностью исключены `pages/test-runner/**`, live E2E, тестовые сценарии и любые тестовые файлы. Они не использовались ни как доказательство дефекта, ни как свидетельство качества продукта. Инвентаризация и рекомендации ниже не раскрывают записи трафика, cookies, токены, введённые данные или другой секретный материал.

GitNexus был проверен как возможный инструмент графа, но в среде недоступен. Вместо него использовались source-level поиск строковых контрактов, manifest/HTML script order, static dependency contracts и точечная проверка sender/consumer путей.

## Классификация

| Метка | Значение |
|---|---|
| Подтверждённая проблема | Есть воспроизводимый по коду путь к нарушению корректности, конфиденциальности или жизненного цикла. |
| Долг / hardening | Исходный код показывает слабое место или цену сопровождения, но вред зависит от среды либо не доказан без runtime-репродукции. |
| Документированное ограничение | Поведение уже открыто зафиксировано в документации как сознательная граница продукта. |
| Совместимость | Ветвления требуются для версий/рендереров Grafana; не считать их дублями без отдельного доказательства. |
| Наблюдение | Улучшение читаемости или структуры без установленного дефекта. |

## Методика и проверенные контракты

Проверена MV3-конфигурация и реальные контексты исполнения из `manifest.json`; архитектурные правила из `docs/architecture.md`, `docs/module-design.md` и `docs/permission-map.md`; цепочки production sender/receiver для `postMessage`, `chrome.runtime.sendMessage`, runtime injection, profile persistence и capture; явный порядок MAIN-world runtime из `js/shared/grafana-runtime-manifest.js`; cleanup и cancellation вокруг iframe, DOM observers, capture windows, ports, archive queues и report lease.

Статическая проверка dependency contracts успешно прошла для 157 JS-файлов, 41 page и 754 load edges. Единственное advisory про `dashbridgeInspectLocation` не является dead code: production sender находится в `pages/dashbridge/dashbridge-frame-load-controller.js`, а receiver — в `js/content/grafana-iframe.js`. ESLint не сообщил ошибок. Проверка module boundaries подтверждает no-growth debt у `js/content/grafana-legend-visuals.js`, `js/content/grafana-panel-data-runtime.js` и `js/content/grafana-panel-tools.js`.

## Архитектурная карта и положительные контроли

Service worker (`js/background.js`) — единственный владелец привилегированных background-потоков: Grafana/DNR infrastructure, profile broker/CAS, capture windows, GUI archive, analytics и Recorder crash fallback. Его проверка `isTrustedExtensionPage()` сопоставляет extension ID, origin и точный pathname (`js/background.js:15–21`). Это хороший стандарт, которому должны соответствовать все новые сообщения extension pages.

Static isolated scripts загружаются на `<all_urls>` из-за настраиваемых корпоративных хостов, но постоянно установленный MAIN runtime сужается динамической регистрацией до dashboard routes и разрешённых host/port. `content.js` держит capture authority в isolated-world closure и проверяет user activation; это заметно сильнее, чем хранить авторизацию только в page-mutable dataset. MAIN coordinator в `grafana-panel-tools.js` проверяет extension origin, ожидаемый `event.source` и явное top-frame разрешение, последовательно сериализует команды и закрывает runtime предыдущего поколения перед reinjection.

DashBridge разделяет mutable ownership: profile controller владеет profiles/active profile, time controller — временем и report lease, frame-load controller — leader/waiting startup и таймерами, card controller — DOM cards/reconciliation, variables controller — groups/timers/observer, report controller — run/abort/overlay, capture controller — capture leases и restoration. В `finally` и `stop()` корректно очищаются ресурсы. Это не «лишние guards», а существенная защита от stale result и SPA/iframe races.

## Подтверждённые проблемы и безопасные исправления

### F-01. GUI capture: sender и readiness не привязаны к доверенной странице и конкретному запуску

**Приоритет: высокий для integrity длительной операции, не доказанная website privilege escalation.**

`js/background.js:264–272` принимает `dashbridge-gui-capture-ready` от любого sender с `_sender.tab` и `dashbridge-popup-capture-size` от любого sender с tab/window. В соседнем обработчике `dashbridge-capture-gui` точная доверенная Popup page уже проверяется (`js/background.js:274–287`), поэтому граница непоследовательна.

`js/background-gui-capture.js:33–55` хранит ожидание готовности только по `tabId`; `waitForReady(tabId)` и `markReady(tabId)` не знают document identity, extension page или run ID. DashBridge iframe controller посылает `dashbridge-gui-capture-ready` при `guiCapture` query parameter (`pages/dashbridge/dashbridge-iframe-message-controller.js:129–142`). Capture workflow переиспользует одну popup-tab для нескольких экранов (`js/background-gui-capture.js:87–130`). Следовательно, stale/unrelated content-script sender в этой tab может преждевременно закрыть ожидание readiness; resize также доступен любому content-script sender в собственной window в допустимых фиксированных пределах.

**Рекомендация.** При старте GUI capture сгенерировать `crypto.randomUUID()` transaction ID; передавать его только в capture URL; хранить waiter по `{tabId, transactionId}`. До `markReady` и resize проверять `isTrustedExtensionPage(sender, ожидаемый pathname)` и transaction ID. Для Popup/DashBridge сохранить одну общую функцию отправки GUI sizing/readiness, вместо двух независимых resize callsite (`pages/popup/popup-core.js` и `pages/popup/popup-grafana-router.js`). Это изменение не требует новых permissions.

### F-02. TDM photo export допускает коллизию run ID и конкурентные запуски

**Приоритет: высокий для целостности экспортируемого архива.**

`pages/popup/popup-tdm.js:125–133` строит `photoExportId` как `YYYYMMDDHHMM`, то есть с точностью лишь до минуты. `progressListener` принимает фото при совпадении этого ID и active tab (`:146–163`). Кнопка запуска не переводится в in-flight state и не вводит session lock; каждый вызов создаёт свой listener, archive queue, injection и callback (`:96–245`). Таким образом, два запуска в одной вкладке в ту же минуту могут смешать сообщения в архивах и конкурировать за scroll/state страницы TDM.

**Рекомендация.** Заменить ID на `crypto.randomUUID()`, ввести единственный active export owner, блокировать кнопку и связанные настройки на время run, включить run/document identity в сообщение фото там, где доступно. Listener нужно снимать только после завершения именно своей `photoQueue` и archive finalization. Для долгой операции лучше перенести durable owner из ephemeral Popup в service worker либо явно документировать отмену при закрытии Popup.

### F-03. Options import обходит profile broker и не обеспечивает recoverable commit между sync/local

**Приоритет: высокий для согласованности пользовательских профилей.**

`pages/options/options-config-transfer.js` тщательно валидирует schema, allowlists, URL и границы, а также сначала создаёт local backup. Однако импорт затем напрямую выполняет `chrome.storage.sync.set(imported.sync)` и после него `chrome.storage.local.set(imported.local)`. Локальный import set включает `dashbridge_profiles` и `dashbridge_activeProfileId`.

Это обходит background profile patch/CAS owner, которым пользуются DashBridge страницы. Между independent storage areas нет транзакции: concurrent profile edit может быть перезаписан, а сбой второго write оставит частичный commit. Наличие backup снижает риск и позволяет восстановление; утверждать полную потерю данных нельзя.

**Рекомендация.** Сделать trusted Options → background import commit protocol. Для profile data использовать revision/fingerprint/lock semantics profile broker. Для sync/local завести import journal с phase (`prepared`, `sync-written`, `local-written`, `committed`) и явным recovery/rollback при следующем запуске. Не заявлять «атомарность» между Chrome storage areas, которой API не предоставляет.

### F-04. Batch main run делает побочные действия после cancellable await без повторной проверки run

**Приоритет: средний, lifecycle/functional race.**

В `pages/batch/batch-main-run-controller.js:65–71` после ранних await уже есть корректные `operation.isActive(runId)` checks; есть проверка после acquire window (`:99–103`) и перед final archive phase (`:151–178`). Однако внутри вложенного loop после `await operation.loadPanel(...)` (`:124–127`) код сразу захватывает panel, меняет archive counters, пишет progress и log (`:128–147`) без повторной проверки. Аналогично после `await operation.capturePanelToZip(...)` side effects продолжаются независимо от отмены, случившейся во время await. `batch-operation-controller.js:17–34` корректно отменяет lifecycle/progress/window, поэтому это узкий gap, а не отсутствие cancellation в целом.

**Рекомендация.** После каждого await, способного пережить cancel, до ближайшего side effect выполнять `if (!operation.isActive(runId)) break` либо единый `assertActive(runId)`. Передать signal в capture/archive paths, если API его поддерживает. Сохранить текущий idempotent `finish()` и owner release.

### F-05. Recorder скрывает sensitive URL только в details-pane, но не в таблицах и copy action

**Приоритет: средний для UI confidentiality.**

`pages/recorder/recorder-view.js:193–233` имеет корректный `redactSensitiveUrl()` и в details-pane выбирает raw URL только при explicit `revealSensitiveDetails`. Однако traffic table помещает raw `request.url` в row и title (`:148–170`), comparison table — raw `item.url` (`:300–309`), а `pages/recorder/recorder.js:384–402` всегда копирует raw URL независимо от reveal state.

Это не меняет документированную природу Dashflow как секретного артефакта, но делает UI default-redaction непоследовательной.

**Рекомендация.** Вынести единый `displayUrl({ value, reveal })` в view boundary и применять к traffic, comparison, title/tooltip и export-preview. Raw copy либо требовать после явного reveal, либо подписывать как копирование полного URL с подтверждением. Не менять underlying recording payload без отдельного product decision, так как `docs/dashflow-v2.md:70–80` намеренно допускает секреты для replay.

### F-06. Worklog принимает невозможные даты через нормализующий `Date`

**Приоритет: средний для корректности remote write.**

`pages/worklog/worklog.js:173–181` строит `new Date(y, m - 1, d, h || 0, min || 0)` без проверки исходных компонент. JavaScript нормализует невозможные значения, например день за пределами месяца, в другую календарную дату. При отправке проверяется только `isNaN(d.getTime())` (`:571–600`), поэтому логически неверная дата может быть отправлена как другая допустимая дата. Поле effort также не проходит строгую клиентскую валидацию: totals используют permissive `parseFloat(... ) || 0` (`:325–336`), а submit передаёт исходную строку Jira.

**Рекомендация.** Создать strict parser `DD/MM/YYYY HH:mm`: проверить целые числа, диапазоны часов/минут, а затем round-trip equality `date.getFullYear()/getMonth()/getDate()/...` с входом. Перед submit проверять допустимый Jira time-spent grammar и показывать field-level error до remote POST. Это не затрагивает существующий defensive порядок «POST → durable local status → следующий POST».

### F-07. Popup сообщает успешный GUI screenshot result до фактического результата background workflow

**Приоритет: средний, UX/integrity статуса.**

`pages/popup/popup-grafana-debug.js:36–42` запускает `chrome.runtime.sendMessage({ type: 'dashbridge-capture-gui' })`, не ожидает response, suppresses rejection в console и возвращает фиксированное `13`. Click handler немедленно пишет «13 снимков упакованы» (`:301–313`). Реальная background операция возвращает actual count или error асинхронно (`js/background.js:274–287`). Поэтому Popup может сообщить success при failure/incomplete result.

**Рекомендация.** Await callback/Promise response, проверять `{ok, count, error}`, не выводить final success до ответа. Для длительного workflow оставить `guiCaptureStatus` как durable progress/result, а Popup читать и отображать именно его. Это удобно объединить с F-01 transaction protocol.

### F-08. Generic Batch capture helper не инвалидирует screenshot при same-URL document reload

**Приоритет: средний, риск неправильного crop; требует targeted runtime reproduction перед приоритизацией.**

`js/shared/grafana-panel-capture.js:3–33` помечает target invalidated на tab activation/removal и только при URL update, если новый URL отличается от `expectedUrl`. Затем `captureGrafanaPanelImage()` измеряет rectangle, ждёт settle interval, берёт visible screenshot и crop по ранее измеренной геометрии (`:87–193`). Reload или document replacement с тем же URL между geometry и screenshot не будет отклонён этой функцией.

Для отдельного direct capture background broker картина лучше: `js/background-gui-capture.js:170–205` invalidates on `change.status === 'loading'`, поэтому этот finding относится только к shared Batch helper. Не смешивать два пути.

**Рекомендация.** В shared helper invalidировать target при `change.status === 'loading'` аналогично background broker, возможно с document navigation/run identity. Сначала добавить narrow runtime reproduction с same-URL reload и проверить, что нет легитимного loading transition, который нужен Batch capture; это рекомендация hardening, а не утверждение о доказанной порче всех captures.

## Долг, hardening и наблюдения

### D-01. Batch capture runner не имеет request deadline

`pages/batch/batch-capture-runner.js:9–35` хранит acquire/release waiters до port response или disconnect. На disconnect waiters корректно reject (`:21–28`), но при connected port без response local timeout и abort route нет. Background owner сериализует задачи, что в обычном пути полезно. Это source-confirmed missing deadline; зависание конкретного Chrome operation требует reproduction.

**Безопасное упрощение.** Добавить per-request timeout/AbortSignal, удаление waiter и generation-aware reject. Не закрывать capture window по таймауту клиента без согласования с background owner.

### D-02. `grafana-series-capture.js` оставляет global Fetch/XHR wrappers до смены документа

Token-gated script (`js/content/grafana-series-capture.js:3–95`) разумно предотвращает double patch, но после найденного expected set не unpatches `window.fetch`, `XMLHttpRequest.prototype.open` и `send`. Это не доказанное повреждение: wrappers пассивно фильтруют `api/ds/query` и нужны до завершения capture gathering. Тем не менее lifetime больше one-shot intent и повышает maintenance/performance surface.

**Безопасное упрощение.** Вынести disposer с restoration только если: все expected identities собраны либо expired deadline; убедиться, что no other token/session uses same document. Не делать blind restore после первого response: Grafana может разбивать panel queries на несколько batches.

### D-03. MAIN-world command acknowledgement имеет page-controlled confirmation channel

`js/shared/grafana-command.js:11–24` отправляет request ID через `window.postMessage` и принимает matching `panelToolsApplied` от `window`/same origin. Скрипт, уже выполняющийся в Grafana MAIN world, теоретически может увидеть ID и подтвердить command раньше реального runtime. Это integrity hardening, не отдельная Chrome privilege escalation: page already controls its own DOM/runtime and command path выполняется по явному extension-page действию.

**Безопасное упрощение.** Предпочесть подтверждение, возвращаемое непосредственно `chrome.scripting.executeScript` в той же invocation, либо closed correlation capability, недоступную page scripts. Если postMessage сохраняется ради async runtime, описать его как best-effort UI acknowledgement, а не security authorization.

### D-04. Diagnostics URL redaction требует более формальной policy

`pages/popup/popup-grafana-debug.js:67–74` маскирует только names matching `(token|auth|password|secret|apikey|api_key)` и обозначает `var-*` как present. Это лучше raw URL, но не покрывает все product-specific sensitive names и не очищает URL userinfo. Комментарий `:1–2` обещает отсутствие query payload, а source на самом деле сохраняет non-matching query values. Без конкретного deployed URL нельзя утверждать exposure; это policy/reproduction item.

**Рекомендация.** Для diagnostic report хранить pathname, query key list и redacted values по deny-by-default; удалить `username/password` из URL; делать allowlist только для необходимых, заведомо несекретных keys. Согласовать текст комментария с фактической policy.

### D-05. `content.js` публикует capture defaults на всех host до Grafana scope gate

Manifest намеренно ставит isolated script на `<all_urls>`. `js/content/content.js:30–37, 53–56` публикует `dashbridgeCapturePrepared`, width и height в document dataset независимо от configured Grafana host; в отличие от icon/analysis scope, которые gated (`:24–50`). Это только metadata, не token/content/privileged API, поэтому низкий scope-consistency debt.

**Рекомендация.** Удалять/не публиковать capture defaults на non-Grafana scope либо документировать их как harmless global UI metadata. Не переносить direct capture authority в dataset: current closure authority должна остаться.

## Документированные ограничения, не являющиеся новыми findings

Native Grafana time-picker clipboard UI включается по DOM dataset, то есть это не независимая trusted-host authority. Это прямо зафиксировано в `docs/permission-map.md:41–45`; не следует представлять как новый defect. Direct capture bridge имеет более сильную closure-based проверку scope и user activation.

`.dashflow` сознательно может содержать password, login/e-mail, request/response bodies, Authorization, Cookie, API keys, tokens и введённые значения. Это документировано в `docs/dashflow-v2.md:70–80` и `docs/permission-map.md:47–50`. Raw password field в Recorder (`js/content/scenario-recorder.js:141–160`) и последующая сериализация не являются независимым newly discovered privacy finding: это сознательный контракт replay artifact. Риск должен управляться продуктовой политикой распространения, а не UI-only redaction.

Совместимость Grafana с React Fiber, uPlot, Flot, Angular/legacy DOM, renderer replacement, panels in nested structures, repeated legend labels, absolute/relative time и `d`/`d-solo` не является дублированием сама по себе. Удалять эти fallback branches можно только после matrix-based compatibility decision и репродукции на целевых Grafana versions.

## Реестр production API и модулей

### Service worker и shared infrastructure

| Модуль / публичная поверхность | Контекст и назначение | Основные consumers | Оценка |
|---|---|---|---|
| `background.js`, `isTrustedExtensionPage` | MV3 service worker dispatcher, exact extension-page identity | Все extension pages, ports | Central authority; F-01 исключение требует выравнивания. |
| `DashBridgeBackgroundGrafanaInfrastructure.create` | Worker: DNR, runtime registration/backfill, configured Grafana host contract | `background.js`, DashBridge/Options | Intentional host/port complexity; lifecycle guarded. |
| `DashBridgeBackgroundProfileStorage.create` | Worker: profile CAS/patch/serialized commits | DashBridge, Options target design | Один owner persistence; не обходить его в import. |
| `DashBridgeBackgroundBatchCapture.create` | Worker: port-owned capture window | Batch runner | Proper port ownership; add client deadline (D-01). |
| `DashBridgeBackgroundGuiCapture.create` | Worker: GUI ZIP collection and direct visible capture | Popup/DashBridge | Bounded source/archive budgets; F-01 needs transaction binding. |
| `DashBridgeBackgroundUpdateIndicator.create` | Worker: update status restore/indicator | `background.js`, Popup updates | Low risk. |
| `DashBridgeBackgroundAnalytics.create` | Worker: bounded queue/send lifecycle | analytics client | Analytics failure is isolated from product action. |
| `DashBridgeGrafanaRuntimeManifest.{files,matchesForHostname}` | Ordered MAIN runtime and Chromium-safe match patterns | background infrastructure, runtime loader | Script order is a runtime contract. |
| `ensureGrafanaRuntime`, `ensureEarlyGrafanaRuntimeForUrl` | MAIN world provisioning/backfill | command/capture paths | Scope to HTTP(S)/dashboard URLs; medium browser API compatibility risk. |
| `runGrafanaCommand`, `applySharedGrafanaPanelTools` | Extension page → MAIN tool commands | Batch and Grafana actions | D-03 acknowledgement hardening; refresh has bounded diagnostic confirmation. |
| `DashBridgeGrafanaCaptureOutput.{normalizeOutputSize,fitPreparedSize,crop,copy,filename}` | Image dimensions/crop/output | content/DashBridge/Batch capture | Bounds and geometry checks; browser screenshot compatibility. |
| `captureGrafanaVisibleTab`, `scrollGrafanaPanelIntoView`, `captureGrafanaPanelImage` | Shared Batch capture primitive | `BatchOperationController` | Restoration in finally; D-02 same-URL lifecycle gap. |
| `DashBridgeGrafanaPanelIdentity.{normalizePanelId,fromUrl}` | Canonical panel URL identity | profiles/content/background | Low risk, input-normalized. |
| `DashBridgeGrafanaSettings` helpers | Defaults, normalize/migrate settings, storage keys | content/background/pages | Low risk, bounded normalizers. |
| `DashBridgeLocalStateSchema` normalizers | Profiles/worklogs/Batch/import local state | local persistence/import | Defensive boundary; validate before use. |
| `DashBridgeAnalytics`, `DashBridgeSyncInputWriter`, `DashBridgeUpdateCheck` | Shared UI telemetry/input/update helpers | extension pages | Independent composition helpers; no central business state. |
| `DashBridgeArchiveDownload`/rolling archive helpers | User-initiated archive/download handling | Batch/TDM/Recorder | Budgets/Blob cleanup owner must remain caller. |
| URL/Grafana time helpers | HTTP normalization, time parse/serialize, panel/solo URL construction | Batch/DashBridge/iframe | Route/time compatibility is intentional. |

### Grafana isolated-world bridges and MAIN-world runtime

| Модуль / публичная поверхность | Контекст и назначение | Вызывающие компоненты | Совместимость / рекомендации |
|---|---|---|---|
| `content.js` | Isolated world: settings publication, direct capture/profile bridge, Confluence branch | Manifest at document_start | Closure scope + user activation are positive; D-05 metadata scope. |
| `DashBridgeGrafanaTimePickerClipboard` | Isolated native picker copy/paste | Manifest | Documented dataset-scope limitation, not new finding. |
| `grafana-iframe.js` | Isolated all-frame readiness, title/location/time/crosshair bridge | DashBridge frame/load/message controllers | Validates parent/origin/request ID; medium DOM drift risk. |
| `grafana-variables-bridge.js` | Isolated correlated bridge for variables | variables controller/runtime | Parent/source/origin checks, one pending request, response cap, pagehide cleanup. |
| `DashBridgeGrafanaVariablesRuntime` | MAIN variables read/set/refresh | variables bridge | Serialized operations, generation/timeout/stop; Grafana Scenes risk. |
| `DashBridgeGrafanaDom` | MAIN shared panel/legend/no-data DOM adapter | Most Grafana runtime modules | High compatibility concentration; do not split blindly. |
| `DashBridgeGrafanaPanelState` | MAIN scoped state surviving React remounts | panel tools/capture | Good bounded state ownership. |
| `DashBridgeGrafanaPanelDefinition` | MAIN dashboard panel definitions/query signatures | tools, data, series, analysis | TTL/max-size cache; dashboard schema compatibility. |
| `DashBridgeGrafanaPanelBootstrap` | URL fragment state / refresh policy | iframe/tools/time | Extension-only data stays out of query/referer. |
| `DashBridgeGrafanaLegendSelection` | Versioned legend visibility matcher/DataFrame filter | data/tools | Legacy hidden-list compatibility deliberate. |
| `DashBridgeGrafanaLegendColumns` | Pure legend columns/stat calculations | visuals | Low risk / suitable pure helper boundary. |
| `DashBridgeGrafanaLegendVisibilityAdapters` | Flot/uPlot/React legend visibility adapters | legend visuals | High renderer risk; `WeakMap` restore lifecycle. |
| `DashBridgeGrafanaLegendVisuals` | Legend relocation/inversion/columns/styling | visual engine | Oversize debt; preserve legacy/modern branches. |
| `DashBridgeGrafanaThresholdVisuals` | Flot/uPlot threshold overlays | visual engine/capture | Resize/mutation/RAF cleanup required; high renderer risk. |
| `DashBridgeGrafanaSeriesStyles` | Line/fill presentation changes | visual engine | Local observer/reflow compatibility. |
| `DashBridgeGrafanaVisualEngine` | Facade composing visuals/report/table/legend | tools/capture | Correct dependency injection; high delegated compatibility risk. |
| `DashBridgeGrafanaUnit`, `TableReport`, `ReportSnapshot` | Units/table extraction/bounded report snapshots | report/data/visuals | Pure-ish data seams; DataFrame schema risk. |
| `DashBridgeGrafanaPanelAnalysis` | CPU/RAM analysis and text output | tools/menu/data | High selector/series compatibility; bounded settings. |
| `DashBridgeGrafanaNetwork` | Request/response reconstruction helpers | panel-data runtime | Preserve body/header correctness on transforms. |
| `DashBridgeGrafanaCpuCapacityFilter` and `CpuCapacityLegend` | Capacity transforms and legend behavior | data runtime/tools | Datasource/DOM fallback complexity justified. |
| `DashBridgeGrafanaPanelDataTransforms` | Domain/data frame transformations | panel-data runtime | Separate from interception by design; retain separation. |
| `DashBridgeGrafanaPanelDataRuntime` | Fetch/XHR interception and transform diagnostics | panel-tools | Oversize debt; global wrapper cleanup and stale run guards critical. |
| `DashBridgeGrafanaPanelCaptureRuntime` | MAIN prepare/restore capture sessions | tools/shared capture | Session correlation and restore owner must remain single. |
| `DashBridgeGrafanaPanelMenuRuntime` | Header actions/settings/analysis overlay | panel-tools | React Fiber/header compatibility, scoped observer cleanup. |
| `grafana-panel-tools.js` | Final MAIN coordinator | runtime manifest, extension commands | Oversize debt; owns queue and cross-module lifecycle. |
| `grafana-refresh-policy.js` | Document-start fragment-opt-in refresh suppression | runtime | One-shot same-origin response policy; intentional. |
| `grafana-series-capture.js` | Token-scoped datasource series discovery | Batch series discovery | D-02 disposer opportunity; do not unpatch too early. |
| `scenario-recorder.js` | Recorder content action capture | controlled Recorder tab | Trusted events/debounce; secret payload is documented Dashflow contract. |
| `inject.js` | Confluence editor focus/scroll patch | content.js selected Wiki host | Idempotent patch and observer lifecycle; unrelated to Grafana. |

### DashBridge page controllers

| Модуль / public factory | Назначение и owners | Consumers / assessment |
|---|---|---|
| `dashbridge.js` composition root | Constructs all controllers and runtime scope ID; compatibility wrappers for classic-script/HTML contracts | Do not remove forwarding wrappers until consumer/string-contract search proves unused. |
| `DashBridgeProfileController.create` | Profiles, active selection, sync, switch/create/clone/rename/delete | Strong storage versioning and unsaved-draft preservation; calls intentionally await result for substantial mutations. |
| `DashBridgeTimeController.create` | Time state, range history, report lease, frame navigation | Fragment keeps large legend selections out of request URL; bounded timers/lease. Fire-and-forget save deserves error-observation consistency review, not proven defect. |
| `DashBridgeFrameLoadController.create` | Per-origin leader/waiting iframe startup, request poll/deadline | Bounded 500 ms/30 s lifecycle is intentional session recovery protection. |
| `DashBridgeIframeMessageController.create` | Exact iframe source/origin dispatch and message routing | Positive source panel mapping; GUI message is part of F-01. |
| `DashBridgePanelCardController.create` | Card render/reconcile/drag/fullscreen/action ownership | Complex but coherent single card/DOM owner; extract only leaf modal/drag helper. |
| `DashBridgePanelAdditionController.create` | Single/quick/dashboard discovered panel add | URL/identity validation and guarded persistence. |
| `DashBridgePanelTransferController.create` | Panel move/copy between profiles | Awaited save paths; maintain profile consistency. |
| `DashBridgePanelToolsController.create` | Tool modal and correlated waiter maps | Distinct maps represent distinct response contracts; do not merge mechanically. |
| `DashBridgePanelAnalysisController.create` | Panel analysis overlay/text actions | UI owner, bounded and source-correlated results. |
| `DashBridgeVariablesController.create` | Variable group request/reload state | Stop cancels timers/observer/listeners; same-URL fragment card replacement intentional. |
| `DashBridgeCapture.create` | Card/archive/selection capture and visual restoration | Exclusive leases, 1–8 selection bound, 64 MiB cap, finally restore. |
| `DashBridgeReportController.create` + transport/UI/attachments/collage/audit | Report run/abort/preview/image collection/attachments | Context signature rejects stale output; preserve user-edited draft. Excluded test-runner dependency is outside this audit. |
| `DashBridgePageUiController.create`, renderer, modal, crosshair, state/url/migration helpers | DOM event composition/pure UI/time/profile compatibility | Thin leaf modules; no confirmed duplicate production logic. |

### Batch, Recorder, Worklog, Popup, Options and shared pages

| Модуль / public factory | Контекст / callers | Assessment |
|---|---|---|
| `BatchOperationController.create`, `BatchMainRunController.create` | Batch lifecycle/window/progress and main capture loop | Cancellation infrastructure good; F-04 gap. |
| `BatchSeriesRunController.create`, discovery/selection/picker/loader/rules/UI/state/utils | Batch series workflow and UI | Intentional Grafana/API and archive constraints; keep state owner separated from UI. |
| `createBatchCaptureWindowRunner` | Batch → worker port window lease | Correct port/disconnect cleanup; D-01 deadline. |
| `DashBridgeRecorderSessionController.create` | Record/replay session lifecycle | Owns normal start/stop, delegates transport/CDP. |
| `DashBridgeRecorderSessionTransport.create` | Controlled tab/window, debugger, lifecycle port/action injection | Strong tab/frame/permission guards and cleanup. |
| `DashBridgeRecorderNetworkCapture.create` | CDP request/response body capture | Bounded request/body/stream/pending budgets. |
| `DashBridgeRecorderActionCapture.create` | Recorded navigation/action/step request attribution | Replay-safe locator ownership; secret values are documented artifact data. |
| `DashBridgeRecorderReplay.create` | Conservative DOM replay | Ambiguous locators fail rather than act arbitrarily. |
| `DashBridgeRecorderView.create` | Recorder rendering/redaction/comparison | F-05 visual redaction mismatch. |
| Dashflow export/IO/controller modules | Versioned archive import/export | Strict schema/budget/hash verification; sensitive artifact policy documented. |
| `DashBridgeWorklogMetrics`, `DashBridgeWorklogJiraClient.create`, `worklog.js` | Worklog UI/Jira submission | Sequential remote/local commit ordering good; F-06 strict input validation. |
| Popup core/router/links/updates/Jira/TDM/debug modules | Action popup routing and selected-tab user workflows | F-02, F-07, D-04; target-site DOM/localization sensitivity is expected TDM risk. |
| Options / `options-config-transfer.js` | Settings, import/export | Input validation/backup good; F-03 ownership/commit gap. |
| `DashBridgeModalAccessibility.create`, theme, operation progress | Shared extension page UI utilities | Modal has focus/escape/page lifecycle support; audit found no functional defect. |
| Debug/easter-egg pages | Isolated diagnostic/non-core UI | Low product criticality; no security conclusion from their presence. |

## Size and safe simplification plan

`grafana-panel-tools.js` (2,358 lines), `grafana-legend-visuals.js` (1,403 lines) and `grafana-panel-data-runtime.js` (760 lines) exceed the stated no-growth boundaries. This is confirmed maintenance debt, not evidence that any arbitrary extraction is safe.

First, fix F-01 through F-07 as narrow owner-preserving changes. Second, create an explicit lifecycle/ownership map for each large Grafana module, listing every mutable map/set, observer, timer, patched global, queue and cleanup function. Third, extract only leaf sections with injected dependencies and no duplicate state: for panel tools, settings-save UI and message-routing parser are possible candidates; for legend visuals, pure selector-independent calculations should remain with `LegendColumns`; for data runtime, protocol-independent transformation decisions may stay in `PanelDataTransforms`, while interception ownership remains singular.

Any extraction must preserve: one owner of mutable state, one owner of cleanup, single command FIFO semantics, cancellation/generation checks, exact origin/source validation, and the manifest runtime order. Before moving a classic global or wrapper, search all HTML inline handlers, `window`/`globalThis` names, `postMessage` actions and dependency-contract consumers. No removal recommendation in this audit is based solely on local apparent non-use.

## Final assessment

The extension’s core security/lifecycle model is materially stronger than a superficial review of its size would suggest. The most valuable work is targeted hardening at message and transaction boundaries, plus enforcing cancellation checkpoints and persistence ownership. Do not spend the first refactoring cycle deleting Grafana fallback code or splitting the three large MAIN-world modules mechanically: the evidence supports preserving their compatibility behavior while creating documented, tested leaf seams around it.
