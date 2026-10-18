# Незавершённая работа над DashBridge

Сверка документации: 2026-10-16, версия 2.5.0. Это список оставшихся исследований
и предложений, а не новый runtime-прогон и не перечень подтверждённых дефектов.
Действующие контракты — в [архитектуре](architecture.md), программа повторной
приёмки — в [testing.md](testing.md), команды — в [development guide](development-guide.md).
Результаты опубликованной версии — в
[релизе 2.5.0](https://github.com/Phuoctonge/DashBridge/releases/tag/v2.5.0).
Закрытые исправления и хронология запусков сюда не добавляются.

## Исследования поведения

Изменение требуется только после воспроизведения расхождения с контрактом.

- **Clipboard authority:** проверить synthetic/off-host действия и независимого
  владельца разрешённого host. Dataset страницы не доказывает authority;
  исправленный cleanup не заменяет эту проверку.
- **Регистрация MAIN и поколение документа:** проверить отзыв host при активных
  transforms, срок explicit host/port registration Batch/Runner, навигацию между
  backfill probe и executeScript, обновление singleton dependencies и поздние
  callbacks после reinjection. Для direct settings проверить отложенный Save
  после смены dashboard/generation с тем же panel ID.
- **Capture/readiness:** исследовать dispatcher/document race, раннюю легенду
  до renderer, streaming plugins и оставшиеся стадии отмены подготовки.
  Одиночный settlement timeout, не повторившийся при проверке, не считать
  установленным дефектом. Фиксированный период не делает datasource транзакционным.
- **CPU/RAM:** исследовать остальные mixed-identity shapes по реальным входным
  данным. Рабочая CPU-панель с Idle `0…100` проверена численно;
  [контракт и границы проверки](architecture.md#cpu-idle--load-подтверждённый-контракт)
  исключают повторную находку про `percentunit` без воспроизведения на настоящем
  входе. Для RAM Total/Available/Used полная label identity и совпадение
  временных осей уже проверяются; произвольные формы ответа требуют своей проверки.
- **vCPU:** после исправлений коллизий endpoint и конфликтующих capacity остаются
  прочие mixed identities и time-only frames. Расширение correlation и изменение
  helper query `mode="user"` оценивать по фактическим данным.
- **WebSocket:** проверить blocked/native identity и brand checks в browser
  fixture до вмешательства в prototype заглушки Grafana Live.
- **Recorder:** исследовать crash до сохранения bind, ошибки session storage и
  incognito crash cleanup. Best-effort detach не обещает закрытия окна;
  текущий контракт — в [DashFlow v2](dashflow-v2.md).
- **Confluence:** определить необходимость собственного REST deadline и общего
  AbortSignal. Отмена продолжения не откатывает уже отправленный POST/PUT;
  held fetch не ограничивается одним таймером родителя. Проверять каждую стадию
  и повтор после ошибки на локальном REST-стенде.
- **TDM:** отдельно проверить рабочую виртуализированную переписку и полный
  watchdog. Продолжение экспорта после закрытия Popup потребует переноса
  владельца долгой операции на отдельную страницу, если такая функция нужна.

## Недостающее покрытие

- Дополнить авторизованное покрытие lifecycle/settings и совместного decode:
  SPA/remount с открытым редактором, RAM analysis вместе с visual legend capture,
  ошибки ответа и восстановление, длительная неактивность вкладки. Проверка
  apply/reset в direct Grafana и визуальных команд DashBridge iframe не заменяет
  эти сценарии; численная проверка рабочей CPU-панели зафиксирована в архитектуре.
- Grafana 9, остальные plugins, base path, темы, DPR и сочетания browser zoom.
  Наличие selector не доказывает поддержку; недоступная среда получает BLOCKED.
- Предельные легенды остальных plugins, реальные отказы Chrome capture и
  legacy Series definition context; остальные mixed-identity случаи CPU/RAM/vCPU.
- Особенности рабочих авторизованных Jira/TDM и оставшиеся стресс-сценарии
  Recorder. Реальная отправка Worklog и запись в рабочую Confluence не входят
  в автоматически разрешённую приёмку.
- Остальные окна, label/input, switch/focus/disabled, клавиатурное создание
  drag/drop связей Confluence и полная screen-reader матрица. Частичная проверка
  Tab/Space/Escape не означает доступность всей страницы.
- Вставка PNG в рабочие редакторы исключена пользователем из приёмки 2.5.0;
  возвращаться к ней только при отдельной потребности.

## UX-предложения

Перед реализацией сверить текущий UI и выбрать конкретный сценарий; это
предложения по понятности, а не доказанные поломки.

- Различить временный Apply в direct Grafana и сохранённые настройки профиля.
- Упростить добавление по dashboard/View/solo URL с ясным выбором панели.
- Разрешить локальные настройки paused-карточки без загрузки iframe, если нужно.
- Показывать область групповых переменных и различие draft/applied времени.
- Объяснить общий scope compact capture и независимые analysis/SLA thresholds.
- Согласовать независимое сохранение вложенных report-фраз и внешний Cancel;
  назвать повтор отчёта согласно фактически повторяемому набору действий.
- Уточнить Batch Main/Series, фактические URL/time/rules и подготовку после
  выбора панели; текущий dashboard предлагать явно, без автоматического capture.
- Показать Jira target/timezone/auth рядом с Worklog; различить TDM run preferences
  и общие defaults; пояснить текущую/чистую Recorder-сессию и путь replay.
- Уточнить saved-state export конфигурации и контекстный запуск Runner без
  autostart или молчаливой замены пользовательского выбора.

## Тестовая инфраструктура и измерения

- Расширять существующий opt-in live harness по недостающим capabilities:
  base-path auth, отказ неизвестного сценария, panel-scoped assertions,
  фактический apply/reset и отмена по timeout. Не создавать второй runner.
- Исправить выбор панели штатного Test Runner для `/d-solo/` без keyed DOM
  wrapper: загруженные Flot/uPlot не должны давать ложный panelFound=false.
  Подтверждать capabilities по renderer; не подменять пропуски успешными проверками.
- Рассмотреть отдельный PR/branch CI без публикации и рабочих сессий;
  release workflow остаётся привязан к тегу.
- Измерить 1/8/20/50 панелей и 50/500/2500 серий: startup, refresh latency,
  long tasks, heap после повторных ON/OFF/remount, observers/requests и ZIP.
  Concurrency report/time navigation и оптимизации выбирать по этим замерам.
- Измерить storage/quotas и backup retention до решения об `unlimitedStorage`.
- Разобрать dependency advisory `dashbridgeInspectLocation` по точным
  producer/consumer контрактам; не подавлять класс предупреждений.
- Проверить scope documentation scanner для локальных профилей/копий и
  игнорируемых документов; основные docs не должны выпадать из проверки.
- Сверить политику `npm ci --ignore-scripts` в development guide с `npm ci`
  в workflow. Обновлять зависимости и skills по конкретной необходимости.
- Крупные модули сохраняют документированные no-growth budgets. Разделять
  только самостоятельную ответственность по [module-design](module-design.md),
  с GitNexus и переносом всего state/cleanup владельца.

## Возможные отдельные проекты

- Полная compact-поддержка Stat/Multistat — только при подтверждённой потребности.
  Сейчас этот режим явно отклоняется; обычный снимок доступен.
- Автоотчёты/триггеры/канал доставки: preview, фиксированный период, дедупликация
  и секреты вне profile export; автоматическая отправка сейчас не реализована.
- Пользовательские HAR/JMX/WebPageTest converters Recorder с явными пределами
  fidelity и correlation. SAZ — по отдельной потребности.
- Сохранение изменений исходного Grafana dashboard через backend, presets,
  copy/undo настроек — только после выбора scope, permissions и конфликтов.
  Текущие renderer transforms не разрешают молчаливый PUT.

Firefox, framework rewrite и удаление legacy Flot не входят в текущий план.
После закрытия пункта убрать его отсюда, обновить профильный контракт и тесты.
