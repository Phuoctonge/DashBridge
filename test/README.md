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

Use `--list` with either runner or the combined runner to inspect discovery without executing tests.
