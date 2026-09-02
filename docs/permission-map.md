# DashBridge permission map

Сверено с `manifest.json` версии 2.4.2 и действующими runtime-потоками
2026-09-02.

| Permission | Функция |
|---|---|
| `storage` | Настройки, профили, versioned migration/backup, worklog, Batch state, Recorder draft и bounded diagnostics. |
| `unlimitedStorage` | Обратная совместимость с уже большими локальными профилями, отчётами и Recorder payload. Новые объёмные данные всё равно имеют caps. |
| `activeTab` | Команды Popup для явно выбранной Grafana/Jira/TDM-вкладки. |
| `tabs` | Поиск активной вкладки, backfill Grafana runtime, временные Batch/Recorder-вкладки, навигация capture и `captureVisibleTab`. |
| `windows` | Отдельные окна Batch, GUI capture и Recorder; управление размером capture и clean incognito lifecycle. |
| `scripting` | Dynamic/explicit MAIN-world runtime только на настроенных Grafana-hosts, узкие Jira/TDM actions и Recorder scenario injection. |
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

Статический `<all_urls>` content script сам по себе не включает Grafana tools
на произвольном сайте. Isolated runtime выставляет scope только после проверки
настроенного hostname и маршрута, MAIN-runtime регистрируется динамически по
тем же hosts/routes, а iframe-команды требуют уникальное имя, точные
`origin`/`source` и extension origin. Web-accessible остаются только
`js/content/inject.js` и `icons/dashbridge-mark.svg`.

`.dashflow` v2 содержит открытые `flow.json`, канонический `network.json`, HAR,
`streams.json`, HTTP bodies, cookies, токены и введённые значения, включая
password inputs. Manifest фиксирует лимиты и неполноту capture. Recorder
предупреждает о секретах до записи; файлы исключены из Git через `.gitignore`.
