# Panel Function Visibility Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CPU/RAM/Load panel controls title-gated only for `mon-dc.mos.ru`, while other Grafana hosts expose the full existing panel-function set, with an explicit global override.

**Architecture:** Add one normalized settings flag, derive a host policy in the shared panel-analysis boundary, and pass that policy through the existing analysis-settings dataset/event into both the DashBridge iframe MAIN modal and direct Grafana MAIN modal. Keep panel IDs for panel state and saved settings, but never use them to classify CPU/RAM/Load semantics.

**Tech Stack:** Manifest V3 Chrome extension, classic scripts, shared JavaScript settings/runtime, Node behavior tests.

**Spec:** `docs/superpowers/specs/2026-10-05-panel-function-visibility-policy-design-ru.md`

## Global Constraints

- Default behavior remains title-gated for `mon-dc.mos.ru` and full-function for other valid Grafana hosts.
- Missing or invalid URLs use the safe title-gated policy.
- Host matching uses parsed URL hostname equality; query parameters and panel IDs do not affect policy.
- Full-function mode changes control visibility only; it does not enable transformations automatically.
- Batch rules, Batch capture lifecycle, and screenshot readiness are out of scope.
- Preserve existing settings keys and import/export behavior.
- Run `node scripts/check-module-boundaries.js`, `node scripts/check-dependency-contracts.js`, targeted tests, and `git diff --check` before the final commit.

---

### Task 1: Add normalized settings flag and Options control

**Files:**
- Modify: `js/shared/grafana-settings.js` — add the default, normalization, and settings key.
- Modify: `pages/options/options.html` — add the user-facing checkbox near the Grafana panel-title settings.
- Modify: `pages/options/options.js` — load, save, and persist the checkbox.
- Modify: `pages/options/options-config-transfer.js` — include the key in config export/import allowlists and normalization.
- Test: `test/grafana_settings_behavior.js` or the existing settings behavior test file discovered before editing.

**Interface:**
- Setting key: `grafanaShowAllPanelFunctions`.
- Type: boolean.
- Default: `false`.
- `normalizeGrafanaSettings()` always returns a boolean for this key.

- [ ] **Step 1: Locate the existing settings defaults, key lists, and Options save/load paths.**

  Run:

  ```powershell
  rg -n "grafanaCpuPanelTitle|grafanaMemPanelTitle|grafanaLoadPanelTitle|SETTINGS_KEYS|normalizeGrafanaSettings" js/shared pages/options test
  ```

- [ ] **Step 2: Add a failing settings test for missing, true, and false values.**

  The test must assert that an absent key normalizes to `false`, an explicit `true` stays `true`, and non-boolean truthy input does not become an unsafe enabled value.

- [ ] **Step 3: Add `grafanaShowAllPanelFunctions: false` to defaults and normalized settings.**

  Keep the existing title keys unchanged and include the new key in the same storage/import/export contract rather than adding a second settings store.

- [ ] **Step 4: Add the Options checkbox and explanatory text.**

  Use the existing native checkbox/switch patterns. The label must state that it shows all panel functions and ignores title restrictions; it must not imply that transformations are automatically enabled.

- [ ] **Step 5: Wire load/save/import/export.**

  Read the checkbox through the normalized config, write a boolean on Save, and include it in the existing config transfer allowlist.

- [ ] **Step 6: Run the focused settings test and syntax checks.**

  ```powershell
  & 'C:\Program Files\nodejs\node.exe' test/grafana_settings_behavior.js
  & 'C:\Program Files\nodejs\node.exe' --check pages/options/options.js
  ```

- [ ] **Step 7: Commit only Task 1 files.**

  ```powershell
  git add js/shared/grafana-settings.js pages/options/options.html pages/options/options.js pages/options/options-config-transfer.js test/grafana_settings_behavior.js
  git commit -m "feat: add full panel functions setting"
  ```

### Task 2: Implement host-aware panel-function policy

**Files:**
- Modify: `js/shared/grafana-panel-analysis.js` — add URL policy helper and policy-aware classification.
- Test: `test/grafana_panel_analysis_behavior.js` — add policy matrix tests.

