# Замена изображений в отчёте

> **Статус на 2026-10-13:** Частично реализован с уточнённым дизайном. Действующая Confluence Report page использует REST storage/attachments в origin выбранной страницы, а не editor/native Save bridge. POST/PUT/GET и exact target verification уже существуют (`9714463`); предложенные модули, manifest v2 и полный cancel/pagehide контракт ниже не следует считать автоматически реализованными. Рабочая Confluence acceptance не заявляется.
> Действующее поведение: [архитектура](../../architecture.md), команды и проверки: [разработка](../../development-guide.md), незавершённые направления: [roadmap](../../roadmap.md).

## Назначение

«Замена изображений в отчёте» — отдельная extension page для частичного обновления графиков в уже созданной и открытой странице Confluence. Функционал принимает архив PNG-снимков, созданный Batch, сканирует живой Confluence-редактор, строит сопоставление по структуре теста и метрики, показывает предварительный план и после явного подтверждения загружает новые вложения, изменяет ссылки на изображения и сохраняет страницу.

Функционал не заменяет Batch и не запускает Grafana capture. Batch остаётся владельцем получения снимков и ZIP-архива. Новая страница владеет настройкой Confluence-сеанса, распознаванием отчёта, выбором целей, импортом архива, применением изменений и проверкой сохранённого результата.

Пользовательский термин: «Замена изображений в отчёте». Внутренний feature namespace: `confluence-report-images`.

## Пользовательский результат

Основной сценарий — вертикальные этапы с линейным переходом вперёд:

1. Пользователь вводит URL страницы Confluence. Расширение открывает его в отдельном видимом окне, ждёт завершения загрузки и выполняет read-only scan. При необходимости пользователь авторизуется в этом окне и повторяет scan.
2. После scan пользователь выбирает тесты, группы, метрики и конкретные occurrence изображений. Доступны массовые фильтры, например «Disk Usage во всех тестах», но каждая выбранная позиция сохраняется отдельной target-записью.
3. Только после выбора целей пользователь добавляет ZIP Batch или отдельные PNG. Источник сопоставляется с уже выбранными target-записями; загрузка архива не запускается автоматически при открытии страницы.
4. Расширение показывает таблицу сопоставления «тест → группа → метрика → occurrence → старое → новое» и требует ручного решения неоднозначных строк.
5. После подтверждения preview отображается итоговый immutable plan с количеством замен, пропусков и нерешённых позиций.
6. Пользователь явно запускает Apply. Расширение загружает новые attachments, изменяет только выбранные image nodes, сохраняет страницу и выполняет post-save verification.

Переход к следующему этапу заблокирован, пока не выполнены его входные условия. Возврат к предыдущему этапу разрешён; новый scan или новый набор целей инвалидирует источник, сопоставление и plan. Отсутствие совпадения, неоднозначность или отсутствие изображения не приводит к автоматическому добавлению или замене.

## Границы и контексты исполнения

### Extension page

Новая страница находится в `pages/confluence-report/` и владеет UI вертикальных этапов, состоянием операции, scan, импортом ZIP, выбором целей, preview, cancel и итоговым отчётом. Она не хранит в глобальных переменных service worker состояние операции и не зависит от того, открыт ли Batch.

Предлагаемые production-модули:

- `confluence-report.html` — разметка и порядок classic scripts;
- `confluence-report.js` — композиция страницы и lifecycle;
- `confluence-report-state.js` — состояние текущего запуска, этапов и переходов;
- `confluence-report-zip.js` — чтение ZIP, manifest и caps;
- `confluence-report-scanner.js` — нормализованная карта структуры, без DOM Confluence;
- `confluence-report-matcher.js` — сопоставление источников и целей;
- `confluence-report-plan.js` — immutable plan изменений и dry-run summary;
- `confluence-report-ui.js` — фильтры, таблица, preview и доступность;
- `confluence-report-apply.js` — orchestration upload/edit/save/verify;
- `confluence-report.css` — стили страницы.

Размер и границы модулей проверяются `scripts/check-module-boundaries.js`. State, lifecycle и cleanup одного владельца не переносятся в отдельные proxy-файлы.

### Isolated content world

Новый узкий bridge в `js/content/` передаёт команды только для текущей разрешённой Confluence-вкладки. Он не доверяет DOM как источнику полномочий. Bridge проверяет extension origin, tab/document identity, request ID и активную страницу.

Предлагаемые модули:

- `js/content/confluence-report-bridge.js` — handshake, request correlation и передача результатов;
- `js/content/confluence-report-editor-adapters.js` — обнаружение и адаптация конкретного editor surface.

Текущий `js/content/inject.js` остаётся владельцем существующего Confluence focus/scroll fix и не получает логику редактирования отчёта.

### Shared contracts

`js/shared/confluence-report-schema.js` содержит нормализацию manifest, logical keys, plan/result schema и ограничения входа. Нельзя дублировать schema в Batch, page controller и content bridge.

### Service worker

