# Замена изображений в отчёте Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить отдельную extension page «Замена изображений в отчёте», которая импортирует Batch ZIP, сопоставляет PNG с блоками живого Confluence-отчёта, позволяет выбрать частичную замену или явное добавление и сохраняет результат с post-save verification.

**Architecture:** Batch остаётся владельцем capture и ZIP. Новая extension page владеет archive parsing, report snapshot, matching, immutable change plan, preview и operation lifecycle. Isolated Confluence bridge выполняет узкие read/prepare/save/verify команды на текущей разрешённой вкладке; service worker получает новый broker только если discovery подтвердит необходимость.

**Tech Stack:** Chrome MV3 classic scripts, vanilla DOM, JSZip, Chrome runtime messaging, existing theme/modal/progress helpers, Node behavior tests and Playwright browser smoke.

**Spec:** `docs/superpowers/specs/2026-09-18-report-image-replacement-design-ru.md`

## Global Constraints

- Живая страница Confluence является рабочим объектом; HTML/`.doc`/PDF — только reference fixtures.
- Batch и новая страница имеют независимые lifecycle/state machines.
- Новые JS-модули целятся в 300–500 строк и не превышают 700 строк/64 КиБ без исключения.
- Внешний текст выводится через DOM properties/`textContent`; `innerHTML` для недоверенных данных запрещён.
- ZIP, manifest, изображения, messages и imports имеют schema, path-traversal guard и bounded caps.
- Apply требует user action, immutable plan, page identity/baseline check и post-save verification.
- Старые attachments не удаляются в первой версии.
- Перед кодом читать архитектурные документы из `AGENTS.md`; после кода обновлять владельцев/permissions при изменении контракта.
- Не изменять `vendor/jszip.min.js` и не затирать существующие пользовательские изменения.

---

### Task 1: Discovery seam and launch entry point

**Files:**
- Create: `test/confluence_report_discovery_behavior.js`.
- Modify: `manifest.json` only for required page wiring.
- Modify: `pages/popup/popup.html`, relevant Popup controller.
- Modify: `docs/architecture.md`, `docs/permission-map.md`, `docs/development-guide.md` after actual wiring is known.

**Interfaces:** `DashBridgeConfluenceReportDiscovery` returns `{ok, tabId, documentId, pageIdentity, editorKind, capabilities}` and rejects wrong host, URL, sender, document or unsupported editor.

- [ ] Write failing tests for configured wiki host, HTTP(S)-only URL, page identity, view-only page, unsupported editor and stale document.
- [ ] Add a Popup action opening `pages/confluence-report/confluence-report.html`; it must not mutate Confluence.
- [ ] Implement the minimal read-only discovery seam and keep upload/save unspecified until live browser discovery.
- [ ] Run `node test/confluence_report_discovery_behavior.js` and `node scripts/check-dependency-contracts.js --explain pages/popup/popup.html`.
- [ ] Commit `feat: add report image replacement entry point`.

### Task 2: Version the Batch manifest

**Files:**
- Create: `js/shared/confluence-report-schema.js`.
- Create: `test/confluence_report_schema_behavior.js`.
- Modify: `pages/batch/batch-operation-controller.js`.
- Modify: `pages/batch/batch-main-run-controller.js`.
- Modify: `pages/batch/batch-series-run-controller.js`.
- Modify: relevant existing Batch behavior tests.

**Interfaces:**

```js
DashBridgeConfluenceReportSchema.normalizeManifest(raw) -> NormalizedManifest
DashBridgeConfluenceReportSchema.logicalKey(record) -> String
CaptureRecord = { file, testKey, testTitle, metricGroup, metric, panelId, panelTitle, from, to, sha256, occurrence }
```

- [ ] Test v2 `captures[]`, legacy fallback, normalization, stable keys, duplicate occurrences and invalid paths.
- [ ] Implement schema facade retaining absent metadata as `null` and rejecting unsafe paths.
- [ ] Add `schemaVersion: 2` and per-capture records without changing current PNG names or ZIP paths.
- [ ] Run schema, Batch main/Series tests, module boundaries and dependency contracts.
- [ ] Commit `feat: add report capture manifest metadata`.

