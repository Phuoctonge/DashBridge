# Приёмочные проверки DashBridge

Это повторяемая программа проверки, а не журнал запусков или заявление «всё PASS».
Команды, runtimes и MAIN restart описаны в [development guide](development-guide.md)
и [AGENTS.md](../AGENTS.md). Runtime-контракты — в [архитектуре](architecture.md),
полномочия — в [permission map](permission-map.md), непроверенные направления —
в [roadmap](roadmap.md).

## Подготовка и результат

- Зафиксировать commit/version, Chrome/OS, timezone, viewport, DPR, browser zoom,
  uiScale и способ запуска. MAIN после обновления должен быть подтверждён текущим.
- Использовать отдельный профиль: чистая установка и тестовое сохранённое состояние.
  Не переносить рабочие cookies, токены и backup в публикуемые fixtures.
- Для Grafana подготовить modern uPlot/Table и legacy Flot, фиксированный период,
  пустую панель, несколько серий, длинные и повторяющиеся имена.
- Для отказов использовать локальные Jira/TDM/Recorder/Confluence fixtures.
  Рабочие POST/PUT/DELETE, upload и отправка сообщений требуют отдельного разрешения.
- Каждый сценарий записывать как PASS/FAIL/BLOCKED/NOT RUN с шагами, фактическим
  результатом и restore. Отсутствие VPN/login — BLOCKED. Новый прогон не наследует
  PASS предыдущей версии. Неприменимость сценария объяснять отдельно.
- Логи, PNG/ZIP/JSON и evidence хранить в игнорируемом `test-results/`.
  После проверки вернуть свои временные настройки, clipboard, zoom и окна.

## Общие проверки всех страниц

| Область | Действия и критерий |
|---|---|
| Открытие | Обычная точка входа, прямой URL, reload, повторное открытие; без startup/pageerror |
| Вид | Light/dark, uiScale, узкий/обычный/широкий viewport, browser zoom; действия и ошибки достижимы |
| Клавиатура | Tab/Shift+Tab, Enter/Space, Escape; подписи, видимый фокус, удержание и возврат из dialog |
| Ввод | Пустые/длинные строки, Unicode/кавычки/HTML-подобный текст, неверный URL/дата; без молчаливой подмены |
| Асинхронность | Двойной клик, смена входов при ожидании, поздний ответ; только один текущий владелец операции |
| Отмена | Cancel, закрытие дочернего окна, reload/pagehide; без ложного успеха, утечек и позднего download |
| Сохранение | Save/reload, две вкладки, quota/storage failure; конфликт виден, draft и retry сохранены |
| Сеть | Timeout, 401/403/404/500, восстановление; причина различима, повтор доступен |
| Повтор | Повторить success/error/cancel; нет зависшего busy и накопления listeners/Blob URLs/окон |

## Сценарии страниц

Все подходящие общие проверки выше применяются к каждой строке.

