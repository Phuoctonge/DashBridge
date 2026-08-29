# DashBridge Installer

`scripts/Install-DashBridge.ps1` — отдельный Windows bootstrapper для небольшой
внутренней установки unpacked-расширения. Он не входит в ZIP расширения, не
выполняется из service worker и не получает доступ к `chrome.storage`.

## Пользовательский поток

1. Installer обнаруживает Google Chrome, Microsoft Edge и Яндекс Браузер. Если
   браузеров несколько, пользователь выбирает один; известный системный браузер
   помечается как вариант по умолчанию.
2. Для существующей установки installer best-effort читает `Preferences` и
   `Secure Preferences`
   профилей выбранного Chromium-браузера и проверяет найденный `path` по
   `manifest.json`, `popup.html` и `js/background.js`. Browser preferences не
   изменяются.
3. Если установка не найдена, используется постоянная папка
   `%LOCALAPPDATA%\DashBridge\Extension`. Installer показывает этот default и
   предлагает нажать Enter либо ввести другой абсолютный путь. Переменные среды
   в пользовательском пути раскрываются; относительные и небезопасные пути
   отклоняются. Выбор сохраняется в
   `%LOCALAPPDATA%\DashBridge\installer-state.json`.
4. Installer принимает только stable GitHub Release репозитория
   `Phuoctonge/DashBridge`, точные имена `DashBridge-X.Y.Z.zip` и checksum asset,
   затем сверяет SHA-256 и версию внутри `manifest.json`.
5. Новая версия копируется в sibling staging-папку. Текущая папка быстро
   переименовывается в timestamped backup, staging занимает прежний точный путь.
   При сбое swap восстанавливает backup. Браузер может оставаться открытым.
6. Для первой установки installer запускает выбранный браузер, если он закрыт,
   и открывает Проводник. Пользователь открывает управление расширениями через
   штатное меню браузера, включает Developer Mode и выбирает
   **Загрузить распакованное расширение**. Chromium не предоставляет обычному
   скрипту поддерживаемого API для этого подтверждения.

Внутренние `chrome://`/`edge://`/`browser://` URL могут отбрасываться при
передаче браузерному executable извне: вместо целевой страницы открывается
пустая вкладка. Поэтому installer не использует `--new-tab`, clipboard или
эмуляцию клавиатуры через `SendKeys`: они могут изменить пользовательские данные
или ввести текст не в то активное окно.

После swap загруженный runtime продолжает работать до явной активации. При
следующем открытии popup сравнивает текущий `chrome.runtime.getManifest()` с
`manifest.json` на диске. Если disk version новее, remote download notice
заменяется кнопкой **Перезагрузить расширение**, вызывающей
`chrome.runtime.reload()`. Страница управления расширениями и закрытие браузера
для обычного обновления не требуются. До reload пользователь не должен запускать
новые долгие операции DashBridge: service worker или extension page могут быть
повторно загружены браузером уже из новых файлов.

`browser://tune` в Яндекс Браузере предназначен для сценария с упакованным CRX
и не используется installer: на нём нет управления Developer Mode и загрузки
исходной папки unpacked-расширения.

При обновлении исходный путь не меняется, поэтому browser extension identity и
связанный с ней storage сохраняются. Папка с `.git`, корень диска, профиль
пользователя, непустая чужая папка и корень `LOCALAPPDATA` отклоняются. Installer
не завершает процессы браузера принудительно, не меняет `Preferences`, не
использует `--load-extension` и не устанавливает browser policies.

## Release-контракт

`scripts/build-release.ps1` формирует четыре проверяемых asset:

```text
DashBridge-X.Y.Z.zip
DashBridge-X.Y.Z.zip.sha256
Install-DashBridge.ps1
Install-DashBridge.ps1.sha256
```

Release workflow сначала выполняет полный тестовый прогон и `-SelfTest`
installer, затем публикует assets. Popup принимает update metadata только если
точные ZIP и installer URL принадлежат ожидаемому тегу официального репозитория.
Кнопка обновления скачивает installer; запуск PowerShell остаётся явным действием
пользователя.

## Ограничения обнаружения

Чтение Chromium `Preferences` является best-effort совместимостью, а не
публичным browser API. Нестандартный `--user-data-dir`, portable-браузер,
неизвестное расположение профиля или изменение внутреннего формата могут
потребовать параметр `-InstallPath`. После первого успешного запуска сохранённый
installer state является основным источником пути.

`-Diagnostics` выполняет только чтение и показывает обнаруженные браузеры,
профили, extension ID, версии, пути, наличие `.git`, installer state и default
install path. Режим не обращается к сети, не изменяет browser preferences и не
создаёт файлы. `-SelfTest` отдельно проверяет безопасные пути, синтетический
поиск через Chromium Preferences и staging/backup в системной временной папке.