На первом этапе service worker не становится владельцем HTML-редактирования. Он может быть нужен только для узкого доверенного broker-а загрузки attachment, если browser discovery подтвердит, что upload выполняется через privileged request, а не штатным редакторным механизмом. Любая новая message action получает отдельную sender/URL/tab/payload проверку в `background.js`.

## Контракт Batch-архива

Batch продолжает создавать ZIP. Для новых архивов manifest получает `schemaVersion: 2` и массив `captures`:

```json
{
  "schemaVersion": 2,
  "kind": "panels",
  "generatedAt": "2026-09-18T13:08:47Z",
  "dashboard": {
    "origin": "https://grafana.example",
    "basePath": "",
    "uid": "example",
    "orgId": "11"
  },
  "captures": [
    {
      "file": "captures/test-04/server-system-disk.png",
      "testKey": "test-04",
      "testTitle": "Тест 4. Поиск максимальной производительности",
      "metricGroup": "Метрики серверов системы",
      "metric": "disk",
      "panelId": "8",
      "from": "1789070843158",
      "to": "1789072419260",
      "sha256": "..."
    }
  ],
  "errors": []
}
```

Поле `captures` является рекомендуемым источником истины. Старые ZIP без `captures` принимаются ограниченным fallback-путём: имя файла, путь архива и ручное сопоставление. Fallback не должен считать приблизительное совпадение доказанным.

Для Series-архива используется тот же контракт с `kind: "series"`; source-specific поля не должны менять общий logical key.

Входные ограничения:

- ограниченный размер ZIP и распакованных entries через общий archive budget;
- только PNG для первой версии;
- запрет path traversal и абсолютных путей;
- ограниченное число captures;
- hash проверяется после чтения bytes, если присутствует;
- неизвестные поля manifest сохраняются только как совместимые metadata и не исполняются.

## Модель структуры Confluence

Сканер переводит editor-specific DOM или Storage XHTML в чистый snapshot:

```text
ReportSnapshot
  pageIdentity
  editorKind
  tests[]
    testKey?
    title
    groups[]
      title
      images[]
        occurrence
        caption
        imageReference
        sourceLocation
```

Для образца отчёта ожидается структура:

```text
h3 Тест 1
  h4/h5 Метрики серверов системы
    p Подпись изображения
      image
```

Сканер не должен зависеть от конкретного текста «На рисунке далее можно увидеть». Он использует ближайший смысловой заголовок, подпись, порядковый номер и image reference. Интерфейс редактора может быть `contenteditable`, iframe, textarea со Storage XHTML или другим вариантом; это определяется отдельным adapter.

## Сопоставление

Канонический logical key:

```text
testKey + metricGroup + metric + occurrence
```

`testKey` берётся из manifest, если он надёжен. Если его нет, используются нормализованные номер/заголовок теста и положение в структуре. `metricGroup` и `metric` нормализуются по registry синонимов, но исходные подписи сохраняются для отображения.

Порядок сопоставления:

1. точный logical key;
2. page hierarchy test → group → caption → image;
3. нормализованный caption и group;
4. filename/panel metadata;
5. ручной выбор пользователя.

Правила результата:

- ровно один кандидат получает `exact` или `normalized`;
- несколько кандидатов получают `ambiguous` и блокируют автоматическое применение;
- отсутствие цели получает `not-found`;
- отсутствие источника получает `source-missing`;
- старый ZIP без достаточной metadata получает `manual-required`.

Одинаковая метрика в десяти тестах является десятью отдельными target records. Один source file может быть назначен нескольким target records только явным действием пользователя.

## Режимы пользовательского выбора

### Filter mode

Поля:

- тесты: все или выбранные;
- группа метрик;
- метрика;
- диапазон;
- operation: replace или add.

Пример: «Использование диска во всех тестах».

### Mapping table mode

Каждая строка содержит target context, current image, source image, match status и checkbox. Пользователь может снять отдельные строки и назначить другой source file.

### Add mode

Добавление требует явной target position и подписи. Отсутствие совпадения не запускает Add автоматически.

## Plan и preview

После выбора создаётся immutable `ReportChangePlan`:

```text
pageIdentity
sourceArchiveFingerprint
targetSnapshotFingerprint
operations[]
  operation: replace | add
  targetKey
  sourceFile
  oldReference?
  newCaption?
  confidence
```

Preview показывает:

- старое и новое изображение;
- тест и группу метрик;
- имя source file и диапазон;
- confidence/status;
- итог: replace/add/not-found/ambiguous/skipped.

Кнопка Apply заблокирована при unresolved `ambiguous`, `not-found` или `stale-page`.

## Live Confluence apply

До реализации требуется browser discovery на согласованной тестовой странице:

1. определить page identity и состояние view/edit;
2. определить editor surface;
3. определить штатный attachment upload path;
4. определить штатный Save и подтверждение результата;
5. определить, можно ли безопасно менять модель редактора без прямого REST API;
6. проверить, как Confluence выдаёт новую attachment reference.

После discovery adapter предоставляет узкий API:

```text
readSnapshot(signal)
prepareEdit(plan, signal)
uploadAttachment(source, signal)
applyPreparedEdit(signal)
save(signal)
readSnapshot(signal)
```

