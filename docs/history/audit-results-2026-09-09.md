# Завершённые исправления и проверки — 9 сентября 2026

Это история выполненной работы, **не список открытых задач**. Исправления находятся в рабочей копии 2.4.3; факт публикации здесь не утверждается. Актуальные задачи — в [roadmap](../roadmap.md), действующие контракты — в [архитектуре](../architecture.md).

Повторные исходные аудиты, их приложения и три инвентаря удалены при очистке docs. Незавершённые замечания по доступности, раннему snapshot графика и browser acceptance перенесены в roadmap. Ниже сохранены итоговые результаты вместо противоречащих друг другу описаний состояния до/после.

## Более ранние завершённые группы

| Область | Что уже сделано | Где закреплено |
|---|---|---|
| Подключения Grafana | Добавление неизвестного host с подтверждением, сериализация и ожидание MAIN/DNR, guards устаревшей формы | Архитектура; `test/grafana_connection_behavior.js` |
| Переменные сообщений | Общий контекст во фразах и списках; корректные profile/panel-only вставки и диагностика | `test/dashbridge_report_variable_contract_behavior.js`, report engine/controller/audit |
| Сообщения и коллаж | Сохранность ручного текста, проверка контекста, предел 8 снимков, скрытие overlay, согласованный общий сбор и восстановление | `test/dashbridge_report_controller_behavior.js`, `test/support/browser-report-collage.js` |
| Первая группа из 6 дефектов | Profile CAS, видимые ошибки сохранения, актуальные report editors, Options connections CAS, SW-владение окном Batch, exact-host DNR | Profile/report regressions, `test/background_batch_capture_behavior.js`, `test/dnr_session_rules_behavior.js` |
| Восемь последующих дефектов | Profile reload/draft, tools editor Save, Replay startup, root-frame navigation, vCPU helper cleanup, variable query scope, port scope, deadline TDM | Тесты перечислены ниже |
| Первая замена галочек | Два параметра Recorder, четыре шаблона сообщения и SLA-фильтр стали switch; общий focus/disabled/reduced-motion | Архитектура и текущие HTML/CSS; незакрытая доступность отдельно в roadmap |

Постоянные регрессии восьми исправлений:

- `test/dashbridge_profile_reload_race_behavior.js`
- `test/dashbridge_panel_tools_save_race_behavior.js`, `test/grafana_panel_modal_save_failure_behavior.js`
- `test/recorder_startup_races_behavior.js`, `test/recorder_navigation_scope_behavior.js`
- `test/grafana_panel_transport_scope_behavior.js`, `test/grafana_response_filter_workspace_behavior.js`
- `test/grafana_runtime_port_scope_behavior.js`, `test/support/browser-runtime-port-scope.js`
- `test/tdm_export_deadline_behavior.js`

В первых отчётах legacy Flot был недоступен из-за DNS. После включения VPN выбранные проверки пройдены; окончательные результаты ниже. Старые пометки «Flot недоступен» не являются текущим блокером. Это не закрывает все специальные сценарии Batch, коллажа и внешних интеграций.

## Последняя группа: 12 исправлений

Все F01–F12 последнего помодульного аудита перепроверены и исправлены в текущей рабочей копии DashBridge 2.4.3. До production-правок воспроизведены ошибочные исходы и падения новых assertions ожидаемого поведения; после правок те же регрессионные сценарии проходят. Старые `fresh-audit-*.cjs` сохранены как исторические воспроизведения: они ожидают дефект, поэтому не являются тестами исправленной версии.

### Что изменено

| Находка | Исправление | Постоянная проверка |
| --- | --- | --- |
| F01 Worklog Undo | Подтверждение Jira POST сохраняется по stable ID во всех существующих Undo/Redo snapshots до локального commit. История не возвращает отправленную строку в batch. | `test/worklog_history_send_behavior.js`: Undo/Redo, восстановление строк, partial batch и ошибка commit; реальный history/Send, synthetic Jira |
| F02 migration/CAS | Page migration и SW broker разделяют `dashbridge-profile-storage` Web Lock на весь read/backup/sync/marker/commit lifecycle. | `test/dashbridge_migration_concurrency_behavior.js`: два контекста, competing migrations/CAS, partial retry, backup и missing locks |
| F03 Batch Series | Поколение preparation и проверки текущих URL/selection отбрасывают старые ответы и finally. Programmatic Copy Main также инвалидирует подготовку. | `test/batch_series_preparation_races_behavior.js`, `batch_page_controller_behavior.js` |
| F04 iframe settings | Проверяется текущая панель/профиль/config baseline, Save ожидает commit, повторный Save блокируется; ошибка сохраняет открытые поля, навигация выполняется после успеха. | `test/dashbridge_iframe_settings_save_behavior.js`: quota retry, замена/удаление/смена профиля, layout-only и theme/URL reload |
| F05 deleteProfile | Актуальный массив и ID проверяются после подтверждения; повторно проверяются исчезнувший и последний профиль. | `test/dashbridge_profile_delete_race_behavior.js` |
| F06 fullscreen | Layer карточки 150 находится выше header100 и ниже dialog200+/report editor. | `test/dashbridge_iframe_settings_browser.cjs`: Chromium hit-test, Tab, Escape, focus; подключён к каноническому browser smoke |
| F07 MAIN generations | Единственный document wrapper использует callbacks актуального владельца; cleanup/install старого поколения не сбрасывают и не захватывают нового. | `test/grafana_panel_data_generation_behavior.js`: fetch/XHR, direct/iframe, in-flight, late cleanup/install |
| F08 variables timeout | Реальный 20s deadline охватывает adapter/import/poll waits; timeout/stop освобождает busy и инвалидирует поздние continuations. | `test/grafana_variables_deadline_behavior.js`: import/refresh hang, retry, late set/result, stop/reinitialization |
| F09 Test Runner startup | Синхронный run guard, локальный spool в callbacks, отмена подготовки и освобождение предыдущей диагностики при новом запуске. | `test/test_runner_operation_ownership_behavior.js`: double Run, selection reload, Clear, cancel, OPFS failure, pagehide |
| F10 Flot cleanup | Queued microtask сверяет controller с текущим WeakMap owner перед rebind. | `test/grafana_flot_visibility_cleanup_behavior.js`: reset/replacement/new owner и native negative control |
| F11 variable URL | Предел 4096 совпадает с persistence schema; исходный и Grafana-resolved выбор проверяются до изменения panels/accepted snapshot. | `dashbridge_variables_state_behavior.js`, `dashbridge_variables_refresh_behavior.js`: 4096/4097, oversize, rollback и повтор |
| F12 export/Clear | Export захватывает snapshot/spool до await, запрещает второй export и блокирует Run/Clear до success/error/cancel; pagehide учитывает активного владельца. | `test/test_runner_operation_ownership_behavior.js`: streaming, duplicate export, error/cancel unlock |

