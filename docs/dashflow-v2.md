# DashFlow v2

`.dashflow` — ZIP-контейнер записи Traffic Recorder. Расширение файла является
продуктовым именем; содержимое можно исследовать обычным ZIP-инструментом.
Файл предназначен для replay в DashBridge и как исходный материал для будущих
конвертеров. Он содержит секреты в открытом виде и должен храниться как файл с
учётными данными.

## Владелец записи и границы CDP

Recorder — extension page. `createControlledTab` и `attachNetwork` в
[`recorder-session-transport.js`](../pages/recorder/recorder-session-transport.js)
создают отдельную вкладку `about:blank`, подключают CDP и настраивают Network/Page
до первой навигации. CDP нужен для response bodies, ExtraInfo, redirects и
stream events: DOM-only recorder или `webRequest` не предоставляют этот набор
данных. Permission `debugger` объявлен при установке, поскольку Chrome не
разрешает его в optional permissions; attach запускают только Record/Replay.
Action recorder инжектируется в созданную вкладку и доступные frames, а не
статически во все сайты. Недоступные frames могут оставить действия незаписанными;
CDP-ошибки чтения тел отражаются в body capture status. Полнота flow не доказывается
одним успешным attach.

`Disable Cache` задаёт `Network.setCacheDisabled` и
`Network.setBypassServiceWorker` для этой CDP-сессии. `Disable Cookies` означает
чистое incognito-окно, а не запрет Cookie headers: cookies работают в пределах
запуска для авторизации. `assertIncognitoReady` требует разрешение incognito и
отсутствие других incognito-окон, поскольку Chrome делит между ними cookie store.
Проверка выполняется перед созданием окна и не предотвращает открытие другого
incognito-окна позже; данные исчезают после закрытия последнего такого окна.
Обычный режим использует текущую сессию профиля браузера.

[`recorder-session-controller.js`](../pages/recorder/recorder-session-controller.js)
владеет Start/Stop: общий startup guard блокирует повторный старт и импорт,
Stop во время подготовки помечает отмену. `stopSession` даёт pending body capture
до трёх секунд после начальной паузы 250 мс, затем фиксирует неполноту и вызывает
detach. Штатный Stop и `finalizeUnexpected` закрывают только ephemeral incognito
window; обычное контролируемое окно остаётся открытым. Port
`dashbridge-recorder-lifecycle` в [`background.js`](../js/background.js)
принимает exact Recorder URL и при disconnect пытается detach привязанного tabId.
Heartbeat каждые 20 секунд отправляется только при attached; его interval
принадлежит документу и не снимается на Stop. Закрытие/перезагрузка Recorder
также запускает best-effort detach через beforeunload. Worker сохраняет только
`{tabId, documentId}` доверенного port sender в session-реестре
`dashbridgeRecorderOwners`; очередь сериализует bind/unbind/disconnect и recovery.
При каждом старте worker `runtime.getContexts` проверяет живые документы:
attachment живого Recorder сохраняется, для исчезнувшего владельца выполняется
detach только сохранённого tabId. Глобального обхода debugger targets нет.
При ошибке contexts cleanup не угадывает отсутствие владельца; при ошибке
detach запись сохраняется для следующего restart. Session storage не переживает
закрытие браузера. Сохранение bind не атомарно с attach: crash до записи или
ошибка storage остаются best-effort границей. Fallback не закрывает incognito
window и не гарантирует удаление cookies при аварии страницы.

Контракты проверяют
[`recorder_session_transport_behavior.js`](../test/recorder_session_transport_behavior.js),
[`recorder_session_controller_behavior.js`](../test/recorder_session_controller_behavior.js),
[`recorder_startup_races_behavior.js`](../test/recorder_startup_races_behavior.js) и
[`recorder_navigation_scope_behavior.js`](../test/recorder_navigation_scope_behavior.js) и
[`background_recorder_recovery_behavior.js`](../test/background_recorder_recovery_behavior.js).

## Состав архива

