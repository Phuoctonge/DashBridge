# Dynamic Grafana Legend Columns Implementation Plan

> **For agentic workers:** Execute the tasks sequentially with tests and checkpoints.

**Goal:** Build panel-scoped legend column settings that discover real Grafana legend columns, compute Last from raw series, and apply only enabled columns in direct Grafana and DashBridge.

**Architecture:** MAIN runtime owns raw series extraction and legend presentation. The settings modal requests column metadata from the selected panel, stores a bounded name-to-boolean map, and sends it with panel tools. A dedicated helper computes Last and other supported aggregates without mutating chart series.

**Tech Stack:** MV3 classic scripts, Grafana MAIN-world runtime, DashBridge postMessage bridge, Node tests, Python Playwright persistent profile.

**Spec:** User request and live Grafana DOM contract captured by Python Playwright on 2026-09-13.

## Global Constraints

- Read architecture, permission-map, development-guide, and module-design before implementation.
- MAIN runtime remains the owner of Grafana raw data and renderer state.
- Direct Grafana and DashBridge use one shared contract.
- New handwritten modules stay below 700 lines and 64 KiB.
- Run module boundaries, dependency contracts, syntax/tests, and live Playwright verification.

---

### Task 1: Contract and schema

**Files:** `js/shared/local-state-schema.js`, `js/content/grafana-panel-tools.js`, `pages/dashbridge/dashbridge-panel-tools-controller.js`

- [ ] Normalize `legendColumns` as a bounded map of sanitized column names to booleans.
- [ ] Preserve unknown discovered names and default them to enabled; default `Last` disabled.
- [ ] Include the map in every `applyPanelTools` path and persistence comparison.
- [ ] Add behavior coverage for round-trip normalization and unknown names.

### Task 2: Raw legend statistics helper

**Files:** Create `js/content/grafana-legend-columns.js`; modify `js/shared/grafana-runtime-manifest.js`

- [ ] Expose `create({ findUPlot, getFlotPlot, getLegendTables })` and `compute({ root, columns })`.
- [ ] Read uPlot/Flot raw series without changing chart data.
- [ ] Match rows by stable legend label, compute finite `last`, and return bounded cells.
- [ ] Add cleanup-free pure behavior tests and register dependency before legend visuals.

### Task 3: Dynamic discovery bridge

**Files:** `js/content/grafana-panel-tools.js`, `pages/dashbridge/dashbridge-panel-tools-controller.js`, `pages/dashbridge/dashbridge-iframe-message-controller.js`, `pages/dashbridge/dashbridge.js`

- [ ] Return only legend-table headers from MAIN `getPanelLegendColumns`.
- [ ] Correlate request IDs and current iframe/panel identity.
- [ ] Populate modal controls from discovered names and preserve saved values.
- [ ] Reject stale responses and cap header count/length.

### Task 4: Renderer integration

**Files:** `js/content/grafana-visual-engine.js`, `js/content/grafana-legend-visuals.js`, `js/content/grafana-panel-tools.js`

- [ ] Apply computed cells before legend table presentation.
- [ ] Reapply after Grafana remount through the existing owned observer lifecycle.
- [ ] Keep chart/tooltip raw series intact and provide a safe no-op fallback.
- [ ] Verify direct Grafana and DashBridge paths.

### Task 5: Verification and documentation

**Files:** relevant tests and `docs/architecture.md`

- [ ] Add regression tests for Mean/Max/Min/Total subsets and Last.
- [ ] Run module/dependency guards, syntax checks, Node/Python runner, and diff check.
- [ ] Run Python Playwright against the persistent authorized profile and record real panel headers.
- [ ] Update architecture owner/contract text and commit each coherent task.
