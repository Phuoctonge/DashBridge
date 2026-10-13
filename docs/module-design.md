# Стандарт модулей DashBridge

Этот документ определяет, когда нужен новый JavaScript-файл, каким должен быть
его публичный контракт и как проверить перенос логики. Размер помогает ревью,
но граница модуля всегда проходит по владельцу состояния и lifecycle, а не по
случайному количеству строк.

## Краткие правила для следующего модуля

Сверено с действующими реализациями 2026-09-09. Это стандарт для новой работы,
а не утверждение, что весь legacy-код уже ему соответствует. Карта текущих
владельцев — [architecture.md](architecture.md), команды и матрица проверок —
[development-guide.md](development-guide.md). Известные ограничения и
нереализованные UX-предложения находятся в [roadmap.md](roadmap.md).

1. **Начинать с пользовательского результата.** Описать путь «открыть →
   изменить → применить → увидеть результат», область действия и момент
   сохранения. Новое окно должно помогать выполнить задачу, а не требовать
   дополнительного перехода ради внутренней технической подготовки.
2. **Сначала найти существующего владельца.** Новый файл допустим для новой
   самостоятельной ответственности. Новая кнопка, вкладка, повтор запуска или
   PiP вызывает тот же controller, не создавая второй параллельный lifecycle.
3. **Разделять контексты.** MAIN работает с Grafana/renderer; isolated — мост
   к Chrome API; extension page — рабочий UI; service worker — фоновое владение
   полномочиями и ресурсами. Чистый helper может переиспользоваться в нескольких
   контекстах, если сам не обращается к DOM, Chrome API и их состоянию.
4. **Передавать зависимости явно.** `create({...})` получает нужные сервисы,
   callbacks, getters и при необходимости часы/timers. Обязательные зависимости
   проверяются на входе. У общего состояния один владелец; потребители получают
   контракт, а не доступ к его внутренним коллекциям.
5. **Блокировать повторный старт до первого await.** Run/Record/Replay/Export
   устанавливает guard синхронно. Disabled-кнопка лишь отражает guard. Snapshot
   параметров и принадлежащие операции ресурсы фиксируются до ожиданий.
6. **Проверять актуальность после ожиданий.** Перед применением результата
   сверять run/request ID и контекст: профиль, panel ID, URL или выбор. Старые
   success/error/finally не должны обновлять новую операцию или снимать её busy.
   Для живого редактирования получать актуальный объект по ID, а не сохранять
   в захваченную до диалога ссылку на объект.
7. **Считать сохранённым только подтверждённый commit.** Save ожидает запись,
   ошибка оставляет черновик и понятный путь повтора. Для общего изменяемого
   состояния одной очереди внутри вкладки недостаточно: нужен соответствующий
   broker/CAS или общий lock. Миграция согласуется с обычными писателями.
8. **Освобождать только свои ресурсы.** Observer, timer, listener, iframe,
   окно, debugger, Blob URL, transport wrapper и OPFS lease имеют владельца.
   Cleanup повторяемый и учитывает cancel, ошибку, замену поколения и закрытие
   документа; старый cleanup не очищает ресурсы нового владельца.
9. **Ограничивать ожидание и объём данных.** Настоящий deadline охватывает
   fetch, body, adapter/import и последующие ожидания. Timeout не делает поздний
   результат актуальным. Caps задаются до дорогого чтения/распаковки; единицы
   явные: байты, записи, символы или длительность.
10. **Проверять полномочия у получателя.** Sender/source/origin, маршрут,
    host, request ID и payload проверяются по контракту операции. DOM dataset
    и введённый URL не являются сами по себе разрешением. Общие host permissions
    не заменяют узких runtime guards.
11. **Использовать общие контракты вместо копий.** Runtime order, defaults,
    schema, URL identity, capture helpers, тема, масштаб и analytics catalog
    берутся у текущих владельцев. Похожий renderer-код с другим lifecycle не
    объединять механически; shared helper не должен скрыто забирать владение.
12. **Показывать честный результат.** Cancel останавливает следующие шаги,
    но не откатывает уже выполненную внешнюю запись или отправленный запрос;
    unavailable/no_data не считается нормой, partial не считается полным
    успехом. Подписи различают временное Apply, сохранение профиля и общие
    defaults. Аналитика отражает подтверждённый результат и не блокирует функцию.

## Что переиспользовать и где посмотреть реализацию

Это примеры отдельных контрактов, не файлы для копирования целиком.

