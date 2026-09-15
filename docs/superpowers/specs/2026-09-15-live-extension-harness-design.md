# DashBridge Live Extension Harness Design

**Status:** Proposed

**Goal:** Add an opt-in Playwright live harness that runs capability-level scenarios against the real MV3 extension on one or more authenticated Grafana environments and proves command execution, observable result, diagnostics, and cleanup without duplicating production behavior.

## Decisions

Production extension code remains the only source of runtime behavior. The harness owns orchestration, scenario data, observation, assertions, and report writing. It must never reimplement renderer, storage, network interception, or panel logic.

The default test suite remains deterministic and offline. Live tests are explicit, opt-in commands and are skipped when an authenticated profile or target environment is unavailable; unavailable live infrastructure is reported as `blocked`, never as `passed`.

The extension is loaded as the real unpacked MV3 extension in a persistent Playwright Chromium context. A test-only bridge is enabled only for a dedicated Playwright launch marker and a session-scoped capability token. The bridge is fail-closed when the marker/token is absent and adds no production permissions.

## Runtime topology

```text
scenario manifest
  -> live runner
     -> persistent Chromium context
        -> real DashBridge extension + service worker
        -> Grafana page(s) and iframe(s)
  <- bridge command result
  <- page/iframe/worker/network diagnostics
  <- DOM/renderer/state/cleanup assertions
  -> bounded JSON evidence report
```

The harness addresses contexts explicitly: extension page, service worker, isolated content world, Grafana MAIN world, and DashBridge iframe. A command includes `commandId`, target tab/frame, capability name, and bounded payload. Every result includes accepted, executed, observable, and cleanup phases.

## Bridge contract

The bridge is test-only and session-scoped. It exposes no arbitrary JavaScript evaluation and no generic function-name dispatch. It accepts a fixed capability catalog whose handlers call existing public facades, message actions, or DOM events.

```js
{
  action: 'dashbridgeLiveProbe',
  commandId: 'uuid-or-counter',
  capability: 'legend.completeHide',
  operation: 'apply|reset|snapshot',
  panel: { id: '12' },
  args: { series: ['CPU idle'] },
  token: 'session-token'
}
```

The response is correlated by `commandId` and contains only bounded structured data. Unknown capabilities, malformed panels, excessive strings/arrays, missing token, wrong origin/source, or non-live contexts fail closed. The bridge must not expose profile names, URLs, credentials, or arbitrary network bodies in reports.

## Capability passport

Every live capability gets a passport in `test/live/capabilities/*.json` or an equivalent JS module:

- owner and runtime context;
- command and operations;
- required dashboard/panel selectors;
- supported renderer variants;
- preconditions and readiness probe;
- observable success assertion;
- negative/error assertion;
- cleanup invariant;
- evidence fields and caps.

Initial capabilities should cover the highest-risk Grafana paths: legend complete-hide, threshold highlights, RAM conversion, CPU/vCPU capacity, panel settings, time range/iframe synchronization, panel capture, and report snapshot. Extension pages, Batch, Worklog, Jira, Confluence, and Recorder join only with read-only or reversible scenarios.

## Environment matrix

`test/live/environments.json` stores non-secret environment metadata: host, dashboard URLs, expected route, renderer expectations, and profile label. Secrets and auth state remain in the external persistent profile at `%LOCALAPPDATA%\DashBridge\E2E\browser-profile`.

The runner supports one environment, multiple environments sequentially, and independent parallel contexts. A shared persistent profile is never used concurrently. Each scenario declares whether it requires the modern renderer, legacy renderer, iframe, or both.

## Observation and evidence

The harness collects page console messages, page errors, uncaught exceptions, extension service-worker logs, bridge messages, selected network metadata, renderer snapshots, bounded DOM facts, and before/after capability snapshots. It records timestamps, host, dashboard path, tab/frame identity, extension generation, and cleanup status.

Evidence is written under `test-results/live/<run>/<environment>/<scenario>/` as bounded JSON/NDJSON. Screenshots and HTML are opt-in per scenario or failure. Sensitive values are redacted and body capture is disabled by default.

## Safety boundaries

- No live suite runs as part of ordinary offline unit tests.
- No production permission, manifest match, storage schema, or public runtime contract changes solely for testing.
- No test scenario mutates persistent user profiles except through explicitly reversible capability operations.
- Every apply operation has a reset/restore phase; failures still run cleanup in `finally`.
- The bridge is disabled outside the Playwright marker/token session.
- Live failures retain evidence and return a distinct blocked/failed status.

## Rollout

1. Build a read-only launcher and environment/session check.
2. Add diagnostics collectors and bounded report writer.
3. Add bridge handshake and capability catalog without changing default runtime.
4. Implement one end-to-end legend scenario against modern and legacy fixtures/live dashboards.
5. Add multi-step and multi-environment scheduling with exclusive profile locking.
6. Add capability passports incrementally and verify each against existing unit/integration tests.
7. Add opt-in npm commands and CI artifact publication; keep `test:all` deterministic unless live mode is explicitly requested.

## Acceptance criteria

- A live scenario proves command acceptance, actual execution, observable result, and cleanup.
- The same scenario can run against both configured Grafana environments when their preconditions are met.
- Failed commands produce bounded evidence with page, iframe, worker, and network diagnostics.
- The ordinary extension and offline test suites pass unchanged when live mode is disabled.
- No test-only bridge is reachable without the launch marker and session token.
- Adding a capability requires a passport and does not copy production implementation.