| Путь | Роль |
|---|---|
| `manifest.json` | Версия контейнера, время, окружение, режим cache/cookies, лимиты и полнота записи. |
| `flow.json` | Пользовательские действия и семантические локаторы replay. |
| `network.json` | Канонические CDP-запросы, ответы, redirect chains, timings, TLS/cache/initiator и события страницы. |
| `traffic.har` | Производное представление HAR 1.2 для просмотра и промежуточного обмена. |
| `streams.json` | Ограниченные события WebSocket, SSE и WebTransport. |
| `bodies/*.bin` | Тела HTTP-ответов; путь, размер и SHA-256 находятся в `network.json`. |

`network.json`, `flow.json`, `streams.json` и `bodies/` являются источником
истины. `traffic.har` строится при сохранении и не должен использоваться вместо
канонических данных, если конвертеру нужны точные статусы полноты или внешние
тела. Чистую проекцию live CDP state в `network.json` и HAR выполняет
`pages/recorder/recorder-dashflow-export.js`; модуль не управляет CDP-сессией и
не изменяет исходные request-объекты.

## Flow и replay

`flow.json` похож по структуре на экспорт Chrome Recorder, но не является
drop-in совместимым с ним. DashBridge поддерживает только `navigate`, `click`,
`change`, `keyDown` (`Enter`, `Escape`, `Tab`) и `submit`. Канонический target —
`_dashbridge.locator` с CSS-путём и семантическими признаками: id/name,
test-id, role, accessible name, label, href и fingerprint. Координаты не
сохраняются и не используются.

Конвертер обязан переводить локаторы в синтаксис целевого инструмента и
сообщать о неподдерживаемых действиях. Вложенные frames фиксируются через
`frameUrl`, однако `target: "main"` в Chrome Recorder-подобной части не означает
реальную совместимость с main frame. Загрузка файлов через `<input type=file>`
не переносима без отдельного доступа к исходному файлу. Синтетические
клавиатурные события могут обрабатываться сайтом иначе, чем физический ввод.

## Сеть и полнота

Для request и response body сохраняется явное состояние: `captured`, `empty`,
`partial`, `skipped`, `unavailable`, `failed`, `pending` или `none` в применимом
контексте. Причина объясняет пропуск: лимит, redirect, отсутствие тела,
CDP-ошибка или аварийное завершение. Наличие URL/status без `captured` не
означает, что body можно считать неизменившимся.

Текущие верхние границы одной сессии:

- 50 000 HTTP-запросов и 20 000 действий;
- 5 МиБ на одно request/response body и 100 МиБ каждого вида суммарно;
- 50 000 потоковых событий и 20 МиБ их payload;
- 20 000 событий страницы;
- 256 МиБ общего безопасного рабочего набора архива.

Для входного файла отдельно задан cap 512 МиБ; обязательные entries ограничены
1 МиБ для manifest, 64 МиБ для flow и streams, 256 МиБ для network и HAR,
при этом общий cap читаемых entries остаётся 256 МиБ. Это оценки и caps данных,
а не гарантия пикового RSS: JSON, base64 и JSZip создают промежуточные копии.

Импорт сначала проверяет обязательные JSON, распакованные размеры, пути bodies
и лимиты. Для каждого тела вычисляется SHA-256: при наличии `bodySha256`
значение обязано совпасть; при отсутствии поле заполняется вычисленным digest.
Только после успешной проверки импорт заменяет открытый baseline. Сбой импорта не
должен очищать текущую запись. Эту недоверенную границу реализует
`pages/recorder/recorder-dashflow-io.js`; контроллер Recorder получает только
полностью подготовленный результат и после этого атомарно применяет его к
текущей сессии. Тот же модуль сериализует подготовленные контроллером данные,
проверяет общий budget и собирает ZIP при сохранении; Chrome Downloads и
жизненный цикл Blob URL остаются ответственностью контроллера.

