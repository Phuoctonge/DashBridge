# DashBridge tests

Run the complete dependency-free suite with:

```powershell
node test/run-all-tests.js
```

Set `DASHBRIDGE_PYTHON` when Python is not available on `PATH`.

The combined runner executes module-size, documentation-link and dependency-contract guards before the JS/Python suites. These guards check file structure and declared contracts; they do not prove live renderer, clipboard or authenticated API behavior.

## Conventions

- `*_behavior.js` files are executable Node behavior tests and are discovered automatically.
- Root `audit_*.py`, `security_*.py`, and `smoke_*.py` files are executable Python checks and are discovered automatically.
- Shared Python code belongs in `test/support`; support modules are never counted as tests.
- `analyze_e2e_*.js` and `devtools-e2e-*.js` are manual diagnostic tools, not automated tests.
- Browser fixtures belong in `test/fixtures`.

Use `node test/run-js-tests.js --list` or `node test/run-python-smoke-tests.js --list` to inspect discovery without executing tests. The combined `node test/run-all-tests.js --list` still executes module, documentation, and dependency guards before listing the JS/Python suites.

## Full development check

`npm run test:all` adds ESLint and the Chromium extension-page smoke to the dependency-free suite. Install dependencies and the browser first as described in [the development guide](../docs/development-guide.md). Browser smoke does not replace authenticated live Grafana checks.

Installer changes additionally require `pwsh ./scripts/Install-DashBridge.ps1 -SelfTest` and `pwsh ./test/installer_regressions.ps1`; these are separate from `npm run test:all`.

## Live evidence and scope

`npm run test:browser` runs the real unpacked extension in a temporary Chromium profile with local fixtures. Authenticated Grafana checks use separate persistent profiles and explicit URLs; the commands and setup are documented in [the development guide](../docs/development-guide.md#проверка-изменения). `test:grafana:live` drives the extension Test Runner; `test:live:check`, `test:live:scenario`, `test:live:smoke` and `test:live:matrix` are a separate opt-in bounded capability harness. None of these live commands is included in `test:all`. A `blocked` environment is not a successful test or proof of a production defect.

For MAIN changes, verify that the live browser actually loaded the current runtime. In the locally tested unpacked profile, extension/page reload retained earlier registered MAIN code; a full orderly restart of that separate browser profile resolved the mismatch. See [transport wrapper verification](../docs/development-guide.md#ранние-transport-wrappers). This is a verified recovery path for that environment, not a universal Chromium requirement.

Confluence Report's local [apply](confluence_report_apply_behavior.js) and [storage](confluence_report_storage_behavior.js) tests cover exact original image targets, invalid-target rejection before upload and post-save verification failure. They mock the transport boundary; they do not execute attachment POST or page PUT against a live Confluence session.
