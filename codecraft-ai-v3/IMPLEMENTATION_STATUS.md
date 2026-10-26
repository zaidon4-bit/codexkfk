# CodeCraft AI implementation status — v0.3

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

## Not implemented / not guaranteed

- 100% system-prompt compliance: no probabilistic model can guarantee this. Server authorization and tool validation provide independent controls.
- In-app money collection, provider-rate cost calculation, invoices, refunds, subscriptions, or payment processor integration. Current billing-related functionality is token metering and admin-set monthly token allowance only.
- Full MCP client management, web search, LSP process management, parallel subagents, Git worktrees, plugin lifecycle, isolated command sandbox, password reset / self-service password change.
- Provider-independent guarantee of reasoning levels. The specific provider field/value must be verified per model.
- End-to-end build/run test with installed dependencies (run `npm install`, `npm run check`, `npm run build`).

## Production requirements

Use persistent storage for SQLite and per-user workspaces. Keep `APP_ENCRYPTION_KEY` stable and backed up securely. Do not enable command execution on a public service before implementing an OS/container sandbox. Configure HTTPS and secrets in the hosting provider, set a long bootstrap admin password, and test account isolation with two separate accounts before production.
