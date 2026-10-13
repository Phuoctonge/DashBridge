# DashBridge Live Regression Gate Implementation Plan

> **Статус на 2026-10-13:** Предложение, не завершённый release gate. Действующий Test Runner и opt-in `test/live` уже существуют, но предложенные `scripts/run-release-gate.js`, `scripts/check-live-coverage.js`, capability registry и Unified Dashboard gate отсутствуют. Не выполнять нижние команды как существующие CLI и не считать отдельные live-проверки доказательством полного gate.
> Действующие контракты: [архитектура](../../architecture.md), [разработка](../../development-guide.md); актуальные остатки: [roadmap](../../roadmap.md). Нижние шаги и команды сохранены как исходный план; перед продолжением сверять их с кодом и текущими владельцами.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one automated release gate that discovers capability coverage, selects verified Grafana panels, and runs the full DashBridge extension across direct Grafana and Unified Dashboard surfaces.

**Architecture:** Extend the existing Test Runner rather than creating a second scenario owner. A frozen capability registry describes public commands and invariants; a panel inventory/resolver supplies exact `viewPanel` targets; an external Playwright gate orchestrates check/fast/targeted/full modes and a Unified Dashboard pass. Production modules remain the only behavior implementation.

**Tech Stack:** Chrome MV3, classic-script extension pages, Playwright Chromium, Node.js 24, existing `pages/test-runner` suite/core/diagnostics, existing DashBridge report test runner, GitNexus, Node/Python behavior runners.

**Spec:** `docs/superpowers/specs/2026-09-15-live-regression-gate-design.md`

## Global Constraints

- Read `docs/architecture.md`, `docs/development-guide.md`, `docs/module-design.md` before implementation.
- Do not modify current unrelated dirty files or `vendor/jszip.min.js`.
- Use `apply_patch` for edits and separate logical commits.
- Production code requires a failing behavior test before implementation.
- Keep live tests outside production release paths; `test/live` never enters release ZIP.
- Use bundled Playwright Chromium for unpacked MV3 loading; do not move the authorized profile.
- A missing auth, DNS, VPN, worker, panel capability or stale mapping is `BLOCKED`, not `PASS`.
- Every apply path has reset/cleanup in `finally` and bounded evidence.

---

### Task 1: Capability registry contract

**Files:**
- Create: `pages/test-runner/test-runner-capability-registry.js`
- Test: `test/test_runner_capability_registry_behavior.js`
- Modify: `pages/test-runner/test-runner.html` to load the registry before core
- Modify: `docs/architecture.md` capability ownership table

**Interfaces:**
- Produces `globalThis.DashBridgeCapabilityRegistry.list()` returning a frozen descriptor array.
- Produces `get(id)` and `forMode(mode, surface)` with deterministic ordering.
- Descriptor fields are `id`, `owner`, `surfaces`, `roles`, `renderers`, `modes`, `apply`, `reset`, `required`, `invariants`, `evidence`, `risk`.

- [ ] Write a failing test for deterministic registry ordering, duplicate ID rejection, missing owner/surface rejection and Fast/Full filtering.
- [ ] Run `node test/test_runner_capability_registry_behavior.js` and confirm it fails because the facade does not exist.
- [ ] Implement the frozen registry facade with the existing high-risk capabilities first: legend, threshold, RAM, CPU/vCPU, settings, time/iframe and capture/report.
- [ ] Run the targeted behavior test and confirm PASS.
- [ ] Run `node scripts/check-module-boundaries.js`, `node scripts/check-dependency-contracts.js` and `git diff --check`.
- [ ] Commit only the registry, loader, test and architecture contract.

### Task 2: Panel inventory and verified role mapping

**Files:**
- Create: `pages/test-runner/test-runner-panel-inventory.js`
- Create: `test/live/panel-role-map.json`
- Test: `test/test_runner_panel_inventory_behavior.js`
- Modify: `pages/test-runner/test-runner-probe.js`
- Modify: `pages/test-runner/test-runner-core.js`

**Interfaces:**
- Produces `DashBridgePanelInventory.collect()` with bounded `{ dashboardUid, panels[] }`.
- Produces `DashBridgePanelInventory.resolveRole(inventory, role, mapping)` returning `{ panelId, verified, reason }`.
- `panel-role-map.json` keys by normalized host and dashboard UID and stores role, panel ID, expected title/type.

- [ ] Write failing tests for nested row panels, `panel-N` normalization, stale title/type, missing legend/series and deterministic role selection.
- [ ] Run the targeted behavior test and confirm the resolver fails on missing facade/stale mapping.
- [ ] Implement inventory extraction without copying Grafana calculations; use API metadata plus bounded DOM facts from the existing probe.
- [ ] Add explicit mappings for the currently authorized dashboards: KNS visual/threshold candidates and mon-dc visual `21`, CPU `2`, Load Average `18`, RAM `6`, capture `40`, pending capability verification.
- [ ] Run targeted tests, dependency contracts and module boundaries.
- [ ] Commit inventory, map and probe integration separately from the registry.

### Task 3: Force exact panel targets in direct Grafana suite

**Files:**
- Test: `test/test_runner_panel_target_behavior.js`
- Modify: `pages/test-runner/test-runner-core.js`
- Modify: `pages/test-runner/test-runner-suite.js`
- Modify: `scripts/run-live-grafana-e2e.js` argument parsing

**Interfaces:**
- External runner accepts `--panel-map <path>` and passes verified role targets to the extension page.
- Core opens `viewPanel=<numericId>` for each capability role and records the verified panel context in every result.