| Потребность | Владелец / пример | Что учитывать |
|---|---|---|
| Factory с явными зависимостями | [panel-tools-controller](../pages/dashbridge/dashbridge-panel-tools-controller.js) | `create`, проверка dependencies, getters текущего профиля, корреляция ожиданий |
| Профили из нескольких вкладок | [profile-store](../js/shared/dashbridge-profile-store.js), [background broker](../js/background-profile-storage.js) | Fingerprints/expectedProfiles и атомарный конфликт; не заменять записью всего старого массива |
| Очередь локальных сохранений | [storage-writer](../js/shared/storage-writer.js) | Ожидать Promise `write`; `flush` ждёт опустошения очереди и сам по себе не подтверждает успех всех записей |
| Частое текстовое поле в sync | [sync-input-writer](../js/shared/sync-input-writer.js) | Debounce/flush и onError; `bind` рассчитан на документ, не предоставляет общего teardown для многократно создаваемых форм |
| Двойной старт / snapshot экспорта | [test-runner-ui](../pages/test-runner/test-runner-ui.js), [export-controller](../pages/test-runner/test-runner-export-controller.js) | Один run/export owner, связанный snapshot/spool, взаимодействие с Clear и pagehide |
| Точные ответы iframe | [iframe-message-controller](../pages/dashbridge/dashbridge-iframe-message-controller.js) | Проверять конкретное окно, origin и текущий контекст до dispatch |
| Поколения MAIN | [panel-data-runtime](../js/content/grafana-panel-data-runtime.js) | Один document wrapper, callbacks текущего владельца, безопасный поздний cleanup |
| Нормализация данных | [local-state-schema](../js/shared/local-state-schema.js), [grafana-settings](../js/shared/grafana-settings.js) | Нормализация при load/import; UI и runtime используют одни defaults |
| Идентичность панели / загрузка | [panel-identity](../js/shared/grafana-panel-identity.js), [runtime-manifest](../js/shared/grafana-runtime-manifest.js) | Не вводить второй формат ключа или копию списка файлов |
| Modal и прогресс | [modal-accessibility](../pages/shared/modal-accessibility.js), [operation-progress-window](../pages/shared/operation-progress-window.js) | Helpers управляют фокусом/представлением; Save/Cancel и ресурсы остаются у controller |
| Страница и стили | [theme.js](../pages/shared/theme.js), [theme.css](../pages/shared/theme.css) | Раннее применение темы/масштаба, общие tokens/rem, viewport вместо screen.width |
| Метрики использования | [analytics-client](../js/shared/analytics-client.js), [analytics.md](analytics.md) | Только каталог разрешённых событий; никаких рабочих текстов, URL и секретов |

Для новых UI сохранять нативные controls и связанные подписи. Switch —
булевый режим, checkbox — выбор набора; внешний вид не определяет момент
сохранения. Долгая операция не должна зависеть от того, что popup остаётся
открытым. Focus/Escape, обе темы, масштаб и состояние ошибки входят в контракт.

## Паспорт модуля перед реализацией

Заполнить в описании задачи или PR; отдельный постоянный файл на каждый
модуль не нужен. Для неприменимых пунктов достаточно причины.

```text
Пользовательский результат и точка входа:
Существующий владелец; почему нужен новый файл:
Каталог и контекст исполнения:
Публичный API и обязательные зависимости:
Кто вызывает API; script/runtime order:
Состояние: временное / черновик / сохранённое; ключи и schema:
Область: панель / профиль / вкладка / вся установка:
Когда применяем и когда подтверждаем сохранение:
Run/request ID, guard, проверка устаревшего результата:
Ресурсы, владелец cleanup, cancel/pagehide/повторная загрузка:
Trust boundary, проверки входа, caps и deadline:
Success/error/partial/unavailable и восстановление после ошибки:
Совместимость, затронутые потребители и тесты:
Документы, которые нужно обновить:
```

Например, «повторить перепроверку из результатов Recorder» не требует нового
session controller. Кнопка обращается к существующему владельцу replay;
параметры следующего запуска показываются до старта, guard и cleanup остаются
общими. Это пример применения стандарта, не реализованная здесь UX-функция.

## Проверки контракта нового модуля

Выбирать по ресурсам и последствиям, не копировать одинаковые тесты для каждого
чистого helper. Проверка должна исполнять настоящий production-модуль; timers,
сеть, Chrome API и storage подменяются на границе.

| Контракт | Минимальный смысл проверки |
|---|---|
| Асинхронный запуск | Double start до разрешения первого await; cancel во время подготовки; последующий успешный запуск |
| Результат с контекстом | Старый ответ после смены URL/профиля/selection не меняет актуальный state |
| Сохранение | Ошибка commit сохраняет ввод; retry; конкурентная правка; невалидный импорт не заменяет принятые данные |
| Cleanup | Повторный stop, ошибка посередине, pagehide и замена владельца; чужие ресурсы сохранены |
| Message/URL | Неверные sender/source/origin/request ID, неподдерживаемый URL и превышенный размер |
| Renderer/capture | Success/error restore; повторное включение/выключение; direct/iframe и uPlot/Flot |
| Внешняя запись | Частичный результат, запрет повторной отправки подтверждённого; Undo локального ввода не откатывает факт внешнего действия |

