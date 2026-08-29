# Документация DashBridge

В этом каталоге остаются только документы, которые нужны для поддержки
текущего расширения, и короткая история архитектурно значимых решений.

## Актуальные документы

- [`../AGENTS.md`](../AGENTS.md) — обязательный порядок чтения и правила
  AI-анализа/ревью репозитория.
- [`../README.md`](../README.md) — пользовательские функции, установка и
  запуск проверок.
- [`../extension-architecture.md`](../extension-architecture.md) — источник
  истины по архитектуре, runtime-потокам и пользовательским сценариям.
- [`development-guide.md`](development-guide.md) — инварианты разработки,
  зоны риска и обязательные проверки.
- [`permission-map.md`](permission-map.md) — связь разрешений Chrome с
  функциями расширения.
- [`dashflow-v2.md`](dashflow-v2.md) — формат записи Traffic Recorder,
  полнота данных и границы конвертации в HAR/JMX/WebPageTest/SAZ.
- [`installer.md`](installer.md) — установка и обновление unpacked DashBridge,
  поиск существующей папки, staging/backup и release trust boundary.
- [`../plans/README.md`](../plans/README.md) — только актуальные незавершённые
  направления. Реализованные задачи там не хранятся.

## История

- [`history/architecture-decisions.md`](history/architecture-decisions.md) —
  сводка решений, полученных из прежних аудитов и implementation-планов.
- [`history/legacy-global-dnr-rule.md`](history/legacy-global-dnr-rule.md) —
  почему нельзя возвращать глобальное снятие CSP/XFO.

Старые пошаговые планы и design-черновики удалены: они описывали промежуточную
структуру файлов, содержали устаревшие номера строк и незакрытые чекбоксы после
реализации. История изменений не является источником текущего поведения — его
определяют код, тесты и `extension-architecture.md`; `AGENTS.md` заставляет
AI-агента начать анализ с этой карты, но не подменяет проверку реализации.
