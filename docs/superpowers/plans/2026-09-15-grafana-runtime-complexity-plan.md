# Grafana Runtime Complexity Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce justified complexity in the three oversized Grafana MAIN modules while preserving their existing lifecycle ownership, trust boundaries, and runtime contracts.

**Architecture:** Keep `grafana-panel-tools.js`, `grafana-panel-data-runtime.js`, and `grafana-legend-visuals.js` as lifecycle owners. Extract only pure transformations, bounded diagnostic/archive helpers, and renderer-independent adapters with frozen facades; do not move observers, wrappers, generations, or cleanup across files.

**Tech Stack:** Chrome MV3 classic scripts, Grafana MAIN world, JavaScript, Node test runner, module-boundary and dependency-contract guards, GitNexus.

**Spec:** `docs/architecture.md`, `docs/module-design.md`, `docs/development-guide.md`, and `scripts/module-size-budgets.json`.

## Global Constraints

- Read `docs/architecture.md`, `docs/module-design.md`, and `docs/development-guide.md` before editing.
- Preserve classic-script load order and all documented globals, CustomEvents, message actions, storage keys, and DOM selectors.
- Keep state, observers, wrappers, generations, timers, and cleanup with their current lifecycle owner.
- New handwritten production JavaScript must stay within 700 lines and 64 KiB unless an explicitly justified budget exception is added.
- Run `node scripts/check-module-boundaries.js`, `node scripts/check-dependency-contracts.js`, ESLint, targeted tests, and the full available runner after each extraction.
- Before deleting or moving symbols, run GitNexus `impact`, `context`, `trace`, and exact string-contract searches.

### Task 1: Establish symbol and contract inventory

**Files:**
- Read: `js/content/grafana-panel-tools.js`
- Read: `js/content/grafana-panel-data-runtime.js`
- Read: `js/content/grafana-legend-visuals.js`
- Read: `js/shared/grafana-runtime-manifest.js`
- Read: `scripts/module-size-budgets.json`
- Test: existing `test/*grafana*`, `test/*legend*`, and `test/*panel*` suites

**Interfaces:**
- Produces a table of every candidate symbol, its consumers, lifecycle owner, cleanup owner, and exact string contracts.

- [ ] Run GitNexus `context` and `impact --direction upstream` for actual exported globals/facades, not filenames.
- [ ] Run exact `rg` searches for each global, event, selector, and runtime-manifest entry.
- [ ] Classify candidates as pure/stateless, adapter, or lifecycle-owned.
- [ ] Record candidates in the plan review notes before changing code.

### Task 2: Extract pure panel-data transformations

**Files:**
- Create: `js/content/grafana-panel-data-transforms-runtime.js`
- Modify: `js/content/grafana-panel-data-runtime.js`
- Modify: `js/shared/grafana-runtime-manifest.js`
- Test: existing panel data transform/interceptor tests; add focused behavior coverage only for moved public functions

**Interfaces:**
- Produces frozen `window.DashBridgeGrafanaPanelDataTransformsRuntime` with pure functions for request-body parsing, target query matching, response workspace creation/commit, and bounded series extraction.
- Consumes existing `DashBridgeGrafanaVisualEngine`, `DashBridgeGrafanaPanelDefinition`, `DashBridgeGrafanaCpuCapacityFilter`, and unit APIs through explicit dependency arguments.

- [ ] Write regression tests that compare old and new outputs for dashboard, iframe, variable-only, mixed, and hostile payloads.
- [ ] Move only functions with no observer, wrapper, timer, generation, or DOM ownership.
- [ ] Replace internal calls with the frozen facade and keep interceptor installation/cleanup in `grafana-panel-data-runtime.js`.
- [ ] Update manifest order so the new dependency loads before its consumer.
- [ ] Run targeted data-runtime tests and dependency guard.

### Task 3: Extract bounded diagnostics/archive helpers

**Files:**
- Create: `js/content/grafana-panel-data-diagnostics.js`
- Modify: `js/content/grafana-panel-data-runtime.js`
- Modify: `scripts/module-size-budgets.json`
- Test: diagnostic archive, payload cap, request correlation, and cleanup tests

