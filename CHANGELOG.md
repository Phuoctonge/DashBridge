# Changelog

## Unreleased

- Sent DashBridge absolute time ranges as epoch milliseconds so Grafana solo panels query the selected period even when the saved source URL uses ISO dates.
- Preserved exact Confluence image targets and insertion anchors from the original storage scan through Apply, then verified page version and the full image-reference sequence after save.
- Waited for successful profile commits before completing panel addition; retained drafts and rejected stale completions.
- Rejected missing or non-numeric Grafana table response values before numeric conversion and evaluated table SLA from complete current native data.
- Preserved native Table/Grid geometry during compact capture and recognized populated native tables in Batch readiness.
- Waited for the current Batch Series navigation before discovery, including panel-ID fallback.
- Corrected shared Flot style baselines and resized relocated legends across native View transitions.
- Released Grafana clipboard hooks on scope revocation and rejected invalid or stale picker actions.
- Isolated local browser smoke fixtures, including release metadata and Jira startup responses, from external services.

## 2.4.4

- Added configurable Grafana summary columns with a master edit toggle.
- Added Mean, Max, Min, Total and Last column discovery and persistence.
- Added Last-value formatting, sorting, stable SVG sort indicators and remount recovery.
- Added independent vCPU legend column handling for Load Average panels, including Flot compatibility.
- Improved legend layout, fixed-width numeric columns and header alignment in DashBridge iframes.
- Hardened panel settings schema, runtime manifest wiring and migration compatibility.
- Updated architecture documentation and regression coverage for legend/runtime contracts.
- Fixed Grafana legend filtering, renderer lifecycle and syntax regressions found during full external test runs.

## 2.3.4 → 2.4.3

- Added DashBridge dashboard profiles, migrations, CAS-safe persistence and cross-tab synchronization.
- Added Batch capture, report generation, SLA/threshold analysis and bounded diagnostics.
- Added Recorder/DashFlow workflows, HAR comparison and portable exports.
- Added Grafana uPlot/Flot support, panel tools, visual transforms, CPU/RAM handling and threshold overlays.
- Added responsive themed extension pages, accessibility lifecycle handling and browser smoke coverage.
- Hardened sender/origin/host validation, scoped DNR registration, capture cleanup and release packaging.
- Added Jira, Confluence, TDM and Worklog integrations with bounded retries and safe external rendering.
