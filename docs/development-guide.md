# DashBridge: ориентир для дальнейшей разработки

> Для версии 2.4.3. Команды и описание проверок сверены 2026-09-09. Архитектурный источник
> истины — [`architecture.md`](architecture.md), карта
> разрешений — [`permission-map.md`](permission-map.md), незавершённые
> направления — [`roadmap.md`](roadmap.md). История не описывает
> текущее поведение.

## Текущее состояние

Расширение не требует сборки и загружается напрямую из исходной папки.
Текущее количество production-файлов и проверок намеренно не фиксируется в
документе: его печатают канонические runners. Полный прогон включает module
budget, dependency contracts, все JavaScript/Python проверки, ESLint и
автономный browser smoke extension pages в чистом профиле.

Автотесты хорошо фиксируют структурные и поведенческие контракты, но не
заменяют живую проверку Chrome/Grafana: renderer, clipboard, capture,
авторизованные API и lifecycle MV3 service worker зависят от браузера.
Browser smoke не требует пользователя и ловит ошибки загрузки локальных
страниц, но не подменяет авторизованную Grafana-сессию.

## Ключевые инварианты

1. Grafana MAIN-runtime имеет один упорядоченный список в
   `js/shared/grafana-runtime-manifest.js`. Порядок — часть контракта загрузки.
2. Данные Grafana и renderer меняются в MAIN world. Chrome API вызываются из
   isolated world или extension page через узкий мост.
3. Любой `postMessage` использует точный origin; получатель проверяет `origin`
   и, где есть родитель/iframe, `source`.
4. Постоянная MAIN-регистрация/backfill ограничены настроенными hosts и
   маршрутами `/d/`/`/d-solo/`. Явные loader-вызовы Batch/Test Runner используют
   выбранный HTTP(S) dashboard URL; полная область описана в permission-map.
   Новые привилегированные мосты не должны доверять DOM dataset. Capture bridge
   хранит authority в closure, service worker повторно проверяет host/route.
   Существующий time-picker clipboard использует dataset для UI scope;
   это отмеченное ограничение, которое нельзя копировать как безопасный шаблон.
5. DNR-правила остаются session- и tab-scoped. Нельзя возвращать глобальное
   снятие X-Frame-Options/CSP.
6. Любое временное изменение DOM, размеров или renderer при capture
   восстанавливается в `finally`, включая ошибочный путь.
7. Частые UI-события не пишут напрямую в `storage.sync`: используется
   debounce/flush. Объёмные данные и diagnostics принадлежат `storage.local`.
8. Storage keys и profile/worklog schema — публичный внутренний контракт.
   Изменение требует нормализации legacy state и round-trip import/export.
9. Внешний текст попадает в DOM через `textContent`/DOM properties либо
   context-correct escaping. Проверка URL не заменяет экранирование HTML.
10. Совместимость определяется renderer и DOM (uPlot/Flot), а не только номером
    версии Grafana. Fallback нельзя удалять по результату проверки одной среды.
11. Responsive UI определяется шириной viewport/container в CSS-пикселях.
    `screen.width` и DPR не управляют раскладкой; DPR используется только в
    canvas/capture. Геометрия контролов масштабируется через общие `rem`-токены
    и `uiScale`, а широкие data-workspace не получают произвольный desktop cap.
12. Намерение DashBridge `Refresh Off` передаётся только во fragment и
    самостоятельно читается ранним one-shot MAIN wrapper для same-origin
    dashboard-definition response. Он не должен зависеть от более позднего
    bootstrap helper или использовать несовместимый `refresh=off`; простое
    отсутствие query-параметра позволяет Grafana восстановить сохранённый
    dashboard refresh. Если SoloPanel не запрашивает dashboard definition,
    допустим только узкий fallback для стека `SoloPanelPage → setupIntervalTimer`;
    остальные timers обязаны сохранить native semantics.
    Любое изменение выбранного режима refresh пересоздаёт iframe один раз:
    разные SoloPanel router не гарантируют создание или удаление scheduler после
    одного `history.replaceState`/`popstate`.
13. Versioned storage migration создаёт backup до изменения и пишет schema
    marker последним. Удалять временный migration-модуль можно только вместе с
    его script tag, startup call, backup/marker policy и legacy load fallback.
14. Clipboard time range нормализуется между Grafana 10/12, читается и пишется
    только по user action; невалидный payload не должен менять picker/state.