Примеры отрицательных сценариев:
[operation ownership](../test/test_runner_operation_ownership_behavior.js),
[profile migration concurrency](../test/dashbridge_migration_concurrency_behavior.js),
[MAIN generations](../test/grafana_panel_data_generation_behavior.js),
[iframe Save](../test/dashbridge_iframe_settings_save_behavior.js).

Не переносить в новый код как норму: зависимость clipboard authority от DOM,
сохранение общих данных без проверки конфликта, проглатывание ошибки commit,
самостоятельный повторный lifecycle у второй кнопки, бессрочный polling и
сокрытие неоднозначности кнопкой «Отмена». Известные случаи и оставшиеся работы
перечислены в roadmap; стандарт не утверждает, что они уже устранены.

## Основное правило

Новый файл должен уменьшать объём знаний, необходимых для безопасного
изменения функции. Если после переноса для одной обычной правки приходится
открывать больше владельцев состояния, разделение ухудшило архитектуру.

Один модуль должен иметь:

1. одну сформулированную ответственность;
2. один контекст владения ресурсами: service worker, MAIN, isolated world либо
   extension page; чистый helper без такого состояния может работать в нескольких;
3. явные входные зависимости;
4. одного владельца изменяемого состояния;
5. явный `start/create` и `stop/cleanup`, если создаются ресурсы;
6. стабильный facade, если модуль загружается как classic script;
7. поведенческий тест публичного контракта.

## Размер

Для handwritten production JavaScript в `js/` и `pages/` действуют пределы:

- целевой размер: 300–500 физических строк;
- общий предел нового файла: 700 строк;
- общий предел нового файла: 64 КиБ UTF-8;
- превышение любого предела запрещено без именованного исключения.

Байты используются вместо количества символов: Unicode и разные окончания
строк делают «число символов» нестабильной метрикой. Проверка выполняется
`node scripts/check-module-boundaries.js`; бюджеты находятся в
`scripts/module-size-budgets.json`.

Существующие крупные файлы не требуется механически делить. Для них задан
индивидуальный no-growth budget и причина. Если файл стал меньше общего
предела, исключение удаляется. Увеличивать исключение можно только вместе с
объяснением, почему новая ответственность принадлежит этому владельцу и почему
отдельный модуль ухудшит контракт.

Размер не оправдывает разделение, если:

- обе части совместно владеют одним изменяемым state machine;
- cleanup одной части невозможен без внутренних деталей другой;
- возникает двусторонняя зависимость или цикл загрузки;
- новый файл состоит только из однострочных proxy-функций;
- перенос создаёт второй источник истины для schema, defaults или каталога;
- код сгенерирован из одного каталога и меняется атомарно.

## Когда разделять

Разделение оправдано, если выполняется хотя бы один сильный критерий:

- в файле есть два независимых владельца ресурсов или lifecycle;
- чистые преобразования смешаны с transport/DOM/Chrome API;
- один блок исполняется в другой trust boundary;
- часть имеет самостоятельные входы, выходы и отрицательные сценарии;
- часть переиспользуется минимум двумя потребителями;
- изменение одного блока регулярно требует загружать несвязанную логику.

Пример правильной границы: pure response transforms отдельно от fetch/XHR
interceptor. Пример неправильной: observer остаётся в одном файле, а его
controller state и cleanup переносятся в другой.

## Когда объединять

Модули следует объединить, если после разделения обнаружено, что:

- публичный API почти полностью повторяет внутренний API соседа;
- состояние передаётся туда и обратно на каждом событии;
- файлы никогда не тестируются или не изменяются независимо;
- script order существует только ради искусственной прослойки;
- для понимания одной функции постоянно нужны три и более мелких proxy-файла;
- ни один файл не может описать собственный lifecycle и cleanup.

Объединение выполняется тем же безопасным процессом, что перенос: impact,
точный поиск строковых контрактов, dependency guard и полный тестовый прогон.

## Выбор каталога

| Задача | Каталог |
|---|---|
| Extension page и её UI/lifecycle | `pages/<feature>/` |
| Общий UI extension pages | `pages/shared/` |
| Общая чистая логика и контракты | `js/shared/` |
| Grafana MAIN renderer/data | `js/content/` + runtime manifest |
| Isolated bridge с Chrome API | `js/content/` + manifest/узкий loader |
| Service worker owner | `js/background-*.js`, dispatcher в `background.js` |
| Dev/release инструмент | `scripts/` |
| Поведенческая проверка | `test/` |

