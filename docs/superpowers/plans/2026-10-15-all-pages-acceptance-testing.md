# План приёмочного тестирования всех страниц DashBridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Выполнять последовательно по страницам; этот документ сам по себе не запускает проверки и не разрешает запись в рабочие внешние системы.

**Goal:** проверить все самостоятельные страницы расширения по реальным пользовательским действиям, результатам, сохранению и восстановлению после ошибок, а не только загрузке HTML.

**Architecture:** страницы проверяются через их обычные точки входа в отдельном браузерном профиле. Существующие Node/Python/Chromium runners переиспользуются; живые интеграции и контролируемые стенды дают разные доказательства. Исправляется только повторно подтверждённое расхождение с действующим контрактом.

**Tech Stack:** Chrome MV3, Chrome API, Playwright/Chromium, Node.js, Python smoke, GitNexus; локальные HTTP fixtures для отказов и внешних записей.

**Spec:** запрос пользователя от 2026-10-15 о проверке всех страниц; runtime-контракты в [архитектуре](../../architecture.md), границы в [карте разрешений](../../permission-map.md), правила проверки в [development guide](../../development-guide.md), формат Recorder в [DashFlow v2](../../dashflow-v2.md).

**Статус:** выполняется с 2026-10-15; полный обход ещё не завершён. Фактически выполненные проверки указаны ниже. План не является перечнем уже найденных багов.

### Ход исполнения 2026-10-15

Начальная версия `aec1bae`, checkpoint перед Popup-правками `dcba7dc`; Windows,
Chromium 153.0.8010.12, Europe/Moscow. Новый отдельный профиль; рабочие данные
не импортировались. Popup открывался через `chrome.action.openPopup` и управлялся
как настоящий action popup через CDP. Страница HTML во вкладке его не подменяла.

