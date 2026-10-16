# DashBridge 2.4.4 Release Readiness Implementation Plan

> Изменение 2026-10-16: отдельный `CHANGELOG.md` удалён по решению пользователя;
> описание изменений на русском хранится в GitHub Releases и передаётся workflow
> аннотацией тега. Упоминания CHANGELOG ниже сохранены как часть исходного плана.

> **Статус на 2026-10-13:** Частично завершён; это исторический release-план, не разрешение повторно исправлять уже интегрированный код или создавать тег. Позднейшие RAM/Table/clipboard, local smoke и renderer fixes описаны в плане аудита 12 октября. Автономный набор прошёл до этой prose-ревизии, но installer/supply-chain/package/full live gate и решение о публикации требуют собственного актуального evidence.
> Действующие контракты: [архитектура](../../architecture.md), [разработка](../../development-guide.md); актуальные остатки: [roadmap](../../roadmap.md). Нижние шаги и команды сохранены как исходный план; перед продолжением сверять их с кодом и текущими владельцами.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подготовить DashBridge 2.4.4 к выпуску так, чтобы обязательные локальные и CI-проверки были зелёными, упаковка была воспроизводимой, а заявленная Grafana/uPlot/Flot/capture-совместимость имела живое подтверждение.

**Architecture:** Сначала исправляются детерминированные blockers (lint, smoke-contract drift, generated-profile isolation и RAM patch), затем проверяются modal/DNR lifecycle и живые renderer-сценарии. Большие MAIN-модули не дробятся механически: state, observers и cleanup остаются у владельца; выносятся только чистые независимые части либо обновляется документированный budget с причиной.

**Tech Stack:** Chrome MV3, classic JavaScript, Node.js 22+, ESLint 10, Playwright Chromium, Python smoke checks, PowerShell installer tests, GitNexus.

**Spec:** `docs/architecture.md`, `docs/development-guide.md`, `docs/permission-map.md`, `docs/roadmap.md`, `.github/workflows/release.yml`.

## Global Constraints

- Перед правкой читать `architecture.md`, профильный документ и `development-guide.md`.
- Для MAIN/renderer/capture правок обязательны direct Grafana и DashBridge iframe проверки, uPlot и Flot.
- Для каждого bugfix сначала написать падающий тест и увидеть RED.
- Не делить state machine, transport wrapper, observer и cleanup разных владельцев по признаку размера.
- Release ZIP содержит только `manifest.json`, `icons`, `js`, `pages`, `vendor`.
- `manifest.json`, `package.json`, README badge, CHANGELOG и Git tag имеют одну версию.
- `npm run lint`, `node test/run-all-tests.js`, `npm run test:browser`, installer tests и supply-chain checks должны иметь код 0.

---

### Task 1: Зафиксировать baseline и GitNexus-контекст

**Files:**
- Read: `AGENTS.md`, `docs/architecture.md`, `docs/permission-map.md`, `docs/development-guide.md`, `docs/module-design.md`, `docs/roadmap.md`, `.github/workflows/release.yml`
- Read: `scripts/module-size-budgets.json`, `package.json`, `manifest.json`
- Output: `test-results/release-baseline/` (local only)

**Interfaces:**
- Consumes: checkout and GitNexus index.
- Produces: список FAIL/SKIP/BLOCKED для следующих задач.

- [ ] **Step 1: Check Git and versions.**

```powershell
git status --short
git log -20 --oneline --decorate
node -p "require('./package.json').version"
node -p "require('./manifest.json').version"
rg -n "version-2\\.4\\.|extensionVersion.*2\\.4\\." README.md CHANGELOG.md docs manifest.json package.json
```

- [ ] **Step 2: Refresh GitNexus without file injection.**

```powershell
& 'C:\Users\Vanya\AppData\Roaming\npm\gitnexus.cmd' analyze --index-only --workers 2
& 'C:\Users\Vanya\AppData\Roaming\npm\gitnexus.cmd' detect-changes -r 'D:\Work\Automation\DashBridge'
```