**Interfaces:**
- `getPanelFunctionVisibilityPolicy({ url, settings }) -> { mode: 'title-gated' | 'all', host: string }`.
- `classifyPanelTitle(value, settings, policy) -> 'cpu' | 'ram' | 'load' | null` for type classification.
- Existing two-argument calls remain valid and use legacy title-gated behavior unless the caller supplies the policy.

- [ ] **Step 1: Write failing policy tests.**

  Cover:

  ```js
  assert.deepStrictEqual(getPanelFunctionVisibilityPolicy({ url: 'https://mon-dc.mos.ru/d/x', settings }), { mode: 'title-gated', host: 'mon-dc.mos.ru' });
  assert.strictEqual(getPanelFunctionVisibilityPolicy({ url: 'https://other.example/d/x', settings }).mode, 'all');
  assert.strictEqual(getPanelFunctionVisibilityPolicy({ url: 'not-a-url', settings }).mode, 'title-gated');
  ```

  Also assert that `evil-mon-dc.mos.ru` is not treated as the protected host and that panel/query changes do not change the mode.

- [ ] **Step 2: Implement parsed-host policy with safe invalid-URL fallback.**

  Use `new URL()` and `.hostname.toLowerCase()`. Do not use substring matching. The explicit settings flag must override the host policy to `all`.

- [ ] **Step 3: Preserve exact title classification in title-gated mode.**

  Keep configured CPU/RAM/Load titles and `baseTitle()` behavior unchanged. In `all` mode, expose a policy result to the modal instead of inventing a semantic type from an arbitrary title.

- [ ] **Step 4: Run panel-analysis tests.**

  ```powershell
  & 'C:\Program Files\nodejs\node.exe' test/grafana_panel_analysis_behavior.js
  ```

- [ ] **Step 5: Commit only Task 2 files.**

  ```powershell
  git add js/shared/grafana-panel-analysis.js test/grafana_panel_analysis_behavior.js
  git commit -m "feat: add host-aware panel function policy"
  ```

### Task 3: Pass policy through content and render the full modal safely

**Files:**
- Modify: `js/content/content.js` — publish the normalized setting and current URL policy through the existing analysis-settings dataset/event.
- Modify: `js/content/grafana-panel-tools.js` — use the policy when opening the direct Grafana panel modal.
- Modify: `pages/dashbridge/dashbridge-panel-tools-controller.js` — use the policy when opening the DashBridge iframe panel modal.
- Modify: `js/shared/grafana-panel-settings-modal.js` — render all existing function groups when policy mode is `all` without auto-enabling state.
- Modify: `pages/dashbridge/dashbridge-report-ui.js` only if its type-specific presentation directly calls the classifier and tests show it needs the same policy.
- Test: `test/grafana_panel_tools_behavior.js`, `test/dashbridge_panel_tools_controller_behavior.js`, or the closest existing modal behavior tests.

**Interfaces:**
- Analysis settings dataset includes the normalized `grafanaShowAllPanelFunctions` flag and a normalized policy mode/host.
- Modal transform rendering accepts `{ panelKind, functionVisibilityPolicy }` while retaining the existing `panelKind` behavior for legacy callers.

- [ ] **Step 1: Trace and test the current analysis-settings publication and modal call sites.**

  Confirm direct Grafana and DashBridge iframe callers both use `classifyPanelTitle`/`transformFields`; do not add a parallel host check in either UI controller.

- [ ] **Step 2: Add failing tests for full-mode rendering.**

  Assert that an arbitrary panel title under `mode: 'all'` includes the CPU, RAM, and vCPU control names, while title-gated mode keeps the current type-specific output. Assert that checked state remains false unless it was already saved true.

- [ ] **Step 3: Publish policy from the existing content settings bridge.**

  Keep the current dataset/event lifecycle and update it when settings change. Do not expose credentials or query values; only the host/policy result is published.

- [ ] **Step 4: Update both modal call sites to pass policy.**

  Direct Grafana reads the policy from the existing dataset. DashBridge controller receives the same normalized policy through its existing settings dependency. Both call the shared modal renderer.

