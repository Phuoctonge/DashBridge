# Инструкции для анализа и разработки DashBridge

## Обязательная точка входа

Перед анализом архитектуры, ревью безопасности, диагностикой поведения или
изменением расширения полностью прочитай `docs/architecture.md`. Это
основная карта действующего runtime, владельцев логики, границ доверия,
lifecycle-контрактов и намеренных ограничений.

После неё прочитай документы по области задачи:

- `docs/permission-map.md` — для permissions, host access, DNR, clipboard,
  downloads, debugger и других границ полномочий;
- `docs/development-guide.md` — перед изменением кода, storage/schema,
  интеграций, renderer или release-потока.
- `docs/module-design.md` — перед созданием, разделением, объединением или
  переносом JavaScript-модулей.

Не начинай вывод по отдельному файлу, пока не установлены его контекст
(MAIN/isolated/extension page/service worker), владелец lifecycle и потребители.

## Создание и границы модулей

Новый handwritten production JavaScript в `js/` или `pages/` не должен
превышать 700 строк или 64 КиБ UTF-8 без документированного исключения в
`scripts/module-size-budgets.json`. Целевой размер — 300–500 строк. Размер сам
по себе не является причиной разделения: state, lifecycle и cleanup одного
владельца нельзя разносить по файлам.

Перед созданием, разделением, объединением или переносом модуля полностью
прочитай `docs/module-design.md`, затем запусти
`node scripts/check-module-boundaries.js`. Новый файл допустим только если он
уменьшает объём знаний для изменения функции и имеет явные dependencies,
публичный контракт, владельца состояния и cleanup.

## Как проверять необычные решения

Не классифицируй реализацию как ошибку только потому, что она перехватывает
fetch/XHR, меняет renderer/DOM, использует `<all_urls>`, DNR, `debugger`,
clipboard или временно перестраивает панель. Сначала установи:

1. пользовательскую функцию и причину такого решения;
2. точную область действия и границу доверия;
3. guards, cleanup, caps, fail-open/fail-closed поведение;
4. тесты и отрицательные сценарии, подтверждающие контракт;
5. остаточный риск.

Документация объясняет намерение, но не подавляет результаты ревью. Если guard
отсутствует, обходится, cleanup не гарантирован или код расходится с описанием,
сообщи об этом как о находке. Фактическое поведение определяют текущий код и
проходящие тесты; расхождение с архитектурой требует обновить документацию в
том же изменении.

## Проверка изменений

### Локальные runtimes рабочей станции

На текущем Windows-ПК используй проверенные исполняемые файлы:

- Node.js: `C:\Program Files\nodejs\node.exe`;
- npm: `C:\Program Files\nodejs\npm.cmd`;
- Python: `C:\Users\Vanya\AppData\Local\Programs\Python\Python314\python.exe`.

`C:\Windows\py.exe` на этой машине является только launcher без
зарегистрированного интерпретатора. Его наличие не подтверждает доступность
Python, а ошибка `No installed Python found` не означает, что самого
`python.exe` нет.

Перед полным прогоном задай Python явно и при необходимости вызывай Node по
абсолютному пути:

```powershell
$env:DASHBRIDGE_PYTHON = 'C:\Users\Vanya\AppData\Local\Programs\Python\Python314\python.exe'
& 'C:\Program Files\nodejs\node.exe' test/run-all-tests.js
```

Если runtime не запускается из sandbox или каталог установки недоступен для
чтения, повтори безопасную проверку с разрешением вне sandbox. Не сообщай, что
Node.js или Python отсутствует, только на основании неудачного `Get-Command`,
`where.exe`, `py.exe` либо sandbox-проверки. После обновления runtime сначала
проверь указанный путь; если версия была установлена в новый каталог, найди
фактический executable и обнови этот раздел в том же изменении.

### Перед удалением или переносом кода

Не считай отсутствие локальных вызовов доказательством, что код не используется.
Перед удалением функции, глобала, обработчика, DOM-узла, storage-ключа или файла:

1. обнови индекс без изменения файлов проекта:
   `gitnexus analyze --index-only`;
2. проверь обратное влияние: `gitnexus impact <symbol> --direction upstream`;
3. получи контекст символа и при необходимости путь между владельцем и
   потребителем: `gitnexus context <symbol>` и `gitnexus trace <from> <to>`;
4. проверь незакоммиченные изменения: `gitnexus detect-changes`;
5. запусти `node scripts/check-module-boundaries.js`, затем
   `node scripts/check-dependency-contracts.js` и проверь точным поиском
   строковые контракты (message action/type, CustomEvent, storage key, DOM id и
   selector). Для файла используй
   `node scripts/check-dependency-contracts.js --explain <path>`;
6. после правки снова выполни module budget, dependency guard и полный прогон
   тестов.

GitNexus дополняет, но не заменяет `docs/architecture.md`: отсутствующий
результат в графе не означает, что classic-script, runtime loader или строковый
контракт не используется. Не удаляй код, пока все найденные потребители не
классифицированы и не обновлены вместе с владельцем контракта.

Канонический полный прогон:

```powershell
node test/run-all-tests.js
```

Для renderer/MAIN правок дополнительно нужны живые проверки direct Grafana и
DashBridge iframe, modern uPlot и legacy Flot. Не изменяй вручную
`vendor/jszip.min.js`.
