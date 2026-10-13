# Полный диагностический журнал Batch Implementation Plan

> **Статус на 2026-10-13:** Основной журнал реализован (`1c244e7`), переключатель находится в шапке Batch (`a0868ed`), читает/пишет sync `batchDetailedLogging`, по умолчанию включён. Operation owner добавляет `batch-debug.jsonl` только при enabled. Предложенное размещение в Options и некоторые имена callbacks ниже — исторический проект; фактический контракт описан в architecture.
> Действующие контракты: [архитектура](../../architecture.md), [разработка](../../development-guide.md); актуальные остатки: [roadmap](../../roadmap.md). Нижние шаги и команды сохранены как исходный план; перед продолжением сверять их с кодом и текущими владельцами.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Добавить управляемый подробный журнал Batch в `batch-debug.jsonl`, который восстанавливает полный lifecycle каждого задания и опционально попадает в ZIP.

**Architecture:** `BatchOperationController` владеет журналом и получает настройку `batchDetailedLogging`. Loader, capture и window runner получают узкий callback событий; MAIN runtime не получает новый lifecycle, а его существующие diagnostic snapshots читаются на контрольных точках. `manifest.json` и текущий UI-лог сохраняются независимо от подробного режима.

**Tech Stack:** Manifest V3 extension pages, classic scripts, Chrome tabs/scripting APIs, JSONL, JSZip rolling archive, Node behavior tests, Python smoke tests, Playwright browser smoke.

**Spec:** `docs/superpowers/specs/2026-10-07-batch-full-diagnostic-journal-design-ru.md`

## Global Constraints

- Не записывать cookies, authorization headers, токены, тела datasource-ответов и бинарные PNG-данные.
- Не создавать второй data interceptor или второй lifecycle владельца.
- `batchDetailedLogging` по умолчанию `true`; `false` полностью исключает `batch-debug.jsonl` из ZIP.
- Не вводить ограничение размера журнала в этой версии.
- Сохранять текущий UI-лог, `manifest.json`, `errors.txt`, cancellation и partial ZIP results.
- Не менять общие ordinary Grafana/DashBridge capture semantics без Batch callback.
- Перед удалением или переносом контрактов использовать GitNexus, module boundary и dependency guards.

### Task 1: Add the diagnostic setting and Batch UI control

**Files:**
- Modify: `js/shared/local-state-schema.js` — accept boolean `batchDetailedLogging` in batch state only if needed for migration; do not put sync preference in local batch form state.
- Modify: `js/shared/grafana-settings.js` and settings defaults/schema owner — add sync key `batchDetailedLogging: true` with normalization.
- Modify: `pages/options/options.html` and `pages/options/options.js` — render and persist the switch near Batch settings.
- Modify: `pages/options/options-config-transfer.js` — include the setting in export/import if the existing global settings transfer owns it.
- Test: `test/batch_diagnostic_setting_behavior.js`

**Interfaces:**
- Produces normalized sync setting `batchDetailedLogging: boolean`.
- Consumers read it once at Batch run start through existing settings normalization.

- [ ] **Step 1: Write the failing test** asserting default `true`, boolean validation, Options control persistence and export/import round-trip.
- [ ] **Step 2: Run** `& 'C:\Program Files\nodejs\node.exe' test/batch_diagnostic_setting_behavior.js`; expected failure because the key/control is absent.
- [ ] **Step 3: Implement** the setting using existing global settings defaults, sync storage and Options event wiring; do not add a new storage owner.
- [ ] **Step 4: Run** the same targeted test and `node scripts/check-dependency-contracts.js --explain pages/options/options.js`.
- [ ] **Step 5: Commit** `feat: add Batch detailed diagnostic setting`.

### Task 2: Create the Batch diagnostic journal owner

**Files:**
- Create: `pages/batch/batch-diagnostic-journal.js` — classic-script facade `BatchDiagnosticJournal.create({ enabled, now, runId })`.
- Modify: `pages/batch/batch.html` — load the journal before operation controller.
- Test: `test/batch_diagnostic_journal_behavior.js`

**Interfaces:**
- `create(...).startRun(context)`, `record(event)`, `snapshot()`, `toJsonl()`, `clear()`.
- Every emitted event receives `seq`, ISO `at`, `elapsedMs`, run/job/panel context and `details`.
- `record` accepts only JSON-serializable bounded scalar/object data and strips secret-like keys (`cookie`, `authorization`, `token`, `password`, `secret`, request bodies).

- [ ] **Step 1: Write failing tests** for ordering, mandatory fields, disabled mode, JSONL output and secret redaction.
- [ ] **Step 2: Run** `node test/batch_diagnostic_journal_behavior.js`; expected failure because the facade does not exist.
- [ ] **Step 3: Implement** closure-owned journal state with no timers, observers or globals beyond a frozen facade; disabled mode makes `record` a no-op and `toJsonl()` return an empty string.
- [ ] **Step 4: Run** the targeted test, module budget and dependency guard.
- [ ] **Step 5: Commit** `feat: add Batch diagnostic journal owner`.

### Task 3: Instrument operation/window lifecycle and ZIP export