### Task 3: Bounded ZIP import and operation state

**Files:**
- Create: `pages/confluence-report/confluence-report-zip.js`.
- Create: `pages/confluence-report/confluence-report-state.js`.
- Create: `test/confluence_report_zip_behavior.js`.

**Interfaces:**

```js
DashBridgeConfluenceReportZip.create({ JSZip, schema, budget }).load(file, signal) -> Promise<ArchiveSnapshot>
ArchiveSnapshot = { fingerprint, manifest, sources: Map<path, {path, blob, bytes, sha256}> }
```

- [ ] Test path traversal, absolute paths, unsupported types, duplicate paths, caps, hash mismatch, abort and cleanup.
- [ ] Implement injected JSZip parser with validation before retaining image bytes and bounded object URL lifetime.
- [ ] Implement run IDs and states `idle`, `archive-loaded`, `scanning`, `ready`, `planning`, `preview`, `applying`, `verifying`, `completed`, `cancelled`, `partial`, `failed`.
- [ ] Run targeted test and commit `feat: add bounded report archive import`.

### Task 4: Standalone page and accessible UI

**Files:**
- Create: `pages/confluence-report/confluence-report.html`.
- Create: `pages/confluence-report/confluence-report.css`.
- Create: `pages/confluence-report/confluence-report.js`.
- Create: `pages/confluence-report/confluence-report-ui.js`.
- Create: `test/confluence_report_ui_behavior.js`.

**Interfaces:** `DashBridgeConfluenceReportUI.create({root, state, actions})` exposes `renderDiscovery`, `renderArchive`, `renderTargets`, `renderPlan`, `renderResult`, `destroy`.

- [ ] Test file selection, disabled Apply, status badges, filters, mapping rows, keyboard focus, Escape/cancel, both themes and pagehide cleanup.
- [ ] Add explicit script order: theme, shared helpers, schema/zip/state, UI/controller; no inline handlers.
- [ ] Render all external text safely; create/revoke bounded old/new preview object URLs; reuse modal accessibility and progress helpers.
- [ ] Run browser smoke and commit `feat: add report image replacement page`.

### Task 5: Pure scanner, matcher and change plan

**Files:**
- Create: `pages/confluence-report/confluence-report-scanner.js`.
- Create: `pages/confluence-report/confluence-report-matcher.js`.
- Create: `pages/confluence-report/confluence-report-plan.js`.
- Create: `test/confluence_report_scanner_behavior.js`.
- Create: `test/confluence_report_matcher_behavior.js`.
- Create: `test/confluence_report_plan_behavior.js`.

**Interfaces:**

```js
Scanner.fromStorageHtml(html, context) -> ReportSnapshot
Scanner.fromEditorTree(tree, context) -> ReportSnapshot
Matcher.match(snapshot, archive, selection) -> MatchResult[]
Plan.create({pageIdentity, archive, snapshot, matches}) -> ReportChangePlan
```

- [ ] Add fixtures with two tests, repeated CPU/disk captions, duplicate groups and one missing image.
- [ ] Test heading hierarchy, caption/image association, occurrence numbering, malformed markup, exact/normalized/ambiguous/missing matches, one metric across ten tests, one source to explicit multiple targets, replace/add and stale fingerprint.
- [ ] Implement pure scanner and matcher using `testKey + metricGroup + metric + occurrence`; never auto-apply ambiguous/missing candidates.
- [ ] Implement immutable plan and dry-run counts; run targeted tests and commit `feat: match report images by context`.

### Task 6: Live Confluence read-only adapters

**Files:**
- Create: `js/content/confluence-report-bridge.js`.
- Create: `js/content/confluence-report-editor-adapters.js`.
- Create: `test/confluence_report_bridge_behavior.js`.
- Create: `test/confluence_report_editor_adapter_behavior.js`.
- Modify: page controller and manifest only if the discovered editor requires static injection.