| Сценарии | Фактически выполненная часть | Результат |
|---|---|---|
| O01 | Remember tab, uiScale, dirty → Save → reload; отключить все модули и открыть настоящий Popup | PASS |
| O03 | RAM Available/Used: зависимые ключевое слово/формула, сохранение своего названия | PASS; renderer-потребитель ещё NOT RUN |
| O04 | warn > crit, пустой/отрицательный/>100 порог; коэффициент вне 0,01–10; размер вне 100–4096/дробный; включённые граничные значения и reload | PASS; ошибочный ввод не меняет storage |
| O07 | Скачать/прочитать JSON schema 3, изменить scale, import и restore backup через UI | PASS |
| O08 | Повреждённый JSON не меняет настройки | PASS; лимит/остальные отказы ещё NOT RUN |
| O10 | Раскрыть диагностику доставки, обновить и прочитать состояние | PASS; storage failure ещё NOT RUN |
| P01 | Все четыре вкладки и три подвкладки Grafana, reopen; все модули OFF через Options показывают fallback настроек | PASS |
| P02 | Создать/редактировать/отменить/удалить ссылку, HTML-подобное имя показано текстом | PASS; длинный список/невалидный URL ещё NOT RUN |
| P03 | Настроенный перенос двух `var-instance`, from/to/timezone, сохранение целевого URL | FAIL до правки → PASS после restart, два повторения |
| P04 | Повторное чтение после переключения вкладок; epoch/ISO, отказ для relative/reversed, истечение session TTL | FAIL статуса до правки → PASS после restart, два повторения; clipboard ещё NOT RUN |
| P05 | Штатные кнопки настоящего Popup открывают DashBridge/Batch/Confluence/Recorder/Worklog/Runner/Options | PASS |
| O09/B09 | Устаревшая Options не затирает новое подключение; Batch lease живёт дольше idle worker и освобождается при закрытии владельца | PASS; остальные стадии cancel ещё NOT RUN |
| C04/C07 | ZIP, drag/drop на последнюю из одноимённых целей, локальные attachment POST/page PUT и контрольное чтение | PASS; рабочая Confluence не изменялась |
| C08 | Сервер сохранил неверную цель: UI отвергает результат post-save verification | PASS; conflict/частичные загрузки ещё NOT RUN |
| W01–W05 | 10 групп расширенной локальной Worklog-регрессии: календарь/год/время, clone/delete, суммы, sent/edit, гонки lookup, focus, native Undo, pending lookup и clear/reload | PASS перечисленных частей; реальные Jira-записи исключены, auth-матрица ещё NOT RUN |
| D10 | Настоящие меню/редакторы: неправильный SLA, фразы/шаблон, хранение черновика, ручной порядок/выбор, переключение профиля, slow refresh и warning без overlay | PASS на локальных fixtures; дополнительные live-панели ещё NOT RUN |
| R03/R06/R08/R09/R10/X05 | Локальная запись 5 шагов → download .dashflow → manifest/flow/network/HAR/streams/bodies → UI import → replay → сравнение → download XLSX | PASS этого маршрута; счётчик сервера 1 при записи и 2 после replay, Workbook XML открыт; полная матрица сравнения ещё NOT RUN |
| T01/S02–S04 | Runner отвергает javascript URL; Selector: none, поиск без результата, один checkbox, Save/reopen, all → Escape → reopen | PASS; полный run/diagnostics и standalone ещё NOT RUN |
| E01/E02 | Валидный файл → два повреждённых → корректный retry; «Очистить» отменяет эффекты, сохраняя фото | FAIL до правки → PASS после restart; clipboard/размерная матрица/закрытие окна ещё NOT RUN |
| O02/O03 | Адрес с credentials/запрещённой схемой, Jira с query, TDM file URL; одинаковые названия метрик; своё название → Save/reload | PASS перечисленных отказов/сохранения; полная нормализация hosts ещё NOT RUN |
| B01/B02/B04 | Перевёрнутый период отклонён до создания capture window; live picker: 51 панель, all/none/cancel | PASS на grafanakns |
| B06/X02 | Две реальные панели × два периода → ZIP v3 → чтение importer Confluence; четыре PNG 1000×520 просмотрены | PASS; поля manifest и две папки периодов сверены; сквозной Popup→Batch здесь не повторялся |
| B07 | Main→Series переносит URL/периоды без изменения; Series picker выбирает панель и получает query definitions | PASS подготовки; захват Series проверяется отдельно |
| R02 | Четыре сочетания Disable Cache × Disable Cookies с разрешённым incognito; fixture cookie и два одинаковых cacheable fetch; Stop | PASS: сервер получает 1/2 запроса согласно cache, прежний cookie только в обычной сессии; ephemeral tab закрывается |
| R06 | Скачанный .dashflow: 5 шагов, 4 запроса; bytes и SHA-256 каждого из четырёх bodies, HAR count, pending=0 | PASS; это не проверка лимитов/stream capture |
| R07 | Повреждённый ZIP, отсутствующий body и подменённый digest, каждый дважды | PASS: ошибка видна, текущие 5 шагов и доступный Replay сохранены |
| R10 | Открыты XML всех листов XLSX; пять строк различий и cached totals: 2 unchanged, 1 changed, 1 added, 1 removed | PASS содержимого fixture-отчёта; визуальное открытие в Excel и длинные URL ещё NOT RUN |
| C08 | Fixture: attachment upload HTTP 500; page PUT HTTP 409 | PASS: ошибка видна, исходный storage сохранён; при upload error PUT отсутствует; timeout/вторая загрузка ещё NOT RUN |
| D01/D02 | UI create/rename/clone/delete cancel/confirm/reload; вручную 2,3,2 → две новые карточки; Cancel одиночного добавления | PASS; конфликт двух окон/discovery ещё NOT RUN |
| D03/D05 | Resume→fullscreen→Escape→pause→delete cancel→reload; валидный период → URL iframe, невозможная дата/перевёрнутый период не меняют storage; multi variables сохранены | PASS на локальных HTML fixtures; renderer не проверялся этим сценарием |
| D11 | UI export JSON прочитан; повреждённый import и Cancel валидного import сохраняют профиль | PASS перечисленных частей; применение импорта/курсор ещё NOT RUN |
| S01/S05 | Standalone Selector: 20 fast tests, none, один ID→Save; закрыто только созданное окно, выбор сохранён | PASS; отказ storage ещё NOT RUN |
| O08 | 15 неверных импортов конфигурации и 5 проверок UI дважды, Cancel; отказы backup/sync/local write | PASS перечисленных отказов и сохранения прежнего состояния при validation/Cancel; storage write поэтапный, при последнем отказе уже записанная sync-часть остаётся с backup, атомарный rollback не заявляется |
| S05 | Отказ сохранения выбора в embedded и standalone по два раза | FAIL пустого статуса до правки → PASS: ошибка видна, прежний выбор и draft сохранены; retry закрывает окно и сохраняет выбор; финальные четыре повтора без pageerror |
| C05/C07/C08 | Создание графика, вложенной группы и раздела: Apply → локальный POST/PUT/GET → scanner; по два повтора | FAIL порядка/принадлежности до правки → PASS: график в конце группы, новая группа сохраняет прежние изображения, раздел принадлежит выбранному тесту |
| C05/C07 | Несколько изображений в одной новой группе/разделе; повтор файла с разными подписями | FAIL planner/verification → PASS: один заголовок, правильная иерархия; постоянная Chromium-регрессия проверяет результат после сохранения |
| S02/S03/S04/G04 | Embedded FAIL/NOT RUN presets с явной историей дважды; Save/reopen/Cancel; основные Tab/Escape Options, actual Popup и Selector | PASS перечисленного; полный Tab trap и вся keyboard-матрица не заявляются; standalone Escape не закрывает обычную страницу, Cancel закрывает |
| D09 | Живые uPlot/Flot: настоящая кнопка карточки Save → PNG, ordinary и compact, восстановление style и исходного URL | PASS четырёх файлов: ordinary 1390×618, compact 1000×520; файлы compact просмотрены; clipboard/collage/ZIP этим не проверены |
| O01/O02/O03/X01 | Actual Options Save → exact-port runtime/direct/iframe, revoke/re-add; CPU/RAM названия и режимы, коэффициент, showAll; отказ Save и retry дважды | PASS локальных fixtures; analysis использует DOM fallback, а не транспортное преобразование; compact 900×480 подтверждён только до dataset |
| B03/B05 | All/white/black/empty/unknown ID, rules autosave/max/last/reload/remove/reset, разные dashboards в двух редакторах | PASS перечисленных путей; захват заменён noncapturing boundary, PNG этим не проверены |
| B02 | Delayed A → сменить URL B; новое открытие B/Apply/Cancel/reopen; программная смена URL перед Apply; Main и Series по два повтора | FAIL старых ID до правки → PASS восьми локальных UI сценариев; нынешние ID сохранены, старый ответ не открывает picker |
| T02/T05/T06/X06 | Настоящий Runner: 11 выбранных сценариев на Grafana 12; отдельное окно диагностики; download fallback JSON v4 прочитан | PASS: 11 completed; mon-dc недоступна — ещё 11 честных NOT RUN, итог неполный; native file picker/большой export ещё NOT RUN |
| T03 | Stop во время подготовки, возврат доступного Run и Clear | PASS этой стадии; Stop в середине сценария ещё NOT RUN |
| C05 | Clear отключает Apply; новое соединение и шесть путей добавления снова включают Apply; затем точечная замена на локальном стенде | FAIL до правки → PASS targeted Chromium; повторное сканирование ещё не проверено успешно |
| C01/C06 | Повторный Scan: свежая версия 4, сброс ZIP/mapping, HTTP 500 закрывает своё окно, retry успешен | FAIL до правки → PASS; общий suite ESLint/222 JS/41 Python/Chromium 24/24 |
| C04 | Повреждённый ZIP, отсутствие manifest/PNG/границ периода; прежний валидный архив остаётся доступен | PASS локального UI fixture |
| W01/W04 | Auth 401/403/network → retry; lookup 404/401/network → retry | PASS; все non-GET заблокированы тестом |
| E01/E03 | Настоящая PNG-вставка из clipboard: portrait/landscape при 150%; Close закрывает только созданное окно | PASS; исходный clipboard восстановлен |
| T02/T03/T05 | После VPN и повторного входа KNS: 11 базовых сценариев × две Grafana, просмотр диагностики, Stop startup/Clear | PASS 22/22, без экспорта; не является проверкой всех Flot/uPlot transforms |
| B07/B08/B09 | Реальные query definitions → group и standalone Total → два PNG 1000×520 с правильным периодом/manifest; немедленная отмена | PASS на CFT156; оба PNG просмотрены; это не полная матрица отмены |
| T06/X06 | Повтор реального fallback экспорта legacy-прогона на CFT156 | PASS: JSON v4 открыт, 11 planned = 11 completed + 0 not-run |
| O07/G03 | Restore при отсутствии backup; три служебные кнопки в 600px/150% | FAIL до CSS-правки → PASS targeted и независимый Chromium; исправленный экран просмотрен |
| D11 | Валидный JSON → заменить текущий / создать новый → reload, сверены URL и время | PASS на локальном fixture |
| D01 | Одновременное переименование разных профилей в двух вкладках → storage → reload обеих | PASS: обе правки сохранены, выбор профиля каждой вкладки сохранён |
| D06 | Живой KNS: поиск/Escape, два значения station → All, URL двух iframe и storage | PASS; точный период сохранён, это не доказательство отрисовки обеих панелей после каждого выбора |
| C08 | Локальный REST: первая загрузка успешна, вторая HTTP500 → повтор Apply, два прогона | PASS: до повтора PUT нет; повтор не дублирует первую загрузку, затем один PUT и verification |
| T03/T05/T06 | Stop после завершения 6 из 60 тестов → JSON, затем короткий restart | PASS: 60 = 6 completed + 54 NOT RUN, reconciliation valid; restart 3/3 |
| T06 | Настоящее копирование полного отчёта и ошибок; контролируемый отказ native и fallback | Copy PASS; двойной отказ выявил ложное «Скопировано», регрессия RED → GREEN; live-повтор исправления PASS, отказ повторён дважды |
| P07 | Настоящий action Popup: Cancel/Escape, copy/move, второй POST500 и DELETE500, каждый дважды | PASS только на локальных синтетических worklogs; после неуспешного копирования DELETE нет |
| P08 | TDM fixture: HTML/JSON/both, даты, исключение фото автора, ZIP с фото | PASS: скачанные файлы прочитаны, фото побайтово совпадает с fixture |
| P09 | Закрыть настоящий Popup во время извлечения; фото off/delay5s/404, каждый дважды | PASS восстановления scroll700; после закрытия Popup download не создаётся — ограничение lifecycle, а не фоновое выполнение |
| P06 | GUI ZIP через настоящий Popup на экране допустимых размеров | PASS: завершённый ZIP 713312 байт, десять PNG, preview просмотрен |
| P06 | Полный debug → настоящий clipboard JSON; отказ записи; неподходящая активная вкладка | PASS: JSON прочитан, URL-переменные замаскированы; отказ виден, кнопка доступна для повтора; неподходящая вкладка не меняет clipboard; исходный буфер восстановлен |
| R01 | Пустой/неверный/запрещённый URL, URL без схемы, двойной Start | PASS в отдельном профиле; URL без схемы нормализуется в HTTPS, fixture служит HTTP; delayed-start cancel ещё NOT RUN |
| R04/R05 | Известные 302/200/503/204/slow ответы, URL/method/status/type filters, reset/details | PASS: статусы и содержимое тел сверены с архивом, reset7/7 |
| R08/R11 | Отсутствующий locator → ограниченный отказ → retry; закрыть target; reload Recorder → restart | PASS: locator назван, retry успешен; проверен detach именно расширения, обычное окно намеренно сохраняется |
| R01 | Stop при контролируемой задержке Chrome API создания окна, затем retry, два раза | PASS этой fault-injection границы: нет навигации к сайту, debugger расширения отключён, следующий Record/Stop успешен; естественная задержка старта и остальные его фазы этим не проверены |
| B09 | Main: Cancel при задержке dashboard definition и query в native View; новый захват после обеих отмен | PASS: собственные окна закрыты, поздний ответ не создаёт ZIP; следующий ZIP содержит PNG 1000×520 с точным периодом, файл просмотрен |
| G01/G02/X01 | Настоящие Popup theme toggle и Options Save для auto/90/100/110/125/150; восемь открытых потребителей и reload | PASS темы/масштаба; служебное Easter-окно отдельно получает 150% через настоящий launcher |
| G03/G04 | Стартовые/пустые страницы при 600/1024/1440 и 100/150%; выборочные Tab/Enter | Геометрия PASS в указанном scope; клавиатура PARTIAL, browser zoom NOT RUN |
| D03/D04 | Iframe settings Save/Cancel, URL/theme/width/height → reload; устаревший draft после изменения во второй вкладке; drag → reload | PASS локального UI; cross-profile draft и нативный календарь отдельно NOT RUN |
| D05/D11 | Поиск quick range, relative Apply, absolute history/replay; меню курсора и толщина → reload | PASS сохранения и UI на локальном HTML; живое отображение курсора этим не доказано |
| D07 | Общее Refresh now дважды при absolute/Off, две активные панели и одна paused | FAIL до правки → PASS постоянной Chromium-регрессии; по одному новому документу на активную панель, paused исключена, период/variables/Off сохранены, token не пишется в panel.src |
| D07 | После restart: кнопка Refresh now дважды в живых KNS и mon-dc | PASS: для каждой Grafana по одному новому документу на клик, запросы datasource и canvas присутствуют; скриншоты просмотрены |

Свежие evidence: `test-results/pages-confluence-rescan-suite.txt`,
`pages-confluence-controls-results.json`, `pages-worklog-auth-results.json`,
`pages-layout-clipboard-results.json`, `pages-runner-both-vpn-results.json`.
Первый повтор экспорта Runner аварийно закрыл тестовый Chromium153. Прежний
успешный fallback экспорт остаётся историческим результатом; результат нового
сравнения runtime описан ниже. Первый вывод о засыпании MV3 worker как единственной
причине не подтвердился после обращения через страницу.
Сравнение runtime без изменений расширения: Chromium 153 аварийно завершался
при Series (native exit 0xC0000005) и экспорте Runner. Тот же тестовый профиль
и те же сценарии на отдельном официальном CFT156 прошли, включая native PiP.
Это ограничение воспроизведённой тестовой среды; причину на уровне Chromium
не установили, расширение для обхода аварии не менялось. Штатный Chrome155
не загрузил unpacked через CLI в чистом профиле; рабочие cookies не переносились.
Evidence: `test-results/pages-batch-series-cft156-log.txt`,
`pages-runner-cft156-log.txt`, `acceptance-runner-legacy-vpn-report.json`.

