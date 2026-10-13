# DashBridge permission map

Сверено с `manifest.json` версии 2.4.3 и действующими runtime-потоками
2026-09-09.

| Permission | Функция |
|---|---|
| `storage` | Настройки, профили, versioned migration/backup, worklog, Batch state, Recorder draft, bounded diagnostics и ограниченная очередь обезличенных почасовых агрегатов. |
| `alarms` | Один периодический wake-up service worker для отправки не более одной накопленной пачки аналитики в час. Если очередь пуста, сетевого запроса нет. |
| `unlimitedStorage` | Обратная совместимость с уже большими локальными профилями, отчётами и Recorder payload. Новые объёмные данные всё равно имеют caps. |
| `activeTab` | Команды Popup для явно выбранной Grafana/Jira/TDM-вкладки. |
| `tabs` | Поиск активной вкладки, backfill Grafana runtime, временные Batch/Recorder-вкладки, навигация capture и `captureVisibleTab`. |
| `windows` | Отдельные окна Batch, GUI capture и Recorder; управление размером capture и clean incognito lifecycle. |
| `scripting` | Постоянная MAIN-регистрация/backfill ограничены настроенными hosts; explicit loader extension pages допускает выбранный HTTP(S) dashboard URL вне этого списка. Jira/TDM actions и Recorder injection имеют собственные guards. |
| `downloads` | PNG/ZIP/JSON/HTML/`.dashflow` exports и release ZIP по явному действию пользователя. Для снимка direct Grafana isolated bridge хранит разрешённый scope вне DOM, требует user activation, а service worker повторно проверяет sender host и dashboard route. |
| `declarativeNetRequestWithHostAccess` | Session rules для снятия XFO/CSP только во вкладках DashBridge. Одновременный `declarativeNetRequest` не требуется. |
| `clipboardRead` | Вставка диапазона времени в native Grafana picker и DashBridge по клику пользователя. Payload парсится как ограниченный `{from,to}` JSON либо URL с `from`/`to`; невалидный буфер не применяется. |
| `clipboardWrite` | Копирование диапазонов времени, отчётов, ссылок, diagnostics и PNG по пользовательскому действию. |
| `debugger` | Chrome не разрешает объявлять `debugger` как optional permission. Traffic Recorder подключается через CDP только после явного Record/Replay, только к созданной им вкладке и отсоединяется при Stop или закрытии Recorder. |
| `<all_urls>` host access | Пользовательские корпоративные Grafana/Jira/TDM/Confluence hosts неизвестны во время сборки. MAIN runtime всё равно ограничен динамической регистрацией и route guard. |

`unlimitedStorage` можно удалить только после измерения существующих
пользовательских storage. Diagnostics, caches и export payloads имеют caps, а
import ограничен 16 МиБ. Test runner остаётся внутренней extension page и не
публикуется через `web_accessible_resources`.

Isolated `content.js` вычисляет Grafana UI scope по настроенному host/hostname.
Постоянная MAIN-регистрация/backfill дополнительно ограничены dashboard routes.
Для привилегированных direct Grafana сообщений service worker независимо
проверяет sender, top frame, HTTP(S), route и разрешённый host. Explicit loader
Batch/Test Runner не читает allowlist; ранняя регистрация действует на matches
выбранного host/порта до окончания сессии, не только на одну вкладку.
Iframe-команды требуют уникальное имя, точные `origin`/`source` и extension origin.

Location probe именованного iframe работает также на Home/login, но не запускает
там панельные инструменты. `dashbridgeInspectLocation` принимается только от
точного extension parent; correlated `dashbridgeFrameLocation` не содержит
cookies или HTML. Родитель проверяет origin/source, профиль/runtime и поколение
навигации до однократного восстановления сохранённого URL. Новых permissions нет.

Native time-picker clipboard использует DOM dataset для включения UI.
Отзыв UI scope снимает принадлежащие DashBridge native handlers, восстанавливает
исходное представление кнопок и удаляет legacy actions. Handler повторно проверяет
scope и актуальный picker перед clipboard action и после async completion;
закрытый/заменённый picker и pagehide отменяют применение и feedback. Native
clipboard поведение Grafana при выключенном scope остаётся ответственностью сайта.
Это не независимая проверка доверенного host; усиление этой границы требует
отдельной правки и отрицательных тестов. Capture bridge в `content.js`, напротив,
проверяет собственный closure scope и user activation. Web-accessible остаются только
`js/content/inject.js` и `icons/dashbridge-mark.svg`.

