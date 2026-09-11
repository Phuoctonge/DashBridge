# DashBridge tests

Run the complete dependency-free suite with:

```powershell
node test/run-all-tests.js
```

Set `DASHBRIDGE_PYTHON` when Python is not available on `PATH`.

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
