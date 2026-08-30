# DashBridge: ориентир для дальнейшей разработки

> Сверено с версией 2.4.1, исходным кодом и тестами 2026-08-29. Архитектурный источник
> истины — [`extension-architecture.md`](../extension-architecture.md), карта
> разрешений — [`permission-map.md`](permission-map.md), незавершённые
> направления — [`plans/README.md`](../plans/README.md). История не описывает
> текущее поведение.

## Текущее состояние

Расширение не требует сборки и загружается напрямую из исходной папки. На
момент проверки проходят:

- 97 JavaScript behavior-файлов;
- 41 Python smoke/security/audit-файл;
- `node --check` для всех 78 production JavaScript-файлов.

Автотесты хорошо фиксируют структурные и поведенческие контракты, но не
заменяют живую проверку Chrome/Grafana: renderer, clipboard, capture,
авторизованные API и lifecycle MV3 service worker зависят от браузера.

## Ключевые инварианты

1. Grafana MAIN-runtime имеет один упорядоченный список в
   `js/shared/grafana-runtime-manifest.js`. Порядок — часть контракта загрузки.
2. Данные Grafana и renderer меняются в MAIN world. Chrome API вызываются из
   isolated world или extension page через узкий мост.
3. Любой `postMessage` использует точный origin; получатель проверяет `origin`
   и, где есть родитель/iframe, `source`.
4. Grafana runtime регистрируется только для настроенных hosts и маршрутов
   `/d/`/`/d-solo/`. `<all_urls>` в manifest не является разрешением включать
   функциональность на каждом сайте.
   DOM dataset может сообщать scope MAIN world, но не может авторизовать Chrome
   API: isolated bridge хранит authority в собственном closure, а service worker
   повторно проверяет host/route привилегированного capture-запроса.
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
    применяется ранним one-shot MAIN wrapper к same-origin dashboard-definition
    response. Query omission недостаточен: Grafana восстановит сохранённый
    dashboard refresh.
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
| Renderer/легенда/threshold | uPlot и Flot, View/dashboard, refresh/remount, restore после capture | `grafana-unit.js`, `grafana-visual-engine.js`, `grafana-panel-tools.js` |
| Network transform | fetch и XHR semantics, panel scope, fail-open, отсутствие helper-серий | `grafana-network.js`, response filters |
| DashBridge panel/profile | schema, import/export, pause, theme, time, drag/drop, source+origin | `dashbridge.js`, renderer, profile store |
| Time/refresh | relative/absolute range, Grafana 10/12 clipboard, Off vs saved dashboard refresh, iframe reload | `dashbridge-time-state.js`, `grafana-time-picker-clipboard.js`, `grafana-panel-bootstrap.js`, `grafana-refresh-policy.js` |
| Batch | отдельное окно, cancel/error cleanup, лимиты PNG/ZIP, Blob URL lifecycle | `batch.js`, loader/capture/lifecycle helpers |
| Test Runner | порядок runtime scripts, OPFS spool, planned/completed/NOT RUN, PiP cancel и elapsed time, cleanup окна Grafana | `test-runner-*.js`, `operation-progress-window.js`, `test-runner.html` |
| Capture | save и copy, prepared on/off, DPR/crop, success/error restore | shared capture helpers, content bridge, background |
| Storage/import | legacy и hostile input, rejected backup, сериализация записей | `local-state-schema.js`, `storage-writer.js`, Options |
| Storage migration | backup до commit, marker последним, повтор после partial failure, удаление legacy keys только после commit | `dashbridge-data-migration.js`, `dashbridge-time-state.js`, `dashbridge.html` |
| Runtime message | sender, payload type/size, authority конкретного контекста | `background.js`, соответствующий sender |
| Permission/DNR | минимальный сценарий, tab/host scope, документацию | `manifest.json`, `dnr-rules.js`, `permission-map.md` |
| Новая page/popup UI | порядок scripts, раннюю тему, safe DOM rendering, keyboard/focus | HTML, `js/pages/` или `js/popup/`, CSS |

## Зоны повышенного риска

### Крупные runtime-модули

`grafana-panel-tools.js`, `grafana-visual-engine.js`, `dashbridge.js` и
`batch.js` объединяют несколько тесно связанных lifecycle-сценариев. Они
покрыты тестами, но локальная правка может иметь нелокальный эффект. При
добавлении функции сначала ищите существующего владельца логики в
`extension-architecture.md`; новый helper выносите только при ясном контракте
входов, cleanup и минимум двух потребителях.

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

## Проверка изменения

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
$files = @(rg --files js -g '*.js')
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
   обновить `extension-architecture.md` в том же изменении.

## Выпуск версии

Версия в `manifest.json`, README badge и Git tag должна совпадать. Скрипт
`scripts/build-release.ps1` собирает минимальный ZIP расширения и SHA-256,
а также отдельный `Install-DashBridge.ps1` и его checksum. Installer не входит
в extension ZIP:

```powershell
./scripts/build-release.ps1 -ExpectedTag 'v2.4.1'
```

Push тега `vX.Y.Z` запускает `.github/workflows/release.yml`: полный набор
тестов, проверку совпадения тега с версией manifest, сборку
`DashBridge-X.Y.Z.zip`, installer и их SHA-256, затем публикацию GitHub Release с
автоматически сформированными release notes. При открытии popup проверяет
`releases/latest` не чаще одного раза в час, игнорирует draft/prerelease и
принимает download URL лишь при полном совпадении стабильного тега, версии,
GitHub-путей и имён ZIP/installer assets. Popup скачивает installer только по
явному действию. Installer сверяет checksum ZIP, делает staging/backup и не
обходит ручное первичное подтверждение Chromium. После его изменения обязателен
`pwsh ./scripts/Install-DashBridge.ps1 -SelfTest`; полный контракт находится в
`docs/installer.md`.

## Политика комментариев

Комментарий должен объяснять не очевидное действие, а ограничение: почему
важен порядок, кто владеет cleanup, какая граница доверия проверяется и какую
совместимость сохраняет fallback. Исторические номера багов и пересказ кода
лучше заменять ссылкой на действующий контракт или тест.