`.dashflow` v2 содержит открытые `flow.json`, канонический `network.json`, HAR,
`streams.json`, HTTP bodies, cookies, токены и введённые значения, включая
password inputs. Manifest фиксирует лимиты и неполноту capture. Recorder
предупреждает о секретах до записи; файлы исключены из Git через `.gitignore`.

Клиентская аналитика использует только `storage` и один редкий `alarms` wake-up.
Фиксированный HTTPS endpoint покрывается существующим `<all_urls>` host access;
запрос выполняется без credentials/referrer, а сервер не хранит IP/access logs.
Контракт данных описан в `docs/analytics.md`.

DNR дополнительно ограничен initiator расширения; при навигации с DashBridge
или замене вкладки service worker пересинхронизирует правила. Вкладка с чужим
pendingUrl исключается. Общий broker снимков direct Grafana и DashBridge
проверяет активную вкладку и URL до и после capture и отклоняет результат при
переключении или навигации. Новых permissions эти проверки не требуют.

При добавлении URL в DashBridge неизвестный Grafana-host сохраняется только
после подтверждения в UI. Узкая команда `dashbridge-grafana-connection`
доступна только точной странице `pages/dashbridge/dashbridge.html`, не content
scripts или Popup. Service worker проверяет HTTP(S) dashboard URL без credentials,
сохраняет только host, ограничивает подключения сотней и дожидается runtime/DNR.
Query-параметры, имена дашбордов и контекст теста не отправляются в аналитику.
Область DNR остаётся прежней: разрешённые hosts, DashBridge tabs, extension initiator.

Команда `dashbridge-grafana-connections-replace` разрешена только exact Options
page, проверяет нормализованные списки и базовое состояние в очереди владельца
Grafana connections. DNR использует exact HTTP(S) host regex; поддомены не
наследуют разрешение. Host без порта допускает порты этого host, host:port
ограничен указанным портом. TabIds/initiator/sub_frame guard сохраняются.
Тот же host/port-контракт действует для MAIN registration и backfill. Для
явного порта используются отдельные HTTP и HTTPS match patterns: реальный
Chromium принимает `http://host:port/...` и `https://host:port/...`, но не
`*://host:port/...`. Запись без порта сохраняет разрешение на порты hostname;
временная регистрация различает полный host с портом. Непредставимый host не
считается покрытым пустым набором patterns. Дополнительных permissions нет.

Replay и Record занимают общую блокировку подготовки до асинхронных действий;
импорт и второй старт в это время отклоняются. Stop во время подготовки
передаёт отмену действующему владельцу, который освобождает созданную вкладку
и CDP после завершения текущего шага. Навигация дочернего iframe не расширяется
до действия над основной вкладкой: только известный корневой CDP frame создаёт
flow navigation, остальные события сохраняются как diagnostics.

Service worker по-прежнему проверяет profile CAS. Спекулятивное чтение страницы
не меняет baseline до принятия актуального снимка; открытые настройки графика
проверяют профиль и панель перед записью. Очистка vCPU helper привязана к запросу
и сохраняется после выключения фильтра; запросы dashboard variables остаются
вне panel status даже при visual-only наблюдении iframe. TDM export ограничивает
тем же десятиминутным deadline загрузку изображений, чтение body и передачу фото;
timeout проходит штатное восстановление scroll. Эти ограничения используют
существующие контексты и permissions, не добавляя новых полномочий.

Порт `dashbridge-batch-capture` принимает только exact Batch page. Service worker
сам создаёт окно и привязывает его к порту; клиент не может назначить произвольный
windowId для удаления. Disconnect и restart cleanup освобождают окно,
storage.session хранит только собственные window IDs. Новых permissions нет.

Batch и Test Runner используют аналогичный guard в общем extension-page
capture helper: active tab/URL/window до и после PNG, listeners навигации и
активации в течение захвата. Web Locks для Batch rules и OPFS не требуют
нового permission; locks действуют между документами одного extension origin.

Автоматические переменные DashBridge используют существующие host permissions
и Grafana-сессию iframe. Новый isolated `grafana-variables-bridge.js` не вызывает
привилегированные Chrome API: только получает собственный extension origin,
проверяет exact parent/source/origin и передаёт ограниченные correlated снимки
MAIN runtime. URL, имена и варианты переменных не отправляются в аналитику.

Коллаж в сводном сообщении использует существующие capture broker,
`clipboardWrite` и `downloads`; новых permissions нет. Выбранные PNG и
итоговое изображение существуют только в памяти extension page и в локальном
предпросмотре. Копирование и сохранение выполняются отдельным пользовательским
действием. Прямой отправки в Telegram, новых сетевых endpoints и записи
изображений в storage нет. Ограничения захвата и проверка active tab/URL
отправителя сохраняются.
