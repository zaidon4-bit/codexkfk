# CodeCraft AI implementation status — v0.4 diagnostics update

## Implemented in code

- Independent React/Express coding assistant and bounded model tool loop.
- Cookie-based login sessions; scrypt password hashing; admin bootstrap via environment.
- Admin-only console and API routes to create/disable users, assign per-user provider URL/model/API key, manage model-specific prompts, set monthly token allowances, and inspect usage events.
- AES-256-GCM encrypted provider API-key storage; masked-only key status in UI.
- Separate user workspace and JSON data directories, including file history, tasks, sessions, skills, and pending agent approvals.
- Model-specific admin system prompt selected server-side, with `*` fallback.
- Token usage meter and monthly token quota checks.
- Thinking levels Low/Medium/High/X High kept separate from Standard/Quick/Long/Deep response modes.
- Explicit approval for file writes, deletes, task creation, and allowlisted commands; commands remain disabled by default.
- Provider-aware reasoning mapping for ODiRouter Gemini 2.5 Pro, including Low/Medium/High and X High → High; Deep mode uses a thinking budget and Long mode sets a maximum output-token cap only when the provider field is configured/preset. Unknown providers no longer receive a guessed output field.
- Per-turn tool activity traces in chat, a read-only `check_code` tool for native JS syntax and JSON parse validation, and a Settings diagnostics endpoint that exercises safe workspace tools and can send optional live provider tests.
- Offline Node test coverage for provider parameter mapping, reasoning-evidence classification, command preflight safeguards, and tool definition contracts (`npm run verify`).
- Diagnostics now distinguish positive usage evidence from zero/missing reasoning-token usage; absent or zero counts are not falsely reported as proof that thinking was ignored.
- `build`/`test`/`lint`/`typecheck` preflight checks the user's workspace `package.json` and returns `NOT CONFIGURED` before invoking npm when the script is missing. Direct command-panel runs require explicit browser confirmation.

## Not implemented / not guaranteed

- 100% system-prompt compliance: no probabilistic model can guarantee this. Server authorization and tool validation provide independent controls.
- In-app money collection, provider-rate cost calculation, invoices, refunds, subscriptions, or payment processor integration. Current billing-related functionality is token metering and admin-set monthly token allowance only.
- Full MCP client management, web search, LSP process management, parallel subagents, Git worktrees, plugin lifecycle, isolated command sandbox, password reset / self-service password change. Diagnostics report the first six tool families as not implemented in this build.
- Provider-independent guarantee of reasoning levels. The specific provider field/value must be verified per model; gateway acceptance alone cannot prove reasoning effort was honored.
- Live ODiRouter function calling and reasoning behavior until the deployed Settings diagnostics are run with an assigned API. Local `npm run verify` passed; the Vite production build could not be run in this isolated workspace because the dependency install was not available.

## Production requirements

Use persistent storage for SQLite and per-user workspaces. Keep `APP_ENCRYPTION_KEY` stable and backed up securely. Do not enable command execution on a public service before implementing an OS/container sandbox. Configure HTTPS and secrets in the hosting provider, set a long bootstrap admin password, and test account isolation with two separate accounts before production.