- [ ] Write failing tests proving that a visual scenario never falls back to the first canvas when a role mapping is present, and stale mapping returns `BLOCKED`.
- [ ] Run targeted tests and confirm current first-panel behavior fails the new assertions.
- [ ] Implement exact target propagation while retaining legacy URL-only behavior as an explicit `auto` mode.
- [ ] Add a negative assertion that a failed capability selection cannot execute an apply command.
- [ ] Run targeted tests, then the existing live behavior suite.
- [ ] Commit direct panel targeting.

### Task 4: Unified Dashboard surface adapter

**Files:**
- Create: `pages/test-runner/unified-dashboard-gate.js`
- Test: `test/unified_dashboard_release_gate_behavior.js`
- Modify: `pages/dashbridge/dashbridge-report-test-runner.js` only through its public facade
- Modify: `pages/test-runner/test-runner.html` UI status/report wiring

**Interfaces:**
- Produces `DashBridgeUnifiedDashboardGate.run({ profile, environments, mode, signal })` returning bounded surface results.
- Uses existing `DashBridgeReportTestRunner`, `dashbridge.js` profile/panel controllers and iframe message controller; it cannot dispatch arbitrary DOM events or call private functions.
- Each surface result records panel add/load, settings, time, capture/report and cleanup statuses.

- [ ] Write failing tests for profile setup, iframe readiness, apply/reset, stale iframe response and cleanup after abort.
- [ ] Run targeted tests and confirm the public gate facade is absent.
- [ ] Implement the adapter using existing public commands and exact origin/source guards.
- [ ] Add the negative path where one iframe fails while other panels and profile state remain intact.
- [ ] Run targeted Unified Dashboard behavior tests and existing DashBridge controller tests.
- [ ] Commit the surface adapter without moving renderer logic into the test runner.

### Task 5: Release-gate orchestrator

**Files:**
- Create: `scripts/run-release-gate.js`
- Test: `test/release_gate_behavior.js`
- Modify: `package.json` with `test:release-gate`
- Modify: `scripts/setup-grafana-e2e-profile.js` only for bundled Chromium/profile checks if required

**Interfaces:**
- CLI accepts `--grafana-one`, optional `--grafana-two`, `--panel-map`, `--mode check|fast|targeted|full`, `--tests`, and `--evidence failures|all|off`.
- Returns exit `0` only when all required surfaces pass; returns `2` for blocked environment and `1` for functional failure.
- Writes `test-results/release-gate.json` with bounded summary and links to per-run reports.

- [ ] Write failing tests for argument validation, sequential environment ordering, blocked-vs-failed exit codes, profile lock release and bounded report fields.
- [ ] Run the targeted CLI behavior test and confirm missing orchestrator behavior.
- [ ] Implement orchestration: check → direct Grafana → Unified Dashboard → aggregate report, with one profile lock and `finally` cleanup.
- [ ] Add targeted mode selection from explicit `--tests` first; do not infer arbitrary test IDs from text.
- [ ] Run targeted tests and then a real `--mode check` on both authorized Grafana using Playwright Chromium.
- [ ] Commit the release-gate command and report schema.

### Task 6: Automatic coverage audit and Git impact selection

**Files:**
- Create: `scripts/check-live-coverage.js`
- Test: `test/live_coverage_audit_behavior.js`
- Modify: `scripts/check-dependency-contracts.js` only if a reusable read-only API is needed
- Modify: `docs/roadmap.md` with uncovered owners and accepted limitations

**Interfaces:**
- `check-live-coverage.js --registry --changed` reports `covered`, `uncovered`, `stale`, `blocked`.
- It maps descriptor owners to `git diff`, dependency contracts and optional GitNexus upstream impact.
- It never declares semantic coverage from mere string presence; an invariant and reset are required.

- [ ] Write failing tests for missing owner, missing surface, missing reset, stale command ID and changed-owner targeted selection.
- [ ] Run the audit test and confirm expected failures.
- [ ] Implement bounded static audit and changed-owner report; GitNexus remains advisory and cannot suppress string-contract checks.
- [ ] Add release-gate refusal for `uncovered` production owners in Full mode.
- [ ] Run audit, guards and full Node/Python tests.
- [ ] Commit coverage audit separately.

### Task 7: Evidence, performance and release documentation

**Files:**
- Test: `test/release_gate_evidence_behavior.js`
- Modify: `test/live/evidence-writer.js` and its behavior test only if shared bounded behavior is missing
- Modify: `docs/development-guide.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`

- [ ] Write failing tests for redaction, bounded evidence, screenshot policy, per-capability deadline and report aggregation.
- [ ] Implement only missing evidence/report behavior; reuse existing OPFS spool and diagnostics owners.
- [ ] Document bundled Playwright Chromium, profile lifecycle, direct/Unified surfaces, commands, statuses and release thresholds.
- [ ] Run documentation links, diff check, lint, dependency/module guards and all offline runners.
- [ ] Commit docs/evidence changes.

### Task 8: Live verification and release-gate acceptance

**Files:**
- No production changes; use `test-results/release-gate.json` and live reports.

- [ ] Run `node scripts/check-module-boundaries.js`.
- [ ] Run `node scripts/check-dependency-contracts.js`.
- [ ] Run `npm run lint`.
- [ ] Run `node test/run-all-tests.js` with `DASHBRIDGE_PYTHON` explicitly set.
- [ ] Run all `test/live/**/*_behavior.js` sequentially.
- [ ] Run `npm run test:browser` with bundled Playwright Chromium.
- [ ] Run release-gate `check` on both authorized Grafana.
- [ ] Run Fast direct + Unified Dashboard and inspect every FAIL/SKIP/BLOCKED reason.
- [ ] Run Full before release and verify reset/cleanup, not just PASS counts.
- [ ] Do not claim completion while any required capability is `UNCOVERED`, stale panel mapping is `BLOCKED`, or either surface was not executed.