**Interfaces:**
- Produces `window.DashBridgeGrafanaPanelDataDiagnostics.create({ limits, emit })` returning `{ beginRequest, archiveRequest, archiveResponse, completeRequest, snapshot, clear }`.
- The runtime remains the only owner of fetch/XHR wrappers and generation invalidation; diagnostics receives events and bounded payloads only.

- [ ] Add failing tests for bounded request/response retention and clear-on-owner-stop.
- [ ] Implement the helper with hard caps and no DOM/Chrome dependencies.
- [ ] Wire the runtime to the helper without changing event names or diagnostic schema.
- [ ] Re-run all panel data tests and module-size checks.

### Task 4: Extract pure legend layout and naming adapters

**Files:**
- Create: `js/content/grafana-legend-model.js`
- Modify: `js/content/grafana-legend-visuals.js`
- Modify: `js/shared/grafana-runtime-manifest.js`
- Test: legend selection, naming, layout, Flot/uPlot adapter tests

**Interfaces:**
- Produces frozen `window.DashBridgeGrafanaLegendModel` with pure series-name normalization, visibility matching, layout calculations, and palette selection.
- `grafana-legend-visuals.js` retains renderer lookup, observers, remount handling, and cleanup.

- [ ] Add regression tests for duplicate names, complete-hide allowlists, empty input, and renderer-specific layout values.
- [ ] Move only pure calculations and keep all DOM mutation and observer registration in the owner.
- [ ] Update manifest order and run legend/visual tests.

### Task 5: Reduce panel-tools facade duplication without moving lifecycle

**Files:**
- Create: only a focused adapter file if Task 1 proves an independent pure responsibility; otherwise modify in place
- Modify: `js/content/grafana-panel-tools.js`
- Modify: `scripts/module-size-budgets.json`
- Test: panel tools, menu, capture, threshold, settings, and cleanup suites

**Interfaces:**
- Preserve the existing `DashBridgeGrafanaPanelTools` facade and all installer/stop behavior.
- Any extracted facade must expose explicit `create/deactivate` or pure-function APIs and must not own state already held by panel-tools.

- [ ] Use GitNexus impact/context and exact searches before each symbol move.
- [ ] Remove only duplicate proxy wrappers or unreachable compatibility branches confirmed by tests and contract search.
- [ ] Keep panel capture, menu, threshold, and data-runtime lifecycle registration in panel-tools.
- [ ] Run targeted panel-tools suites after each small extraction.

### Task 6: Resolve dependency advisory and budgets

**Files:**
- Modify: `pages/dashbridge/dashbridge-frame-load-controller.js`
- Modify: `js/content/grafana-iframe.js`
- Modify: `test/grafana_frame_location_probe_behavior.js` or add a focused dependency-contract fixture
- Modify: `scripts/module-size-budgets.json` only if residual size is intentionally justified
- Modify: `docs/architecture.md` if ownership or load order changes

**Interfaces:**
- Preserve `dashbridgeInspectLocation` action, exact origin/source checks, request correlation, timeout, and cleanup.

- [ ] Add an explicit static contract marker or test fixture linking producer and consumer.
- [ ] Run dependency contracts and confirm the advisory is gone or documented as a deliberate dynamic edge.
- [ ] Set no-growth budgets only after extraction and explain any remaining exception by lifecycle ownership.

### Task 7: Full verification and review artifact

**Files:**
- Modify: `docs/architecture.md` only for factual ownership/load-order changes
- Create: `docs/superpowers/reviews/2026-09-15-grafana-runtime-complexity-review.md`

- [ ] Run module boundaries, dependency contracts, ESLint, `node test/run-all-tests.js`, Python smoke tests with `DASHBRIDGE_PYTHON`, and required browser smoke checks.
- [ ] Re-run GitNexus `analyze --index-only`, `detect-changes`, `impact`, and `context` for moved symbols.
- [ ] Compare generated/runtime script order and verify no duplicate observers, wrappers, or globals.
- [ ] Record remaining risks, skipped live checks, and exact command outputs in the review artifact.