15. Длительные Batch, Recorder и E2E-операции используют общий
    `DashBridgeOperationProgress` на Document Picture-in-Picture. Запрос окна
    выполняется до первого `await`, пока действует user activation; отсутствие
    API не блокирует основной in-page lifecycle, а cancel вызывает владельца
    операции, не создавая второй независимый state machine.

## Матрица влияния изменений

| Меняется | Обязательно проверить | Часто затрагиваемые места |
|---|---|---|
| Grafana MAIN-модуль | порядок runtime, direct Grafana, DashBridge iframe, повторную установку | `grafana-runtime-manifest.js`, `background.js`, `js/content/` |
| Renderer/легенда/threshold | uPlot и Flot, Table, View/dashboard, refresh/remount, restore после capture | `grafana-panel-definition.js`, `grafana-unit.js`, `grafana-table-report.js`, `grafana-visual-engine.js`, `grafana-panel-tools.js` |
| Network transform | fetch и XHR semantics, panel scope, fail-open, отсутствие helper-серий | `grafana-network.js`, response filters |
| DashBridge panel/profile | schema, import/export, pause, theme, time, drag/drop, source+origin | `dashbridge.js`, report transport, renderer, profile store |
| Time/refresh | relative/absolute range, Grafana 10/12 clipboard, Off vs saved dashboard refresh, iframe reload | `dashbridge-time-state.js`, `grafana-time-picker-clipboard.js`, `grafana-panel-bootstrap.js`, `grafana-refresh-policy.js` |
| Batch | отдельное окно, cancel/error cleanup, лимиты PNG/ZIP, Blob URL lifecycle | `batch.js`, loader/capture/lifecycle helpers |
| Confluence Report | авторизованная live-страница, REST storage/attachment scan, точное сопоставление test/group/metric/occurrence; mutation только отдельным подтверждаемым этапом | `pages/confluence-report/`, `confluence-report-live-*.js`, `confluence-report-scanner.js` |
| Recorder/DashFlow | CDP lifecycle, network/HAR projection, atomic import, ZIP working-set и entry caps, SHA-256 bodies, secrets warning | `recorder.js`, `recorder-dashflow-export.js`, `recorder-dashflow-io.js`, `dashflow-schema.js` |
| Test Runner | порядок runtime scripts, OPFS spool, planned/completed/NOT RUN, PiP cancel и elapsed time, cleanup окна Grafana | `pages/test-runner/test-runner-*.js`, `pages/shared/operation-progress-window.js`, `pages/test-runner/test-runner.html` |
| Capture | save и copy, prepared on/off, DPR/crop, success/error restore | shared capture helpers, content bridge, background |
| Storage/import | legacy и hostile input, rejected backup, сериализация записей | `local-state-schema.js`, `storage-writer.js`, Options |
| Storage migration | backup до commit, marker последним, повтор после partial failure, удаление legacy keys только после commit | `dashbridge-data-migration.js`, `dashbridge-time-state.js`, `pages/dashbridge/dashbridge.html` |
| Runtime message | sender, payload type/size, authority конкретного контекста | `background.js`, соответствующий sender |
| Permission/DNR | минимальный сценарий, tab/host scope, документацию | `manifest.json`, `dnr-rules.js`, `permission-map.md` |
| Новая page/popup UI | порядок scripts, раннюю тему, safe DOM rendering, keyboard/focus | feature-каталог в `pages/`, общие модули в `js/shared/` |

## Зоны повышенного риска

### Крупные runtime-модули

Некоторые runtime- и Test Runner-модули остаются крупнее общего предела, потому
что владеют единым state machine или сгенерированным каталогом. Их текущие
no-growth бюджеты и причины находятся в `scripts/module-size-budgets.json`.
При добавлении функции сначала ищите существующего владельца в
`architecture.md`; правила разделения и объединения находятся в
[`module-design.md`](module-design.md).

### Browser-only совместимость

Заглушка блокируемого Grafana Live WebSocket намеренно не обещает
`instanceof WebSocket`. Механическое изменение prototype опасно из-за native
brand checks. Исправлять это можно только вместе с browser fixture для
blocked/non-blocked sockets и живой проверкой Grafana.

### Широкие host permissions

`<all_urls>` нужен для заранее неизвестных корпоративных адресов, поэтому
реальная защита находится в runtime guards: настроенные hosts, HTTP(S), route,
sender/source/origin и ограниченные payload. Каждый новый мост должен иметь
собственный guard; одного факта, что сообщение пришло из расширения,
недостаточно для выдачи полномочий content script.

