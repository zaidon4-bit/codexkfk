# CodeCraft AI v0.5 verified-diagnostics upgrade

## Deploy

1. Replace the contents of the repository's `codecraft-ai-v3/` folder with this folder's contents.
2. Commit and push the change so Render deploys the new commit.
3. Keep Render build command `npm install --include=dev && npm run build` and start command `npm start`.
4. Keep existing Render secrets and environment variables. Do not rotate `APP_ENCRYPTION_KEY` during this code update; changing it can make previously stored provider API keys unreadable.
5. After deployment, sign in as a user with an API assigned and open **Settings & account → Tools & reasoning diagnostics → Run full diagnostics**.

The diagnostic performs safe workspace checks and up to eight live provider API requests. Live checks can consume provider quota. Check results individually; a request accepted by a gateway does not prove that the gateway honored the reasoning parameter.

## Safety and limits

- `ENABLE_WORKSPACE_COMMANDS=false` is deliberate. Command checks will show `SKIPPED` until enabled, and this switch must not be turned on for a public deployment unless commands run inside a properly isolated sandbox.
- `check_code` parses JavaScript (`.js`, `.mjs`, `.cjs`) and JSON without executing project code. It explicitly skips JSX/TypeScript; these need the project's real build/test tooling.
- Web search, MCP server integration, LSP diagnostics, parallel subagents, Git worktrees and plugin lifecycle are not implemented in this build. Diagnostics identify them as `NOT_IMPLEMENTED` rather than claiming they work.
- For ODiRouter Gemini 2.5 Pro, X High maps to High, the highest supported reasoning-effort level for that model. Deep mode requests a separate 10,000-token thinking budget. Long mode sets a maximum output-token cap of 10,000; it cannot guarantee a 10,000-token minimum response.
- `/tmp` storage is temporary. If the deployed service currently uses `/tmp/codecraft-ai-data`, data may be lost on restart/redeploy. This code update does not migrate the database or add persistent storage.


## v0.5 verification improvements

- Local diagnostics now test path traversal, symlink rejection, NUL/binary-file rejection, and the 300 KB read/delete boundary using temporary fixtures that are cleaned up.
- New text writes reject NUL bytes rather than creating files that later read operations cannot handle.
- Provider diagnostics report reasoning evidence separately from a parameter merely being sent; zero/missing usage fields are not described as proof the parameter was ignored.
- Unknown providers no longer get an assumed `max_completion_tokens` output field. Configure the exact field per model/provider.
- `build`, `test`, `lint`, and `typecheck` check for the matching non-empty workspace `package.json` script before running npm; missing scripts produce a clear `NOT CONFIGURED` response.
- The direct command panel now requests explicit browser confirmation and uses the same preflight. Command execution is still disabled by default and must not be enabled on public Render without a real isolated sandbox.