- [ ] **Step 5: Render the full existing controls in all mode.**

  Refactor only the visibility condition in `transformFields`; retain existing control names, state serialization, parent-child disabling, mutually exclusive filters, and save callbacks.

- [ ] **Step 6: Run focused modal/runtime tests and syntax checks.**

  ```powershell
  & 'C:\Program Files\nodejs\node.exe' test/grafana_panel_tools_behavior.js
  & 'C:\Program Files\nodejs\node.exe' test/dashbridge_panel_tools_controller_behavior.js
  & 'C:\Program Files\nodejs\node.exe' --check js/content/content.js
  & 'C:\Program Files\nodejs\node.exe' --check js/content/grafana-panel-tools.js
  ```

- [ ] **Step 7: Commit only Task 3 files.**

  ```powershell
  git add js/content/content.js js/content/grafana-panel-tools.js pages/dashbridge/dashbridge-panel-tools-controller.js js/shared/grafana-panel-settings-modal.js test
  git commit -m "feat: show panel functions by host policy"
  ```

### Task 4: Documentation, dependency guards, and release verification

**Files:**
- Modify: `docs/architecture.md` — document the host policy owner and safe fallback.
- Modify: `docs/roadmap.md` only if a live Grafana smoke check remains unavailable.
- Test: existing full guard/test suite; no new production module.

- [ ] **Step 1: Update architecture documentation to match the implemented policy.**

  Document that panel semantic classification is title-gated only for `mon-dc.mos.ru` by default, full mode is explicit, and panel IDs remain state keys rather than semantic classifiers.

- [ ] **Step 2: Run structural checks.**

  ```powershell
  & 'C:\Program Files\nodejs\node.exe' scripts/check-module-boundaries.js
  & 'C:\Program Files\nodejs\node.exe' scripts/check-dependency-contracts.js
  git diff --check
  ```

- [ ] **Step 3: Run all targeted tests together.**

  ```powershell
  & 'C:\Program Files\nodejs\node.exe' test/grafana_settings_behavior.js
  & 'C:\Program Files\nodejs\node.exe' test/grafana_panel_analysis_behavior.js
  & 'C:\Program Files\nodejs\node.exe' test/grafana_panel_tools_behavior.js
  & 'C:\Program Files\nodejs\node.exe' test/dashbridge_panel_tools_controller_behavior.js
  & 'C:\Program Files\nodejs\node.exe' test/extension_package_integrity_behavior.js
  ```

- [ ] **Step 4: Run the full suite with the configured Python runtime.**

  ```powershell
  $env:DASHBRIDGE_PYTHON = 'C:\Users\Vanya\AppData\Local\Programs\Python\Python314\python.exe'
  & 'C:\Program Files\nodejs\npm.cmd' run test:all
  ```

  Record unrelated pre-existing failures separately; do not claim a full pass if any remain.

- [ ] **Step 5: Run GitNexus change detection and inspect the final diff.**

  ```powershell
  & 'C:\Users\Vanya\AppData\Roaming\npm\gitnexus.cmd' detect-changes --repo DashBridge --scope all --limit 100
  git diff --stat
  git status --short
  ```

- [ ] **Step 6: Perform browser smoke checks when Grafana access is available.**

  Verify direct Grafana and DashBridge iframe panels for `mon-dc.mos.ru` and a second host. If the second host is unavailable, report this limitation and keep the runtime tests as the verified evidence.

- [ ] **Step 7: Commit documentation and final verification separately.**

  ```powershell
  git add docs/architecture.md docs/roadmap.md
  git commit -m "docs: document panel function visibility policy"
  ```

## Plan self-review

- Spec coverage: defaults, host equality, explicit override, invalid URL fallback, title compatibility, panel-ID independence, unchanged Batch scope, tests, and live smoke limitation each have a task.
- Placeholder scan: no TODO/TBD/“implement later” placeholders are present.
- Interface consistency: the new settings key, policy helper, and modal policy argument are named consistently across tasks.
- Commit isolation: existing `pages/batch/batch-panel-loader.js` changes remain unstaged and are not included in these commits.