Options: `.btn { display:flex }` перебивал нативное скрытие кнопки Restore,
а три служебные кнопки не переносились в узком окне. Исправления ограничены
maintenance Options; постоянная регрессия — `test/support/browser-audit-fixes.js`.
Независимый targeted-прогон подтвердил hidden/backup, геометрию 600px/150%,
а также прежние conflict/lease проверки. Скриншот
`test-results/acceptance-options-maintenance-fixed.png` просмотрен: все три
кнопки внутри окна. Канонический полный `test:all` без override и с отдельным
smoke-профилем прошёл: ESLint, 222 JS, 41 Python, Chromium24/24
(`test-results/pages-options-layout-canonical-suite.txt`). Предшествующий запуск
с override CFT156 остановился на unit-проверке штатного пути Chromium;
он не выдаётся за PASS.
Новые DashBridge evidence: `test-results/pages-dashboard-transfer-results.json`.
Дополнительные evidence: `test-results/pages-dashboard-variables-results.json`,
`pages-confluence-partial-results.json`, `pages-runner-midrun-fixed-log.txt`,
`pages-popup-remaining-artifacts/actual-exports-verified.json`,
`pages-popup-remaining-artifacts/gui-zip-verified.json`,
`pages-recorder-remaining-results.json`. Первичные P08 FAIL по числу downloads
оказались особенностью тестового подключения CDP; итоговые PASS основаны на
чтении файлов с путей завершённых Chrome Downloads, а не статусе UI.
Runner clipboard: `copyTextToClipboard` проверяет boolean fallback и удаляет
textarea в `finally`; blocked diagnostics ждёт подтверждённого успеха.
GitNexus и точный поиск подтвердили трёх потребителей: полный отчёт, ошибки,
compact notice viewer. Отложенный feedback не перезаписывает более новый статус.
Targeted RED/GREEN и независимый review прошли; финальный полный прогон после
guard: ESLint, 222 JS, 41 Python, Chromium24/24 — PASS
(`test-results/pages-runner-clipboard-final-suite.txt`).

Дополнительные evidence: `test-results/pages-general-remaining-artifacts/results.json`,
`pages-dashboard-remaining-results.json`, `pages-popup-debug-clipboard-results.json`,
`pages-batch-cancel-results.json`, `pages-header-refresh-red.txt`,
`pages-header-refresh-nonce-green.txt`, `pages-header-refresh-live-nonce-log.txt`,
`pages-recorder-delayed-cancel-results.json`.
Selector/Options evidence: `test-results/pages-general-remaining-import-selector/results.json`,
`pages-general-remaining-selector-final/results.json`, `pages-selector-save-red.txt`,
`pages-selector-save-green.txt`. Selector исправлен отдельно после checkpoint
`3a21b35`; оба контекста используют один обработчик `saveSelection`.
Постоянная регрессия в `inspectTestSelectionWorkflow` проверяет реальную кнопку,
отказ Chrome API и успешный повтор. Исторический NOT RUN в ранней строке выше
заменён этим результатом; embedded history presets остаются PARTIAL.
Первый debug harness искал неэкранированное `[present]` в URL; фактическая
маска корректно сериализована как `%5Bpresent%5D`, продукт не менялся.
Первый live refresh harness проверял первый сохранённый профиль вместо своего
ID; повтор исправил утверждение. Новые документы уже были в первом прогоне.
mon-dc показывает прежнее Templating/system Failed to fetch, ранее повторённое
без расширения; это не новый дефект DashBridge и не скрытый PASS переменных.
Общее обновление исправлено после checkpoint `9e4962b`; GitNexus дополнен
точным поиском обоих потребителей — явной кнопки и смены refresh interval.
Постоянная регрессия находится в `test/support/browser-frame-startup.js`.
Итоговый token — `crypto.randomUUID()`: он гарантирует новый URL независимо
от фиксированных часов стенда Worklog. Первый общий прогон с timestamp прошёл
23/24, повторный клик не навигировал из-за одинакового времени; этот результат
не объявлялся PASS. Финальный nonce прошёл отдельную регрессию, повторный live
на обеих Grafana и канонический suite: ESLint, 222 JS, 41 Python,
Chromium24/24 (`test-results/pages-header-refresh-final-suite.txt`).
Независимый reviewer не нашёл замечаний ни к контракту, ни к замене token.

В C05 подтверждена активная кнопка Apply без связей: нажатие ничего не делало.
После исправления отдельно обнаружен и закрыт пропущенный путь повторного
включения через добавление графика/раздела/группы. Регрессии находятся в
`test/support/browser-confluence-target.js`; внешний Confluence не изменялся.
Отдельно подтверждены постоянно отключённая кнопка «Сканировать заново» без
обработчика и незакрытое созданное окно после ошибки чтения. Повторная кнопка
подключена к существующему Scan; error cleanup закрывает своё окно. Постоянный
browser fixture прошёл targeted success/error/retry, без дополнительных записей.
Полный прогон после C05: ESLint, Node/Python и Chromium 24/24 — PASS
(`test-results/pages-confluence-clear-verified-suite.txt`). Независимый reviewer
повторил успешную замену и отказ verification с шестью путями добавления.
Контроллер превысил общий byte budget на 44 байта; документированное исключение
66560 байт сохраняет единый lifecycle вместо искусственного выделения кнопок.

Подтверждены и исправлены потеря второго значения переменной при переходе по
ссылке и невидимый новый статус времени после переключения вкладок. Область —
`popup-grafana-links.js`; GitNexus и точный поиск подтвердили владельца Popup,
общие URL/time helpers не менялись. Обе регрессии добавлены в существующий
`test/grafana_timestamp_clipboard_behavior.js` и отдельно наблюдались красными.
Evidence: `test-results/pages-options-popup-red.json`,
`pages-options-popup-export-log.txt`, `popup-multivalue-evidence.json`,
`popup-status-evidence.json`, `popup-status-after-switch.png`.
Неперечисленные сценарии нового обхода остаются NOT RUN.

Дополнительные evidence: `test-results/pages-local-workflows-log.txt`,
`pages-recorder-independent-log.txt`, `acceptance-recording.dashflow`,
`acceptance-comparison.xlsx`, `pages-popup-expanded2-log.txt`.
Первоначальный Recorder timeout оказался загрязнением тестового контекста:
Worklog фиксирует Date; новый независимый процесс подтвердил replay с обычными
часами. Исправления Recorder по этому timeout не делались.

Для E01 дважды подтверждено: повреждённый файл терял прежнее фото (naturalWidth 0)
и оставлял прежнюю подсказку. `loadPhoto` теперь сначала декодирует кандидата;
неудача сохраняет фото и показывает причину. Потребители — только file input
и paste этой страницы; GitNexus и точный поиск проверены. Постоянная регрессия
в существующем browser smoke наблюдалась RED 23/24, затем GREEN 24/24.
Полный прогон текущих исправлений: ESLint, 222 JS, 41 Python, Chromium 24/24;
evidence `test-results/pages-easter-full-suite.txt`. Независимый code review
обеих малых правок actionable замечаний не выявил.

Продолжение приёмки: `test-results/pages-recorder-modes-results.json`,
`pages-batch-native-path-log.txt`, `pages-archive-failures-results.json`,
`pages-dashboard-ui-results.json`, `pages-options-bounds-results.json`,
`pages-runner-fallback-log.txt`, `acceptance-runner-report.json`.
В JSON Runner сверено равенство 22 planned = 11 completed + 11 not-run;
неработающая сеть mon-dc не записана как успешная проверка Flot.
Для проверки download fallback в тестовой странице отключён `showSaveFilePicker`;
прежний запуск ожидал настоящий системный диалог, а не зависший exporter.
Первоначальный FILE_FAILED Batch возник из-за смешанных разделителей в CDP
downloadPath тестового скрипта; native Windows path дал полный успешный download.
Production-код Batch/Recorder/Runner по этим ошибкам окружения не менялся.

Остаток нельзя свести только к VPN: ещё не выполнены debug clipboard и полный
TDM watchdog, часть отказов и потребителей Options, полная Series/cancel матрица
Batch, все ordering/addition варианты Confluence, streams/limits и delayed-start
cancel Recorder, storage failure Worklog, полный capture/clipboard DashBridge,
большой export и native file picker Runner, общая матрица G01–G10.
Строки ниже без конкретного результата остаются NOT RUN, даже если соответствующий
Node/Python-тест прошёл в полном автономном наборе.

## Границы и правила