`read` проверяет именно обязательные entries и тела, на которые ссылается
network; дополнительные ZIP entries не извлекаются и не входят в его working-set
подсчёт. Paths тел разрешены только как `bodies/[a-zA-Z0-9_.-]+.bin`, requestId
не должны повторяться. SHA-256 защищает согласованность bytes с metadata, но
не доказывает происхождение архива: подписи и доверенного ключа здесь нет.
`validateNetwork`/`validateStreams` в
[`dashflow-schema.js`](../js/shared/dashflow-schema.js) проверяют базовую форму и
caps, а не каждое необязательное CDP-поле. Проверки ZIP, tampered digest и
сохранения baseline при отказе находятся в
[`dashflow_io_behavior.js`](../test/dashflow_io_behavior.js) и
[`recorder_dashflow_controller_behavior.js`](../test/recorder_dashflow_controller_behavior.js).

## Секреты

В архив могут попасть пароль, login/e-mail, request body, Authorization,
Cookie, Set-Cookie, API key, токены и персональные данные. Маскирование в UI не
изменяет содержимое файла. Сохранение исходных значений позволяет replay
повторить ввод логина/пароля и сохраняет диагностическую сеть; cookies и старые
токены из baseline автоматически не устанавливаются в новый браузерный запуск.
Очищенный экспорт был бы другим контрактом и может потребовать ручной авторизации
и correlation. Текущий формат означает:

- не добавлять `.dashflow` в Git и общие артефакты CI;
- передавать файл только по защищённому каналу;
- не публиковать HAR/JMX/SAZ, полученные из него, без отдельной очистки;
- считать `manifest.containsSecrets` предупреждением, а не доказательством
  отсутствия секретов при значении `false`.

## Границы будущей конвертации

### HAR

`traffic.har` уже даёт HAR 1.2 metadata и timings. Response bodies лежат во
внешних `bodies/*.bin` через поля `_dashbridgeBodyPath`/`_dashbridgeSha256`.
Для автономного HAR конвертер должен встроить их в `content.text` и указать
`encoding: "base64"` для бинарных данных. Потоковые протоколы и DOM-действия
стандарт HAR не описывает. CDP не гарантирует точные wire bytes, порядок и
регистр HTTP/2/3 headers или исходно сжатое тело.

### JMX (Apache JMeter)

Из `network.json` можно построить HTTP Request samplers, Header/Cookie Manager,
request bodies и assertions. DOM click сам по себе не является HTTP sampler:
нужно выбрать запросы шага и исключить browser-only ресурсы по продуктовой
политике. Динамические CSRF/OAuth/session значения требуют correlation —
извлечения из предыдущего ответа и подстановки переменной, а не копирования
старого токена. Multipart file bytes могут быть неполными. WebSocket требует
отдельного JMeter plugin, а Service Worker, HTTP cache, browser rendering и
JavaScript приложений JMeter не воспроизводит.

### WebPageTest

`navigate` и часть `click`/`change` можно перевести в WPT script после
трансляции локаторов. Записанный CDP-трафик служит baseline/ожидаемыми данными,
но не является входным «реплеем пакетов» WebPageTest: WPT повторно загружает
страницу в настоящем браузере. Авторизация, frames, SPA navigation и секреты
требуют явных команд и проверки поддерживаемого синтаксиса выбранной версии
WPT.

### SAZ / Fiddler

SAZ технически можно собрать как ZIP с сессиями и реконструированными raw
request/response. Конверсия будет приближённой: CDP не сохраняет исходный wire
формат HTTP/2/3, точный порядок/casing headers и во всех случаях compressed
payload. SAZ стоит реализовывать только при реальной необходимости Fiddler,
не заявляя lossless round-trip.

## Версионирование

`manifest.format` равен `dashbridge-flow`, `version` равен `2`. Импорт v2
строгий: неизвестные типы действий и некорректные обязательные структуры
отклоняются. Несовместимое изменение канонических полей требует новой версии;
добавочные поля должны игнорироваться читателями, если они не меняют смысл
существующих данных.
