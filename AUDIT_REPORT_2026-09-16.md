# Аудит Chrome-расширения DashBridge

**Дата:** 16 сентября 2026  
**Режим:** строго read-only; исходники не изменялись.  
**Цель:** проверить production-код расширения, границы ответственности и совместимость Grafana/DashBridge; отделить реальные дефекты от оправданной поддержки разных версий Grafana.

## Границы проверки

Проверены manifest, service worker, production content scripts, shared-модули и страницы Batch, Worklog, Popup, Options, Recorder, Jira/TDM. Намеренно исключены из выводов о качестве продукта:

- `D:\Work\Automation\DashBridge\pages\test-runner\**`;
- все тестовые файлы, недоделанная автопроверка и live E2E;
- секреты (не читались и не включены в отчёт).

## Итог

Архитектура в целом хорошо защищена: есть строгие проверки sender/page для большинства привилегированных сообщений, владелец временного Batch-окна находится в service worker, состояние нормализуется перед сохранением, а Batch применяет run-id и отмену. Самая дорогая по сложности область — не «лишние проверки», а оправданная совместимость Grafana: разные DOM/React/Fiber/uPlot/Flot/Scene/DataFrame реализации. Упрощать эти ветви без матрицы версий Grafana рискованно.

Выявлено **17 подтверждённых пунктов**: 8 medium, 8 low/low-medium и 1 privacy/security boundary. В первую очередь стоит исправить передачу паролей Recorder, ложный результат GUI-capture, отсутствие дедлайна capture-port и валидацию Worklog.

---

## Подтверждённые проблемы

### P1. Высокий приоритет

### 1. Recorder передаёт исходное значение password-полей

**Серьёзность:** privacy/security boundary.

**Где:** `D:\Work\Automation\DashBridge\js\content\scenario-recorder.js:141-160`.

`change` и debounce-обработчик `input` передают `target.value` и лишь добавляют флаг `secret: true`. То есть пароль уже пересекает границу страницы и расширения в незамаскированном виде.

**Риск:** секрет может попасть в сценарий, локальное состояние, экспорт или журнал последующей цепочки обработки.

**Безопасное исправление:** для `HTMLInputElement[type=password]` передавать только метаданные (`secret: true`, длину при необходимости), но никогда не `value`; отдельно удалить уже сохранённые/экспортируемые значения, если такие есть.

### 2. Popup показывает успешный GUI-capture до получения результата worker

**Серьёзность:** medium.

**Где:**
- `D:\Work\Automation\DashBridge\pages\popup\popup-grafana-debug.js:36-42, 301-313`;
- фактический ответ worker: `D:\Work\Automation\DashBridge\js\background.js:274-287`.

`collectGuiScreenshots()` запускает `sendMessage()` без `await`, игнорирует ответ и возвращает константу `13`. UI немедленно пишет, что 13 снимков упакованы, даже если worker ещё работает, завершился ошибкой либо получил иное число.

**Риск:** ложное подтверждение диагностического экспорта, потеря обратной связи об ошибке и неверное число кадров.

**Безопасное исправление:** дождаться ответа, проверить `response.ok`, отображать фактический `response.count`; на время выполнения показывать «в процессе». Длительное состояние и результат хранить авторитетно в worker/storage, а не только в Popup.

### 3. Worklog принимает некорректную дату и effort

**Серьёзность:** medium.

**Где:**
- `D:\Work\Automation\DashBridge\pages\worklog\worklog.js:173-180, 571-578`;
- `D:\Work\Automation\DashBridge\pages\worklog\worklog-jira-client.js:69-78`.

`new Date(y, m - 1, d, h, min)` нормализует несуществующие даты (например, 31 февраля), вместо отказа. Перед отправкой проверяется только непустое значение. Jira-клиент добавляет `h` к произвольному `timeSpent`.

**Риск:** работа может уйти на другую фактическую дату либо с ошибным/непринимаемым duration, включая отрицательное или уже содержащее единицы значение.

**Безопасное исправление:** строго проверить календарную дату/время обратным сравнением компонентов и принять только документированную грамматику Jira duration (например, допустимые числа часов/минут), затем формировать payload из нормализованного числа.

### 4. Batch capture-port не имеет deadline

**Серьёзность:** medium.

**Где:** `D:\Work\Automation\DashBridge\pages\batch\batch-capture-runner.js:9-35, 39-57`.

Ожидание ответа на acquire/release разрешается только ответом worker или disconnect. Если worker завис между storage/window/orphan-cleanup этапами, страница Batch остаётся заблокированной без выхода.

**Риск:** вечное состояние выполнения/невозможность начать следующую операцию.

**Безопасное исправление:** добавить ограниченный timeout и `AbortSignal`-race для каждого запроса; очищать pending entry при отмене и безопасно игнорировать опоздавший ответ.