| Страница | Что пройти через настоящий UI |
|---|---|
| [Popup](../pages/popup/popup.html) | Настоящий action popup: все вкладки/подвкладки, remember/fallback при отключённых модулях; CRUD ссылок; перенос from/to/timezone и повторных var-*; Django time/TTL/clipboard; запуск остальных страниц; debug/export; update notice cache/timeout и доверенные installer URL |
| [Options](../pages/options/options.html) | Dirty/Save/reload; модули, hosts/ports и их потребители; CPU/RAM/Load названия и режимы, thresholds/coefficient; compact sizes; Jira/Wiki/TDM defaults; JSON export/import/backup restore, невалидная schema/лимиты/частичный отказ; два редактора и retry; analytics delivery status |
| [Batch](../pages/batch/batch.html) | Main и Series; URL/picker all/white/black/empty/unknown IDs; смена dashboard при discovery; rules max/last, reset и два редактора одного dashboard; один/несколько периодов; group/standalone Series; cancel на подготовке/capture/ZIP, ошибка и новый запуск; прочитать PNG и manifest, проверить папки/метаданные и отсутствие позднего download |
| [Confluence Report](../pages/confluence-report/confluence-report.html) | Scan/rescan/auth/read errors; свежий Batch ZIP, неполный manifest/повреждённый архив; preview и точные occurrence/anchor при повторных именах; single/group mapping, drag/drop, reorder, новые графики/группы/разделы; смена URL/ZIP во время preview/Apply; на локальном REST проверить partial upload, version conflict, double-click, cancel/retry и контрольный GET |
| [Recorder](../pages/recorder/recorder.html) | Start/Stop/double start, обычная/чистая сессия, cache/cookies combinations; формы/SPA/redirect/fetch/XHR/iframe/stream; read .dashflow и hashes/limits, плохой import сохраняет прежнюю запись; replay сверить счётчиком сервера; сравнение repeated requests, PNG и XLSX; reload/закрытие вкладок, worker restart/crash, cleanup и export failure |
| [Worklog](../pages/worklog/worklog.html) | Auth и issue lookup OK/401/403/404/network, поздние A/B ответы; календарь месяц/год/короткий месяц/клавиатура; даты/время/timezone и суммы; create/clone/delete, Undo/Redo, drafts/reload, sent/partial/storage failure; реальные отправки не выполнять без отдельного разрешения |
| [DashBridge](../pages/dashbridge/dashbridge.html) | Profiles CRUD/import/export/две вкладки; добавление single/IDs/picker, invalid URL и commit failure; pause/resume/delete/fullscreen; tools и iframe settings, nested dialogs/focus при загрузке; relative/absolute/invalid/reversed time и переменные с All/multi/limits; refresh Off/«Обновить сейчас»; SLA warning/error/partial loading, сообщения, PNG/коллаж и restore |
| [Test Runner](../pages/test-runner/test-runner.html) | URL validation и выбранные сценарии; run/startup cancel/mid-run Stop/restart; planned = completed + NOT RUN; diagnostics/OPFS, export JSON и clipboard при отказе; history/Clear, reload/pagehide и cleanup принадлежащих окон; большой export и double export на контролируемом стенде |
| [Test Selector](../pages/test-runner/test-selector.html) | Standalone и embedded: search/no results, all/none/one, fast/FAIL/NOT RUN presets, Save/reopen, Cancel/Escape, отказ storage и retry без потери draft |
| [Служебное фото](../pages/debug-easter-egg/debug-easter-egg.html) | Валидное/повреждённое изображение и retry, file/clipboard, portrait/landscape и scale, эффекты/Clear/Close; предыдущее фото не теряется при ошибке. Окно должно находиться на экране: Chromium запрещает resize за его пределами |

## Direct Grafana и iframe

Для MAIN/renderer правки обязательны обе поверхности, uPlot и Flot; Table
проверяется отдельно. Версия Grafana сама по себе не доказывает поддержку plugin.

- Dashboard → View/solo → назад, resize/fullscreen, refresh/remount; ON/OFF/reset
  каждой затронутой функции и её persistence.
- CPU/RAM/Load/vCPU: сверять исходные ответы, units, timestamps, scope/refIds,
  неизвестные и неоднозначные helper-данные; числа legend/report и видимые серии.
- Legend placement, columns, sorting, trim, fill/line width, threshold и filters:
  отдельные и совместные режимы; длинные/повторные подписи, пустой результат.
- Ordinary/compact Save/Copy: реальные PNG, размеры/пиксели/полнота, success/error
  и restore DOM/styles/URL/scroll. Stat/Multistat compact должен явно отказать;
  ordinary остаётся отдельным поддерживаемым маршрутом.
- Host/port revoke/re-add, чужой frame/refId, навигация и поздние ответы:
  граница scope и lifecycle не расширяются из-за теста.

## Сквозные маршруты

1. Options Save → actual Popup → direct Grafana и DashBridge iframe.
2. Popup parameters → Batch → выбранный абсолютный период → PNG/ZIP manifest v3
   → Confluence import → preview; Apply/verification только на локальном стенде
   либо при отдельно разрешённой рабочей записи.
3. DashBridge time/report lease → несколько панелей → сообщение/PNG/коллаж
   → внешняя ссылка; после операции исходные настройки/URL восстановлены.
4. Recorder record → .dashflow → import/replay → comparison → XLSX/PNG.
5. Runner selection → run/Stop → diagnostics/export → повтор и cleanup.

## Перед выпуском

Выполнить полный автономный набор и installer-проверки из development guide,
затем живую матрицу затронутых renderer/интеграций. Проверить состав ZIP,
совпадение version/tag, checksum и опубликованные assets. История изменений —
в [GitHub Releases](https://github.com/Phuoctonge/DashBridge/releases).

Локальная fixture не доказывает рабочую авторизацию или запись. Вставка PNG
в рабочие редакторы, screen reader и новая Grafana/plugin считаются проверенными
только после собственных сценариев; исключённые пользователем действия не запускать.
