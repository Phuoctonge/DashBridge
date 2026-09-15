# План реализации live-тестового контура DashBridge

## Этап 1. Схемы и паспорта

Создать русскоязычную схему окружения, сценария и команды с caps, deadline и статусами `passed`, `failed`, `blocked`, `timeout`. Добавить паспорт первого сценария legend complete-hide.

Проверка: unit-тесты схемы на плохие URL, неизвестные capability, oversized payload и корректный multi-step сценарий.

## Этап 2. Launcher и блокировка профиля

Переиспользовать существующий persistent profile resolver. Добавить lock, запуск настоящего unpacked extension и readiness check. Ошибка авторизации должна завершать окружение как `blocked` за ограниченный timeout.

Проверка: missing profile, missing Chromium, worker timeout, concurrent profile и release после исключения.

## Этап 3. Сбор evidence

Добавить bounded collectors для page console/errors, service worker, network metadata и renderer snapshots. Кольцевые буферы и общий лимит отчёта обязательны.

Проверка: caps, redaction, detach после success/failure/timeout.

## Этап 4. Fail-closed bridge

Добавить только фиксированный каталог capability-команд. Bridge принимает marker/token, проверяет origin/source, коррелирует `commandId` и не предоставляет arbitrary eval.

Проверка: неизвестная команда, плохой token, stale command, oversized payload и reset после ошибки.

## Этап 5. Probes

Добавить panel probe, renderer probe и iframe probe. Они определяют panel, readiness, uPlot/Flot и bounded snapshot, но не повторяют Grafana calculations.

Проверка: virtualized panel, remount, iframe ownership, renderer timeout и restore.

## Этап 6. Scenario engine

Реализовать короткий цикл `apply → observe → assert → reset → assert-restored`. Общий deadline 30 секунд, шаги 3–5 секунд. Сценарий обязан завершать cleanup.

Проверка: command correlation, failed apply, timeout, blocked environment и несколько последовательных шагов.

## Этап 7. Режимы запуска

Добавить отдельные команды `live:check`, `live:scenario`, `live:smoke`, `live:matrix`. `test:all` остаётся offline и быстрым. Smoke ограничить 3–5 критическими сценариями.

Проверка: deterministic ordering, shared-profile lock, partial matrix failure и отсутствие live-зависимости у обычного runner.

## Этап 8. Capability coverage

Добавлять по одному паспорту: threshold, RAM, CPU/vCPU, settings, time/iframe, capture, report snapshot, Batch и интеграции. Каждый новый capability сначала проверять GitNexus impact/context и существующими unit/integration tests.

## Этап 9. Документация и release gate

Описать команды, профили, evidence, redaction и blocked semantics в `development-guide.md`, обновить architecture/roadmap и выполнить module boundaries, dependency contracts, ESLint, JavaScript runner, Python runner и opt-in live smoke.