- В объёме — все 10 HTML-страниц в `pages/`, их динамические окна, меню и переходы. Popup считается одной страницей с несколькими самостоятельными пользовательскими потоками.
- Внешние Grafana, Jira, TDM и Confluence — интеграции этих страниц. Админка analytics из `deploy/`, installer и публикация релиза не являются extension pages и не входят в этот обход.
- Рабочие профили, черновики и dashboards не используются для разрушительных сценариев. Исходное состояние сохраняется и после проверки сравнивается с результатом.
- Реальная отправка Worklog в Jira остаётся исключённой по прежнему запросу пользователя. Копирование/перенос записей Jira, Confluence Apply и Recorder replay с записывающими действиями выполняются на локальном/специальном тестовом стенде. Рабочая система не становится тестовым стендом только потому, что в неё выполнен вход.
- Не сохранять и не удалять рабочие dashboards Grafana. Панельные ON/OFF проверять временно с восстановлением. Не привязывать исправления к ID конкретных панелей.
- Старые Batch ZIP не требуются. Проверять текущий manifest и понятный отказ для неподдерживаемого/неполного архива; не проектировать восстановление дат из имён файлов.
- Не создавать второй runner. Новые постоянные регрессии встраивать в существующий набор только после нахождения пробела покрытия.
- До правки — checkpoint commit, воспроизведение, проверка потребителей через архитектуру, GitNexus и строковые контракты. Затем одна логическая правка, её отдельная регрессия, общий прогон и коммит. Полномочия и storage/schema не расширять попутно.

## Исходное покрытие — не новая приёмка

На момент составления плана production-основа — `1088627`. Полный прогон после Worklog: ESLint, 222 JS, 41 Python и Chromium 24/24; отдельно расширенный Worklog workflow прошёл 10 групп UI-проверок. Это не означает проверку всех кнопок всех страниц.

| Страница | Основные владельцы | Что уже является доказательством | Что остаётся пройти по плану |
|---|---|---|---|
| `pages/popup/popup.html` | `popup-core.js`, `popup-grafana-*.js`, `popup-jira.js`, `popup-tdm*.js`, `popup-updates.js` | Загрузка и отдельные browser/source-контракты | Настоящее action popup, каждый раздел, закрытие в процессе операции |
| `pages/options/options.html` | `options.js`, `options-config-transfer.js` | Dirty state, валидация, отдельные browser-конфликты | Все группы настроек и их фактические потребители, import/restore через UI |
| `pages/batch/batch.html` | `batch.js`, `batch-*-controller.js`, loader/lifecycle | Много behavior-тестов; отдельные capture/window проверки | Полные Main/Series потоки через UI, полученный ZIP, отмена на разных стадиях |
| `pages/confluence-report/confluence-report.html` | page controller, scanner, mapping, preview, apply | Локальный REST/browser для точных целей и verification | Полный путь от URL и Batch ZIP, все способы сопоставления и отказы |
| `pages/recorder/recorder.html` | session, transport, capture, DashFlow, replay, view | Модульные контракты и загрузка страницы | Полный record → save → import → replay → compare, режимы cache/session |
| `pages/worklog/worklog.html` | `worklog.js`, `worklog-jira-client.js` | Расширенная локальная UI-регрессия после исправлений | Сверка интерфейса/ошибок auth и lookup; без реальной отправки |
| `pages/dashbridge/dashbridge.html` | `dashbridge.js` и профильные controllers | Выбранные живые Grafana/iframe сценарии, локальные browser workflows | Полная навигация страницы: profiles, добавление, переменные, настройки, файлы и сообщения |
| `pages/test-runner/test-runner.html` | UI/core, selection, reports, diagnostics/spool | Runtime-контракты, часть живых сценариев | Весь жизненный цикл запуска и отчёта через UI |
| `pages/test-runner/test-selector.html` | `test-selector.js`, suite | Selection behavior и загрузка | Отдельное окно и встроенный dialog, presets, отмена и сохранение |
| `pages/debug-easter-egg/debug-easter-egg.html` | `debug-easter-egg.js` | Загрузка, структурные smoke-контракты | Пользовательские изображения, clipboard, эффекты, очистка и закрытие |

Список сценариев ниже — конкретная программа проверки, а не обещание отсутствия других дефектов.

## Подготовка и фиксация результата

- [ ] Зафиксировать commit расширения, Chrome/OS, часовой пояс, viewport, DPR, browser zoom, uiScale и способ запуска. После MAIN-правок использовать подтверждённый restart тестового браузера из development guide.
- [ ] Подготовить два отдельных состояния: чистая установка и тестовый профиль с сохранёнными данными. Не импортировать рабочий backup в отчуждаемый стенд.
- [ ] Для Grafana подготовить доступные modern uPlot/Table и legacy Flot dashboard, фиксированный период с известными данными, пустую панель и панель с несколькими сериями. Отсутствие VPN/login — `BLOCKED`, а не дефект или PASS.
- [ ] Подготовить текущие Batch ZIP: один период/несколько панелей, несколько периодов, длинные/повторяющиеся названия; повреждённый ZIP, неполный manifest и превышение лимита.
- [ ] Подготовить Jira fixture: auth OK/401/403, задача найдена/404, медленные ответы A/B, сетевой отказ. TDM fixture: сообщения на границах периода, фото/без фото, повторные имена, спецсимволы.
- [ ] Подготовить Recorder fixture: форма, ссылка, SPA-переход, redirect, fetch/XHR, 404/500, медленный ответ, iframe, stream; отдельный счётчик действий сервера для обнаружения дублей replay.
- [ ] Подготовить Confluence fixture с двумя тестами/периодами, повторными именами изображений, группами, добавлением в конец/после позиции, version conflict и частичным upload failure.
- [ ] Для каждого сценария записать ID, окружение, действия, ожидаемый/фактический результат, `PASS/FAIL/BLOCKED/NOT RUN`, файл доказательства и восстановление состояния. До исполнения все строки ниже имеют статус `NOT RUN` для нового обхода.

Доказательства хранить в игнорируемом `test-results/`: снимок состояния до/после, screenshot/PNG/ZIP/JSON, console/pageerror и нужные network-запросы. Не включать cookies, токены, тела рабочих запросов и конфиденциальные файлы в публичную документацию.

## Общие проверки для каждой страницы

Каждую строку применить ко всем подходящим страницам, а неприменимость объяснить в результате.

| ID | Действия | Критерий |
|---|---|---|
| G01 | Открыть обычным входом, затем напрямую, reload и повторное открытие | Нет startup/pageerror; начальное состояние и доступность кнопок соответствуют данным |
| G02 | Переключить светлую/тёмную тему; uiScale auto/90/100/110/125/150 | Текст, ошибки, поля и меню читаемы; сохранение соответствует владельцу настройки |
| G03 | Full pages: ширины 600/1024/1440; browser zoom 80/100/125/150%; popup — реальный доступный размер | Основные действия достижимы; таблицы скроллятся; календарь/меню/диалог не обрезаются. Не перемножать все варианты без необходимости |
| G04 | Tab/Shift+Tab, Enter/Space на действиях, Escape; закрыть и повторно открыть dialog | Фокус виден, модальное окно удерживает/возвращает его; ввод не уходит в фон |
| G05 | Быстро дважды нажать основное действие; изменить входы во время ожидания | Нет двойной операции; старый ответ не подменяет новые данные |
| G06 | Отмена, закрытие дочернего окна, reload/закрытие страницы во время операции | Отсутствует ложный успех; освобождены принадлежащие операции окна, listeners, Blob URLs и ресурсы |
| G07 | Пустые/длинные строки, Unicode, кавычки, HTML-подобный текст и невалидный URL | Без исполнения текста; понятная ошибка; неправильное значение не применяется молча |
| G08 | Сохранить, reload; изменить из двух вкладок; вызвать контролируемый storage failure | Видимое состояние совпадает с сохранённым; конфликт/ошибка не объявляются успехом |
| G09 | Сетевой timeout, 401/403/404/500 и восстановление доступности | Причина различима; повтор работает; предыдущие корректные данные не теряются |
| G10 | Проверить завершение и сразу повторить ту же операцию | Нет зависшей блокировки, дублированных событий и оставшегося временного состояния |

## 1. Popup — все вкладки, а не только Grafana

**Вход:** кнопка расширения в Chrome; отдельная HTML-вкладка используется только как вспомогательная диагностика. **Постоянные тесты:** `test/popup_initial_layout_behavior.js`, `test/popup_update_notice_behavior.js`, общий browser smoke.