### DOM Grafana

Селекторы и React/renderer internals нестабильны. Предпочтительный порядок:
устойчивый data-атрибут → renderer-specific признак → документированный
fallback. MutationObserver обязан иметь владельца и cleanup либо доказанную
одноразовую остановку.

### Ранние transport wrappers

`grafana-network.js` и `grafana-refresh-policy.js` намеренно работают в MAIN
world до renderer. Для любого такого wrapper обязательны точный request scope,
сохранение native semantics, отсутствие повторного оборачивания и ограниченный
lifecycle. Refresh-policy — отдельный one-shot механизм: он допустим только для
именованного DashBridge iframe с fragment policy `off` и same-origin GET
dashboard definition; расширять его на datasource responses или direct
Grafana нельзя.

### Clipboard совместимость времени

Grafana 12 копирует absolute range как UTC ISO, а legacy Grafana ожидает
локальную форму. `grafana-time-picker-clipboard.js` поэтому перехватывает только
native Copy/Paste рядом с Apply либо добавляет эти две кнопки в legacy picker;
сам Apply остаётся Grafana-native. Изменение формата требует round-trip тестов
для local datetime, ISO с zone, epoch milliseconds, JSON и URL, плюс проверки
невалидного payload.
Lifecycle-регрессии должны отдельно проверять отзыв UI scope: native listeners
Grafana сохраняются, DashBridge capture listener снимается с восстановлением
title/marker/classes, legacy кнопки удаляются. Deferred clipboard read/write после
отзыва, закрытия picker, замены inputs или pagehide не должны писать в старые
inputs или показывать feedback. Повторные activation/remount не накапливают
listeners; pageshow согласует UI с текущим scope. Dataset остаётся UI scope,
а не независимой проверкой доверенного host.

## Проверка изменения

Однократная установка dev-зависимостей и официального тестового Chromium:

```powershell
npm ci --ignore-scripts
npm run browser:install
```

`--ignore-scripts` запрещает lifecycle-скрипты пакетов при установке.
Зафиксированные версии и integrity находятся в `package-lock.json`; для
повторной supply-chain проверки используются `npm audit` и
`npm audit signatures`.

Полный автономный dev-прогон:

```powershell
npm run test:all
```

Он последовательно запускает ESLint, канонические Node/Python-тесты и browser
smoke. Эти же три проверки обязательны в release workflow; Chromium там
работает под Xvfb. Browser smoke использует отдельный временный профиль, собирает console,
page и network diagnostics в `test-results/extension-smoke.json`. При ошибках
создаются диагностические снимки; отдельные визуальные сценарии сохраняют
изображения и при успехе как evidence. Путь к другому тестовому Chromium можно
явно задать через `DASHBRIDGE_CHROME_PATH`.

Worklog smoke подменяет только точный стартовый GET
`https://jira.lanit.ru/rest/api/2/myself` локальным JSON fixture до навигации.
Проверяются единственное обращение, имя пользователя и `auth-ok` в настоящем UI;
остальные запросы и ошибки console не подавляются. HTTP 401 и network failure
отдельно проверяются unit-тестом Jira client. Это проверка локального startup,
а настоящая авторизация Jira требует отдельного явно выбранного live-теста.
Клавиатурные проверки DashBridge используют paused sample panel в собственном
временном профиле: внешние iframe не участвуют в этом локальном focus-тесте.
Удержание фокуса при асинхронном autofocus живого iframe остаётся отдельной
проверкой и открытым ограничением из roadmap.

Для живых Grafana используется один постоянный профиль, отдельный от обычного
Chrome и от временного smoke-профиля:

```powershell
npm run auth:grafana -- 'https://grafana-one.example/d/...' 'https://grafana-two.example/d/...'
```

Команда открывает обе Grafana в официальном Playwright Chromium с загруженным
DashBridge. Пользователь входит в обе системы один раз и закрывает окно;
последующие E2E используют сохранённые browser cookies. Профиль по умолчанию
находится в `.dashbridge-local/e2e/browser-profile` внутри рабочей папки
DashBridge. Каталог добавлен в `.gitignore`, не входит в release paths и
содержит cookies/local storage авторизованных сессий; он не должен попадать в
Git, ZIP расширения или архивы релиза. URL не должны содержать username,
password или token; секреты не передаются скрипту и не сохраняются в исходниках.
Можно начать с одного URL и позже повторить команду со вторым: обе авторизации
останутся в том же постоянном профиле.
Сохранённую авторизацию без показа credentials проверяет
`npm run check:grafana-session -- '<dashboard-url>'`: команда требует успешный
`/api/user`, отсутствие login redirect и загруженный service worker DashBridge.

