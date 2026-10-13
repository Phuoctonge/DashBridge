# DashBridge Live Extension Harness Implementation Plan

> **Статус на 2026-10-13:** Частично реализован. В `test/live/` есть schema, profile lock, observers, probes, command router, scenario engine и opt-in check/scenario/smoke/matrix; живые сценарии ограничены legend и threshold. Имена предлагаемых файлов, marker/token topology и команды ниже — исходный проект, а не точный контракт текущего launcher. Полный capability catalog и все поверхности не объявляются проверенными.
> Действующие контракты: [архитектура](../../architecture.md), [разработка](../../development-guide.md); актуальные остатки: [roadmap](../../roadmap.md). Нижние шаги и команды сохранены как исходный план; перед продолжением сверять их с кодом и текущими владельцами.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opt-in Playwright harness that executes capability-level scenarios against the real DashBridge MV3 extension on authenticated Grafana environments and records proof of execution, observable outcome, diagnostics, and cleanup.

**Architecture:** Keep production extension behavior unchanged and add orchestration under `test/live`. Load the actual unpacked extension in a persistent Chromium context, use a fail-closed test-only bridge with a fixed capability catalog, and collect bounded evidence from pages, iframes, service worker, network metadata, DOM, and renderer state.

**Tech Stack:** Playwright 1.62, Node.js, Chrome MV3, existing runtime manifest, existing Grafana MAIN/isolated contracts, JSON/NDJSON evidence.

**Spec:** `docs/superpowers/specs/2026-09-15-live-extension-harness-design.md`.

## Global Constraints

- Read `docs/architecture.md`, `docs/permission-map.md`, `docs/development-guide.md`, and `docs/module-design.md` before implementation.
- Do not add production permissions or broad manifest matches for testing.
- Do not duplicate production renderer, storage, network, or lifecycle logic in `test/live`.
- Live mode is opt-in and must never make offline `test:all` depend on network or authentication.
- All live mutations require reversible reset/restore in `finally`.
- Reports are bounded and redact URLs, credentials, profile names, panel IDs, and response bodies unless a scenario explicitly whitelists a safe field.
- Every task ends with targeted tests, dependency checks, and `git diff --check`.

### Task 1: Define live environment and capability schemas

**Files:**
- Create: `test/live/live-schema.js`
- Create: `test/live/environments.example.json`
- Create: `test/live/capabilities/legend-complete-hide.json`
- Test: `test/live/live-schema_behavior.js`

**Interfaces:**
- `validateEnvironment(value) -> normalizedEnvironment`
- `validateScenario(value) -> normalizedScenario`
- `validateCommand(value) -> normalizedCommand`
- `redactEvidence(value) -> boundedValue`

- [ ] Write failing tests for missing host, invalid HTTP(S) URL, oversized args, unknown renderer, duplicate capability names, and valid multi-step scenarios.
- [ ] Implement schema validation with explicit caps and no credential-bearing fields.
- [ ] Add the first legend capability passport with apply, snapshot, reset, renderer variants, and cleanup invariant.
- [ ] Run `node test/live/live-schema_behavior.js` and ESLint.

### Task 2: Build persistent extension launcher and profile lock

**Files:**
- Create: `test/live/live-launcher.js`
- Create: `test/live/profile-lock.js`
- Create: `test/live/live-session-check.js`
- Test: `test/live/live-launcher_behavior.js`
- Modify: `package.json`

**Interfaces:**
- `acquireProfileLock(profileRoot) -> { release }`
- `launchLiveContext({ profileRoot, extensionRoot, headless, marker }) -> { context, extensionId, close }`
- `checkEnvironment(context, environment) -> sessionStatus`

- [ ] Write failing tests for concurrent profile use, missing profile, missing Chromium, extension worker timeout, and clean release after failure.
- [ ] Reuse `scripts/setup-grafana-e2e-profile.js` helpers instead of duplicating profile resolution.
- [ ] Launch the real unpacked MV3 extension with a unique live marker and no additional permissions.
- [ ] Detect `/api/user` 200 vs login/401 and return `blocked` with a reason.
- [ ] Add `npm run test:live:check` as an explicit command.

### Task 3: Add bounded observation collectors

**Files:**
- Create: `test/live/observers/page-observer.js`
- Create: `test/live/observers/worker-observer.js`
- Create: `test/live/observers/network-observer.js`
- Create: `test/live/evidence-writer.js`
- Test: `test/live/live-observers_behavior.js`

**Interfaces:**
- `attachPageObserver(page) -> { snapshot, drain, detach }`
- `attachWorkerObserver(context, extensionId) -> { drain, detach }`
- `attachNetworkObserver(page, policy) -> { snapshot, drain, detach }`
- `writeEvidence(run, evidence) -> reportPath`

- [ ] Write failing tests for page errors, console caps, worker messages, duplicate events, network metadata redaction, and report size limits.
- [ ] Implement collectors with bounded ring buffers and deterministic timestamps/order.
- [ ] Capture no response bodies by default; allow only explicit safe metadata fields.
- [ ] Ensure observer detach is called on success, failure, timeout, and browser close.
- [ ] Run observer tests and `git diff --check`.

### Task 4: Implement fail-closed test-only bridge