| ID | Действия | Что должно получиться |
|---|---|---|
| P01 | Переключить Grafana/Запись/Jira/TDM и подвкладки Grafana; открыть настройки; повторно открыть popup | Активные разделы и remember-настройки соответствуют Options; отключённые модули скрыты, fallback открывает настройки |
| P02 | Создать, открыть, изменить, удалить ссылку; отменить edit; проверить пустое имя/неверный URL и длинный список | Меняется выбранная ссылка; отмена сохраняет прежнюю; повторное открытие воспроизводит список |
| P03 | Открыть ссылку с текущими from/to, повторяющимися `var-*`, timezone и keepParams; повторить на чужой вкладке | Переносятся только предусмотренные параметры, выбранный dashboard и значения не подменяются соседней вкладкой |
| P04 | «Время для Django»: absolute/relative/ISO/epoch, неверные границы; копировать обе границы; открыть снова до/после 3 минут | Полученные milliseconds соответствуют исходному периоду; TTL работает; ошибка clipboard видна |
| P05 | Открыть DashBridge, Batch, Confluence replacement, Recorder, Worklog и E2E Runner штатными кнопками | Открывается правильная страница/окно с ожидаемыми входными данными |
| P06 | Скопировать debug-отчёт и скачать ZIP интерфейса на Grafana; повторить на неподходящей вкладке и при отказе capture | Файлы читаются, снимки просмотрены; неподходящий контекст объяснён; viewport/scroll восстановлены |
| P07 | Открыть выбор «Скопировать/Перенести» Jira; Escape/отмена; чужой origin/base path; оба режима выполнить только на fixture | Отмена ничего не пишет; copy сохраняет оригинал; move удаляет исходную запись только после подтверждённого копирования; частичный результат честный |
| P08 | TDM: HTML/JSON/оба, фото ON/OFF, исключение автора ON/OFF, «Я», помнить даты; пустой/перевёрнутый период | Состав сообщений/фото и границы сверяются с fixture; формат файла соответствует выбору; никакой подмены автора |
| P09 | Во время TDM export закрыть popup; на стенде задержать фото/дать 404 и timeout | Установлен фактический lifecycle; нет вечного выполнения/ложного полного ZIP; scroll восстановлен. Это отдельный открытый вопрос roadmap |
| P10 | Update notice: текущая/новая версия, ошибка сети, доверенный/посторонний release URL, кнопка installer | Правильная версия и ссылка; сетевой отказ не блокирует popup; установка/перезапуск не запускаются автоматически |

- [ ] Выполнить P01–P10 и G01–G10, приложить именно результаты настоящего popup; отдельно отметить непроверенную живую TDM/Jira-интеграцию.

## 2. Options — применение настроек и восстановление

**Вход:** Popup → настройки и `chrome.runtime.openOptionsPage`. **Тесты:** `test/options_user_settings_behavior.js`, `test/options_dirty_state_behavior.js`, `test/support/browser-audit-fixes.js`.

| ID | Действия | Что должно получиться |
|---|---|---|
| O01 | По одному изменить remember tabs, module switches, uiScale; Save/reload; все модули OFF | Dirty state и сохранённое состояние совпадают; Popup показывает реальные изменения и доступный fallback |
| O02 | Grafana hosts: добавить/убрать host и порт; пустая строка, дубли, схема, путь, неверный host | Нормализация по контракту; iframe/runtime доступ только в нужном scope; чужая вкладка не затронута |
| O03 | CPU/RAM/Load: названия/ключевые слова, Total+Available/Total+Used, coefficient, trimming, show-all | Зависимые подписи и формула верны; после Save потребитель использует новое значение; OFF возвращает ожидаемое отображение |
| O04 | Пороги CPU/RAM: ноль, 100, warn=crit, warn>crit, пустое/нечисловое; templates с Unicode/переносами | Допустимость соответствует валидатору, неверные пары не сохраняются; preview/сообщение использует актуальный шаблон |
| O05 | Compact width/height: допустимые, минимальные, чрезмерные и пустые значения | Ошибка соответствует реальным границам; полученный compact PNG имеет сохранённые размеры |
| O06 | Jira URL/context path/timezone; Wiki hosts/editor iframe IDs/scroll fix; TDM defaults | После Save значения отражены в Worklog, Confluence editor и TDM UI; неактивные зависимости не применяются неожиданно |
| O07 | Export JSON → изменить тестовые настройки/профили → Import → Restore before import | Состав allowlist и schema корректен; backup создан; восстановление возвращает исходное состояние, повтор не повреждает данные |
| O08 | Import: плохой JSON, неверная schema, неподдерживаемые ключи, неверные поля, файл сверх 16 МиБ, частичный storage failure | Понятное сообщение; не происходит молчаливого частичного применения; предыдущее состояние/backup доступны |
| O09 | Две вкладки Options: параллельное изменение host и других настроек; Save conflict; quota failure | Нет перезаписи чужого нового подключения устаревшей формой; ошибка не сбрасывает черновик |
| O10 | «Обновить состояние» доставки analytics: очередь, пустая очередь, ошибка получения состояния | Показаны текущие диагностические значения без раскрытия содержимого рабочих данных; это не тест внешней админки |

- [ ] Выполнить O01–O10 с проверкой потребителей после Save; затем восстановить тестовые настройки.

## 3. Batch — Main и Series как отдельные потоки

**Вход:** Popup → Скриншоты → панель сбора. **Тесты:** `test/batch_main_run_controller_behavior.js`, `test/batch_series_run_controller_behavior.js`, `test/batch_series_preparation_races_behavior.js`, `test/batch_report_manifest_behavior.js`, `test/batch_confluence_period_integration_behavior.js`.

| ID | Действия | Что должно получиться |
|---|---|---|
| B01 | Переключить все вкладки; заполнить URL, периоды, режим панелей, темы и detailed logging; reload | Восстановлены предусмотренные поля; вкладка логов и сброс работают; темы Main/Series не смешиваются |
| B02 | Загрузить панели; раскрыть группы, выбрать все/часть/ничего, применить/отменить; сменить URL до ответа | Используются панели актуального dashboard, включая обнаруживаемые вложенные; отмена не меняет выбор |
| B03 | Все панели, белый и чёрный списки ID: пробелы, дубли, неизвестные ID, пустой список | Правильная очередь включений/исключений без случайных дублей; невалидная очередь не запускает capture |
| B04 | Один/несколько absolute/relative периодов; нулевой и перевёрнутый диапазоны, неверная дата | В очередь попадают точные нормализованные границы; неверный ввод не начинает сбор |
| B05 | Добавить/изменить/удалить/сбросить panel rules, including numeric max/last filters; reload; два редактора | UI и сохранённые правила совпадают; settings применяются выбранным условиям; чужие панели не получают их |
| B06 | Main: один период × несколько панелей, затем несколько периодов; обычный/compact, light/dark/inherit | Каждый PNG просмотрен, соответствует периоду/панели/теме; есть папка каждого диапазона и полный manifest; архив импортируется Confluence |
| B07 | Series: подставить Main URL/периоды, загрузить серии; include/ignore поиск, повторные подписи, пустой результат | Выбранные occurrence серий определены однозначно; быстрые смены URL/selection не применяют старый ответ |
| B08 | Все доступные варианты Series capture mode; группы/отдельные серии и несколько периодов | В PNG находятся именно выбранные серии; количество файлов/manifest совпадает с заданиями; исходные линии восстановлены |
| B09 | Отмена до появления окна, во время загрузки, после первого PNG и при упаковке; закрыть capture window/страницу | Никаких новых заданий после cancel; частичный архив явно частичный; принадлежащие Batch окна закрыты, чужие сохранены |
| B10 | Login/пустая панель/timeout/capture failure/ZIP limit; подробные логи ON/OFF; повторить запуск | Нет белого PNG как успеха; в логе определима причина/задача, итог и полнота; отсутствует утечка окна/блокировки |
| B11 | Stat/Multistat через picker и ручной ID в Main/Series | Установить достижимость compact пути. Если путь доступен, не выдавать обрезанный PNG за корректный; исходное известное обрезание учитывать отдельно. Полную поддержку этих renderer автоматически не добавлять |

- [ ] Выполнить B01–B11 на modern и legacy там, где сценарий зависит от renderer; раскрыть все группы, не ограничиваться первоначальным viewport.

## 4. Confluence Report — от чтения до проверяемого результата

**Вход:** Popup → замена скриншотов. **Тесты:** `test/support/browser-confluence-target.js`, `test/confluence_report_mapping_board_behavior.js`, `test/confluence_report_apply_behavior.js`, `test/confluence_report_storage_behavior.js`.

| ID | Действия | Что должно получиться |
|---|---|---|
| C01 | URL отчёта, scan/rescan; pageId и поддерживаемый route; login/нет прав/неверный URL/секреты в URL | Читается нужная страница в отдельном окне; некорректный вход отклоняется; scan не пишет в Confluence |
| C02 | Дерево: раскрыть группы, выбрать конкретное изображение/группу/несколько тестов | Счётчики и цели однозначны даже при повторных именах изображений |
| C03 | Current Batch ZIP с одним/несколькими периодами; плохой manifest, отсутствующий PNG, повреждённый/большой архив | Периоды и панели берутся из manifest; один период объединён; ошибка не затирает действующий план молча |
| C04 | Создать связи drag/drop и формой операций; заменить конкретную цель/группу; все/выбранные тесты | Preview указывает точную исходную позицию и нужный PNG, а не соседнее одноимённое вложение |
| C05 | Добавление в конец/после позиции, подпись, несколько правил из ZIP; конфликтующие связи; очистить связи | Порядок и подписи верны; конфликт виден; очистка сбрасывает план, не меняя сервер |
| C06 | Сменить URL/ZIP и rescan при готовом preview; отменить выбор файла; удалить правило | Старый preview не может примениться к новому источнику/странице |
| C07 | На fixture выполнить Apply, повторный клик и контрольное чтение | Загрузки и page PUT соответствуют плану; версия увеличена правильно; подтверждён именно конечный storage |
| C08 | На fixture: version conflict, второй upload failure, timeout, AbortSignal, verification mismatch | Нет ложного успеха; список выполненного/неприменённого различим; уже загруженные вложения не обещаны как откатанные |
| C09 | Preview старых/новых картинок: загрузка/ошибка/размеры; узкое окно и keyboard | Подписи и даты точны, изображения доступны; важные действия и строки не скрыты layout |

