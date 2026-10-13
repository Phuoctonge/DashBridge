# DashBridge: аудит расширения и план работ

> **Статус на 2026-10-13, checkpoint `663afff`:** частично завершённый план. Закрытые условия A01/A04/A07/A08/A09/A11/A12 отделены ниже от частичного A05 и исследований. Разделы первоначального аудита сохраняют исторические наблюдения и не объявляют исправленный код снова сломанным. Текущие runtime-контракты — в [архитектуре](../../architecture.md), открытые работы — в [roadmap](../../roadmap.md), команды — в [development-guide](../../development-guide.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать редактирование графиков Grafana достоверным, предсказуемым и проверяемым; привести вспомогательные сценарии и документацию в соответствие с текущим кодом.

**Architecture:** Сохранить единый MAIN-runtime и существующих владельцев transport, renderer, capture, profile commits и операций. Исправлять причины ошибок небольшими независимыми изменениями; новые пользовательские сценарии проектировать отдельно от исправлений. Деление файлов допустимо только по самостоятельной ответственности и lifecycle.

**Tech Stack:** Chrome MV3, classic JavaScript, Grafana uPlot/Flot/Table, Chrome storage и Web Locks, Node/Python, ESLint, Playwright, GitNexus.

**Spec:** Запрос пользователя на полный аудит с приоритетом редактирования графиков; [архитектура](../../architecture.md), [стандарт модулей](../../module-design.md), [разработка](../../development-guide.md), [permissions](../../permission-map.md).

## Основания и пределы анализа

### Статус пяти согласованных исправлений на 13 октября

Позднейшие интегрированные изменения: RAM `a4cffb3`, Mil/strict numeric Table
`cbbf452`, полный native Table frame `efe2afa`, clipboard parser/cleanup
`9ba97e4`/`46ce5b6`; add/commit `d59b1c8`, null response `1481b42`,
Confluence target `9714463`. Legend View sizing (`31d5c32`), общий native
Flot baseline (`8871670`), native Table readiness (`a2de993`), compact
geometry (`efaa0fa`, `6ad4460`) и Series navigation (`7dbf2b4`) также
уже исправлены, а не новые задачи аудита. Local release fixture — `edd499e`.
Последний автономный прогон до этой prose-ревизии: ESLint PASS, 221 JS,
41 Python, Chromium 23/23. Это прежняя проверка кода, не новый runtime-прогон
правки документации. Jira POST, Apply на рабочем Confluence и Recorder live
этим набором не объявляются проверенными. Полная D01-матрица остаётся частичной.

| Исправление | Подтверждённый результат |
|---|---|
| RAM byte/% (A11/F10) | Direct/iframe Flot, report и OFF проверены; рассчитанные проценты не смешиваются с оставшимися byte-сериями |
| Mil/неразобранные Table-ячейки (A12/F11) | Живые Mil, footer и mismatch единиц проверены; неизвестная числовая ячейка не даёт успешный SLA |
| Полный Table native DataFrame | Direct/iframe №31: 100 строк, max 1504287 при ON/OFF/scroll; №36/44/54, uPlot №138 и Flot CPU/RAM проверены. Старый ограниченный DOM fallback явно остаётся неполным |
| Clipboard parser (A07/F07) | В обеих Grafana valid copy и invalid paste с изолированными заглушками: неверный payload сохраняет inputs/URL; grammar сверена с публичным Grafana 12.2 datemath |
| Clipboard cleanup (часть A05/F05) | Grafana 10/12: deferred paste после revoke не меняет поля; native Copy восстановлен, modern writes=1, isolated writes=0, bindings=0; OS clipboard не менялся |

Каждое исправление прошло spec/quality review и свой live-контракт. Это не
закрывает весь A05 (независимая доверенная host authority остаётся исследованием).
Остальные неподтверждённые/невыбранные направления остаются открытыми.
Дополнительная проверка 13 октября закрыла A01/F01, A04/F04 и A08/F08:
null/blank response cells больше не создают zero metadata; выбранное изображение
Confluence сохраняет адрес исходной разметки до verification; добавление панелей
закрывает форму только после принятого commit и повторяет dirty draft без дублей.
Для неполной Metric/Value таблицы response fallback отклоняется целиком;
reduced-series пропускает отсутствующие samples, настоящий ноль сохранён.
Table проверена в обеих Grafana direct/iframe после полного restart браузера;
Confluence проверен фактическим UI на локальном REST fixture, без записи на рабочую
страницу. Specific/group precedence, original occurrence, no-cascade, разные
Batch ranges и заменяемый anchor дополнительно закреплены behavior tests.
Confluence частичные загрузки, отмена и version conflict остаются задачей E05;
исправление точной цели не объявляет атомарность REST-операций.
Последний полный прогон перед интеграцией Task 6: lint PASS, 220 JS и 41 Python
PASS, Chromium 19/21: Jira startup HTTP 401 и потеря modal focus внешним iframe.
Task 6 локализует только тестовый startup GET Jira и keyboard fixture с paused
panel; production Worklog/modal не меняются. Итоговый текущий полный прогон
прошёл: ESLint, 220 JS, 41 Python, Chromium 21/21; локальная Worklog auth fixture
проверена вместе с реальным UI. Evidence: `test-results/task-6-all.log` и
`test-results/task-6-smoke.json` (ignored). Финальная live matrix после полного
перезапуска браузера также PASS: direct RAM 36→12%→36 OFF; iframe CPU 12 Load,
RAM 12%→36 OFF; Table №31 ON/OFF до/после scroll — 100 строк, max 1504287;
direct Table №31/36/44 no_data/54 literal и uPlot №138; unit mismatch даёт
configuration error. В обеих Grafana invalid clipboard/deferred paste после
revoke сохраняют inputs, modern native writes=1, isolated writes=0, bindings=0.
Исходные страницы сохранены, временные закрыты; OS clipboard и сохранённые
настройки не менялись. Пометка об ожидаемом review относилась к тому этапу;
последующие исправления интегрированы в checkpoint `663afff`.
Остаточный внешний autofocus описан в [roadmap](../../roadmap.md); зелёный
локальный focus-тест не подтверждает его исправление.

Дата: 2026-10-12. Рабочая версия: 2.4.4. Исходный HEAD: `3494d85`.
Рабочая копия перед аудитом чистая. Production-код в этом задании не изменён.

Полностью прочитана архитектура, установлены контексты исполнения и владельцы.
Просмотрены основные Grafana MAIN/isolated/background потоки, страницы,
сохранение профилей, Batch, сводные сообщения, Confluence apply, Worklog,
Recorder/TDM, загрузочные контракты, release workflow, roadmap и UX-предложения.
Три независимых направления проверены агентами; ключевые выводы сверены
с исходниками. Первоначальные RAM/CPU примеры были синтетическими; ниже дана
повторная классификация доказательств и исправлены завышенные выводы.
Это широкий аудит с углублением в Grafana, а не обещание доказать отсутствие
ошибок в каждой ветви каждого файла.

Использованы skills: using-superpowers, chrome-extensions,
dispatching-parallel-agents, writing-plans, systematic-debugging,
verification-before-completion, modern-web-guidance; brainstorming — для
разделения будущих изменений поведения на самостоятельные проектные решения.
modern-web-guidance сообщает об обновлении самого навыка: локальная версия
2026_08_31-6ba3cecd, доступная 2026_09_04-7de96777.

### Исходный baseline 12 октября (исторический снимок)

| Проверка | Результат |
|---|---|
| ESLint | PASS |
| Module boundaries | PASS: 171 production JS, 10 документированных исключений |
| Dependency contracts | PASS: 444 load edges; одно advisory по `dashbridgeInspectLocation` |
| JavaScript runner | PASS: 219 файлов тестов |
| Python runner | PASS: 41 проверки, Python 3.14.3 |
| Chromium smoke | FAIL: 20/21 проверок, Worklog получил HTTP 401 при стартовой проверке Jira |
| Полный `test:all` | FAIL из-за browser smoke; не объявляется зелёным |
| Grafana live session check | BLOCKED: обе настроенные среды возвращают `/login`, `/api/user` 401 |
| GitNexus analyze --index-only | PASS; индекс предупреждает о caps и неполноте связей |
| GitNexus detect-changes | До добавления этого документа: No changes detected |

Первый sandbox-прогон не смог запустить указанный Python. Повтор вне sandbox
подтвердил наличие интерпретатора и успешные Python-проверки. Это ограничение
доступа, а не отсутствие runtime. Browser smoke использовал отдельный чистый
профиль; живые проверки — существующий отдельный E2E-профиль.

Диагностика smoke: `test-results/extension-smoke.json`, не включать в Git.
Единственная failed запись: `pages/worklog/worklog.html`, console resource 401,
без pageErrors. Worklog по загрузке вызывает `/rest/api/2/myself` на default Jira;
локальный smoke не изолирует этот внешний запрос. Нельзя исправлять это простым
игнорированием всех console errors.

Реальные изменения Jira/Confluence, отправки сообщений и запись рабочих
дашбордов во время аудита не выполнялись. Живое поведение renderer, clipboard
permissions и новой навигационной гонки capture этим прогоном не подтверждено.

## Что уже реализовано

| Контур | Действующие возможности | Важная граница |
|---|---|---|
| Обычная Grafana | Меню панели, временные настройки вида, CPU Idle→Load, RAM→% Used, анализ CPU/RAM, числовые и vCPU-фильтры, легенда, стили серий, пороги/подсветка, PNG/copy, добавление в профиль | Изменения локальные; расширение не является редактором dashboard JSON с сохранением в Grafana API |
| DashBridge | Профили, iframe-карточки, размеры/тема/пауза/fullscreen/reorder, период/refresh, групповые переменные, сохранённые tools, импорт/экспорт, снимки/ZIP | Активный профиль принадлежит вкладке; профили общие, CAS отвергает конфликт целого профиля |
| Сводный отчёт | Текстовые шаблоны, SLA, снимки uPlot/Flot/Table, списки метрик, согласованный период, до восьми PNG в коллаже | Это не транзакция datasource и не автоматическая доставка отчётов |
| Batch | Inventory панелей, правила по ID, несколько периодов, Main/Series, discovery, PNG/ZIP, диагностика, cancel, отдельное capture-окно | Готовность определяется renderer/transport; неизвестные плагины не обещаны |
| Confluence Report | Чтение live storage/attachments, импорт Batch ZIP, сопоставление, preview, загрузка вложений, обновление страницы и post-save проверка | Запись уже существует; exact target исправлен в `9714463`, partial/cancel/version-conflict остаются E05 |
| Worklog/Jira | Черновики, история, пакетная отправка, подтверждённые sent IDs, timezone, перенос/копирование, настоящая отмена | POST и локальная запись не атомарны; при аварии нужна сверка Jira |
| Recorder | CDP capture, actions/network/HAR/streams/bodies, `.dashflow` v2, import/replay/comparison, cache/incognito режимы | HAR-проекция внутри архива — не отдельный готовый JMX/WebPageTest экспортёр |
| TDM/Confluence editor | Экспорт чата/фото и отдельный editor scroll fix | Долгая TDM-операция пока зависит от popup; потеря результата при закрытии ещё не доказана |
| Разработка/релиз | Guards, unit/behavior tests, browser fixtures, E2E Test Runner, OPFS diagnostics, installer/staging/rollback, release CI, аналитика | Release CI уже есть; проверки pull request и вся live-матрица отсутствуют |

Сильные существующие решения: единственный упорядоченный runtime manifest;
MAIN/isolated разделение; exact origin/source iframe messages; tab/host/initiator
scope DNR; profile CAS + общий lock миграции; request-owned vCPU helper cleanup;
bounded diagnostics/archives; отдельные владельцы окон Batch/Recorder;
восстановление capture в finally. Их следует сохранять при исправлениях.

## Перепроверка выводов: факты, условия и неподтверждённые предположения

### Живая проверка 13 октября 2026 до исправлений (историческая evidence)

Наблюдения F10/F11, неверный clipboard parser и native cleanup ниже
зафиксированы до соответствующих исправлений. Итог после исправлений указан
выше; старые номера строк не являются актуальными указателями в исходниках.

Пользователь предоставил два дашборда и авторизовал отдельный visible-profile.
Production-файлы, dashboard JSON, профили и сохранённые настройки тестами не
редактировались. После отдельного разрешения пользователя проверены временные
CPU/RAM ON/OFF через настоящий UI с восстановлением. Тестовые iframe создавались
в DOM настоящей страницы DashBridge без добавления карточек в профиль.

| Среда/сценарий | Наблюдение и вывод |
|---|---|
| Grafana 10.1.10, CPU Usage №2 | **Flot**, 96 исходных серий → 12 Load → 96 после OFF. Проверка формулы на реальном response: 2892 точки, ошибка 0. В DashBridge iframe также 12 Load, процентная шкала. Прежний F03 не подтвердился. uPlot в целом на дашборде не определяет renderer этой панели. |
| Grafana 10.1.10, Memory №6 | 12 Total/Available пар; оси и длины совпадают, missing нет. Прежний F02 не подтвердился. Но обнаружен отдельный дефект отображения F10 ниже. |
| Grafana 12.2.0, Table №31/36/44/54 | №31/36 не имеют missing в проверенных числовых ответах; №44 возвращает No data и snapshot no_data; №54 содержит пропуски в многоколоночном response, но не распознаётся как Metric/Value records. Превращение missing в SLA=0 на этих панелях не воспроизведено; F01 остаётся дефектом collector с узкими условиями. |
| Grafana 12.2.0, timeseries №138 | Найден uPlot, snapshot читает 53 серии. Это проверка готовности/чтения, не полная проверка всех инструментов. |
| Picker времени, обе версии | Обычные copy и valid paste проходят. JSON со строками garbage/also garbage записывает их в реальные inputs, URL остаётся прежним. F07 подтверждён в UI; Apply не нажимался. Clipboard API заменялся безопасной заглушкой только в isolated world тестовой вкладки: системный буфер не читался/не менялся. |
| Picker scope=false | На 12.2 native Copy остался и вызвал API-заглушку ещё раз; на 10.1 custom buttons удалены и вызовов нет. F05 подтверждён для native lifecycle. Scope=false и настоящий scope-change event задавались в DOM; фактическое удаление connection из storage и обход permissions не тестировались. |
| Table №31, текущие настройки, iframe → report message | trimDomainEnabled=true, 100 response records; максимум 1504287 и critical при тестовом пороге 1000000. Обычный отчёт с этими настройками корректен. |
| Table №31, iframe без transforms в URL | DOM fallback: 23 numeric records вместо 100, максимум 505600, состояние ok при том же пороге. Реальный datasource содержит значение 1504287; значения Mil отбрасываются. F11 ниже воспроизведён через полный collectPanelReportSnapshot → panelReportSnapshot маршрут. Storage-настройка не менялась. |

**F10 / P1 — смешение байтов и процентов после RAM conversion.** В Memory №6
три исходных набора: Total, Available и Used. Transform заменяет только пару
Total/Available, сохраняя третьи Used-серии. После UI ON остаются 12 расчётных
серий 16.7–68.5% и 12 исходных байтовых серий до 66943471616; Flot подписывает
общую ось процентами (ticks 10000000000% … 70000000000%). Повторено дважды в
direct View и в DashBridge iframe. В iframe report также получает максимум
66943471616 с unit='%'. OFF восстанавливает 36 исходных серий и байтовую ось.
Это фактический renderer/report дефект, отдельный от прежних F02/F03.
Причина на границе: transforms сохраняет поля вне выбранной пары
(grafana-panel-data-transforms.js:198–217) и задаёт percent расчётному полю (:232),
но оставшиеся байтовые поля затем участвуют в общей процентной шкале/агрегации.
Исправление должно согласовать состав серий и единицы; не удалять произвольно
посторонние поля и не менять формулу, которая для проверенных пар верна.

**F11 / P1 — потеря Mil в числовом Table DOM fallback.** Настоящие ячейки
1.50 Mil и 7.93 Mil не поддерживаются parseDisplayValue (:113–143 в grafana-unit.js).
Строгий parser возвращает null, report отбрасывает строки и способен вернуть ok
по остальным значениям вместо неизвестного/ошибочного результата. Старый
parseGrafanaTableDisplayValue, напротив, возвращает 1.5/7.93 без миллионного
масштаба. Ошибка проявляется в поддерживаемом режиме без response metadata;
с текущим trimDomainEnabled=true report использует сырые числа и корректен.
Нужны единый scale contract для реального форматтера Grafana и обработка
неразобранных числовых ячеек, исключающая молчаливый успешный SLA.

**Подтверждённое ограничение DOM fallback — виртуализация таблицы.** При одном
периоде простая прокрутка №31 изменила DOM-снимок с 24 до 29 строк, а report max
с 505600 до 743180. Набор response содержит 100 значений. Архитектура уже
описывает ограниченный DOM-снимок, поэтому это не классифицируется как новый
неожиданный дефект всех таблиц. Для полного SLA такой fallback недостаточен:
нужно определить контракт частичного результата либо получать полный scoped
response. Текущий response-маршрут не зависит от прокрутки.

Локальная evidence в ignored test-results: live-ui-transforms.json,
live-ui-ram-repeat.json, live-iframe-cpu-ram.json, live-picker-audit.json,
live-table-report-audit.json, live-table31-details.json,
live-iframe-report-audit.json; снимки live-ui-6-transformed.png и
live-iframe-ram-mixed.png. Это результаты отдельных проверок, не новый test:all.
Confluence replacement, storage failure добавления и Jira smoke не проверяются
на страницах Grafana и не получили нового live-подтверждения в этом прогоне.

### Основания первоначальной повторной классификации (12 октября)

Повторная проверка 12 октября исправляет первоначальное завышение уверенности.
Девять F-пунктов ниже **не являются девятью наблюдёнными поломками**.
52 рабочих пакета включают исследования, UX-предложения и новые возможности;
их число не является числом ошибок. Рабочие графики пользователя не проверены:
live-сессии требуют входа; дополнительная проверка CDP 9222 получила ECONNREFUSED.
Перепроверка использует receiving-code-review и systematic-debugging.

### F01 / P2: Table collector теряет различие между пропуском и нулём

Факт в production-функции: collectResponseTableRecords для числовой колонки
[null, '', 0] возвращает три записи value: 0. Перепроверено через целую фабрику
transforms с настоящим table-report helper, а не только вырезанную формулу.
Места: grafana-panel-data-transforms.js:292,312; числовой фильтр :368 имеет
аналогичное приведение. Это ошибка представления missing values в collector.

Охват уже первоначального вывода: response metadata публикуется в ветви активного
data transform; report предпочитает эти записи только для DOM Table без uPlot/Flot
(grafana-panel-data-runtime.js:471,533; grafana-report-snapshot.js:106–118).
Неверный SLA на реальном отчёте пользователя не наблюдался. Полный сценарий
transform → Table → report следует закрепить regression до исправления;
нельзя утверждать, что все таблицы или обычные отчёты сейчас ошибочны.

### F02 / исследование: сдвинутые временные оси RAM

Код соединяет Total/Available по индексу. Пример разных осей [1000,2000] и
[2000,3000] был искусственно составлен: он показывает ограничение алгоритма,
но наличие таких ответов в рабочих запросах не установлено. Слова о реальной
ошибке RAM и обязательном P1-исправлении отозваны.

Поддерживаемый пример с одинаковыми осями и Total [100,100], Available [40,25]
повторно дал корректные [60,75]. Существующий atomic behavior test проверяет
неполные пары и сохранение исходных данных. A02 отложен до реального ответа
datasource с различающимися осями и согласования поддержки этого случая.

### F03 / совместимость: CPU со шкалой percentunit

Формула 100 - value рассчитана на Idle в шкале 0–100. Перепроверенный Idle
[80,20] дал Load [20,80]. Пример idle=0.8 с unit=percentunit был искусственным;
на рабочих панелях такая шкала не установлена. Утверждение, что CPU-преобразование
у пользователя сломано, отозвано. A03 — возможное расширение совместимости,
а не обязательное исправление существующего рабочего сценария.

### F04 / P1: выбранная Confluence replacement теряет позицию

Перепроверена цепочка настоящих private sourceForKey/buildApplyPlan и exported
storage.transform. Два targets в разных тестах с одним attachment old.png;
connections содержит только первый target. План выдаёт одну replacement без
occurrence, transform меняет обе картинки. Это конкретная ошибка выбора цели
при повторном использовании имени attachment. Места: confluence-report.js:144
и confluence-report-storage.js:55. Проверка replacements не подтверждает позицию.

Воспроизведение выполнено в VM с заданным состоянием страницы; внешняя запись
не выполнялась. Ошибка не проявляется автоматически у страницы с уникальными
именами, и повреждение рабочего отчёта пользователя не установлено.

### F05 / P2: native clipboard handlers не снимаются при scope=false

Факт lifecycle: bindNativeButton устанавливает capture listener, syncScope
отключает observer и удаляет custom buttons, но оставляет native listeners
(grafana-time-picker-clipboard.js:144–168,216–218). Сохранённый handler не проверяет
scope перед вызовом clipboard. Первоначальное VM-воспроизведение подтверждает
вызов API-заглушки после отзыва scope.

Это дефект cleanup обработчика. Реальное чтение буфера, обход browser permission
или утечка не доказаны. DOM dataset как источник scope требует отдельной
проверки границы доверия; отсутствие gesture guard само по себе не доказывает
обход защиты Chromium. A05 сначала проверяет DOM lifecycle в browser fixture.

### F06 / не подтверждено: смена документа в capture queue

Прежнее воспроизведение вызывало helper напрямую и обходило диспетчер.
background.js:209–226 перед broker делает injection с documentIds sender;
старый документ уже может быть отвергнут здесь. Тест background_gui_capture_behavior
покрывает диспетчер, documentIds и навигацию во время capture.
VM-результат OTHER_DOCUMENT_PNG не доказывает достижимость через runtime message
и доставку результата в браузере. Вывод о подтверждённом capture-дефекте отозван.
A06 — исследование окна между injection и queued run; исправление только после
воспроизведения полного маршрута. Нельзя обещать устранить доказанную утечку.

### F07 / P2: parser принимает обычные строки, не являющиеся временем

Настоящий parseRange для JSON {"from":"garbage","to":"also garbage"} вернул
эти endpoints. Paste присваивает их обоим native inputs (time-picker-clipboard.js:113),
вместо отказа на invalid input. Это конкретный недостаток валидации данных формы.
Apply остаётся native и автоматически не вызывается; Grafana может отклонить
значения. Повреждение сохранённого dashboard или применение неверного периода
не установлены. Прежний объект с secret был лишним искусственным примером.

### F08 / P2: форма добавления завершается независимо от commit failure

Single/quick handlers не ждут savePanels, picker ждёт, но не проверяет результат
(dashbridge-panel-addition-controller.js:171,231,339). Настоящий save owner ловит
ошибку, выставляет dirty и показывает «Изменения не сохранены», возвращая error
(dashbridge-profile-controller.js:41–53). Controller-test с этим результатом
закрывает форму, очищает ввод и отмечает success.

Это несогласованность формы/аналитики с результатом записи при storage failure,
а не доказанная тихая потеря данных: черновик и видимое предупреждение есть.
Реальная ошибка commit в рабочем профиле не наблюдалась; browser failure fixture
с настоящим save owner нужен перед изменением UX. Atomic save не объявляется сломанным.

### F09 / P2: зафиксировано падение smoke на внешнем Jira auth request

В исходном полном прогоне 20/21 browser checks: Worklog console resource HTTP 401,
без pageErrors. Startup вызывает checkJiraAuth → /rest/api/2/myself, smoke его
не изолирует. Факт — невоспроизводимость полностью автономной проверки без внешней
авторизации. Ошибка production Worklog этим не доказана. Повторный полный runtime
прогон в ходе prose-перепроверки не выполнялся; прежний результат не новый PASS.

### Первоначальные основания для исправлений и очередность

F01/F04/F05/F07 — воспроизведённые либо прямо установленные локальные дефекты
с указанными условиями. F08 — установленное расхождение завершения UI и save
контракта; полная browser-проверка failure остаётся открытой. F09 — наблюдённая
ошибка тестовой изоляции. F02/F03/F06 исключены из обязательных исправлений.
Уверенность в механизме не означает наблюдённый инцидент у пользователя.

Локальный повторный harness: test-results/recheck-audit.cjs (ignored, не production
test). Проверяет целые CPU/RAM/Table фабрики, parser и private plan → storage;
входные ответы/состояние заданы явно. Постоянные browser regression должны
проверять соответствующие пользовательские маршруты до правки кода.

## Где документация отстала

Таблица описывает состояние на начало аудита. При сохранении этого плана
в docs/README и roadmap добавлены ссылки и уточнены статусы U01/U05/U15/U16;
полная пересверка профильных контрактов остаётся работой A10.

| Документ/контракт | Расхождение | Необходимое действие |
|---|---|---|
| architecture, permission-map, development-guide, roadmap | Шапки 2.4.3/2026-09-09 при manifest/package 2.4.4 и октябрьских контрактах | Пересверить содержимое, затем обновить дату/версию; не менять только цифру |
| architecture: runtime list | Нет `grafana-legend-columns.js` и `grafana-panel-data-transforms-runtime.js` из действующего manifest | Сверить список и owner table, добавить проверку документированной последовательности |
| architecture: Confluence Report | Mutation/upload обозначены будущими/read-only | Описать actual POST/PUT/verify, version conflicts, partial upload, target scope и отмену |
| permission/development maps | Кандидат на уточнение полноты описания Confluence apply через executeScript | Сначала сверить все разделы; не считать отсутствие подробности доказанной ошибкой контракта |
| docs/README и roadmap | Все U01–U20 названы нереализованными | U01 основной Cancel и U05 уже исправлены; U15/U16 частичные, остальные проверять по пунктам |
| Сентябрьские/октябрьские plans | Существующий код рядом с непомеченными checklist steps | Проставить implemented/partial/open/needs-live; не использовать пустые checkbox как факт отсутствия реализации |
| README feature map | Нет полноценного описания Confluence report replacement | Добавить после F04 и проверки точности, обозначив фактические ограничения |
| Live tooling guide | Opt-in harness уже содержит threshold-highlight, пример перечисляет главным образом legend | Согласовать команды, обязательные параметры, base-path auth и результаты blocked/failed |

Исторический UX-аудит остаётся снимком 9 сентября. Его описание старого Cancel
не следует переписывать как будто ошибки никогда не было; нужно указать
актуальный статус в roadmap и ссылку на исправление/тест. Фактическая
архитектура должна описывать сегодняшнее поведение.

## Global Constraints

- Перед правкой читать профильные документы и выполнять правила [AGENTS.md](../../../AGENTS.md).
- Handwritten production JS: не более 700 строк или 64 КиБ без именованного исключения; цель 300–500 строк.
- MAIN/isolated/extension page/service worker не смешивать; общий manifest order сохранить.
- State, observers, generation и cleanup одного владельца не разносить механически.
- Перед удалением/переносом: GitNexus analyze/impact/context/trace/detect-changes, exact string search, module/dependency guards.
- `vendor/jszip.min.js` вручную не изменять.
- Ошибка записи не подтверждает success; недоступные данные не являются нулём или нормальным SLA.
- Runtime/renderer changes требуют direct/iframe × uPlot/Flot, capture success/error restore.
- Prose-only changes: documentation links и diff --check; исполняемые изменения: targeted + test:all.
- Не объявлять live blocked или SKIP успехом; внешние записи тестировать в согласованном тестовом контексте.

## Перечень работ и порядок выполнения

Ниже кандидаты в самостоятельные work packages. `[x]` обозначает закрытое
указанное условие, `[ ]` — остаток, исследование или продуктовый кандидат,
а не подтверждённую ошибку и не обязательство реализовать все предложения.
Подробные patch-планы новых функций составляются при начале соответствующего
этапа: этот документ не подменяет проектирование UX и не разрешает вымышленные
API. Для подтверждённых дефектов сначала regression RED, затем минимальное
исправление текущего владельца, targeted GREEN и общий набор.

### Этап A — достоверность и безопасное завершение операций

Таблица сохраняет исходные постановки и приоритеты. Актуальный статус каждого
условия указан в checklist после таблицы; слово «исправить» в исходной постановке
не означает, что эта задача остаётся открытой.

| ID | Работа и владелец | Проверка и критерий завершения | Зависимости |
|---|---|---|---|
| A01 / P2 | Исправить F01: missing-value contract в `grafana-panel-data-transforms.js`, Table/report metadata | `[null,'',undefined]` не дают записей zero; настоящий 0 сохранён; all-null даёт no_data, mixed считает только данные; numeric filter не превращает missing в breach | Нет |
| A02 / HOLD | F02: сначала подтвердить разные временные оси в реальном поддерживаемом ответе; затем решить, нужна ли корреляция RAM по времени | Сдвинутые/разные/пустые оси, reorder/duplicates; t=2000 из repro даёт 80%; unmatched либо null, либо explicit fail-open по выбранному контракту; исходные поля не удаляются до валидации | Нет |
| A03 / HOLD | F03: установить потребность в дробном Idle; unit-aware inversion только при расширении поддерживаемого контракта | percentunit 0.8 → 0.2 с сохранением шкалы либо 20 percent; percent 80 → 20; unknown unit без молчаливого неверного расчёта; null/nonfinite и downstream thresholds/filters | A01 желательно |
| A04 / P1 | Исправить F04: exact Confluence target от plan до transform и verify | Два использования одного attachment: выбранное изменено, второе неизменно; два targets на разные новые файлы не конфликтуют; verification проверяет позицию/содержание | Нет, отдельное изменение |
| A05 / P2 | Исправить F05: доверенный isolated clipboard scope и cleanup native bindings | Поддельный dataset/event, off-host, synthetic click, revoked host не вызывают extension Clipboard API; native Grafana actions восстанавливаются; разрешённый клик Grafana 10/12 работает | Нет |
| A06 / исследование | F06: проверить весь dispatcher → injection → queue → delivery; изменения только при достижимой гонке | Navigation до injection, во время queue wait и существующий pending navigation дают capture-target-changed; History API в том же документе допустим; listeners снимаются при всех исходах | Нет |
| A07 / P2 | Исправить F07: строгий time payload parser | Object/boolean/null, невозможные даты, недопустимые relative expressions и oversized payload не меняют ни одного поля; local/ISO/epoch/relative round-trip сохранён | A05 совместная проверка |
| A08 / P2 | Исправить F08: commit-aware addition single/ID-list/picker | Failure сохраняет форму/черновик, retry не добавляет дубль, double-click не запускает два commit; success/закрытие только после принятого результата; profile switch не получает чужую панель | Нет |
| A09 / P2 | Исправить F09: локальные Jira fixtures в smoke и explicit unauthorized assertion | Чистый smoke без рабочей сети воспроизводим; 401 даёт ожидаемый Worklog auth state; остальные console/page/resource errors продолжают проваливать тест | Нет |
| A10 / P2 | Привести актуальные документационные контракты и статусы в порядок | MAIN order совпадает, Confluence writes описаны; U01/U05 закрыты, partial отделены; ссылки и команды проверены; не повторять уже исправленные исторические работы | После соответствующих A01–A09 либо вместе с ними |
| A11 / P1 | Исправить живой F10: согласовать byte и percent серии RAM в renderer/report | Memory №6 с тремя исходными наборами не рисует байты как проценты; рассчитанные 12 рядов сохраняют правильные значения; report не выдаёт байтовый максимум как %; direct/iframe Flot и OFF проверены | Отдельно от отложенного A02 |
| A12 / P1 | Исправить живой F11: Mil и неразобранные ячейки Table fallback | Реальная ячейка 1.50 Mil учитывается как 1500000; snapshot не возвращает ok при пропуске неразобранной числовой строки; response path остаётся точным. Контракт частичной виртуализированной таблицы определить отдельно | F01 не является причиной этого случая |

Исходный порядок после живой проверки был A11/A12 → A04 → A01 → A05/A07 → A08/A09
и A10. Завершённые условия ниже повторно не выполнять. A02/A03 отложены,
A06 исследуется без заранее назначенного исправления.

- [x] A01/F01: null/blank response и reduced-series не создают zero; regression и direct/iframe Table выполнены (`1481b42`).
- [x] A04/F04: original image target, no-cascade, specific/group precedence, ranges и verification закреплены behavior tests и локальным REST UI fixture (`9714463`).
- [x] A07/F07: строгий time parser сохраняет оба inputs при invalid payload; Grafana 10/12 проверены (`9ba97e4`).
- [x] A08/F08: форма ждёт commit, failure сохраняет dirty draft, retry без дублей; single/ID-list/picker regression и browser fixture (`d59b1c8`).
- [x] A09/F09: smoke использует локальный Jira startup fixture и явный unauthorized state; рабочая Jira этим не проверялась (`9c3f0d7`).
- [x] A11/F10: RAM byte/% согласованы, Flot direct/iframe/report/OFF проверены (`a4cffb3`).
- [x] A12/F11: Mil scale и отказ от частичного numeric SLA; native DataFrame полный и независим от scroll (`cbbf452`, `efe2afa`).
- [x] Часть A05/F05: native listeners/markers/timers очищаются; deferred paste после revoke не меняет поля (`46ce5b6`).
- [ ] Остаток A05: независимая trusted host authority и synthetic/off-host сценарии; cleanup не закрывает эту границу.
- [ ] A02/A03 остаются HOLD до реальных условий/выбора совместимости; A06 — исследование полного capture dispatcher, без утверждения утечки.
- [x] A10: проектные руководства, интеграции, история, UX и планы/specs пересверены отдельной документационной ревизией 2026-10-13 после checkpoint `663afff`. Причины MAIN/DNR/transport/renderer/CDP связаны с владельцами и тестами; roadmap согласован. Это проверка prose, не новый runtime PASS.

### Этап B — проверить потенциальные дефекты, не фиксировать наугад

| ID | Исследование | Точный сценарий и решение после проверки |
|---|---|---|
| B01 / P1 | Direct settings Save после смены dashboard/generation | Задержать query signatures (`grafana-panel-tools.js:2220/2234`), перейти A→B с тем же panel ID или reinject. Проверить state/DOM B. При подтверждении добавить captured identity/generation guard текущему owner; DashBridge profile guard уже существует |
| B02 / закрыто для локального контракта | Grouped Confluence replacement и временные срезы | `9714463`: behavior tests закрепляют ranges, specific/group precedence, original occurrence и anchor. Acceptance записи на рабочем Confluence остаётся отдельной проверкой E05 |
| B03 / P2 | Отзыв Grafana host в уже загруженном MAIN | Включить transforms/threshold, удалить host, инициировать новый запрос. Согласовать немедленную деактивацию либо явный reload-контракт; проверить observers, wrappers, меню и повторное разрешение |
| B04 / P2 | Backfill navigation между probe и executeScript | Навигация фрейма после проверенного URL и до frameId injection. Подтвердить исполнение в нужном document или воспроизвести scope race; затем использовать document-specific injection там, где API поддерживает |
| B05 / исследование | Early legend-as-Table / единичный Table timeout | HP8_2 timeout не воспроизведён на повторе и не считается доказанным дефектом. Для early legend, offscreen и delayed datasource сохранять correlated transport/renderer evidence; успешный повтор не закрывает весь набор условий |
| B06 / P2 | Runtime update/reinjection и поздние callbacks | Старый документ после reload extension; in-flight fetch/XHR, threshold readiness, singleton dependencies. Проверить только current generation и отсутствие накопления listeners/wrappers |
| B07 / P2 | Batch cancel на подготовке и streaming snapshots | Cancel в storage/create/discovery, late window create, поток без idle. Capture не начинается после отмены; streaming получает явный unsupported/limited verdict вместо псевдостабильности |
| B08 / P2 | Закрытие popup во время TDM export | Долгая передача photos → закрыть popup → проверить финализацию/cleanup. Если результат теряется, перенести владельца долгой операции на отдельную page, не дублировать lifecycle |
| B09 / P2 | RAM identity за пределами timestamps | Один instance, разные job/device/mount/datasource и повторяющиеся названия. Найти однозначный ключ полного pair; неоднозначность не разрешать первым совпавшим полем |
| B10 / P3 | Grafana Live WebSocket fallback semantics | Browser fixture blocked/native sockets, identity и brand checks; менять prototype только при доказанном требовании и сохранённой native семантике |

- [x] B02: точный target/range локальный контракт проверен; рабочая внешняя запись не объявлена PASS.
- [ ] Для B01/B03–B10 сохранить минимальный сценарий и verdict confirmed / not reproduced / intentional limitation; B05 единичный HP8_2 — not reproduced on repeat.
- [ ] Подтверждённые ошибки исправить у установленного owner; неподтверждённые не выдавать за завершённые исправления.

### Этап C — сделать редактирование графиков понятным

| ID | Работа | Владельцы/файлы | Критерий завершения |
|---|---|---|---|
| C01 / P2 | Объяснить temporary Apply в direct Grafana и saved tools в профиле; U04 | `grafana-panel-settings-modal.js`, `grafana-panel-tools.js`, `dashbridge-panel-tools-controller.js` | Подпись действия соответствует контексту; видно, что переживает reload; сохранение панели в профиль не обещает перенос вида без реализации |
| C02 / P2 | Добавление по обычной ссылке с ясным выбором panel/discovery; U17 | `dashbridge-panel-addition-controller.js`, `dashbridge-panel-url.js`, HTML | Ссылка dashboard/view/solo нормализуется существующими helpers; выбор панели очевиден; connection confirmation, дедупликация и A08 сохранены |
| C03 / P2 | Локальное редактирование paused-карточки; U06 | `dashbridge-renderer.js`, `dashbridge-panel-card-controller.js` | URL/theme/size/report можно менять без iframe, pause не снимается; tools, требующие renderer, явно недоступны либо редактируют только сохранённое намерение |
| C04 / P2 | Показать область переменных и автосохранения; U13 | `dashbridge-variables-controller.js`, state/card/profile owners | Перед Apply видно N панелей и профиль; ошибка сохраняет старые URL; pause, grouped dependencies и лимит URL 4096 сохраняются |
| C05 / P2 | Различать applied и draft время; U14 | `dashbridge-time-controller.js`, `dashbridge-time-state.js` | Видно неприменённое время; Copy явно берёт draft либо applied; возврат текущего периода без лишней навигации |
| C06 / P2 | Объяснить общий prepared capture и отдельный analysis threshold; U11/U12 | shared modal, panel-menu/analysis, Options | Видим общий охват compact setting; CPU/RAM анализ показывает фактические warning/critical и путь настройки; не путать с линией графика/SLA |
| C07 / P2 | Единый понятный draft/Save contract nested report editor; U02 | `dashbridge-report-ui.js`, report/controller/profile owners | Отмена внешнего редактора имеет однозначный эффект; независимый commit явно обозначен либо введён общий draft; quota/CAS сохраняют ввод |
| C08 / P2 | Исправить название report retry; U03 | `dashbridge-report-attachments.js`, report-controller | Если повторяется весь текст и набор снимков, действие так и называется; fixed-time lease и consistency check не ослаблены |
| C09 / P2 | Доступность общих controls и MAIN modal | Options, TDM popup, shared panel modal, modal-accessibility | Label/input связаны, collapsible headings доступны с клавиатуры, native checkbox/switch семантика верна; focus/Escape/Tab, light/dark и scale проверены |

Потребность в undo/reset/copy-settings/пакетном Apply имеет смысл отдельно
обсудить после C01: это новые функции, а не найденные обязательные исправления.
Для них сначала определить scope: panel/profile/document, что сохраняется и
как откатывается; текущий план не обещает запись в исходную Grafana.

- [ ] Перед C01–C06 сверить текущий UI и выбрать нужные улучшения; рабочие CPU/RAM расчёты не переделывать по искусственным примерам.
- [ ] Выполнить C07–C09 независимыми проверяемыми изменениями, без общего редизайна всех страниц.

### Этап D — тестовая совместимость и измеренная производительность

| ID | Работа | Критерий завершения |
|---|---|---|
| D01 / P1 | Полная live-матрица Grafana | Direct dashboard/View/solo и DashBridge iframe × uPlot/Flot, настоящий Table, base path, light/dark, DPR 1/1.25/2; apply/refresh/remount/OFF/reset/capture success+failure; blocked отдельно |
| D02 / P2 | Закрепить разрешённые версии/типы панелей | Документировать tested/capability-supported/unsupported; Grafana 9–13 не объявлять проверенными по наличию selectors; unknown plugin даёт понятный fallback |
| D03 / P2 | Улучшить opt-in live harness | `test/live/run-live-scenario.js`, live-session-check, threshold scenario: base-path `/api/user`, explicit unknown scenario rejection, panel-scoped overlay assertions, проверка actual apply/reset результата, true cancellation после timeout |
| D04 / P2 | Добавить PR/branch CI без публикации | Новый workflow запускает lint/guards/Node/Python/Chromium и installer tests по релевантным изменениям; release только по tag; default token read-only, без рабочих сессий |
| D05 / P2 | Измерить performance baseline | 1/8/20/50 панелей, 50/500/2500 серий, пороги/легенда/фильтры отдельно; startup до первой панели, refresh latency, main-thread long tasks, heap после десяти ON/OFF/remount, число observers/requests и размер ZIP |
| D06 / P2 | Оптимизировать только найденные hotspots | По D05: ограничивать repeated DOM/fiber traversal, переиспользовать scoped snapshots, coalesce observer repaint, не дублировать response parsing; до/после показатели и unchanged correctness |
| D07 / P2 | Проверить load/report/capture при большом профиле | Startup gate первого origin не равен полному concurrency cap: измерить одновременный запуск остальных и report/time navigation; менять лимиты только по результатам и без потери offscreen report |
| D08 / P3 | Привести dependency advisory в проверяемый контракт | Найти producer/consumer `dashbridgeInspectLocation` exact search + test; добавить точное описание динамического edge, не подавлять весь класс предупреждений |
| D09 / P3 | Чистые scope тестовых/document scanners | `scripts/check-documentation-links.js` не должен смешивать основной checkout со служебными копиями/профилями; проверить осознанные roots/excludes и fixtures, не исключить production/docs |

Не установлено, что приложение сейчас «тормозит» из-за конкретного observer
или большого файла. D05–D07 — измерения и обусловленные ими оптимизации,
не утверждение измеренного bottleneck. Eager iframe и отсутствие постоянного
polling — намеренные контракты, а не автоматически плохие решения.

- [ ] D01 частично проверен после авторизации: direct/iframe Flot CPU/RAM, uPlot и Table, выбранные renderer/capture сценарии проходят; вся матрица тем, DPR, base path, ошибок и reset ещё не закрыта. Общий статус больше не BLOCKED из-за login.
- [ ] Выполнить D02–D04, сохранив единого владельца основного E2E catalog.
- [ ] Получить D05 baseline, затем выбрать только доказанные D06/D07 изменения.
- [ ] Завершить D08/D09 как небольшие maintenance задачи.

### Этап E — обслуживаемость кода и остальные сценарии

| ID | Работа | Критерий завершения |
|---|---|---|
| E01 / P3 | Обновить старый complexity plan по фактическому состоянию | Чистый transforms-runtime и legend-columns уже существуют; не повторять перенос. `panel-tools` ~2367 строк/140 КБ, legend-visuals ~1403/97 КБ — не автоматические дефекты, но требуют no-growth и focused review |
| E02 / P3 | Выделять только подтверждённые самостоятельные responsibilities | Сначала паспорт и GitNexus; переносить state/cleanup целиком, без proxy layers, cycles или второго defaults/schema source; учесть readability плотного Confluence controller |
| E03 / P2 | Согласовать Batch Main/Series и подготовку; U07/U08/U20 | Явные режимы, фактические URL/time/rules; prepare после подтверждённого выбора через current discovery owner, без автоcapture; текущий dashboard предлагается явно |
| E04 / P2 | Понятный Worklog target/timezone/auth; U09 | Видимый Jira URL/timezone, login/settings/recheck рядом; sent/partial/error не меняются; POST только явным действием |
| E05 / P2 | Confluence apply partial/cancel/version conflict | Dry-run transforms до upload; общий deadline/AbortSignal owner, double-click guard, журнал uploaded/page commit/verify, retry без молчаливых лишних attachment updates; конфликт версии не объявлять полным rollback |
| E06 / P3 | Recorder session wording и replay рядом с результатом; U15/U18 | Название объясняет текущую/чистую сессию; replay использует тот же startup/stop owner; никакой второй session state machine |
| E07 / P3 | TDM run preferences vs global defaults; U10 | Видно, что сохраняется автоматически; empty enabled user filter остаётся invalid; фото/data guards не ослабляются |
| E08 / P3 | Export saved configuration и контекст Test Runner; U16/U19 | Export явно читает saved state; dirty предупреждение понятно; runner получает проверенный текущий URL без autostart и не затирает выбор пользователя без объяснения |
| E09 / P3 | Проверить существующие storage объёмы | Обезличенные размеры/quotas/backup retention; решение об unlimitedStorage только после замеров и migration/recovery проверки |
| E10 / P3 | Обновить skill/development guidance и release checklist | Сверить обновлённый modern-web-guidance; согласовать npm ci --ignore-scripts с release workflow, в котором сейчас npm ci; исправления не затрагивают runtime-пакет |

- [ ] Выполнить E01 перед любым крупным разделением; E02 только при доказанной пользе.
- [ ] Довести E03–E08 как самостоятельные сценарии после основных Grafana работ.
- [ ] E09/E10 завершить по измерениям и проверке команд, не как формальное удаление permission/обновление всех зависимостей.

### Этап F — отдельные возможные проекты

Это направления с продуктовым выбором, а не обязательные bugfixes.

- [ ] F01: Автоотчёты/триггеры/канал доставки — отдельный проект с preview,
  fixed-period contract, секретами вне profile export и защитой от дубликатов.
- [ ] F02: Отдельные HAR/JMX/WebPageTest экспортеры Recorder — определить
  conversion fidelity, CSRF/OAuth correlation и ограничения browser-only шагов.
- [ ] F03: Настоящее сохранение изменений dashboard в Grafana — только при
  отдельном требовании: backend permissions, version conflict, backup, preview
  и точный перечень полей. Текущие renderer transforms не превращать молча в PUT.
- [ ] F04: Presets/copy/undo настроек графиков — после стабилизации C01,
  canonical tools schema и явно выбранного scope.

Firefox, SAZ, полный rewrite на framework/bundler и удаление legacy Flot
не являются необходимыми работами по текущему запросу.

## Статус прежних U01–U20

«Открыт» ниже означает актуальность UX-предложения по сравнению с историческим
аудитом, а не доказанную runtime-ошибку. Перед изменением нужны проверка текущего
пользовательского маршрута и выбор желаемого поведения. Наличие release CI без
PR CI, большие модули с разрешёнными исключениями и отсутствие замеров также
не являются фактическими поломками.

| Пункты | Статус на дату аудита | Новая задача |
|---|---|---|
| U01 | Основная отмена исправлена: explicit copy/move/cancel, cancel до POST | Не повторять fix; обзор операции возможен отдельно |
| U02 | Открыт: независимое сохранение фраз | C07 |
| U03 | Открыт: подпись partial retry не описывает полный повтор | C08 |
| U04 | Открыт: временный direct Save и добавление в профиль | C01 |
| U05 | Исправлен: empty enabled TDM user filter отклоняется | Сохранить regression |
| U06 | Открыт: paused settings | C03 |
| U07/U08 | Открыты: ручная подготовка/неясные Batch режимы | E03 |
| U09/U10 | Открыты: Jira контекст/TDM defaults | E04/E07 |
| U11/U12 | Уточнение scope/порогов актуально; финальный UI сверить перед правкой | C06 |
| U13/U14 | Открыты: grouped variables / draft time | C04/C05 |
| U15 | Частично: clean incognito объяснён, название не обновлено | E06 |
| U16 | Частично: dirty-state виден, export wording/saved scope не завершён | E08 |
| U17 | Открыт: embed-first addition UX | C02 |
| U18/U19/U20 | Открыты: replay/contextual runner/Batch | E06/E08/E03 |

## Проверка каждого рабочего пакета

Для исправлений сначала закрепить case failing regression с настоящим owner.
A02/A03/A06 ниже — условные критерии после подтверждения необходимости,
а не доказательства существующей ошибки. F05 не означает доказанную утечку.
Expected contracts:

```text
A01: collect(null/blank) != record(value=0); collect(0) == real record(0).
A02: match(t=2000) == 80%; unmatched t=1000 не получает значение из t=2000.
A03: invert(0.8, percentunit) == 20 отображаемых процентов.
A04: single target replacement меняет ровно выбранный image occurrence.
A05: forbidden/revoked/synthetic action -> Clipboard API calls == 0.
A06: old document/pending navigation -> capture-target-changed, без PNG выдачи.
A07: invalid payload -> оба native inputs == прежние значения.
A08: commit error -> форма и draft сохранены, success event == 0.
```

Команды в этом плане не дублируют machine paths: проверенные executable
находятся в AGENTS.md. Общая последовательность:

```powershell
node scripts/check-module-boundaries.js
node scripts/check-dependency-contracts.js
node scripts/check-documentation-links.js
npm run test:all
git diff --check
```

Installer changes дополнительно проходят SelfTest и installer_regressions
из development-guide. Live commands используют только отдельный тестовый
профиль; credentials не читать и не включать в репозиторий/артефакты.

Каждый пакет завершён, когда пользовательское поведение проверено, regression
проходит, affected contracts/документы обновлены, cleanup/error/cancel покрыты,
нужная live-проверка имеет реальный результат. Если live заблокирован, пакет
обозначается partially verified с конкретным остатком, а не полным PASS.

## Результаты после подтверждённых исправлений и выбранных улучшений

1. Table/SLA больше не называют отсутствие данных нормальным нулём.
2. Рабочие CPU/RAM преобразования сохранены; расширение шкал/осей обосновано реальными данными.
3. Clipboard cleanup и валидация проверены; capture меняется лишь при подтверждении гонки.
4. Add/Save показывают успех после commit и сохраняют ввод для retry.
5. Confluence меняет только выбранные позиции, а документация описывает запись честно.
6. Автономный набор зелёный без зависимости от рабочей Jira; live-совместимость
   подтверждается отдельной матрицей после входа.
7. UX-предложения выбираются отдельно; оптимизация и разделение модулей требуют
   измерений и самостоятельного основания. Сейчас измеренных bottlenecks не установлено.