**Files:**
- Create: `test/live/bridge/live-bridge.js`
- Modify: `js/content/content.js` only if an existing isolated-world routing hook is required
- Modify: `js/background.js` only if an existing message route must be explicitly allowlisted
- Test: `test/live/live-bridge_behavior.js`
- Test: existing message/origin/security suites

**Interfaces:**
- `createBridge({ token, capabilityCatalog, context }) -> { install, uninstall }`
- Fixed action: `dashbridgeLiveProbe`
- Response action: `dashbridgeLiveProbeResult`

- [ ] Write failing tests for missing marker, invalid token, unknown capability, oversized payload, wrong origin/source, stale command, and reset after exception.
- [ ] Prefer a test-runner extension page plus existing `chrome.runtime.sendMessage` contracts; do not add arbitrary eval or generic function dispatch.
- [ ] Route only fixed catalog names and correlate every response by `commandId`.
- [ ] Ensure bridge is inert in normal extension pages and absent from published behavior without the live marker.
- [ ] Run all origin/message and bridge tests.

### Task 5: Build panel and renderer probes

**Files:**
- Create: `test/live/probes/grafana-panel-probe.js`
- Create: `test/live/probes/renderer-probe.js`
- Create: `test/live/probes/iframe-probe.js`
- Test: `test/live/live-probes_behavior.js`

**Interfaces:**
- `findPanel(page, selector) -> panelHandle`
- `snapshotPanel(panelHandle) -> boundedSnapshot`
- `detectRenderer(panelHandle) -> uplot|flot|unknown`
- `waitForReady(panelHandle, passport) -> readiness`
- `assertRestored(before, after) -> assertionResult`

- [ ] Write failing tests for panel ID/title lookup, virtualized/remounted panels, iframe ownership, uPlot/Flot detection, readiness timeout, and cleanup restoration.
- [ ] Use real DOM/renderer observations only; do not recreate Grafana calculations.
- [ ] Add stable facts: panel identity, renderer kind, visible legend labels, canvas dimensions, selected attributes, and bounded event counters.
- [ ] Run probe tests against fixtures and existing renderer behavior tests.

### Task 6: Add scenario engine and multi-step execution

**Files:**
- Create: `test/live/scenario-engine.js`
- Create: `test/live/scenario-runner.js`
- Create: `test/live/scenarios/legend-complete-hide.js`
- Test: `test/live/scenario-engine_behavior.js`

**Interfaces:**
- `runScenario({ context, environment, scenario, capabilityCatalog }) -> scenarioResult`
- `invokeStep(step) -> commandResult`
- `expectStep(expectation, state) -> assertionResult`
- `cleanupScenario(state) -> cleanupResult`

- [ ] Write failing tests for sequential steps, step timeout, command correlation, failed apply with guaranteed reset, and blocked environment.
- [ ] Implement apply → observe → assert → reset → assert-restored flow for legend complete-hide.
- [ ] Record accepted/executed/observable/cleanup phases distinctly.
- [ ] Make multiple scenarios in one page explicit and reset between capabilities.
- [ ] Run scenario tests and one live check when an authenticated profile is available.

### Task 7: Add environment matrix and reports

**Files:**
- Create: `test/live/environments.json` with non-secret placeholders only, or keep local override outside Git
- Create: `test/live/matrix-runner.js`
- Create: `test/live/report-summary.js`
- Test: `test/live/matrix-runner_behavior.js`
- Modify: `package.json`

**Interfaces:**
- `runMatrix({ environments, scenarios, mode }) -> matrixReport`
- `summarizeReport(report) -> humanSummary`

- [ ] Write failing tests for sequential multi-environment runs, exclusive shared-profile lock, blocked auth, partial matrix failure, and deterministic report ordering.
- [ ] Implement sequential execution for shared profile and optional parallel execution only with distinct profiles.
- [ ] Add `npm run test:live -- --environment ... --scenario ...` and `npm run test:live:all` without changing `test:all`.
- [ ] Write bounded JSON/NDJSON reports and optional screenshots only on failure.
- [ ] Run matrix tests with synthetic environments.

### Task 8: Add capability passports incrementally

**Files:**
- Create/modify: `test/live/capabilities/*.json` and `test/live/scenarios/*.js`
- Test: one capability test per passport

- [ ] Add threshold highlights with renderer-specific assertions and reset.
- [ ] Add RAM conversion and byte-unit restoration.
- [ ] Add CPU/vCPU capacity legend metadata.
- [ ] Add panel settings save/reset and stale-owner failure checks.
- [ ] Add time range/iframe synchronization and stale reply checks.
- [ ] Add panel capture with temporary layout restoration.
- [ ] Add report snapshot and other extension-page capabilities only when read-only/reversible.
- [ ] For each capability run GitNexus impact/context on the invoked production facade and exact string-contract searches before adding bridge routes.

### Task 9: Integrate verification and documentation

**Files:**
- Modify: `docs/development-guide.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`
- Create: `docs/superpowers/reviews/2026-09-15-live-harness-verification.md`

- [ ] Document live commands, profile requirements, blocked semantics, evidence paths, and redaction policy.
- [ ] Run module boundaries, dependency contracts, ESLint, full JavaScript runner, Python 41-test runner, and live check where authorized.
- [ ] Verify ordinary extension packaging does not include test-only bridge or live config.
- [ ] Run `git diff --check`, GitNexus `analyze --index-only`, `detect-changes`, and impact/context on every new production route.
- [ ] Record live environment limitations and renderer coverage in the verification report.