- [ ] Выполнить C01–C09; реальный scan пометить отдельно от fixture Apply. Рабочий Apply этим планом не запускается.

## 5. Recorder — запись, файлы, replay и сравнение

**Вход:** Popup → Запись → открыть Recorder. **Тесты:** `test/recorder_*_behavior.js`, `test/dashflow_*_behavior.js`; формат/ограничения — DashFlow v2.

| ID | Действия | Что должно получиться |
|---|---|---|
| R01 | URL со схемой/без, пустой/запрещённый; Start дважды; Stop во время подготовки | Один владелец сессии; валидация до attach; отменённый startup не создаёт позднюю запись |
| R02 | Все четыре комбинации Disable Cache × Disable Cookies; incognito permission OFF/ON, другое incognito window | Режимы действительно отражены в CDP и cookie/session поведении; нет молчаливого перехода в другой режим |
| R03 | Navigate/click/change/Enter/Escape/Tab/submit, SPA/full navigation, iframe; повторные label | Порядок и локаторы проверены по UI; change/submit не удваиваются; недоступный frame не объявлен записанным |
| R04 | Fetch/XHR, redirects, ошибочные/медленные/empty responses, body limit, streams | Network details и body/completeness статусы соответствуют фактическим ответам; URL без body не равен полному capture |
| R05 | Выбрать шаг/все шаги; URL/method/status/type filters и сброс; request details, URL copy, показать/скрыть секреты | Счётчики, связи со шагами и детали согласованы; секреты не раскрываются непреднамеренно в обычном UI |
| R06 | Stop, сохранить .dashflow, открыть архив и проверить manifest/flow/network/HAR/streams/bodies | Размеры, ссылки на тела и SHA-256 согласованы; файл повторно импортируется; предупреждение о секретах соответствует данным |
| R07 | Import валидного/повреждённого/большого архива, пропавшего тела и неверного hash; отмена выбора | Невалидный import не заменяет текущую запись частично; понятна причина отказа |
| R08 | Replay на fixture; сверить счётчик действий, запросы, паузы/ожидания и отказ locator | Действия выполняются однократно; ошибка указывает шаг; зависание ограничено; рабочие записывающие действия не воспроизводятся |
| R09 | Вкладка сравнения: changed/added/removed/unchanged/incomplete, URL filter, пустой результат, возврат к записи | Каждый статус сверяется с заранее известным различием; неполные тела не выдаются за «без изменений» |
| R10 | Экспорт Excel сравнения; открыть файл и сверить строки/длинные URL/Unicode | XLSX открывается, данные/статусы и число записей совпадают с полным результатом, фильтрация трактуется по контракту |
| R11 | Закрыть controlled tab/window, Recorder, reload и остановить worker на fixture; повторный Start | CDP detached насколько обещает lifecycle; ограничения аварийного incognito cleanup явно записаны, а не объявлены исправленными |

- [ ] Выполнить R01–R11; обычный Stop и аварийное завершение оценить раздельно, согласно документированным границам.

## 6. Worklog — контроль после исправлений

**Вход:** Popup → Jira → Worklog. **Тесты:** `test/support/browser-worklog-ui.js`, `test/worklog_regressions_behavior.js`, `test/worklog_history_send_behavior.js`, `test/worklog_jira_client_behavior.js`.

| ID | Действия | Что должно получиться |
|---|---|---|
| W01 | Add/clone/delete, последний ряд, undo/redo, несколько дат и обе сортировки | Строки, суммы, заголовки и сохранённое состояние согласованы; группировка после ручного edit соответствует кнопке «Перегруппировать» |
| W02 | Январь 31 → февраль, назад, переход года/високосного февраля; время → месяц → выбор дня; «Сейчас» | Календарь открыт до выбора/закрытия; точные дата/время, без пропуска месяца |
| W03 | Несуществующие даты, 99:99, пустые/нечисловые часы; повторное открытие и Escape/outside | Неверный ввод не меняет запись; один календарь/владелец; нет старых listeners |
| W04 | Sent → edit текста/даты/«Сейчас»; Ctrl+Z в поле и вне поля; clear sent cancel/confirm/undo | Badge и storage соответствуют статусу; нативный ввод не заменён историей строк; подтверждённые отправки сохраняют существующий ACK-контракт |
| W05 | Jira URL/key, 404/401, A→B и A→B→A с задержками, edit/Undo/delete во время lookup | Подпись и ссылка относятся к актуальному ключу; ввод/фокус сохраняются; удалённая/восстановленная запись не получает старый ответ |
| W06 | Дробные часы, текущие день/неделя и граница недели; reload/перезапуск, storage failure, auth retry | Итоги и сохранение точны; ошибки понятны; сохранённые черновики не исчезают |

- [ ] Выполнить W01–W06 как регрессию. Реальный `sendAll` не нажимать; POST-ошибки/частичное подтверждение проверять существующими локальными тестами.

## 7. DashBridge — страница целиком

**Вход:** Popup → единый дашборд. **Тесты:** существующие `test/dashbridge_*_behavior.js`, browser dashboard/frame/report workflows.

| ID | Действия | Что должно получиться |
|---|---|---|
| D01 | Создать/переключить/переименовать/клонировать/удалить профиль, отменить; два окна | Действие применяется нужному профилю; межвкладочный commit не теряет чужие изменения |
| D02 | Добавить одну панель URL, списком ID, discovery picker; свернуть/раскрыть группы, all/none, отмена | Корректны UID/orgId/panelId/variables, порядок и количество; старый discovery не подменяет новый dashboard |
| D03 | Перетаскивание, ширина/высота, меню действий, pause/resume, delete/cancel, fullscreen | Состояние сохраняется; iframe соответствуют карточкам; fullscreen и выход восстанавливают layout |
| D04 | Настройки iframe: URL/title/размеры, Save/Cancel, ошибка сохранения, переключение профиля при открытом окне | Черновик не сохраняется в чужую панель; рабочий период и переменные согласованы с URL |
| D05 | Absolute/relative/quick/history ranges; оба календаря, поиск, copy/paste; неверные даты; timezone | Один период согласован во всех панелях/файлах/preview; неверный ввод не меняет профиль |
| D06 | Variables: одиночный/multi/All, пустой список, длинные значения; Save/cancel/reset по доступным действиям | Обновляются нужные панели, повторяющиеся `var-*` не теряются |
| D07 | Refresh now, interval/Off, pause, скрытие/возврат вкладки, SPA/login/retry | Нет двойной навигации; Off не возвращается к сохранённому Grafana refresh; ошибка/login различимы |
| D08 | Panel settings: CPU/RAM, легенда, фильтры, threshold, title/width; ON/OFF, View и resize | Проверять применимые функции на uPlot/Flot/Table; данные и layout восстанавливаются; ранее проверенные варианты пометить ссылкой на evidence |
| D09 | Copy/save обычного и compact PNG, все панели ZIP, выбранные/paused/empty; отмена и failure | Файл просмотрен и вставлен в целевое приложение; размеры/полнота/restore корректны, unsupported renderer не считается PASS |
| D10 | Сообщение: configuration, проверка и генерация; loading/success/error/disabled SLA, закрыть/повторить, copy | Постепенные результаты понятны; ошибка сообщения не перекрывает исправный график; общий успех только после завершения |
| D11 | Export/import панелей/профиля: round-trip, cancel, неверный JSON, conflict; cursor line/off и толщина | Файлы импортируются по действующей schema; состояние и scope соответствуют текущему профилю; курсор не сохраняет лишние listeners |

- [ ] Выполнить D01–D11; не считать проверку одной панели доказательством всей страницы. Сравнить direct Grafana и iframe только в сценариях, зависящих от общего runtime.

## 8. E2E Test Runner — проверить сам инструмент проверки

**Вход:** Popup → Отладочная → E2E Runner. **Тесты:** `test/test_runner_*_behavior.js`, `test/smoke_test_runner_matrix.py`.

| ID | Действия | Что должно получиться |
|---|---|---|
| T01 | Пустой/плохой URL, несколько строк, duplicate URL; fast/full; Ctrl+Enter | Валидация до запуска; исполняется выбранный профиль и предусмотренные адреса |
| T02 | Выбрать часть сценариев, none, последние fail/not-run; изменить профиль | Planned соответствует фактическому выбору; несделанный сценарий не становится PASS |
| T03 | Start дважды, Stop при подготовке и в середине; закрыть Grafana window; начать заново | Один run; отмена завершает нужные задачи/окна; повтор возможен без reload |
| T04 | Screenshots ON/OFF, первый/повторный запуск; одинаковые и различающиеся visual snapshots | OFF не сохраняет изображения; повторное использование не скрывает реальные различия |
| T05 | Progress, таблица, длительности, summary, fail/error/NOT RUN и диагностическое окно | Итоги равны строкам и плану; детали относятся к своему run/panel, статусы не смешиваются |
| T06 | Copy report/errors, скачать малый и большой JSON; отказ clipboard/download/OPFS | Полученный JSON парсится и полон; ошибка видна, нет ложного экспорта или вечной блокировки |
| T07 | Clear, reload/pagehide/pageshow при spool/export, повторное открытие diagnostics | Не очищаются данные чужого владельца; cancellation и restart соответствуют контракту |
| T08 | Запуск на modern и legacy с известным набором функций; login/недоступный dashboard | Окружение и неподдерживаемый сценарий обозначены честно; нет фиктивной совместимости со всеми Grafana |