### 5. Одноразовый series-capture навсегда оставляет global fetch/XHR hooks

**Серьёзность:** medium.

**Где:** `D:\Work\Automation\DashBridge\js\content\grafana-series-capture.js:3-10, 70-95`.

После активации заменяются `window.fetch`, `XMLHttpRequest.prototype.open` и `send`. Есть защита от двойного патча, но нет unpatch по получению результата, timeout или lifecycle-dispose.

**Риск:** все последующие datasource-запросы документа проходят через лишние wrapper-ы; накопление побочных взаимодействий с другими патчами Grafana/расширений и лишняя нагрузка.

**Безопасное исправление:** сохранить оригиналы и вернуть их после покрытия требуемых target-ов либо по deadline/pagehide. Нужен аккуратный ownership-token, чтобы не восстановить API поверх нового владельца.

### 6. Старый async lookup Jira issue может переписать новый выбор

**Серьёзность:** medium.

**Где:** `D:\Work\Automation\DashBridge\pages\worklog\worklog.js:215-238, 365-375`.

Запрос заголовка issue запоминает ключ, ждёт сеть и обновляет строку по `logId`. Если пользователь сменил issue, старый медленный запрос остаётся активным и способен записать старый title/summary поверх актуального.

**Риск:** пользователь видит заголовок не той задачи и может отправить некорректный worklog.

**Безопасное исправление:** per-row generation token или `AbortController`; перед записью после `await` сравнить текущий ключ строки с ключом запроса.

### 7. MAIN-world command можно ложно подтвердить тем же origin

**Серьёзность:** medium (целостность операции, не эскалация Chrome privilege).

**Где:** `D:\Work\Automation\DashBridge\js\shared\grafana-command.js:11-24`.

Bridge публикует requestId через `window.postMessage` и принимает `panelToolsApplied` при совпадении origin, source, action и requestId. Скрипт, уже исполняющийся в MAIN world Grafana, может увидеть ID и отправить соответствующее ложное acknowledgement.

**Риск:** extension page может показать успешное применение настройки, хотя команда не была обработана runtime.

**Безопасное исправление:** не использовать публичный `postMessage` как подтверждение привилегированного результата. Предпочтительно вернуть результат напрямую из одного `executeScript`/внутреннего runtime API либо применить одноразовый непубличный канал с дополнительной проверкой runtime generation.

### 8. TDM export привязан к volatile Popup и допускает параллельные запуски

**Серьёзность:** medium.

**Где:**
- `D:\Work\Automation\DashBridge\pages\popup\popup-tdm.js:59-60, 96-107, 138-245`;
- возможная длительность page exporter: `D:\Work\Automation\DashBridge\pages\popup\popup-tdm-page-export.js:3-34`.

Кнопка не блокируется и не имеет in-flight lock. Каждый клик создаёт собственные listener, ZIP, injection и finalization; Popup при этом может быть уничтожен при закрытии/потере фокуса.

**Риск:** дублирующиеся экспорты/скачивания, конфликтующий scroll и потеря ZIP/finalization в долгой (до 10 мин.) операции.

**Безопасное исправление:** перенести orchestration/archive/final download в worker или долговечную extension page. Минимум — disable button, persisted operation ID/status и восстановление статуса при повторном открытии Popup.

---

### P2. Средний приоритет

### 9. Visible-tab capture не инвалидируется на same-URL reload

**Серьёзность:** medium.

**Где:** `D:\Work\Automation\DashBridge\js\shared\grafana-panel-capture.js:3-33`.

`tabs.onUpdated` считает операцию невалидной только при отличающемся `change.url`. Reload/замена документа с тем же URL между подготовкой и `captureVisibleTab()` не блокирует захват.

**Риск:** в архив попадёт replacement/still-loading document вместо подготовленной панели.

**Безопасное исправление:** также инвалидировать capture при `change.status === 'loading'` у целевой вкладки, сохранив существующие проверки active tab/window/expected URL/pending URL и `finally` cleanup.

### 10. Dashboard auth recovery может пропустить быстрое initial navigation

**Серьёзность:** low-medium.

**Где:** `D:\Work\Automation\DashBridge\pages\batch\batch-panel-picker.js:19-24, 45-63`.

Auth-tab создаётся до регистрации listener. Быстрый cached navigation способен завершиться в этом окне, после чего код напрасно ждёт до 120 секунд.

**Риск:** пользователь видит ложную долгую авторизацию после уже успешного входа.

**Безопасное исправление:** сразу запросить актуальный status tab и/или повторить dashboard API после создания; listener оставить для интерактивного redirect/login.

### 11. Base URL Jira и issue key недостаточно строго валидируются у execution boundary

**Серьёзность:** low security hardening.