Если analyzer не завершается за bounded timeout, сохранить его вывод и считать индекс вспомогательным evidence; отсутствие символа не считать отсутствием consumer.

- [ ] **Step 3: Save baseline locally.**

```powershell
New-Item -ItemType Directory -Force test-results/release-baseline | Out-Null
& 'C:\Program Files\nodejs\node.exe' test/run-all-tests.js *> test-results/release-baseline/unit.txt
```

- [ ] **Step 4: Verify no release artifacts are staged.**

```powershell
git diff --check
git status --short
```

### Task 2: Finish the RAM transform patch

**Files:**
- Modify: `js/content/grafana-panel-data-transforms.js:195-220`
- Test: `test/grafana_mem_conversion_atomic_behavior.js`
- Test: `test/grafana_metric_keyword_literal_behavior.js`
- Test: `test/grafana_memory_unit_restore_behavior.js`

**Interfaces:**
- Consumes: `transformMemData(data)` and existing `serverFrames` correlation.
- Produces: removal of only selected Total/Available source fields while preserving unrelated fields/frames.

- [ ] **Step 1: Run RED.**

```powershell
& 'C:\Program Files\nodejs\node.exe' test/grafana_mem_conversion_atomic_behavior.js
```

The pre-fix assertion must fail on `free slots`.

- [ ] **Step 2: Confirm impact.**

```powershell
& 'C:\Users\Vanya\AppData\Roaming\npm\gitnexus.cmd' context -r 'D:\Work\Automation\DashBridge' transformMemData
& 'C:\Users\Vanya\AppData\Roaming\npm\gitnexus.cmd' impact -r 'D:\Work\Automation\DashBridge' transformMemData --direction upstream --summary-only
```

- [ ] **Step 3: Implement the minimal fix.**

Use a `Set` of `item.totalField.field` and `item.availField.field`; remove only those field indexes and matching `data.values` indexes. Preserve a frame when a non-time field remains. Do not use generic `free/used/available/total` fallback deletion.

- [ ] **Step 4: Verify GREEN.**

```powershell
& 'C:\Program Files\nodejs\node.exe' test/grafana_mem_conversion_atomic_behavior.js
& 'C:\Program Files\nodejs\node.exe' test/grafana_metric_keyword_literal_behavior.js
& 'C:\Program Files\nodejs\node.exe' test/grafana_memory_unit_restore_behavior.js
& 'C:\Program Files\nodejs\node.exe' test/grafana_panel_analysis_behavior.js
```

- [ ] **Step 5: Commit the isolated patch.**

```powershell
git add js/content/grafana-panel-data-transforms.js test/grafana_mem_conversion_atomic_behavior.js
git commit -m "fix: preserve unrelated metrics during RAM conversion"
```

### Task 3: Close ESLint and syntax blockers

**Files:**
- Modify: `scripts/check-visible-grafana-cdp.js:20-30`
- Test: `npm run lint`, `node --check`

**Interfaces:**
- Consumes: Playwright `page.evaluate()` callback.
- Produces: same `{ apiUserStatus, url, path, authenticated }` JSON without Node lint false positives.

- [ ] **Step 1: Reproduce RED.**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run lint
```

- [ ] **Step 2: Change browser globals only.**

Inside the evaluated callback use `globalThis.location.href` and `globalThis.location.pathname`, preserving the `/api/user`, status 200 and `/login` checks.

- [ ] **Step 3: Verify GREEN.**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\node.exe' --check scripts/check-visible-grafana-cdp.js
```

- [ ] **Step 4: Commit.**

```powershell
git add scripts/check-visible-grafana-cdp.js
git commit -m "fix: lint visible Grafana CDP checker"
```

### Task 4: Stabilize deterministic JS/Python smoke contracts