Для видимого Chrome в пользовательском desktop-сеансе используйте ярлык
`Запустить Grafana Playwright.cmd` в корне проекта. Он по умолчанию открывает
`chrome://new-tab-page`; после этого любую Grafana можно открыть вручную.
Тот же launcher доступен как
`scripts/Open-Grafana-Playwright.cmd '<dashboard-url>'`. Launcher открывает
отдельный `.dashbridge-local/visible-profile`, загружает unpacked-расширение и
поднимает CDP на `127.0.0.1:9222`; ссылка не зашивается в проект и может быть
передана при каждом запуске. После входа проверка
`node scripts/check-visible-grafana-cdp.js --port 9222` перебирает HTTP(S)-вкладки
подключённого окна и проверяет `/api/user`, поэтому конкретный домен в проекте
не требуется. Playwright подключается ко всему Chrome через CDP и может работать
с любой вкладкой этого профиля. Профиль основного Chrome не используется.

Живой Fast-прогон запускается без ручного управления окнами:

```powershell
npm run test:grafana:live -- --mode=fast 'https://grafana-one.example/d/...'
```

Для точечной проверки нового opt-in live-контура используется один bounded
сценарий настоящего unpacked-расширения:

```powershell
npm run test:live:check -- 'https://grafana-one.example/d/...'
npm run test:live:scenario -- --url 'https://grafana-one.example/d/...' --panelSelector "section[data-testid*='Panel title']" --panelId 8 --hidden 'Series A'
npm run test:live:scenario -- --url 'https://grafana-one.example/d/...' --evidence test-results/live-scenario
```

`test:live:check` ограничен readiness-проверкой (до 15 секунд на Grafana), а
один сценарий — 30 секундами. Сценарий проходит `apply`, наблюдение результата,
`reset` и проверку восстановления; ошибка авторизации, DNS или неподдержанный
renderer получают `blocked`, а не `passed`. Эти команды не запускаются из
`test:all` и не входят в release ZIP.
Smoke запускает только явно зарегистрированные capability-сценарии и поэтому
не расширяет быстрый набор автоматически:

```powershell
npm run test:live:smoke -- --scenario legend-complete-hide --url 'https://grafana-one.example/d/...'
```

Для нескольких авторизованных Grafana используется последовательная matrix:

```powershell
npm run test:live:matrix -- --urls 'https://grafana-one.example/d/...,https://grafana-two.example/d/...' --scenario legend-complete-hide
```

Один persistent profile не используется параллельно; каждый URL получает
отдельный результат, а недоступный environment остаётся `blocked`.
Опция `--evidence` сохраняет только bounded JSON (`live-scenario.json`),
обезличенный общим redaction-слоем; сохранение evidence не является обязательным
для обычного запуска.

Точечный повтор выполняется тем же владельцем сценариев по стабильным ID:

```powershell
npm run test:grafana:live -- --mode=full --tests=H1_1,HP9_1 'https://grafana-one.example/d/...'
```

Без `--tests` внешний запуск намеренно выбирает весь профиль и не наследует
интерактивный выбор, сохранённый пользователем в окне Test Runner.

Для двух уже авторизованных Grafana передаются два URL; Full используется перед
выпуском после чистого Fast. Playwright здесь только управляет существующим
`pages/test-runner/test-runner.html`: матрица сценариев и доказательство reset
не дублируются в Node-скрипте. Результаты сохраняются локально в
`test-results/live-grafana-e2e.json` и
`test-results/live-grafana-e2e-failures.txt`. Полный JSON не следует выводить в
AI-контекст: для штатной диагностики достаточно счётчиков и компактной записи
проваленного теста; screenshot создаётся лишь при фатальной ошибке оркестратора.