Не создавай новый общий каталог `utils`, `helpers` или `common`: имя должно
показывать предметную область и владельца. Файл называется по возможности
`<feature>-<responsibility>.js`; слова `manager`, `service` и `helper` допустимы
только когда более точного владельца действительно нет.

## Публичный контракт classic script

DashBridge не собирается bundler-ом, поэтому порядок `<script>`, manifest и
`importScripts` является runtime-контрактом. Рекомендуемый facade:

```js
(function initFeatureRuntime(root) {
    'use strict';

    const create = dependencies => {
        // closure-owned state
        const run = input => {};
        const stop = () => {};
        return Object.freeze({ run, stop });
    };

    root.DashBridgeFeatureRuntime = Object.freeze({ create });
})(globalThis);
```

Требования:

- dependency загружается раньше consumer;
- mutable state остаётся в closure созданного controller;
- наружу публикуется минимальный frozen facade;
- обязательная dependency проверяется сразу с понятной ошибкой;
- consumer регистрирует `stop` у владельца поколения;
- повторная инъекция не оставляет старые observers/listeners/wrappers;
- не создаются новые неименованные `window.*` globals;
- строковые actions/events/storage keys документируются и тестируются.

Не переносить функцию отдельно от используемых ею `Map`, `WeakMap`, generation,
observer, listener, RAF/timer и cleanup. Такое разделение создаёт скрытое
совместное владение и утечки.

## State, timers и ресурсы

Перед добавлением `setTimeout`/`setInterval` сначала проверь возможность
событийного завершения: promise результата, MutationObserver, Chrome event,
AbortSignal или явный state transition. Timer допустим как bounded watchdog,
debounce, settle-window либо fallback, но у него должны быть:

- владелец;
- верхняя граница ожидания;
- отмена при `stop`, abort и повторной generation;
- тест success, timeout и cancellation;
- отсутствие рекурсивного re-arm от собственной DOM mutation.

Для `MutationObserver`, `ResizeObserver`, event listener, Blob URL, iframe,
debugger attach, DNR rule, fetch/XHR wrapper и временного DOM/style изменения
обязателен симметричный cleanup. Для временного изменения capture используется
`try/finally`.

## Trust boundary

Новый модуль не должен размывать контекст полномочий:

- MAIN world не получает Chrome API;
- isolated bridge не доверяет DOM dataset как источнику authority;
- `postMessage` проверяет точные `origin` и `source`;
- service worker повторно проверяет sender, host, route и payload;
- URL принимает только HTTP(S), без credentials;
- внешние строки выводятся через DOM properties/`textContent`;
- imports, diagnostics, archives и network bodies имеют schema и caps.

Перед изменением permissions, DNR, clipboard, downloads или debugger прочитай
`permission-map.md`.

## Порядок создания или переноса

1. Полностью прочитать `architecture.md`, затем документы области.
2. Назвать текущего владельца функции, контекст исполнения и потребителей.
3. Обновить GitNexus: `gitnexus analyze --index-only`.
4. Выполнить upstream impact и context для переносимых символов.
5. Точным `rg` найти message action/type, CustomEvent, storage key, DOM id,
   selector, script path и global facade.
6. Запустить dependency guard с `--explain` для исходного файла.
   До создания или переноса также выполнить `node scripts/check-module-boundaries.js`;
   контекст и при необходимости путь между владельцем и потребителем проверить
   через `gitnexus context`, `gitnexus trace`, затем `gitnexus detect-changes`.
7. Зафиксировать API нового модуля до переноса: dependencies, methods, state,
   cleanup, fail-open/fail-closed.
8. Перенести state и lifecycle целиком; dispatcher и facade не менять без
   отдельной причины.
9. Обновить script order, ESLint globals, архитектуру и поведенческие тесты.
10. Запустить module budget, dependency guard, targeted tests и полный runner.
11. Для MAIN/renderer выполнить browser smoke и живые uPlot/Flot проверки.
12. Повторить GitNexus analyze/detect-changes и подготовить отдельный логический
    набор изменений для ревью. Коммит и интеграцию выполнять в рамках текущего
    задания, не включая посторонние незакоммиченные правки.

## Definition of done

Модуль готов, только если:

- его ответственность можно описать одним предложением;
- у состояния и ресурсов ровно один владелец;
- все consumers найдены и используют новый facade;
- старые символы и состояния отсутствуют точным поиском;
- runtime loader содержит dependency до consumer;
- повторная загрузка и cleanup покрыты тестом;
- error/abort/timeout путь не оставляет ресурсов;
- `check-module-boundaries`, dependency guard, ESLint и полный runner проходят;
- `architecture.md` отражает фактического владельца;
- обязательные для изменённого контракта browser-only проверки выполнены.
  Если среда недоступна, результат отмечается как частично проверенный,
  оставшаяся проверка фиксируется в roadmap; это не эквивалент полного PASS.