**Files:**
- Modify/Test: `test/extension_package_integrity_behavior.js`, `scripts/check-dependency-contracts.js`
- Modify/Test: `test/popup_initial_layout_behavior.js`, `test/responsive_layout_behavior.js`
- Modify/Test: `test/smoke_batch_audit_regressions.py`, `test/smoke_batch_worklog_workflows.py`, `test/smoke_dashbridge_lazy_iframes.py`, `test/smoke_popup_contracts.py`

**Interfaces:**
- Consumes: production HTML/CSS/JS contracts.
- Produces: behavior-level checks that ignore only generated `.dashbridge-local`, `test-results`, `dist` and foreign Chrome assets.

- [ ] **Step 1: Reproduce every failure independently.**

```powershell
& 'C:\Program Files\nodejs\node.exe' test/extension_package_integrity_behavior.js
& 'C:\Program Files\nodejs\node.exe' test/popup_initial_layout_behavior.js
& 'C:\Program Files\nodejs\node.exe' test/responsive_layout_behavior.js
$env:DASHBRIDGE_PYTHON = 'C:\Users\Vanya\AppData\Local\Programs\Python\Python314\python.exe'
& 'C:\Program Files\nodejs\node.exe' test/run-python-smoke-tests.js
```

- [ ] **Step 2: Classify each failure.**

Package integrity must exclude generated profiles. Icon/layout/header checks must use semantic selectors or documented invariants instead of whitespace-sensitive strings. Timeout/archive checks must assert the public deadline and cap, not literal formatting.

- [ ] **Step 3: Add one RED assertion per classified contract.**

Each assertion must fail on the old source for the intended reason: missing icon, missing layout invariant, missing timeout/observer cleanup or missing archive cap.

- [ ] **Step 4: Change only the owner.**

Change production only when the browser-visible behavior is wrong; otherwise update the brittle test helper. Keep Batch loader, archive owner and popup section owner unchanged.

- [ ] **Step 5: Verify and commit.**

```powershell
& 'C:\Program Files\nodejs\node.exe' test/run-js-tests.js
& 'C:\Program Files\nodejs\node.exe' test/run-python-smoke-tests.js
git add test scripts
git commit -m "test: stabilize release smoke contracts"
```

### Task 5: Resolve browser modal and DNR smoke failures

**Files:**
- Test: `test/run-extension-browser-smoke.js`, `test/support/browser-grafana-connection.js`, `test/support/browser-dashboard-visual.js`
- Inspect/modify only after RED: `pages/shared/modal-accessibility.js`, `pages/dashbridge/dashbridge-modal.js`, `pages/dashbridge/dashbridge.js`
- Test: `test/dashbridge_modal_behavior.js`, `test/dashbridge_page_ui_controller_behavior.js`

**Interfaces:**
- Consumes: one clean Playwright extension context, modal owner lifecycle and tab-scoped DNR owner.
- Produces: deterministic Escape cancellation, per-tab DNR cleanup and no failure cascade.

- [ ] **Step 1: Run browser smoke with an empty generated profile.**

```powershell
$env:DASHBRIDGE_SMOKE_SETTLE_MS='0'
& 'C:\Program Files\nodejs\npm.cmd' run test:browser
```

- [ ] **Step 2: Instrument the failing Escape case.**

Before Escape record visible `.modal-overlay` count, z-index and visible cancel controls. RED must distinguish topmost-modal selection from stale storage/page state.

- [ ] **Step 3: If production is wrong, write a failing modal test first.**

The topmost `.modal-overlay` must route Escape to `.modal-cancel`; hidden `#modalOverlay` or lower nested surfaces must not consume it.

- [ ] **Step 4: Verify DNR cleanup per tab.**

Assert zero rules for closed test tab IDs, rather than global zero while another valid fixture tab owns a rule.