Для ежедневной разработки не обязательно запускать весь профиль. Кнопка
«Выбрать сценарии» открывает отдельное окно с поиском, человекочитаемыми
названиями и шагами. Доступны весь текущий профиль, Fast-набор, последние FAIL,
последние NOT RUN и произвольный выбор. Выбранные стабильные ID применяются
после ограничений URL и Fast/Full; нулевой набор блокируется. Компактная история
ограничена 20 запусками и не заменяет диагностические отчёты.

Название, описание и шаги нового сценария добавляй в тот же generated catalog,
из которого строится `DASHBRIDGE_TEST_SUITE`; не создавай отдельную ручную карту
ID для UI. Для матричного Full допустимо повторно использовать только доказанный
финальный reset предыдущего теста на той же панели. Текущий semantic snapshot,
native legend и all-OFF invariant должны подтвердить границу; иначе обязателен
полный isolation reset с Refresh.

Полный dependency-free прогон:

```powershell
node test/run-all-tests.js
```

Если Python отсутствует в `PATH`, укажите исполняемый файл явно:

```powershell
$env:DASHBRIDGE_PYTHON = 'C:\path\to\python.exe'
node test/run-python-smoke-tests.js
```

Быстрая синтаксическая проверка production JS:

```powershell
$files = @(rg --files js pages -g '*.js')
foreach ($file in $files) { node --check $file }
```

Перед выпуском изменения:

1. Запустить полный набор и targeted-тест изменённого контракта.
2. Проверить HTML script order, `importScripts` и runtime manifest.
3. Для MAIN/renderer правки пройти direct Grafana и DashBridge, uPlot и Flot.
4. Для capture проверить success, failure и визуальное восстановление.
5. Для storage проверить новый, legacy и повреждённый state.
6. Для URL/message/import добавить отрицательный тест, а не только happy path.
7. Если менялось permission или DNR, обновить `permission-map.md`.
8. Если менялось фактическое поведение, владелец логики или необычный guard,
   обновить `architecture.md` в том же изменении.

## Выпуск версии

Версия в `manifest.json`, README badge и Git tag должна совпадать. Скрипт
`scripts/build-release.ps1` собирает минимальный ZIP расширения и SHA-256,
а также отдельный `Install-DashBridge.ps1` и его checksum. Installer не входит
в extension ZIP:

```powershell
./scripts/build-release.ps1 -ExpectedTag 'v2.4.3'
```

Push тега `vX.Y.Z` запускает `.github/workflows/release.yml`: полный набор
тестов, проверку совпадения тега с версией manifest, сборку
`DashBridge-X.Y.Z.zip`, installer и их SHA-256, затем публикацию GitHub Release с
автоматически сформированными release notes. При открытии popup проверяет
`releases/latest` не чаще одного раза в час, игнорирует draft/prerelease и
принимает download URL лишь при полном совпадении стабильного тега, версии,
GitHub-путей и имён ZIP/installer assets. Popup скачивает installer только по
явному действию. Installer сверяет checksum ZIP, делает staging/backup и не
обходит ручное первичное подтверждение Chromium. После его изменения обязательны
обе проверки, которые также запускаются release workflow:

```powershell
pwsh ./scripts/Install-DashBridge.ps1 -SelfTest
pwsh ./test/installer_regressions.ps1
```

Они не входят в `npm run test:all`. Полный контракт находится в
`docs/installer.md`.

## Изменение аналитики

Перед добавлением аналитики прочитайте `docs/analytics.md`. Каждая новая точка
должна ссылаться на статический `featureId` из allowlist и передавать только
закрытые категориальные dimensions. URL, домены, заголовки, имена, Jira/TDM/
Recorder данные и тексты исключений запрещены. Для долгой операции фиксируйте
намерение отдельно от результата, для сохранённой настройки — дневной
`configured`, а `effective` принимайте только от владельца runtime после
применения. Аналитика остаётся fail-open и не получает отдельный observer или
частый timer.

Админка collector проверяется локально через
`scripts/Start-AnalyticsDev.ps1`; она использует только `.dev-data` и
синтетические fixtures. Публикация выполняется `scripts/Publish-Analytics.ps1`:
визуальные assets применяются без restart, server/contract — с коротким
health-checked restart и rollback. В release запрещено включать SQLite,
credentials, Compose или root helper.

## Политика комментариев

Комментарий должен объяснять не очевидное действие, а ограничение: почему
важен порядок, кто владеет cleanup, какая граница доверия проверяется и какую
совместимость сохраняет fallback. Исторические номера багов и пересказ кода
лучше заменять ссылкой на действующий контракт или тест.