Независимое ревью дополнительно обнаружило pagehide во время startup со старым completed spool. Этот случай сначала подтверждён отдельным RED assertion, затем исправлен и включён в постоянный Test Runner regression. Предыдущие незакоммиченные изменения сохранены; version, permissions и production module layout не менялись. Коммиты и публикация не выполнялись.

### Проверка влияния

Использованы Superpowers receiving-code-review/systematic-debugging/TDD/verification, skill chrome-extensions и modern-web-guidance. До изменений обновлён GitNexus index-only: 13017 nodes, 36962 edges, 651 flows. Для владельцев выполнены context/upstream impact: migration/broker, iframe editor, deleteProfile, variable codec, Worklog history/Send, Series preparation, MAIN install/variables/Flot reset, Test Runner Run/export. Точный поиск проверил classic-script consumers, message actions, DOM selectors, storage keys и новый общий lock.

После production-правок индекс обновлён повторно: 13457 nodes, 38267 edges, 649 flows. `detect-changes` сообщает 80 tracked files, 343 symbols, 200 processes **для всей накопленной dirty working copy**, включая прежние задачи. Автоматическая метка critical — эвристика размера охвата, не подтверждённая критическая уязвимость. GitNexus сообщает ограничения fanout/trace: отсутствие ребра не использовалось как доказательство неиспользования.

Подробные локальные evidence: `test-results/twelve-fixes-main.md`, `twelve-fixes-dashbridge.md`, `twelve-fixes-integrations.md`, `twelve-fixes-*-context.json`, `twelve-fixes-*-impact.json`, `twelve-fixes-index-after.log`, `twelve-fixes-changes-after.txt`.

### Живые проверки

Итоговый `npm run test:all` завершился с **exit 0**: ESLint, **181 JavaScript test files**, **41 Python checks**, **19/19 browser smoke pages/workflows**, 0 console warnings и 0 external request failures. В этот прогон включена новая Chromium-проверка fullscreen settings. Лог: `test-results/twelve-fixes-verified.log`; browser evidence: `test-results/extension-smoke.json`. Module guard: 154 production JS/9 documented exceptions; dependency guard: 10 pages/249 load edges/0 advisory warnings; documentation links и `git diff --check` проходят.

- Direct Grafana 12.2.1/uPlot, panel137, и Grafana10.1.10/Flot, panel40: A1/A3/A5/A6/H1_1/H1_2/H4_3/H8_3, **16 PASS, 0 FAIL, 0 SKIP, 0 NOT RUN**. Проверены загрузка, ON/OFF, повторные переходы видимости/порога и штатное восстановление. `test-results/twelve-fixes-live.json` и `.log`.
- Временные named iframe в настоящей странице DashBridge: uPlot и Flot, ON fill/width → повторное выполнение canonical 29-file MAIN bundle через DevTools → OFF. В обоих случаях generation1→2, ACK applied, flags OFF, current owner присутствует. `test-results/twelve-fixes-live-iframes.json`. Сохранённые профили не менялись.
- Первая iframe-проба была вне видимой области и не дождалась renderer; временная тестовая панель перенесена в viewport. Попытка `scripting.executeScript(allFrames)` включала extension top document и была штатно отклонена Chromium; для fixture использовано выполнение того же bundle непосредственно в MAIN тестового iframe. Это ограничения тестовой оснастки, не найденные production-дефекты.

Обычный live lifecycle не гарантирует воспроизведение каждого редкого interleaving: именно такие случаи покрыты детерминированными production-module regressions. Jira POST проверен синтетически; реальные worklog не создавались. Полный ручной визуальный прогон всех тем, масштабов, окон и состояний не выполнялся.

### Поведение, которое важно сохранить

- Неудачно сохранённые iframe settings остаются общим dirty profile draft, как в прежнем tools editor. Cancel закрывает окно, но не откатывает этот draft и чужие смежные правки. Ошибка остаётся видимой до закрытия/успешного retry.
- Worklog исправляет именно отмену подтверждения через историю. Явное ручное редактирование уже отправленной строки сохраняет прежний контракт; атомарность между Jira POST и local storage по-прежнему невозможна.
- После перезагрузки расширения нужно обновить уже открытые Grafana и страницы расширения. Старый MAIN wrapper предыдущей версии не содержит новой привязки owner; безопасная миграция выполняется при загрузке документа.
- Незначительно расширены два документированных size budget: data-runtime740 и runner-ui780 строк. Оба содержат тот же неделимый lifecycle; новые production-модули и дублирующие владельцы не добавлялись. Архитектурные контракты обновлены в `docs/architecture.md`.
