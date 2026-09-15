# Дизайн live-тестового контура DashBridge

## Цель

Добавить opt-in Playwright-контур, который запускает настоящее расширение на авторизованных Grafana, выполняет отдельные функциональные сценарии и доказывает четыре вещи: команда принята, обработчик выполнился, результат виден на странице, cleanup завершён.

Production-код расширения остаётся единственным источником поведения. Live-контур только запускает браузер, передаёт команды, собирает наблюдения и проверяет результат. Реализация renderer, storage, interception и lifecycle в тестах не копируется.

## Как не получить прогоны по 20–30 минут

Будет три режима:

| Режим | Состав | Целевое время |
|---|---|---:|
| `live:check` | авторизация, загрузка extension, один readiness probe | до 15 с на Grafana |
| `live:smoke` | 3–5 критических сценариев на выбранной Grafana | до 60 с на Grafana |
| `live:scenario` | один явно выбранный сценарий | до 30 с |
| `live:matrix` | несколько Grafana, renderer-ы и capabilities | отдельный длинный запуск, не входит в обычный `test:all` |

Каждый сценарий имеет общий deadline 30 секунд, а отдельные шаги — обычно 3–5 секунд. При превышении deadline сценарий сразу получает `timeout` с evidence; следующие сценарии не ждут его бесконечно.

По умолчанию:

- сценарии выполняются последовательно внутри одного persistent profile;
- независимые профили могут выполняться параллельно;
- screenshots, HTML и network body сохраняются только при ошибке или по флагу `--evidence=full`;
- обычный `test:all` не запускает live matrix;
- перед длинным запуском выполняется короткий readiness check и matrix отбрасывает недоступные окружения.

## Поток сценария

```text
паспорт capability
  → открыть нужную Grafana
  → дождаться dashboard/panel/renderer
  → выполнить команду
  → подтвердить accepted/executed
  → проверить DOM/renderer/state
  → выполнить reset в finally
  → проверить восстановление
  → записать bounded JSON evidence
```

Test-only bridge включается только в специальном Playwright-сеансе с marker и session token. Без них он не принимает команды. Generic `eval`, произвольный dispatch по имени функции и новые production permissions не добавляются.

## Функциональные паспорта

Каждый сценарий описывает:

- владельца и runtime-контекст: MAIN, isolated, iframe, extension page или service worker;
- входную команду и операции `apply`, `snapshot`, `reset`;
- dashboard/panel и способ поиска;
- поддерживаемый renderer: uPlot, Flot или оба;
- readiness condition;
- observable success;
- negative case;
- cleanup invariant;
- поля evidence и их лимиты.

Первая короткая smoke-группа:

1. legend complete-hide;
2. threshold highlight;
3. RAM conversion с возвратом byte units;
4. panel settings apply/reset;
5. iframe/time synchronization.

Capture, report snapshot, Batch, Worklog, Jira, Confluence и Recorder добавляются отдельными opt-in сценариями. Они не должны автоматически увеличивать быстрый smoke-набор.

## Несколько Grafana

Окружения задаются без секретов в конфигурации: host, dashboard URL, ожидаемый route и renderer. Авторизация остаётся в отдельном persistent profile.

Команды:

```text
npm run test:live:check -- --environment grafanakns
npm run test:live:scenario -- --environment grafanakns --scenario legend-complete-hide
npm run test:live:smoke -- --environment grafanakns
npm run test:live:matrix -- --environments grafanakns,mon-dc
```

Shared profile никогда не используется параллельно. Для параллельного matrix запуска нужны разные profile directories.

## Evidence

Каждый результат содержит host, scenario, commandId, timestamps, accepted/executed/observable/cleanup, renderer, bounded DOM facts, console/page errors, service-worker errors и network metadata. Credentials, cookies, profile names, полные URL и response bodies не записываются.

## Критерии безопасности

- live-контур не меняет обычную установку и offline tests;
- apply всегда сопровождается reset/restore;
- ошибка и timeout выполняют cleanup через `finally`;
- недоступная авторизация имеет статус `blocked`, а не `passed`;
- test-only bridge недоступен без marker/token;
- новый capability не копирует production-логику.
