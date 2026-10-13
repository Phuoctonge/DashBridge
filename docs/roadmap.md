# Актуальная работа над DashBridge

Сверено с рабочей копией 2.4.4 на 2026-10-13. Здесь только незавершённое.
Контракты — в [архитектуре](architecture.md), evidence и статусы по идентификаторам —
в [октябрьском плане](superpowers/plans/2026-10-12-extension-audit-and-work-plan.md).
Дата ревизии текста не означает новый runtime или live-прогон.

Закрытые исправления RAM, Table, clipboard, легенды, Flot, Batch readiness,
добавления панелей и точной цели Confluence не нужно повторять. Последний
прогон кода до документационной ревизии: ESLint, 221 JS, 41 Python, Chromium 23/23.
Confluence Apply проверен через UI локального REST-стенда, а не записью на рабочей
Confluence. Исправление в рабочей копии не означает опубликованный выпуск.

## 1. Подтверждённое поведение, требующее исправления

Асинхронно загружающийся внешний Grafana iframe может забрать фокус у открытого
extension-page modal. Воспроизведено дважды: после keyup внутри modal
`document.activeElement` становился IFRAME при завершении загрузки.
Tab/Shift+Tab trap не предотвращает этот autofocus. Нужен отдельный пакет с
живой регрессией; paused browser fixture не доказывает устранение проблемы.

## 2. Исследования и ограничения

Ниже — кандидаты на проверку, а не список подтверждённых пользовательских ошибок.

- **Clipboard authority (A05):** dataset страницы не является независимым
  доказательством host scope. Cleanup исправлен; отдельно проверить synthetic
  off-host сценарий и доверенного владельца разрешения.
- **Явная регистрация MAIN:** Batch/Test Runner допускают выбранный HTTP(S)
  dashboard вне списка подключений. Регистрация host/port остаётся до конца
  браузерной сессии; согласовать cleanup. Отзыв host не выгружает исполняющийся
  документ. Проверить backfill/document race и обновление singleton dependencies.
- **Capture/readiness:** воспроизвести dispatcher race, раннюю legend до uPlot,
  поздние callbacks после reinjection, отмену во время Batch подготовки и
  streaming plugins. Фиксированный период не является транзакцией datasource.
  Единичный settlement timeout HP8_2 не повторился; при повторении сохранить
  correlated diagnostics, не выдавать гипотезу за установленную причину.
- **CPU/RAM:** fractional `percentunit`, несовпадающие временные оси и полная
  identity series остаются вопросами совместимости. Синтетические случаи
  не доказывают ошибку рабочих CPU-панелей. Нужны реальные входы до новых правок.
- **TDM:** проверить закрытие popup во время экспорта: очередь фото и ZIP
  принадлежат документу popup. Решение о переносе владельца принимать после проверки.
- **Recorder:** аварийный fallback worker делает best-effort detach, но не
  гарантирует закрытие incognito window и не восстанавливает реестр после restart.
  Согласовать аварийную семантику; пределы описаны в
  [DashFlow v2](dashflow-v2.md#владелец-записи-и-границы-cdp).
- **WebSocket:** проверить blocked/native identity и brand checks в browser fixture
  до вмешательства в prototype.
- **vCPU/displayed-series:** проверить mixed host/port/FQDN, partial helper,
  time-only frames и duplicate labels; затем решать canonical correlation и
  контракт capacity query `mode="user"`.
- **Storage и упрощение:** сначала измерить объёмы для `unlimitedStorage`.
  Повтор измерения popup и `BatchRunLifecycle.registerCleanup` — кандидаты на
  анализ, не блокеры; перед удалением нужны GitNexus и строковые контракты.

## 3. Приёмочные проверки интеграций

Выбранные Table/uPlot/Flot direct/iframe, ON/OFF и View-переходы проверены после
restart. Это не вся матрица продукта. Перед заявлением новой совместимости:

- Подтвердить текущий MAIN-runtime в отдельном профиле по
  [development guide](development-guide.md#ранние-transport-wrappers).
- Проверить недостающее: DPR и длинные легенды, копирование PNG в целевые приложения,
  capture error/cancel и restore, legacy Series definition context,
  latest/SLA `[80, null]`, no_data `[null, null]`, network failure и vCPU.
- Пройти авторизованные Jira, TDM и Recorder record/save/import/replay в обоих
  режимах cache/session. Реальные отправки выполнять в согласованном тестовом контексте.
- Для Confluence E05 проверить deadline/AbortSignal, double-click, partial upload
  и version conflict на согласованном стенде. Точные исходные цели, specific/range
  уже покрыты локально; повторно переписывать их не требуется.
- Завершить матрицу окон, тем, масштаба и доступности. Grafana 9 требует отдельной
  проверки. Окружение `blocked` не считать PASS или доказательством дефекта.

CI и локальные Chromium fixtures существуют. Сначала составить недостающее
покрытие, не создавать второй runner. Регулярная проверка рабочих dashboards
требует защищённого профиля и отдельно согласованного расписания.

## 4. UX-предложения и доступность

[UX-аудит](workflow-ux-audit-2026-09-09.md) — исторические 20 предложений,
а не список ошибок. U01/U05 закрыты, U15/U16 частично улучшены. Остальные
предложения выбирать небольшими этапами: понятные Save/retry, область настроек
и defaults, неприменённый период, Recorder-сессия и экспорт параметров,
настройки paused-панели, Batch выбор и контекстный запуск.

Остаток доступности: подписи input в Options/TDM/series modal, клавиатурные
`.collapsible-header`, семантика switch/focus/disabled MAIN modal, имя общего
курсора. Нужны Tab/Shift+Tab/Space, label click, screen reader, light/dark и zoom.
Выбор множества панелей/сценариев/значений сохраняет checkbox.
Новые кнопки должны использовать существующих владельцев операций и cleanup.

## 5. Последующие возможности

- Согласовать машинный каталог переменных сообщения и UI-справочник; расширять
  покрытие missing/empty/error snapshots без смешивания no_data и ошибки SLI.
- Отдельно спроектировать расписание автоотчёта, preview, SLI/SLA и доставку.
  Автоматическая отправка пока не реализована; секреты не включать в Git/профиль.
- Экспорт HAR/JMX/WebPageTest по [DashFlow v2](dashflow-v2.md). Внутренняя
  HAR-проекция не равна всем пользовательским конвертерам. JMX требует correlation
  и ограничений multipart/WebSocket/browser-only; SAZ — по подтверждённой потребности.

Перед изменением читать [AGENTS.md](../AGENTS.md) и профильное руководство.
После закрытия убрать задачу отсюда, сохранить контракт и тесты. Firefox не входит
в текущий план.
