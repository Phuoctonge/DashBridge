# DashBridge Extension Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve desktop visual behavior from 1024px through 8K without changing extension runtime ownership or storage contracts.

**Architecture:** Keep existing page controllers and shared theme ownership. Apply focused CSS changes to Worklog and Options, then verify the entire page matrix with Playwright browser smoke. Defer functional smoke failures to the final task.

**Tech Stack:** MV3 extension pages, classic-script HTML, CSS, Playwright Chromium, Node test runners.

**Spec:** `docs/superpowers/specs/2026-09-21-extension-visual-polish-design.md`

## Global Constraints

- Desktop only: 1024px and wider; mobile behavior is out of scope.
- Do not change Grafana MAIN/isolated runtime, storage schema, permissions, or message contracts.
- Reuse existing theme tokens and page owners; no new production JS module.
- Preserve modal focus/Escape and `uiScale` behavior.

### Task 1: Establish visual regression assertions

**Files:**
- Modify: `test/run-extension-browser-smoke.js`
- Test output: `test-results/viewport-sweep.json`

- [ ] Add assertions for page-level `scrollWidth <= innerWidth` at the desktop matrix sizes.
- [ ] Add a Worklog assertion that any overflow is contained by `.table-container`, not the document.
- [ ] Run the targeted browser test and record the expected baseline failure for the new Worklog assertion.

### Task 2: Improve Worklog scroll ownership

**Files:**
- Modify: `pages/worklog/worklog.css`

- [ ] Add `scrollbar-gutter: stable` and `overscroll-behavior-x: contain` to `.table-container`.
- [ ] Preserve the existing sticky action column and readable `min-width` table contract.
- [ ] Run the targeted browser test and verify Worklog passes at 1024px and 1280px.

### Task 3: Improve Options large-desktop geometry

**Files:**
- Modify: `pages/options/options.css`

- [ ] Add a large-desktop container rule that widens the centered form only within a readable maximum.
- [ ] Keep all controls and storage behavior unchanged.
- [ ] Verify 1920px, 3840px, and 7680px screenshots for readable density and no page overflow.

### Task 4: Run full verification matrix

**Files:**
- No production files beyond Tasks 1–3.

- [ ] Run `node scripts/check-module-boundaries.js`.
- [ ] Run `node test/run-all-tests.js`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test:browser` and inspect the fresh JSON report/screenshots.
- [ ] Re-run the custom 8-size viewport matrix and compare Worklog/Options/DashBridge evidence.

### Task 5: Deferred functional smoke failures

**Files:**
- Inspect first: `js/shared/dashbridge-profile-store.js`, `test/support/browser-dashboard-visual.js`, related tests.

- [ ] Reproduce profile clone/save failure on clean storage and add a failing regression test.
- [ ] Fix the profile commit/fixture issue without changing visual scope.
- [ ] Reproduce the SLA template mismatch and decide whether implementation or expectation is authoritative.
- [ ] Add the corresponding regression test and run the full verification matrix again.
