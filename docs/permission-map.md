# DashBridge permission map

Проверено по `manifest.json` и действующим runtime-потокам 2026-08-24.

| Permission | Функция |
|---|---|
| `storage` | Настройки, профили, worklog, Batch state и bounded diagnostics. |
| `activeTab` | Команды Popup для явно выбранной Grafana/Jira/TDM-вкладки. |
| `tabs` | Временные Grafana-вкладки Batch, проверка URL и навигация capture. |
| `windows` | Изолированное окно Batch и GUI capture. |
| `scripting` | Explicit MAIN-world runtime на пользовательских Grafana-hosts и Jira/TDM actions. |
| `downloads` | PNG/ZIP/JSON/HTML exports. |
| `declarativeNetRequestWithHostAccess` | Session rules для снятия XFO/CSP только во вкладках DashBridge. Одновременный `declarativeNetRequest` не требуется. |
| `clipboardWrite` | Копирование отчётов/ссылок из Popup и test runner. |
| `debugger` | Chrome не разрешает объявлять `debugger` как optional permission. Traffic Recorder подключается через CDP только после явного Record/Replay, только к созданной им вкладке и отсоединяется при Stop или закрытии Recorder. |
| `<all_urls>` host access | Пользовательские корпоративные Grafana/Jira/TDM/Confluence hosts неизвестны во время сборки. MAIN runtime всё равно ограничен динамической регистрацией и route guard. |

`unlimitedStorage` временно сохранён для обратной совместимости с уже большими
локальными профилями и отчётами. Новые diagnostics, caches и export payloads
имеют caps, а import ограничен 16 МиБ; permission можно удалить только после
измерения существующих пользовательских storage. Test runner остаётся
внутренней extension page и не публикуется через `web_accessible_resources`.

`.dashflow` v2 содержит открытые `flow.json`, канонический `network.json`, HAR,
`streams.json`, HTTP bodies, cookies, токены и введённые значения, включая
password inputs. Manifest фиксирует лимиты и неполноту capture. Recorder
предупреждает о секретах до записи; файлы исключены из Git через `.gitignore`.