**Files:**
- Modify: `pages/batch/batch-operation-controller.js` — own journal instance, emit run/window/archive events, expose `recordDiagnostic` and include `batch-debug.jsonl` in `addArchiveReport` only when enabled.
- Modify: `pages/batch/batch-capture-runner.js` — emit acquire/create/release/close events through injected callback without changing ownership.
- Modify: `pages/batch/batch.js` — load setting and pass journal callback into controllers.
- Modify: `pages/batch/batch-main-run-controller.js` — emit job start/finish/failure and pass job context.
- Modify: `pages/batch/batch-series-run-controller.js` — emit equivalent Series events.
- Test: `test/batch_diagnostic_archive_behavior.js`

**Interfaces:**
- Operation controller receives `diagnosticJournal` and `detailedLoggingEnabled`.
- `recordDiagnostic({ stage, event, jobId, panelId, panelTitle, requestedUrl, actualUrl, details })` is the only write path.

- [ ] **Step 1: Write failing tests** for enabled ZIP entry, disabled ZIP omission, main/Series job events, partial failures and cancellation cleanup.
- [ ] **Step 2: Run** the targeted test; expected failure because archive contains no journal.
- [ ] **Step 3: Implement** event wiring and serialize `journal.toJsonl()` as UTF-8 `batch-debug.jsonl` immediately before archive finalize; keep `manifest` and `errors.txt` behavior unchanged.
- [ ] **Step 4: Run** targeted archive/controller tests and `git diff --check`.
- [ ] **Step 5: Commit** `feat: export Batch diagnostic journal in ZIP`.

### Task 4: Instrument loader navigation, runtime, panel and readiness checkpoints

**Files:**
- Modify: `pages/batch/batch-panel-loader.js` — accept `recordDiagnostic`, emit navigation/runtime/tools/panel/readiness/timeout events, and snapshot MAIN state at bounded checkpoints.
- Modify: `test/batch_panel_loader_behavior.js` — assert event order and details for success, empty-data, no-data, timeout and navigation rejection.

**Interfaces:**
- Loader input gains optional final `diagnostics` callback/context; existing positional callers remain valid when omitted.
- MAIN snapshot is JSON-only: panel geometry, loading markers, renderer kinds, data status, active request count and new event IDs since previous checkpoint.

- [ ] **Step 1: Write failing assertions** for `load-start`, `navigation-requested`, `runtime`, `lookup`, repeated `readiness-check`, `waiting` reason, `ready`, `timeout` and `navigation-rejected`.
- [ ] **Step 2: Run** `node test/batch_panel_loader_behavior.js`; expected failure because events are not emitted.
- [ ] **Step 3: Implement** event recording at existing state transitions; do not add polling beyond the existing readiness loop and do not log request bodies.
- [ ] **Step 4: Run** loader, main controller, capture URL/context tests and module/dependency guards.
- [ ] **Step 5: Commit** `feat: trace Batch navigation and readiness lifecycle`.

### Task 5: Instrument capture and renderer evidence

**Files:**
- Modify: `js/shared/grafana-panel-capture.js` — accept optional diagnostic callback; emit capture/layout/crop/export/failure events and include final context snapshot on success as well as failure.
- Modify: `pages/batch/batch-operation-controller.js` — pass job context and merge capture events into the journal while preserving `failureDiagnostics`.
- Test: `test/batch_diagnostic_capture_behavior.js`

**Interfaces:**
- `captureGrafanaPanelImage({ ..., onDiagnostic, onEvent })`; existing callers remain valid without `onEvent`.
- Events contain no image data, only coordinates, sizes, DPR, status, stage and bounded DOM/data summary.

- [ ] **Step 1: Write failing tests** for capture start, layout status, crop geometry, PNG export, saved result and failure stages.
- [ ] **Step 2: Run** the targeted test; expected failure because event callback is absent.
- [ ] **Step 3: Implement** event callbacks around existing `reportFailure`, `waitForStableLayout`, capture and crop paths; keep cleanup in `finally`.
- [ ] **Step 4: Run** capture tests and full Batch unit subset.
- [ ] **Step 5: Commit** `feat: trace Batch capture lifecycle`.

### Task 6: Runtime snapshot coverage and release verification

**Files:**
- Modify: `test/batch_report_manifest_behavior.js` and relevant Batch tests to verify no secrets/request bodies in journal.
- Modify: `docs/architecture.md` and `docs/roadmap.md` only if the final owner/setting contract differs from existing documentation.
- Build: `dist/batch-versions/DashBridge-2.4.4.zip` via `scripts/build-release.ps1`.

- [ ] **Step 1: Run** all targeted tests, module boundaries, dependency contracts and `git diff --check`.
- [ ] **Step 2: Run** `$env:DASHBRIDGE_PYTHON='C:\Users\Vanya\AppData\Local\Programs\Python\Python314\python.exe'; & 'C:\Program Files\nodejs\npm.cmd' run test:all` outside sandbox.
- [ ] **Step 3: Run** `gitnexus analyze --index-only`, `gitnexus detect-changes -r 'D:\Work\Automation\DashBridge'` and upstream impact for the new journal owner and modified loader/capture symbols.
- [ ] **Step 4: Build and inspect ZIP`: verify root `manifest.json`, `pages/batch/batch.html`, `batch-debug.jsonl` support and 219+ release entries.
- [ ] **Step 5: Commit** final implementation and release metadata only after fresh verification output is clean.

