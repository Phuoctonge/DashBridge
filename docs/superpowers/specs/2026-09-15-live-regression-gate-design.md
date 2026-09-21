# DashBridge Live Regression Gate — спецификация

## Цель

Создать один автоматический release-gate, которому передают один или два
авторизованных Grafana dashboard URL. Gate запускает настоящее MV3-расширение
в официальном Playwright Chromium, проверяет direct Grafana и
`pages/dashbridge/dashbridge.html`, выбирает подходящие панели по capability,
выполняет Fast/Full/Targeted матрицу и выдаёт bounded-отчёт с verdict
`PASS`, `FAIL`, `SKIP` или `BLOCKED`.

Production runtime остаётся единственным источником поведения. Тестовый код не
копирует расчёты, renderer, storage, message dispatch или cleanup; он вызывает
существующие публичные facade/команды и наблюдает их фактический результат.

## Ограничения и честная автоматизация

Статический анализ JavaScript не может надёжно вывести семантику функции
(`invertLegend` должен изменить конкретную позицию, а RAM conversion — вернуть
byte unit после reset). Поэтому полностью автоматизируется инвентаризация,
маршрутизация, запуск, cleanup, evidence и coverage audit, а ожидаемый
публичный инвариант задаётся одним декларативным capability descriptor. Descriptor
не содержит реализацию функции и не дублирует production-код.

Добавление функции не требует отдельного Playwright-теста: владелец добавляет
descriptor в единый registry, после чего общий runner включает capability в
Fast/Full/Targeted режимы и отчёт покрытия.

## Поверхности

### Direct Grafana

Runner открывает точный `viewPanel=<id>` URL в отдельном сфокусированном окне,
загружает зарегистрированный MAIN-runtime и проверяет renderer-specific
поведение: legend, threshold, CPU/RAM transforms, vCPU, time/refresh и capture.

### Unified Dashboard

Runner открывает `pages/dashbridge/dashbridge.html`, подготавливает тестовый
профиль с панелями из переданных Grafana, ждёт iframe readiness и использует
существующие page controllers и `DashBridgeReportTestRunner`. Проверяются
добавление/удаление панелей, profile switching, settings apply/reset,
time/iframe synchronization, capture/report и cleanup.

## Capability descriptor

Единый registry публикует frozen массив descriptors через
`DashBridgeCapabilityRegistry`:

```js
{
    id: 'invertLegend',
    owner: 'js/content/grafana-legend-visuals.js',
    surfaces: ['direct-grafana', 'dashbridge-iframe'],
    roles: ['visual-legend'],
    renderers: ['uplot', 'flot'],
    modes: ['fast', 'full'],
    apply: { command: 'applyPanelTools', settings: { invertLegend: true } },
    reset: { command: 'applyPanelTools', settings: {} },
    required: ['canvas', 'legend', 'two-series'],
    invariants: ['legend-position-changed', 'native-legend-restored'],
    evidence: ['semantic', 'visual'],
    risk: 'high'
}
```

`apply` и `reset` ссылаются на существующий command catalog; registry не
разрешает arbitrary function name или произвольный `eval`. Каждый descriptor
обязан иметь owner, surface, capability requirements, observable invariant и
cleanup/reset invariant.

## Panel inventory и role mapping

Перед сценариями runner получает bounded inventory через dashboard API и DOM:

- numeric panel ID и title;
- Grafana panel type и renderer;
- canvas/series/legend facts;
- CPU/RAM/threshold hints;
- route/base path и dashboard UID.

Resolver выбирает панель для роли (`visual-legend`, `cpu`, `ram`, `threshold`,
`capture`) и формирует точный `viewPanel` URL. Явный `panel-role-map.json`
может зафиксировать выбор для конкретного host + dashboard UID. Каждый запуск
повторно проверяет title/type/capabilities; устаревшая карта даёт `BLOCKED`, а
не случайный выбор соседней панели. Отсутствие capability даёт `SKIP` только
если descriptor помечен как optional для данного renderer; обязательная
capability даёт `FAIL`.

## Режимы

| Режим | Охват | Использование |
|---|---|---|
| `check` | profile/auth/worker/runtime readiness | перед любым live-запуском |
| `fast` | high-risk capabilities, reset и минимальный cross-surface smoke | после крупной правки |
| `targeted` | owners из `git diff` + upstream impact + обязательные зависимости | ежедневная разработка |
| `full` | весь registry на всех подходящих direct/iframe ролях | перед release |

Fast не наследует случайный UI selection. Full имеет bounded deadline на
capability и общий deadline на environment; timeout не блокирует последующие
environments, а получает статус `TIMEOUT`.

## Verdict и evidence

Каждый capability result содержит только bounded поля:

```text
environment, dashboardUid, panelId, role, renderer, capabilityId,
accepted, executed, observable, reset, cleanup, status, reasonCode,
durationMs, diagnosticRef
```

Credentials, cookies, profile names, response bodies и полные URL с секретами
не записываются. Screenshot/DOM/canvas evidence сохраняется только для failed
capability или при `--evidence=all`. В `finally` выполняются reset, закрытие
вкладки/окна и release profile lock.

## Release command

```powershell
$env:DASHBRIDGE_E2E_PROFILE = '.dashbridge-local\e2e\browser-profile'
& 'C:\Program Files\nodejs\node.exe' scripts/run-release-gate.js `
  --grafana-one 'https://grafana-one.example/d/uid/...' `
  --grafana-two 'https://grafana-two.example/d/uid/...' `
  --panel-map test/live/panel-role-map.json `
  --mode fast
```

Gate использует bundled Playwright Chromium, а не системный Chrome с
корпоративной политикой, блокирующей unpacked extension. Профиль не
перемещается и не используется параллельно.

## Coverage audit

`scripts/check-live-coverage.js` сравнивает registry с фактическим кодом:

1. owner существует и находится в допустимом runtime context;
2. command/event/storage contracts найдены dependency guard;
3. descriptor имеет direct/iframe surface или документированную причину;
4. reset/cleanup и negative case существуют;
5. capability имеет хотя бы один Fast или Full mode;
6. Git diff владельца вычисляет Targeted set.

Отсутствующий descriptor не считается PASS: audit выдаёт `UNCOVERED` и
ненулевой exit code в release-gate.

## Нефункциональные критерии

- обычный `npm test:all` остаётся offline и не зависит от Grafana;
- Fast target — не более 2 минут на environment при доступной Grafana;
- Full target — не более 10 минут на environment, с отдельным deadline для
  медленной capability;
- profile lock исключает параллельное использование одного E2E profile;
- недоступные DNS/VPN/auth/service worker имеют `BLOCKED`, не `PASS`;
- каждый apply имеет reset и restoration assertion;
- release ZIP не содержит `test/live`, registry runner или test-results.

## Доказательство готовности

Готовность подтверждается свежими командами:

1. registry/coverage behavior tests;
2. dependency contracts и module boundaries;
3. lint и Node/Python runner;
4. browser smoke с полным extension;
5. `check` на обеих авторизованных Grafana;
6. Fast direct + Unified Dashboard matrix;
7. Full matrix и bounded report перед release;
8. positive/negative cleanup и stale panel-map scenarios.
