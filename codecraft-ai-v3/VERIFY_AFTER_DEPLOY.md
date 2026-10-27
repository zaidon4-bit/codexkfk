# Verify after deploying v0.5

1. Confirm `/api/health` returns `{ "ok": true, ... }` and log in.
2. Open Settings & account → Tools & reasoning diagnostics → Run full diagnostics. It can send up to eight provider requests and may consume quota.
3. For each thinking level, check **parameter sent** and **reasoning evidence**:
   - `confirmed_by_usage`: positive reasoning token count was explicitly reported.
   - `not_verified`: provider reported zero reasoning tokens; this is not proof of ignored parameters.
   - `not_verifiable`: provider did not return a usable reasoning-token count.
   - `not_configured`: no reasoning parameter was applied.
4. If a parameter is rejected (HTTP 400), set exact field names and values in Admin → System prompt per model using the provider's current documentation.
5. `build`, `test`, `lint`, and `typecheck` require real scripts in the customer's own workspace `package.json`. Missing scripts are reported without running npm.
6. Keep `ENABLE_WORKSPACE_COMMANDS=false` on public Render. The project does not include a true OS/container sandbox. Do not enable it simply to make `run_command` work.
7. Persistent storage is still required for durable SQLite/session/workspace data; `/tmp` remains ephemeral.