- [ ] Выполнить T01–T08; сверять сырой JSON с видимой таблицей, а не доверять зелёному summary без проверки.

## 9. Test Selector — standalone и встроенный dialog

**Владельцы:** `test-selector.js`, suite и storage `trTestSelection`/`trTestHistory`. **Тест:** `test/test_runner_selection_behavior.js`.

| ID | Действия | Что должно получиться |
|---|---|---|
| S01 | Открыть из Runner и отдельно поддерживаемым standalone-путём; fast/full | Каталог, количество и выбранные сценарии принадлежат нужному профилю |
| S02 | Поиск по ID/названию/функции, пустой/нет совпадений; раскрыть описание/шаги | Поиск не теряет скрытые выбранные значения; тексты и оценки читаемы |
| S03 | Все/быстрые/ошибки/NOT RUN/none; история без ошибок; переключить отдельные checkbox | Выбор и счётчики точны; пустая история объяснена |
| S04 | Save → reopen; затем edit → Cancel/Escape/крестик/outside в dialog | Только Save сохраняет выбор; закрытие не меняет сохранённое; фокус возвращён Runner |
| S05 | Закрыть отдельное окно; отмена при изменении профиля; storage failure | Закрыто правильное окно, данные Runner не повреждены; ошибка сохранения не выглядит успехом |

- [ ] Выполнить S01–S05; не предполагать, что standalone остаётся основным способом запуска — сверить текущую кнопку Runner.

## 10. Служебное окно «Тест на свежесть кода»

**Вход:** соответствующая кнопка Popup. **Тесты:** `test/smoke_debug_easter_egg.py` и browser smoke.

| ID | Действия | Что должно получиться |
|---|---|---|
| E01 | Открыть, загрузить поддерживаемое изображение и вставить через clipboard; маленькое/большое/портретное; битый файл | Изображение отображается в доступных границах; неверный файл не оставляет вечное ожидание |
| E02 | Несколько кликов, быстрое «Очистить», заменить изображение во время эффекта; resize/uiScale | Эффекты очищаются и не возвращаются старым async завершением; окно не выходит за экран |
| E03 | Закрыть кнопкой/окном и открыть заново | Закрывается только это окно; Blob URLs и временные эффекты освобождены; нет сетевых/storage side effects кроме локальной загрузки assets |

- [ ] Выполнить E01–E03; не поднимать этот низкоприоритетный блок выше основных пользовательских потоков.

## Сквозные проверки между страницами

| ID | Маршрут | Проверяемый результат |
|---|---|---|
| X01 | Options → Popup → DashBridge/Batch | Модули/hosts/темы/uiScale/defaults применены реальными потребителями после Save, без повторной записи устаревшего состояния |
| X02 | Popup Grafana URL → Batch → ZIP → Confluence preview | UID, панель, variables, точный период, число PNG и manifest не меняются по пути |
| X03 | DashBridge диапазон → PNG/ZIP/сообщение → внешний Grafana URL | Сверены обе границы в milliseconds с учётом timezone; формат подписи не подменяет фактический период |
| X04 | Options config export/import → Popup/профили/Worklog/Batch | Согласованное восстановление данных; локальные черновики и settings не теряются частично |
| X05 | Recorder record → save → import → replay → compare → Excel | Одна и та же запись сохраняет шаги, bodies, полноту и связи; различия в Excel соответствуют UI |
| X06 | Runner → Selector → run → diagnostics → JSON | Выбранные ID и planned/completed/NOT RUN согласованы на всех этапах |
| X07 | Несколько страниц одновременно, закрытие одной во время другой операции | Владельцы окон/ports/storage/Blob URL не задевают чужую операцию; нет общей зависшей блокировки |
| X08 | Options Wiki scroll fix → реальный editor на тестовой Confluence | Включение/выключение действует на настроенные editor frames; чужие hosts не изменяются. Это интеграция Options, а не отдельная HTML-страница расширения |

- [ ] Выполнить X01–X08 после независимого обхода владельцев, а не вместо него.

## Порядок исполнения и обработка находок

1. Options → Popup: зависимости, навигация, сохранение и реальные размеры popup.
2. Batch → Confluence: полный путь получения и использования файлов, затем контролируемые сбои.
3. Recorder: отдельный fixture и четыре режима cache/session; replay только на стенде.
4. Worklog: быстрая регрессия после уже выполненных исправлений и недостающие lookup/auth случаи.
5. DashBridge: полная приёмка страницы, а не повтор прежних точечных renderer-тестов.
6. Runner → Selector → служебное окно; затем все сквозные сценарии.

Для каждой подтверждённой находки:

- [ ] Повторить из чистого начального состояния, сохранить минимальные шаги и отличие фактического результата от ожидаемого.
- [ ] Отделить дефект расширения от ошибки источника, отсутствия доступа и документированного ограничения; при необходимости сравнить с расширением OFF.
- [ ] Найти владельца и всех потребителей; для удаления/переноса выполнить GitNexus/guards по AGENTS.md. Не превращать отсутствие графовой связи в доказательство неиспользования.
- [ ] Добавить регрессию, убедиться, что она воспроизводит исходную ошибку, затем исправить минимально и проверить отдельно.
- [ ] После runtime-правки выполнить канонический полный прогон; для renderer/MAIN дополнительно direct/iframe и modern/legacy live. Зафиксировать результат и коммит, обновить профильный контракт.

Канонические команды из корня проекта; Python и установка Chromium задаются по AGENTS.md и development guide:

```powershell
npm run test:all
node scripts/check-documentation-links.js
git diff --check
```

`npm run test:all` уже включает lint, Node/Python, module/dependency/documentation guards и browser smoke. Для изменения только этого плана достаточно проверки ссылок и diff; новый runtime PASS не заявляется.

## Критерий завершения и итоговый результат

- [ ] У каждой строки плана есть результат; `BLOCKED` и `NOT RUN` не входят в PASS. Для варианта, неприменимого к странице, записана конкретная причина.
- [ ] Критичные локальные потоки подтверждены через настоящий UI и проверяемый результат: сохранённые данные, открытый файл, clipboard-вставка, конечный DOM/renderer, cleanup.
- [ ] Все исправления имеют воспроизведение и отдельную регрессию; текущая версия прошла нужные общие проверки. Прежний тест не выдаётся за проверку свежей правки.
- [ ] Итог содержит по каждой странице: проверенные группы, подтверждённые исправленные/открытые дефекты, ограничения среды и остаточные риски. Рабочие Jira-записи/Confluence Apply явно остаются за пределами приёмки, если не выполнялись.
- [ ] В roadmap остаётся только незавершённое; доказательства и повторяемые команды привязаны к результату. Сам этот план не помечается выполненным до реального обхода.

Цель — обоснованное решение о готовности страниц и списке оставшихся работ. Формулировка «багов вообще нет» не является критерием приёмки.

Confluence additions: checkpoint `54c85cc`, отдельные RED/GREEN для порядка
графиков, владения новой группы и принадлежности раздела выбранному тесту.
Регрессия нескольких изображений использует настоящий `buildApplyPlan`;
независимое ревью дополнительно проверило 720 перестановок смешанного плана
с заменой исходного якоря. Повторное ревью существенных замечаний не выявило.
UI evidence: `test-results/pages-confluence-additions-final-results.json`,
`pages-confluence-additions-browser-targeted.txt`. Создание выполнялось настоящим
`dragTo`; второй источник в существующий раздел — через его drag/drop handlers,
нативное второе перетаскивание этим PASS не заявляется. Скриншоты настроенной
группы/раздела просмотрены; рабочая Confluence не изменялась.
Общий smoke первоначально не создал строку через native dragTo; постоянный
fixture использует существующие drag/drop handlers, а отдельный native-прогон
остаётся самостоятельным доказательством. Следующий прогон выявил одинаковые
временные ключи двух жестов из-за часов, зафиксированных стендом Worklog.
Fixture явно разделяет время жестов; production-ключи по этой причине не менялись.
Оба прогона 23/24 не объявляются PASS.
После корректировки fixture свежий полный
`pages-confluence-additions-clock-suite.txt`: ESLint, 222 JS, 41 Python,
Chromium 24/24 — PASS. Module/dependency guards, ссылки и diff проверены.

