# Актуальный roadmap DashBridge

Здесь перечисляются только направления, которые ещё не завершены. Архитектура
и реализованное поведение описаны в
[`../extension-architecture.md`](../extension-architecture.md), правила
изменений — в [`../docs/development-guide.md`](../docs/development-guide.md).

## P0 — ручной browser acceptance перед выпуском

- Проверить расширение после reload в актуальном Chrome/Chromium.
- Пройти реальные Grafana 9/10/12: direct page и DashBridge iframe, Flot и
  uPlot, capture success/error и восстановление UI.
- Проверить авторизованные Jira, TDM и Confluence сценарии.
- Для Traffic Recorder записать, сохранить, импортировать и replay новый
  `.dashflow` v2 с cache/cookies в обоих режимах.

Автоматические проверки не закрывают этот пункт: CDP, renderer, cookies,
clipboard, downloads и MV3 service-worker lifecycle зависят от браузера.

## P1 — воспроизводимый browser E2E и CI

- Добавить локальные Chromium fixtures для поддерживаемых Flot/uPlot путей.
- Проверить extension-page runner сквозными сценариями: PASS, SKIP, ошибка,
  timeout, cancel и NOT RUN reconciliation.
- После стабилизации локального контура добавить CI без рабочих URL и секретов.
- Реальные dashboards держать в защищённом локальном/CI-профиле; fast-набор
  запускать регулярно, полный — перед выпуском.

Не добавлять `package.json`, pytest или Playwright только ради формы: сначала
нужно выбрать минимальный инструмент и доказать работу с MV3-расширением.

## P1 — конвертеры Traffic Recorder

- Реализовать отдельные экспортёры HAR, JMX и WebPageTest script/data по
  контракту [`../docs/dashflow-v2.md`](../docs/dashflow-v2.md).
- Для JMX спроектировать correlation динамических CSRF/OAuth/session значений
  и явные предупреждения для multipart/WebSocket/browser-only поведения.
- SAZ добавлять только при подтверждённой потребности совместимости с Fiddler;
  экспорт не будет lossless для HTTP/2/3 wire data.

## P2 — browser-runtime исследование WebSocket

- Не менять prototype/identity заглушки Grafana Live WebSocket без fixture для
  blocked и обычного socket и проверки `instanceof`/native brand checks.
- Если Grafana не зависит от identity, сохранить нынешний безопасный контракт.

## P2 — устойчивость vCPU и displayed-series фильтров

- Сначала добавить тесты mixed `host`, `host:port`, FQDN, partial helper
  response, time-only frames и duplicate legend labels.
- Затем отдельно решить canonical instance correlation и продуктовый контракт
  capacity query (`mode="user"`).
- Оптимизацию hot path и UX fallback выполнять отдельными изменениями после
  фиксации текущей семантики тестами.

## P3 — пересмотр разрешений и хранения

- Измерить реальные объёмы существующего `storage.local`.
- После этого отдельно решить, можно ли удалить `unlimitedStorage` без потери
  пользовательских данных.

Каждый закрытый пункт удаляется из этого файла после переноса устойчивого
контракта в документацию или тесты. Завершённые пошаговые планы не архивируются
здесь повторно.
