# Batch panel readiness and capture reliability Implementation Plan

> **Статус на 2026-10-13:** Реализован основной Batch navigation/readiness/capture путь; позднейшие уточнения: SVG axes-only отклоняются (`8188919`), populated native Table принимается (`a2de993`), Series ждёт commit текущей навигации (`7dbf2b4`), compact Table geometry удерживается до reparenting (`efaa0fa`, `6ad4460`). Ordinary readiness требует подтверждения известной визуализации, а не одной outer geometry. Полная live-матрица неизвестных плагинов не заявляется.
> Действующие контракты: [архитектура](../../architecture.md), [разработка](../../development-guide.md); актуальные остатки: [roadmap](../../roadmap.md). Нижние шаги и команды сохранены как исходный план; перед продолжением сверять их с кодом и текущими владельцами.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Batch accept Grafana URL canonicalization, wait for actual panel rendering, and distinguish readiness from screenshot failure without changing Direct Grafana or DashBridge behavior.

**Architecture:** Keep navigation/readiness in `pages/batch/batch-panel-loader.js`. Apply one tolerant document-identity policy in both the loader and `js/shared/grafana-panel-capture.js`. Ordinary panels use bounded DOM/geometry readiness; transform and Series panels retain data-specific evidence. Existing Main/Series contracts remain compatible.

**Tech Stack:** Manifest V3 Chrome APIs, classic-script JavaScript, `chrome.tabs`, `chrome.scripting`, `captureVisibleTab`, MutationObserver/ResizeObserver, Node behavior tests, Python smoke tests, GitNexus.

**Spec:** `docs/superpowers/specs/2026-10-07-batch-panel-readiness-design.md`

## Global Constraints

- Read `docs/architecture.md`, `docs/development-guide.md`, and `docs/module-design.md` before edits.
- Do not change permissions, runtime manifest, Direct Grafana renderer, DashBridge iframe lifecycle, or `vendor/jszip.min.js`.
- Preserve Main Batch, Series Batch, previous-series switching, panel tools, cancellation, partial ZIP results, and `loadPanel` compatibility.
- Use TDD: each production behavior change starts with a failing test.
- Keep waits bounded and clean timers, observers, listeners, and transient DOM state.

---

### Task 1: Add failing regressions

**Files:** Modify `test/batch_panel_loader_behavior.js`; create `test/batch_panel_capture_url_behavior.js`.

- [ ] Add failing tests for epoch-to-ISO `from/to`, `_t`, reordered parameters, numeric `viewPanel` versus `panel-N`, and wrong-dashboard rejection.
- [ ] Add failing ordinary-panel test with geometry but no interceptor/data evidence.
- [ ] Add failing delayed-mount test and capture test where canonicalized URL must still reach `captureVisibleTab`.
- [ ] Run RED with `C:\Program Files\nodejs\node.exe` against both targeted test files.
- [ ] Commit only the failing tests: `test: reproduce batch URL and readiness regressions`.

### Task 2: Replace strict full-URL equality

**Files:** Modify `pages/batch/batch-panel-loader.js` and `js/shared/grafana-panel-capture.js`; update Task 1 tests.

- [ ] Define private helpers with identical semantics: origin, dashboard route/UID, and normalized panel ID are significant; `from`, `to`, `_t`, query order, and known DashBridge bootstrap parameters are ignored.
- [ ] Replace loader `matchesExpectedUrl` equality with identity comparison; preserve generation, abort, and cleanup.
- [ ] Log `canonicalized-url` for accepted differences and `wrong-document` only for identity mismatch.
- [ ] Replace capture `tab.url !== expectedUrl` rejection with the same identity comparison while retaining active-tab/window and invalidation guards.
- [ ] Run the targeted tests GREEN and commit: `fix: accept canonicalized Grafana URLs during batch capture`.

### Task 3: Separate ordinary and transform readiness

**Files:** Modify `pages/batch/batch-panel-loader.js`; update `test/batch_panel_loader_behavior.js`; inspect `js/content/grafana-dom.js`.

- [ ] Add RED tests for ordinary table/stat/canvas panels without request-journal evidence and transform panels requiring diagnostic completion.
- [ ] Implement ordinary readiness from document completion, matching panel identity, no visible loader, positive rect, renderer/outer-panel geometry, and a short stable settle window.
- [ ] Keep data evidence only for CPU/RAM/vCPU transforms, threshold, and active Series/legend filters.
- [ ] Preserve bounded MutationObserver/ResizeObserver lifecycle; log lookup method, candidate count, loader count, rect, renderer, and final readiness reason without response bodies.
- [ ] Run targeted Node tests plus `smoke_batch_audit_regressions.py` and `smoke_batch_capture.py`; commit: `fix: separate ordinary and transformed batch readiness`.

### Task 4: Distinguish ready, capture, and archive failures

**Files:** Modify `pages/batch/batch-operation-controller.js`, `pages/batch/batch-main-run-controller.js`, `pages/batch/batch-series-run-controller.js`, and `js/shared/grafana-panel-capture.js`; update relevant tests.

- [ ] Add RED tests for ready-then-capture failure and PNG-then-archive failure.
- [ ] Emit additive stages: `[Batch ready]`, `[Batch capture-start]`, `[Batch capture-success]`, `[Batch capture-failed]`, and `[Batch archive-failed]`.
- [ ] Preserve existing truthy geometry result, partial results, and cancellation. Run targeted tests and commit: `fix: distinguish batch readiness capture and archive failures`.

### Task 5: Cross-feature verification and final commit

- [ ] Run GitNexus context/impact for `createBatchPanelLoader`, `captureGrafanaPanelImage`, and changed controller symbols; classify all consumers.
- [ ] Run `node scripts/check-module-boundaries.js` and `node scripts/check-dependency-contracts.js`.
- [ ] Set `$env:DASHBRIDGE_PYTHON` to `C:\Users\Vanya\AppData\Local\Programs\Python\Python314\python.exe` and run `C:\Program Files\nodejs\npm.cmd run test:all`.
- [ ] Verify direct Grafana, DashBridge iframe, uPlot, Flot, ordinary no-data/table/stat, transform, Main Batch, Series Batch, and cancellation where live targets exist.
- [ ] Confirm colleague-like logs no longer show `navigation-rejected` for epoch/ISO canonicalization and never advance before ready, timeout, or cancellation.
- [ ] Run GitNexus `detect-changes`, `git diff --check`, and `git status --short`; create the final commit only after all checks pass.