**Interfaces:**

```js
Bridge.create({window, extensionOrigin, pageIdentity}) -> {discover(signal), readSnapshot(signal), destroy()}
Adapters.discover(document) -> {kind, readSnapshot(), prepareEdit(plan), save(), verify(plan)}
```

- [ ] Complete live browser discovery on an authorized test page: editor kind, page identity, upload route, save control, frame boundaries and failure states.
- [ ] Write tests for exact origin/source, request IDs, wrong host, stale document, view page, unsupported editor and cleanup.
- [ ] Implement only the discovered read-only adapter first; return normalized editor tree and do not mutate Confluence.
- [ ] Run browser read-only check and commit `feat: scan live Confluence report structure`.

### Task 7: Apply, save and verification

**Files:**
- Create: `pages/confluence-report/confluence-report-apply.js`.
- Create: `test/confluence_report_apply_behavior.js`.
- Create: `test/confluence_report_save_race_behavior.js`.
- Modify: editor adapter and `js/background.js` only if Phase 0 proves a privileged attachment broker is required.

**Interfaces:** `DashBridgeConfluenceReportApply.create({bridge, zip, state, progress})` returns `{apply(plan, signal), cancel(), destroy()}`. Result statuses are `replaced`, `added`, `not-found`, `ambiguous`, `source-missing`, `upload-failed`, `save-failed`, `stale-page`, `verification-failed`, `skipped`.

- [ ] Test one-of-ten replacement, selected metric across tests, explicit add, source reuse, stale page/baseline, upload/save failure, partial result, cancel, retry and verification mismatch.
- [ ] Implement preflight identity/baseline/hash validation; reject unresolved statuses before upload.
- [ ] Implement upload → prepare selected nodes → native Save → rescan verification, preserving old attachments and checking run ID/AbortSignal at every await.
- [ ] Distinguish uploaded-but-not-saved from saved-but-not-verified; run targeted tests and commit `feat: apply and verify selected report image changes`.

### Task 8: Launch integration, docs and full verification

**Files:**
- Modify: Popup and Batch launchers; Batch only opens the separate page and never owns report state.
- Modify: `pages/confluence-report/confluence-report.js` for progress/retry.
- Modify: architecture, permission, development and roadmap docs with actual supported editor scope.
- Create: `test/smoke_confluence_report.py`, `test/confluence_report_launch_behavior.js`.

- [ ] Test launch actions, explicit user gesture, no ZIP bytes in query strings, pagehide cancel, progress fallback and no duplicate run.
- [ ] Add Popup and optional post-download Batch launch with confirmation feedback.
- [ ] Run module boundaries, dependency contracts, documentation links and `git diff --check`.
- [ ] Run full suite with explicit Python: `$env:DASHBRIDGE_PYTHON='C:\Users\Vanya\AppData\Local\Programs\Python\Python314\python.exe'; & 'C:\Program Files\nodejs\npm.cmd' run test:all`.
- [ ] Run live authorized Confluence acceptance for scan-only, one replacement, one metric across tests, explicit add, reload persistence and manual-edit conflict; report blocked variants honestly.
- [ ] Run `gitnexus analyze --index-only`, classify new actions/selectors/storage keys, run `gitnexus detect-changes`, then rerun guards.
- [ ] Commit `feat: integrate report image replacement workflow`.

## Plan self-review

- **Spec coverage:** manifest, ZIP import, page UI, scanner, matcher, partial replacement, explicit add, live adapter, save/verification, lifecycle, trust boundary, tests and integration are covered by Tasks 1–8.
- **Placeholder scan:** no TBD/TODO steps; unknown editor/upload details are an explicit Phase 0 discovery gate with concrete outputs.
- **Type consistency:** `NormalizedManifest`, `CaptureRecord`, `ArchiveSnapshot`, `ReportSnapshot`, `ReportChangePlan`, bridge and apply facades are named before their consumers.
- **Scope:** saved rules, old-attachment deletion, offline HTML/`.doc` editing and new permissions are excluded from the first implementation.