Редакторная реализация не смешивается с matcher и ZIP parser.

Перед Apply:

- повторно сверяется URL/page identity;
- проверяется отсутствие изменения editor baseline;
- повторно валидируется plan и source hashes;
- пользовательское действие должно быть явно подтверждено.

Во время Apply:

1. загружаются новые attachments;
2. создаются новые references;
3. меняются только выбранные image nodes и явно выбранные captions;
4. вызывается штатный Save;
5. ожидается подтверждение;
6. выполняется повторное сканирование;
7. результат сравнивается с plan.

Старые attachments не удаляются в первой версии. Это позволяет сохранить восстановление и избежать необратимого удаления при частичном сбое.

## Lifecycle и ошибки

Состояния страницы:

```text
idle → archive-loaded → scanning → ready
ready → planning → preview
preview → applying → verifying → completed
applying → cancelled | partial | failed
```

Операция получает run ID и AbortSignal. Новый scan или новый ZIP инвалидирует старый plan. Pagehide, navigation, смена вкладки и cancel освобождают observers, object URLs, listeners и незавершённые uploads.

Результаты операций:

- `replaced`;
- `added`;
- `not-found`;
- `ambiguous`;
- `source-missing`;
- `upload-failed`;
- `save-failed`;
- `stale-page`;
- `verification-failed`;
- `skipped`.

UI отдельно сообщает «attachment загружен, но страница не сохранена» и «страница сохранена, но verification не подтвердила замену».

## Storage

Не сохранять PNG и ZIP в storage. Допустимо хранить ограниченный локальный state:

- последние фильтры;
- последний режим;
- fingerprint последнего архива;
- ограниченный журнал результата;
- сохранённые правила только после отдельного этапа и явного дизайна schema.

Секреты, cookies, URL с credentials и содержимое внешних страниц в аналитику не отправляются.

## Permissions и trust boundary

Новые permissions не планируются. Используются существующие host access, `tabs`, `scripting`, `storage`, `downloads` только в рамках текущего контракта.

Новый bridge обязан проверять:

- sender extension ID;
- точный extension origin;
- настроенный wiki-domain;
- tab ID и, если доступно, document ID;
- URL страницы и page identity;
- request/run ID;
- schema, размер и caps payload.

DOM и dataset Confluence не являются authority. Они только описывают структуру. Не использовать `innerHTML` для вывода внешнего текста; строки отображать через DOM properties/textContent.

## Тестовая стратегия

### Unit/behavior

- старый и новый manifest;
- ZIP limits, path traversal и hostile entries;
- logical key normalization;
- повторяющиеся captions;
- одинаковые группы в разных тестах;
- один source в несколько targets;
- one-of-ten replacement;
- missing/ambiguous/manual mapping;
- stale page и changed editor baseline;
- cancel during scan/upload/save;
- partial upload and save failure;
- verification mismatch;
- cleanup and repeat run.

### Browser

- page view → Edit;
- modern editor;
- legacy iframe/textarea editor, если реально поддерживается;
- preview keyboard/focus/Escape;
- one image replacement;
- metric replacement across multiple tests;
- no-op plan;
- partial failure and retry;
- save confirmation and post-save rescan.

Изменение Batch дополнительно проверяет старый ZIP, новый manifest и отсутствие регрессий основного/Series capture.

## Этапы реализации

### Phase 0 — browser discovery

Зафиксировать реальную Confluence editor/upload/save surface и минимальный тестовый контекст. Если конкретный редактор не даёт безопасного штатного пути, остановить реализацию этого adapter, не подменяя его неподтверждённым REST-вызовом.

### Phase 1 — Batch manifest

Добавить versioned `captures[]`, stable logical keys и hash, сохранив совместимость старых архивов.

### Phase 2 — read-only page

Создать отдельную страницу, импорт ZIP, scan snapshot и дерево структуры без изменений Confluence.

### Phase 3 — matcher/preview

Добавить exact/normalized/manual matching, Filter mode, Mapping table mode и dry-run summary.

### Phase 4 — replace

Реализовать замену существующих изображений, штатный upload/save и verification.

### Phase 5 — add

Добавить явную вставку отсутствующего изображения и подписи.

### Phase 6 — integration

Добавить launch из Popup и Batch, progress window, retry и ограниченный журнал.

Сохранённые массовые правила являются отдельным последующим изменением и не входят в первый commit.

## Definition of done первой версии

- Batch создаёт versioned manifest с `captures[]`;
- новая страница запускается отдельно от Batch;
- ZIP импортируется с caps и fallback для старого формата;
- живой Confluence snapshot строится без записи;
- одна картинка и выбранная метрика в нескольких тестах сопоставляются корректно;
- неоднозначные случаи блокируют Apply;
- preview показывает точный список изменений;
- Apply меняет только выбранные targets;
- save и post-save verification подтверждены browser-тестом;
- cancel/error/pagehide не оставляют ресурсов;
- `architecture.md`, `permission-map.md`, runtime wiring и tests обновлены;
- module boundary и dependency contract checks проходят.