**Где:**
- `D:\Work\Automation\DashBridge\pages\worklog\worklog.js:72-77, 194-202`;
- `D:\Work\Automation\DashBridge\pages\worklog\worklog-jira-client.js` (конструирование URL/issue path).

Страница получает raw Jira URL из sync storage; request path строится конкатенацией с неencoded issue key. `cleanLink()` допускает произвольные оставшиеся символы.

**Риск:** обход нормализации после import/старого state; некорректные ссылки и запросы.

**Безопасное исправление:** повторно нормализовать base URL при инициализации Worklog, валидировать формат key (либо надёжно кодировать path segment), прекращать запросы при invalid configuration.

### 12. Неправильные daily totals на DST и неявная timezone-политика

**Серьёзность:** low.

**Где:** `D:\Work\Automation\DashBridge\pages\worklog\worklog.js:3-17`.

Верхняя граница дня рассчитывается как local midnight + ровно 24 часа elapsed time. В день DST это не календарный конец дня; политика также может расходиться с configured Jira timezone.

**Риск:** пограничные worklogs будут посчитаны не за тот день/превысят или не превысят лимит ошибочно.

**Безопасное исправление:** вычислять следующий local calendar midnight через изменение даты, не прибавлением миллисекунд; явно задокументировать и применять выбранную timezone-политику на totals и submission.

### 13. Profile storage принимает noncanonical Grafana route

**Серьёзность:** low-medium security hardening.

**Где:** `D:\Work\Automation\DashBridge\js\background-profile-storage.js:102-126`.

Проверка URL основана на подстроке pathname `/d/` или `/d-solo/`, а не на каноническом predicate dashboard route. Top-frame extension sender на configured host может сохранить URL вида `/some/d/value`.

**Риск:** расхождение receiver validation с остальными Grafana boundaries; особенно нежелательно при широком static content-script registration.

**Безопасное исправление:** переиспользовать единый canonical dashboard-route validator до URL conversion/persistence, сохранив проверки extension ID, top frame, scheme/host, panel ID, payload normalizer и storage safeguards.

### 14. resize handler Popup не подтверждает source extension page

**Серьёзность:** medium security hardening.

**Где:**
- `D:\Work\Automation\DashBridge\js\background.js:268-272`;
- intended callers: `D:\Work\Automation\DashBridge\pages\popup\popup-core.js:4-14`, `D:\Work\Automation\DashBridge\pages\popup\popup-grafana-router.js:111-120`.

В отличие от соседних privileged handler, `dashbridge-popup-capture-size` принимает любой sender с `tab` и `windowId`, после чего делает `chrome.windows.update`.

**Риск:** это пока hardening gap, а не доказанный website-triggered exploit: прямой relay не подтверждён. Однако content scripts стоят на all URLs/all frames, и изменение будущего relay может расширить доступ.

**Безопасное исправление:** требовать `isTrustedExtensionPage(sender, 'pages/popup/popup.html')`; при необходимости дополнительно валидировать ownership capture-window/server-side status.

### 15. Diagnostic report недостаточно редактирует URL secret-параметры

**Серьёзность:** high privacy risk / medium implementation priority.

**Где:** `D:\Work\Automation\DashBridge\pages\popup\popup-grafana-debug.js:67-74, 156-173, 183-205, 240-247`.

Редактор маскирует только ограниченный список названий (`token`, `auth`, `password`, `secret`, `apikey`, `api_key`) и `var-*`. Значения `session`, signed request, authorization code, JWT-параметры и URL userinfo могут остаться в serialized report, который копируется в clipboard.

**Риск:** непреднамеренная передача credential material в тикет/поддержку.

**Безопасное исправление:** по умолчанию скрывать все query values и оставлять allowlist нужных параметров (`from`, `to` и т.п.); удалить username/password; по возможности не сохранять даже имена ключей без диагностической необходимости.

### 16. Capture defaults публикуются до host-scope authorization

**Серьёзность:** low.

**Где:**
- manifest registration: `D:\Work\Automation\DashBridge\manifest.json:53-67`;
- publication: `D:\Work\Automation\DashBridge\js\content\content.js:15-37, 53-57`.

Isolated script на всех URL публикует capture enabled/width/height в dataset после загрузки settings. Другие данные (analysis settings/icon URL) scope-gated.

**Риск:** наружу уходит лишь configuration metadata, не dashboard data; но нарушена единообразная host-boundary политика.

**Безопасное исправление:** публиковать эти dataset fields только после того же host-scope predicate либо документировать и централизовать исключение.

### 17. Popup dashboard-edit modal не имеет полной доступной семантики

**Серьёзность:** low (accessibility).

**Где:**
- markup: `D:\Work\Automation\DashBridge\pages\popup\popup.html:387-407`;
- доступный controller: `D:\Work\Automation\DashBridge\pages\shared\modal-accessibility.js:24-31, 57-80`.