- [ ] **Step 5: Verify no cascade.**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:browser
Get-Content -Raw test-results/extension-smoke.json | ConvertFrom-Json | Select-Object -ExpandProperty summary
```

Expected summary: `failed: 0`, `consoleWarnings: 0`.

- [ ] **Step 6: Commit.**

```powershell
git add test pages/shared pages/dashbridge
git commit -m "test: make browser release smoke deterministic"
```

### Task 6: Close module budgets without splitting lifecycle owners

**Files:**
- Modify: `scripts/module-size-budgets.json`, or
- Modify/Create only after boundary review: `js/content/grafana-panel-tools.js`, `js/content/grafana-panel-data-runtime.js`, `js/content/grafana-legend-visuals.js` and a pure focused module
- Test: `scripts/check-module-boundaries.js`, `scripts/check-dependency-contracts.js` and affected behavior tests

**Interfaces:**
- Consumes: classic-script runtime order and existing facades.
- Produces: zero budget errors, unchanged globals/actions/events/storage keys and one owner per cleanup lifecycle.

- [ ] **Step 1: Run impact and exact contract search before moves.**

```powershell
& 'C:\Users\Vanya\AppData\Roaming\npm\gitnexus.cmd' context -r 'D:\Work\Automation\DashBridge' create
& 'C:\Users\Vanya\AppData\Roaming\npm\gitnexus.cmd' detect-changes -r 'D:\Work\Automation\DashBridge'
rg -n "CustomEvent|storage|runtime\.sendMessage|data-action|id=|script src" js pages manifest.json
```

- [ ] **Step 2: Prefer a documented budget correction when no independent owner exists.**

Update the exception only with measured current size, lifecycle reason and a bounded margin; do not invent a proxy module.

- [ ] **Step 3: Split only pure independent code.**

Allowed boundary: calculation/adapter with no mutable state, observers, timers, renderer instances or cleanup registry. Update runtime manifest and facade tests after any move.

- [ ] **Step 4: Verify and commit.**

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts/check-module-boundaries.js
& 'C:\Program Files\nodejs\node.exe' scripts/check-dependency-contracts.js
& 'C:\Program Files\nodejs\node.exe' test/grafana_legend_visuals_module_behavior.js
& 'C:\Program Files\nodejs\node.exe' test/grafana_panel_data_runtime_behavior.js
git add scripts/module-size-budgets.json js/content test
git commit -m "chore: close release module budget gate"
```

### Task 7: Supply chain, current-version documentation and package

**Files:**
- Modify: `package-lock.json` and possibly `package.json` only through a reviewed dependency update
- Modify: `docs/architecture.md`, `docs/permission-map.md`, `docs/development-guide.md`, `docs/analytics.md`
- Test: `npm audit`, `npm audit signatures`, documentation links and release archive checks

**Interfaces:**
- Consumes: version `2.4.4` and release workflow.
- Produces: no high audit vulnerability or explicitly documented dev-only exception, current docs, reproducible ZIP and hashes.

- [ ] **Step 1: Reproduce dependency tree.**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' audit --omit=optional --audit-level=high
& 'C:\Program Files\nodejs\npm.cmd' audit signatures
& 'C:\Program Files\nodejs\npm.cmd' ls brace-expansion --all
```

- [ ] **Step 2: Apply the smallest safe lockfile update.**

Run `npm audit fix` or a targeted update only after recording the current tree; rerun lint and unit tests because ESLint/minimatch changes affect tooling.

- [ ] **Step 3: Update current-contract docs.**

Change current runtime references from `2.4.3` to `2.4.4`; leave `docs/history/` historical entries unchanged.

- [ ] **Step 4: Build and verify package.**

```powershell
pwsh -NoProfile -File scripts/build-release.ps1 -ExpectedTag 'v2.4.4' -OutputDirectory dist-release
pwsh -NoProfile -File scripts/Install-DashBridge.ps1 -SelfTest
pwsh -NoProfile -File test/installer_regressions.ps1
```

Inspect ZIP entries and confirm absence of `test/`, `docs/`, `.dashbridge-local/`, `test-results/`, credentials and `.dashflow` files.

- [ ] **Step 5: Commit.**

```powershell
git add package.json package-lock.json docs
git commit -m "chore: align release dependencies and current docs"
```

### Task 8: Run the live Grafana acceptance matrix

**Files:**
- Read/modify only if needed: `scripts/run-live-grafana-e2e.js`, `pages/test-runner/test-runner-suite.js`, `pages/test-runner/test-runner-core.js`, `pages/test-runner/test-runner-diagnostics.js`
- Evidence: `test-results/live-grafana-e2e.json`, `test-results/live-capture-matrix/`
- Docs: `docs/roadmap.md`, `docs/architecture.md`

**Interfaces:**
- Consumes: authenticated stable dashboards for Grafana 10/Flot and Grafana 12/uPlot.
- Produces: PASS/BLOCKED/FAIL evidence for CPU, RAM, threshold, prepared PNG dimensions and restore on direct and iframe surfaces.

- [ ] **Step 1: Check session without exposing credentials.**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run check:grafana-session -- '<stable-dashboard-url>'
```

