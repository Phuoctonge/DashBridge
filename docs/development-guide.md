# DashBridge: ориентир для дальнейшей разработки

> Проверено по исходному коду и тестам 2026-08-28. Архитектурный источник
> истины — [`extension-architecture.md`](../extension-architecture.md), карта
> разрешений — [`permission-map.md`](permission-map.md), незавершённые
> направления — [`plans/README.md`](../plans/README.md). История не описывает
> текущее поведение.

## Текущее состояние

Расширение не требует сборки и загружается напрямую из исходной папки. На
момент проверки проходят:

- 92 JavaScript behavior-файла;
- 41 Python smoke/security/audit-файл;
- `node --check` для всех 76 production JavaScript-файлов.

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

## Матрица влияния изменений

| Меняется | Обязательно проверить | Часто затрагиваемые места |
|---|---|---|
| Grafana MAIN-модуль | порядок runtime, direct Grafana, DashBridge iframe, повторную установку | `grafana-runtime-manifest.js`, `background.js`, `js/content/` |
| Renderer/легенда/threshold | uPlot и Flot, View/dashboard, refresh/remount, restore после capture | `grafana-visual-engine.js`, `grafana-panel-tools.js` |
| Network transform | fetch и XHR semantics, panel scope, fail-open, отсутствие helper-серий | `grafana-network.js`, response filters |
| DashBridge panel/profile | schema, import/export, pause, theme, time, drag/drop, source+origin | `dashbridge.js`, renderer, profile store |
| Batch | отдельное окно, cancel/error cleanup, лимиты PNG/ZIP, Blob URL lifecycle | `batch.js`, loader/capture/lifecycle helpers |
| Capture | save и copy, prepared on/off, DPR/crop, success/error restore | shared capture helpers, content bridge, background |
| Storage/import | legacy и hostile input, rejected backup, сериализация записей | `local-state-schema.js`, `storage-writer.js`, Options |
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

## Выпуск версии

Версия в `manifest.json`, README badge и Git tag должна совпадать. Скрипт
`scripts/build-release.ps1` собирает минимальный ZIP расширения и SHA-256,
исключая тесты, документацию и локальные артефакты:

```powershell
./scripts/build-release.ps1 -ExpectedTag 'v2.4.0'
```

Push тега `vX.Y.Z` запускает `.github/workflows/release.yml`: полный набор
тестов, проверку совпадения тега с версией manifest, сборку
`DashBridge-X.Y.Z.zip` и SHA-256, затем публикацию GitHub Release с
автоматически сформированными release notes. При открытии popup проверяет
`releases/latest` не чаще одного раза в 12 часов, игнорирует draft/prerelease и
принимает download URL лишь при полном совпадении стабильного тега, версии,
GitHub-путей и имени архива. Это уведомление об обновлении, а не автоматическая
установка: ZIP скачивается по действию пользователя, после чего распакованное
расширение нужно заменить и обновить в браузере вручную.

## Политика комментариев

Комментарий должен объяснять не очевидное действие, а ограничение: почему
важен порядок, кто владеет cleanup, какая граница доверия проверяется и какую
совместимость сохраняет fallback. Исторические номера багов и пересказ кода
лучше заменять ссылкой на действующий контракт или тест.