Есть focus trap и Escape, но dialog не имеет `role="dialog"`, `aria-modal`, `aria-labelledby`; видимые labels не связаны с полями через `for/id` либо nesting.

**Риск:** screen reader не обязан объявить модальность и доступные имена полей.

**Безопасное исправление:** добавить dialog role/aria relationships и семантическую связь label—input.

---

## Архитектурная оценка и что не следует упрощать вслепую

### Карта областей

- **Service worker:** `D:\Work\Automation\DashBridge\js\background.js` и `background-*.js` — Chrome API authority, runtime registration, DNR, capture windows, profile persistence, analytics.
- **Grafana bridge:** `js\content\content.js` (isolated world), ordered MAIN-world runtime из `js\shared\grafana-runtime-manifest.js`, визуальные/сетевые/data-transform модули в `js\content\`.
- **Batch:** composition root `pages\batch\batch.js`; operation gate, lifecycle, worker-owned capture window, panel readiness/loader, archive.
- **Worklog:** `pages\worklog\worklog.js` + Jira client; local persistent worklogs и последовательная отправка.
- **Popup/Options:** настройки, direct commands, debug/UI/TDM/Jira transfer. Popup должен оставаться тонким UI-клиентом, а не владельцем длинных операций.
- **Recorder/Confluence:** `scenario-recorder.js`, `inject.js` — отдельные от Grafana surfaces.

### Сложность Grafana обоснована

Совместимость поддерживает legacy/modern Grafana: Flot, uPlot, SVG/canvas, React/Fiber, Scenes/runtime, разную legend/panel markup и DataFrame responses. В соответствующих модулях (`DashBridgeGrafanaLegendVisuals`, `...VisibilityAdapters`, `...ThresholdVisuals`, `...PanelDataRuntime`, `...PanelMenuRuntime`, `grafana-panel-tools.js`) множество selector/renderer ветвей — это реальная зона регрессионного риска, но не «лишние if» без доказанного неработающего пути.

**Рекомендация по упрощению:**
1. выделить адаптеры по renderer family (Flot/uPlot/DOM/React) за стабильным фасадом;
2. держать версионную compatibility matrix и regression fixtures для каждого adapter;
3. не смешивать transport, UI state и renderer probing в одном controller;
4. удалять ветвь только после доказательства отсутствия поддерживаемой версии/потребителя.

### Полезные существующие защиты, которые нужно сохранить

- Batch capture window принадлежит worker, port проверяется по точному extension ID и URL страницы, есть session orphan cleanup и cleanup при disconnect.
- Batch lifecycle использует run ID, AbortController и ownership-sensitive `finish`; `processing` gate сериализует запуск.
- Panel loader имеет abort, timeout и явное снятие tab/abort listeners.
- Worklog фиксирует успешные Jira POST по одной записи и останавливает дальнейшую отправку, если не удалось сохранить acknowledgement: это защищает от слепого duplicate retry.
- Panel picker рендерит через `textContent`, ограничивает список и валидирует panel ID.
- Shared/background области используют bounded schemas, normalizers, tab/initiator scoped DNR и validation analytics contracts.
- Popup input writer flushes на `visibilitychange(hidden)` и `pagehide`; modal controller корректно освобождает lifecycle listeners.

---

## Приоритетный план исправлений

1. **Сразу:** не передавать password values в Recorder; исправить ложный GUI-capture success; закрыть URL-redaction gap.
2. **Затем:** добавить deadline/abort в Batch capture-port, strict Worklog validation, stale issue lookup guard, same-URL capture invalidation.
3. **Authority cleanup:** перенести TDM long-running export из Popup, сделать status/result background-authoritative; добавить sender validation resize handler.
4. **Consistency:** unified canonical Grafana route predicate; Jira execution-boundary normalization; consistent host gating capture metadata; DST/timezone policy.
5. **Поддерживаемость:** разложить Grafana renderer adapters и зафиксировать compatibility matrix до попыток сократить ветви.

## Области для регрессионных сценариев после исправлений

- Grafana reload с тем же URL ровно между prepare/capture.
- Серии: успешный match, no match, batch с несколькими datasource, cleanup hooks после result и после timeout.
- Worklog: 29/30/31 февраля, DST boundary, invalid/negative/formatted efforts, быстрая смена issue во время lookup.
- GUI capture: worker success/error/delayed response; Popup закрывается во время операции.
- TDM: double-click, закрытие Popup, повторное открытие и восстановление status.
- Diagnostics: URL userinfo, session/signed/JWT/custom secret parameter, `var-*`.
- Grafana compatibility: uPlot, Flot, SVG/canvas, legacy/modern legend, nested panel and `d-solo` URL.

## Изменения в ходе аудита

Никакие production, test или configuration файлы не изменялись. Этот документ — единственный созданный файл по явной просьбе подготовить отдельный отчёт.