- [ ] **Step 2: Run fast profile.**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:grafana:live -- --mode=fast '<stable-dashboard-url>'
```

DNS/auth/renderer absence must be `BLOCKED`, never `PASS`.

- [ ] **Step 3: Run capture-focused cases.**

For each direct/iframe and uPlot/Flot environment verify CPU Idle→Load, RAM→% Used, prepared `1000×520` PNG, correlated result, no temporary frame/classes, restored scroll/styles/renderer geometry and no runtime errors.

- [ ] **Step 4: Run full matrix after fast passes.**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:grafana:live -- --mode=full '<grafana-10-url>' '<grafana-12-url>'
```

- [ ] **Step 5: Record only proven evidence.**

Remove roadmap items only after PASS; keep unavailable environments as BLOCKED with date and reason.

- [ ] **Step 6: Commit documentation evidence.**

```powershell
git add docs
git commit -m "docs: record release Grafana acceptance evidence"
```

### Task 9: Final release gate and tag decision

**Files:**
- Read/verify: `.github/workflows/release.yml`, `manifest.json`, `package.json`, `README.md`, `CHANGELOG.md`
- Output: `dist/DashBridge-2.4.4.zip` and hashes outside Git

**Interfaces:**
- Consumes: all previous task commits and live evidence.
- Produces: explicit GO/NO-GO decision for `v2.4.4`.

- [ ] **Step 1: Run complete gate.**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:all
pwsh -NoProfile -File scripts/Install-DashBridge.ps1 -SelfTest
pwsh -NoProfile -File test/installer_regressions.ps1
& 'C:\Program Files\nodejs\npm.cmd' audit --omit=optional --audit-level=high
& 'C:\Program Files\nodejs\npm.cmd' audit signatures
```

- [ ] **Step 2: Verify version and package.**

```powershell
pwsh -NoProfile -File scripts/build-release.ps1 -ExpectedTag 'v2.4.4' -OutputDirectory dist
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('manifest.json'));const p=JSON.parse(fs.readFileSync('package.json'));if(m.version!==p.version||m.version!=='2.4.4')process.exit(1);console.log(m.version)"
git diff --check
git status --short
```

- [ ] **Step 3: Check tracked generated/secrets.**

```powershell
git ls-files | rg "(^|/)(test-results|dist|\.dashbridge-local|\.worktrees|node_modules)(/|$)|\.dashflow$"
```

Expected output is empty.

- [ ] **Step 4: Tag only after all gates are green.**

```powershell
git tag -a v2.4.4 -m "DashBridge 2.4.4"
git show --stat --oneline v2.4.4
```

## Self-review

- Every observed failure has an owning task: lint (3), generated-profile and smoke drift (4), browser lifecycle/DNR (5), module budgets (6), dependency/docs/package (7), live evidence (8), final gate (9).
- The RAM patch keeps the existing `transformMemData(data)` API and has its own RED/GREEN cycle (2).
- Readiness behavior is not changed implicitly; any readiness change requires a separate failing test inside the live acceptance task.
- No task assumes stale GitNexus absence means unused code.
- No placeholder task text remains; each task names files, commands, expected behavior and a commit boundary.