Дополнительные evidence: `test-results/pages-general-remaining-presets-keyboard/results.json`
закрывает прежний PARTIAL embedded history presets; остальные ранние ограничения
сохраняются. `pages-dashboard-native-save/results.json` фиксирует четыре настоящих
сохранения PNG на обеих Grafana. Первый harness ошибочно принял прежний download
за новый компактный; итоговый повтор сверяет новые Chrome download IDs.
На Flot PNG виден прежний native Templating/system Failed to fetch, уже сверенный
с выключенным расширением; это не новый дефект capture.
Options consumer evidence: `test-results/pages-options-consumers-results.json`.
Copy-list template проверен до page-local clipboard stub, без системного буфера.
Batch rules evidence: `test-results/pages-batch-rules-results.json`; правила
редактируются inline и сохраняются автоматически, отдельных Apply/Cancel у них
нет. Нажатия Apply/Cancel/reopen относятся к picker. Stale URL discovery отдельно
воспроизведён дважды и исправлен после checkpoint `e85557f`.
Постоянная регрессия actual owner в `test/batch_dashboard_picker_behavior.js`
наблюдалась RED → GREEN и проверяет оба режима, Apply без input, новое открытие,
Cancel и позднюю ошибку. Отдельный RED → GREEN закрывает запоздалый 401:
он не должен открывать старую вкладку авторизации после смены URL.
Независимая UI-проверка: `test-results/pages-batch-picker-fixed-results.json`.
Поздний 401 отдельно проверен в настоящем UI Main/Series по два раза:
`pages-batch-picker-fixed-401-results.json`, новых tabs/windows/toast нет,
повторный запрос нового URL показывает правильные ID. Независимое ревью
guard и совместимости MainRun recovery замечаний не выявило.
Свежий полный прогон после auth guard:
`pages-batch-picker-final-suite.txt` — ESLint, 222 JS, 41 Python,
Chromium 24/24 PASS; ссылки, module/dependency guards и diff проверены.
Два редактора правил одного дашборда имеют наблюдаемый last-write-wins:
второй полный snapshot убирает правило первого редактора, первый UI остаётся
прежним. Это отдельно зафиксированное наблюдение B05, а не PASS согласования
редакторов; контракт предотвращения такого конфликта ещё не определён.

Проверка исправления S05: целевая Chromium-регрессия RED → GREEN,
затем свежий канонический прогон `pages-selector-save-suite.txt`:
ESLint, 222 JS, 41 Python, Chromium 24/24 — PASS. Независимое ревью
не выявило замечаний. Этот прогон не закрывает оставшиеся строки приёмки.

### Продолжение Confluence 2026-10-15: чтение рабочего отчёта и локальная перестановка

Рабочая страница `703584720` использовалась только для чтения и сопоставления.
Подтверждён дефект C01/C02: storage содержит 293 изображения в 16 тестах,
но Scan показывал 0, поскольку caption-token поглощал весь абзац с изображением.
После исправления видны все 293 цели. ZIP с двумя настоящими снимками Grafana
загружен; native drag создал связь для 95-перцентиля. Очистка убрала связь,
rescan очистил архив и повторно прочитал 293 изображения. Версия до/после — 38,
SHA-256 storage совпал; Apply и загрузка вложений на рабочую страницу не выполнялись.
Evidence: `test-results/pages-confluence-readonly-live.json`,
`pages-confluence-readonly-mapped.png` (просмотрен).

Для C05/C06/C07 на локальном REST-стенде подтверждены и исправлены:
исключение при одиночном переносе (`batchItems: null`), потеря порядка новых
групп/разделов при Apply, выбор первого вместо второго одинакового вложения,
сохранение перенесённого графика в прежний тест и потеря якоря при переносе
перед другим добавленным графиком. Отдельная регрессия закрывает вставку перед
изображением внутри абзаца: предыдущий абзац с картинкой не становится якорем.
Перед production-правками сохранён RED-checkpoint `1c909b6`; каждый дефект
имеет наблюдённый RED → GREEN. Cross-test и наследование якоря проверены
Node-тестами фактических move/planner/storage, отдельный native cross-test
прогон этим результатом не заявляется.

Постоянная Chromium-регрессия проверяет результат сохранения после перестановки
графика, группы и раздела, включая повторяющийся filename и paragraph wrappers.
Отдельный native drag-прогон выполняет график/группу/раздел по два раза с чтением
сохранённого storage: `pages-confluence-acceptance-current-results.json`.
Целевая регрессия после последней правки —
`confluence-reorder-final-targeted.txt`; независимое финальное ревью замечаний
не выявило. Сценарии version conflict, partial upload и остальная матрица страниц
не закрываются этим блоком; B05 с конкурирующими редакторами правил остаётся открытым.

Финальный повтор native-сценариев после последней правки: 6/6 PASS, без pageErrors.
Свежий канонический `confluence-final-verified-suite.txt`: ESLint, 222 JS,
41 Python, Chromium 24/24 — PASS. Module/dependency guards и документационные
ссылки прошли; GitNexus detect-changes сверил затронутые потоки. Существующее
advisory о статически не доказанном consumer `dashbridgeInspectLocation` сохраняется.

### B05: конкурентные редакторы правил, исправление 2026-10-15

Историческое наблюдение last-write-wins выше исправлено после checkpoint
`58e3d37`. До production-правки Node-регрессия воспроизвела потерю правила
первого окна. Отдельная Chromium-проверка двух настоящих вкладок воспроизвела
тот же результат при autosave. После исправления проверены:

- добавление и изменение разных панелей сохраняют оба результата;
- конфликт одной панели отклоняет весь snapshot, включая попутные изменения;
- удаление изменённой панели и reset при чужой правке/добавлении не затирают storage;
- совпавшее изменение можно повторить без восстановления устаревших правил;
- UI сохраняет конфликтующий draft, явная загрузка актуальных правил разрешает
  продолжить редактирование;
- задержанный autosave и следующая правка одного окна сохраняются последовательно.

Проверки выполняются на синтетическом URL, без обращения к Grafana/Confluence:
`batch_panel_rules_behavior.js` и `inspectPanelRuleConflicts` в
`test/support/browser-audit-fixes.js`. Последний включён в канонический smoke.
Evidence: `test-results/batch-rules-conflict-red.txt`, `batch-rules-ui-red.txt`,
`batch-rules-ui-final.txt`. Store сохраняет прежний формат данных; общий
Web Lock остаётся владельцем межвкладочной записи. UI не перерисовывает поля
другого окна автоматически; обновление после конфликта выполняется явно.
Независимое ревью блокирующих замечаний не выявило. Этот блок закрывает
подтверждённый дефект B05, но не оставшиеся режимы захвата Batch и остальную приёмку.

Свежий полный прогон после runtime-правок:
`test-results/batch-rules-conflict-full-suite.txt` — ESLint, 222 JS,
41 Python и Chromium 24/24 PASS, включая двухвкладочный UI-сценарий.
Module/dependency guards, документационные ссылки и diff проверены;
GitNexus context/impact и detect-changes дополнены точным поиском вызовов
`BatchPanelRules` и ключа `batchPanelToolRules`. Options продолжает экспортировать
и импортировать прежний формат; Main/Series только читают правила перед захватом.

### Сверка оставшихся проверок 2026-10-15

Общие формулировки «ещё проверить Series / экспорт / восстановление» не означают,
что эти функции целиком не проверены. Повторно запущены 21 профильный Node-набор:
Series controller/preparation/selection, Main controller, manifest и ZIP→Confluence;
Confluence apply/live client; Runner chunked export/ownership/spool/visual reuse/diff;
Recorder startup/session/DashFlow controller/network/view; DashFlow compare/I/O/XLSX.
Все прошли. Они проверяют фактических владельцев с подменёнными границами,
а не заменяют оставшиеся живые варианты.

Существующие UI evidence также уже подтверждают Series group и standalone с
настоящим PNG (`pages-batch-series-vpn-results.json`), Recorder controlled-tab
close/reload/restart (`pages-recorder-remaining-results.json`) и два delayed-start
cancel/restart (`pages-recorder-delayed-cancel-results.json`). Runner midrun Stop,
частичный export и restart подтверждены `pages-runner-midrun-results.json`.
Основные Tab/Escape Options/Popup/Selector и история presets подтверждены
`pages-general-remaining-presets-keyboard/results.json`. Это прежние результаты,
не новые live-прогоны на текущем коммите; их пределы в исходных строках сохраняются.

Свежая настоящая Chromium-проверка C07/C08 на loopback REST-стенде:
`test-results/confluence-failure-acceptance.json`. Double-click даёт один PUT;
HTTP 409 не меняет storage и не объявляется успехом; ошибка второго вложения
сохраняет первое загруженное вложение, PUT не выполняется. Retry в обоих случаях
успешен с контрольным GET и без повторной загрузки первого вложения. Эти сценарии
повторены в двух прогонах, без рабочей Confluence.

**Новая подтверждённая ошибка C06/C08:** первый upload задержан, затем нажат
Rescan. После успешного нового scan (версия 3) старый ответ освобождён сервером;
старый Apply продолжает цепочку и выполняет PUT версии 4 прежнего плана.
Причина в текущем controller: `runner.apply` не получает abort signal и не
проверяет актуальность владельца Apply между стадиями. Это не ошибка источника.
Сам по себе ожидающий запрос после 32 секунд отмечен как наблюдение отсутствия
REST deadline, а не доказательство конкретного пользовательского SLA.
Второй независимый повтор гонки сохраняется в `confluence-pending-repeat.json`.
Production-файлы в рамках этой проверки не исправлялись; задача внесена в roadmap.
