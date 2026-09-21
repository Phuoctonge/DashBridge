# Confluence Report Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply validated ZIP-to-report mappings to Confluence 7.19.18 through the authenticated page session.

**Architecture:** A pure storage transformer changes only selected image nodes and appends explicitly requested additions. A page-context REST adapter uploads attachments and updates the page version using same-origin credentials. The UI owns confirmation, progress, partial-failure state, and post-save verification.

**Tech Stack:** MV3 extension page, classic scripts, Confluence REST API, Storage XHTML, Node behavior tests.

**Spec:** `docs/superpowers/specs/2026-09-18-report-image-replacement-design-ru.md`

## Global Constraints

- Use the authenticated Confluence tab as the same-origin request context.
- Preserve existing captions during replacement; captions are created only for additions.
- Set added/replaced images to `width="100%"` with automatic height.
- Keep uploaded attachments after a page-save failure and allow retry without re-upload.
- Never delete old attachments in the first implementation.

### Task 1: Storage XHTML transformation

**Files:** Create `pages/confluence-report/confluence-report-storage.js`; test `test/confluence_report_storage_behavior.js`.

- [ ] Write failing tests for replacing one attachment, preserving surrounding text, appending a caption plus image to an existing group, and rejecting ambiguous targets.
- [ ] Implement `transform(storageHtml, plan)` with DOMParser fallback-free validation, exact attachment matching, `ac:image` width `100%`, and structured result `{ html, changed, applied }`.
- [ ] Run the focused test and then the report tests.

### Task 2: REST apply orchestration

**Files:** Create `pages/confluence-report/confluence-report-apply.js`; test `test/confluence_report_apply_behavior.js`.

- [ ] Write failing tests for upload, update version increment, retry after save failure, and post-save verification.
- [ ] Implement `create({ uploadAttachment, updatePage, verifyPage })` with deterministic attachment reuse by filename, no deletion, and explicit partial failure states.
- [ ] Run focused tests.

### Task 3: Authenticated-tab REST adapter and UI

**Files:** Modify `pages/confluence-report/confluence-report.js`, `pages/confluence-report/confluence-report.html`, `pages/confluence-report/confluence-report.css`, and `js/shared/confluence-report-live-client.js`.

- [ ] Add an explicit `Применить изменения в Confluence` button disabled until a valid plan exists.
- [ ] Add page-context GET/POST/PUT helpers using same-origin credentials and multipart attachment upload with `X-Atlassian-Token: no-check`.
- [ ] Build apply plans from mapping connections and additions; preserve uploaded attachment IDs for retry.
- [ ] Show progress, partial upload/save failures, and verification result.
- [ ] Run syntax, focused behavior tests, dependency checks, and `git diff --check`.

### Task 4: Verification

- [ ] Run all report behavior tests and the Node runner.
- [ ] Perform a read-only live scan against the authorized page; do not press Apply without explicit user confirmation in the live environment.
- [ ] Document any Confluence-instance-specific markup limitation.
