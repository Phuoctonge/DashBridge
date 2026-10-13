# История ключевых архитектурных решений

Это краткая замена удалённым implementation-планам и аналитическим отчётам за
июль–август 2026 года. Здесь сохранены только решения, которые всё ещё важны
при изменении кода. Текущее устройство описано в
[`../architecture.md`](../architecture.md).

## Grafana runtime и renderer

- MAIN-world модули загружаются через один упорядоченный runtime manifest.
  Изолированный контекст не имеет доступа к JS-объектам Grafana; обработка
  ответа перед renderer требует MAIN. Регистрация, backfill и документные
  wrappers имеют разные lifecycle — их нельзя сводить к одной операции OFF.
- Flot и uPlot остаются отдельными путями совместимости; fallback нельзя
  удалять после проверки только одной версии Grafana.
- CPU и RAM transformations не объединяются. Popup compact capture и Batch
  raw capture также остаются разными сценариями.
- Изменения DOM, canvas, размеров панели и renderer при capture обязательно
  восстанавливаются, включая ошибочный и отменённый путь.

## Безопасность и границы доверия

- Глобальное снятие CSP/XFO было заменено session- и tab-scoped DNR-правилами.
  Совпавшее правило снимает весь CSP header, а не только `frame-ancestors`;
  это остаточное ограничение. Настройка embedding на сервере является альтернативой,
  если доступна владельцу Grafana. Причины, точные условия и тесты — в
  [архитектуре](../architecture.md#почему-используются-нестандартные-механизмы)
  и [карте разрешений](../permission-map.md).
- Внешние строки рендерятся как текст; URL, origin, sender и source проверяются
  на границах контекстов.
- Test Runner остаётся внутренней extension page и не публикуется как web
  accessible resource.
- Изменение identity заглушки заблокированного Grafana Live WebSocket было
  сознательно отложено: вмешательство в prototype требует browser-runtime
  доказательства из-за native brand checks.

## Lifecycle, storage и объём данных

- Diagnostics, caches, архивы и capture имеют явные лимиты.
- Записи storage сериализуются по revision; частые настройки записываются через
  debounce/flush.
- Batch, TDM и GUI capture имеют отмену, лимиты памяти и гарантированный
  cleanup временных ресурсов.
- Recorder использует CDP ради network bodies/streams; штатный Stop и авария
  extension page имеют разные гарантии. Fallback worker выполняет best-effort
  detach, но не закрывает incognito window. Полный контракт и причины хранения
  секретов — в [DashFlow v2](../dashflow-v2.md).
- `unlimitedStorage` сохранён временно ради существующих больших локальных
  данных. Его удаление возможно только после измерения пользовательского
  storage и проверки миграции.

## Границы модулей

- DOM-карточка DashBridge и её actions принадлежат одному lifecycle-владельцу:
  прежний отдельный actions controller создавал встречные callbacks и был
  объединён с `dashbridge-panel-card-controller.js`.
- `test-runner-report.js` сохранён как стабильный facade сборки и compaction
  артефакта. Чистый visual audit и агрегация health/failure вынесены в
  `test-runner-visual-audit.js` и `test-runner-report-analysis.js`, поскольку
  имеют самостоятельные входы, выходы и тесты без владения UI/OPFS lifecycle.
- Полный статический список размеров файлов не хранится в документации:
  актуальные пределы и исключения принадлежат `check-module-boundaries.js` и
  `module-size-budgets.json`. Документируется причина границы, а не снимок
  быстро меняющихся строк и байтов.

## Тестирование

- `node test/run-all-tests.js` объединяет Node/Python и guards; полный
  автономный `npm run test:all` добавляет ESLint и Chromium smoke. Второй
  параллельный тестовый framework не требуется.
- Статические и Node behavior-проверки не заменяют живую матрицу Chrome,
  Grafana, Jira, TDM и Confluence.
- E2E Runner различает PASS, FAIL, SKIP и NOT RUN, сохраняет evidence и обязан
  восстанавливать baseline после сценария.

Часть июльских/августовских временных планов удалена после реализации.
Сохранённые более поздние планы/specs имеют статусные шапки и служат историей;
текущие задачи принадлежат [roadmap](../roadmap.md), а не старым спискам шагов.
