# Стандарт модулей DashBridge

Этот документ определяет, когда нужен новый JavaScript-файл, каким должен быть
его публичный контракт и как проверить перенос логики. Размер помогает ревью,
но граница модуля всегда проходит по владельцу состояния и lifecycle, а не по
случайному количеству строк.

## Основное правило

Новый файл должен уменьшать объём знаний, необходимых для безопасного
изменения функции. Если после переноса для одной обычной правки приходится
открывать больше владельцев состояния, разделение ухудшило архитектуру.

Один модуль должен иметь:

1. одну сформулированную ответственность;
2. один контекст исполнения: service worker, MAIN, isolated world либо
   extension page;
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
7. Зафиксировать API нового модуля до переноса: dependencies, methods, state,
   cleanup, fail-open/fail-closed.
8. Перенести state и lifecycle целиком; dispatcher и facade не менять без
   отдельной причины.
9. Обновить script order, ESLint globals, архитектуру и поведенческие тесты.
10. Запустить module budget, dependency guard, targeted tests и полный runner.
11. Для MAIN/renderer выполнить browser smoke и живые uPlot/Flot проверки.
12. Повторить GitNexus analyze/detect-changes и создать отдельный коммит.

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
- живые browser-only проверки либо выполнены, либо явно оставлены в roadmap.
