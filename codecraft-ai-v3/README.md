# CodeCraft AI — multi-user admin starter

An independent web-based coding assistant starter. It includes a React/Vite UI, Express API, tool-calling agent, per-user workspaces, cookie-based accounts, admin-managed per-user API configurations, model-specific system prompts, and token usage metering.

## Reasoning verification and command safety

- Thinking/output parameter names and value vocabularies are provider-specific. For accounts using multiple providers, configure the mapping in **Admin → System prompt per model** rather than applying one global `.env` field to all models.
- Unknown providers do not get a guessed output-token parameter. Set `AI_MAX_OUTPUT_FIELD` only when it is correct for every route that uses that environment variable.
- Diagnostics distinguish `confirmed_by_usage`, `not_verified` (the provider reported zero reasoning tokens), `not_verifiable` (the provider omitted a usable count), and `not_configured`. A missing/zero count does not prove the provider ignored the parameter; only the provider can guarantee that behavior.
- `build`, `test`, `lint`, and `typecheck` first require a matching non-empty script in the user's workspace `package.json`. Missing scripts are reported as `NOT CONFIGURED` without launching npm.
- The six command aliases remain `build`, `test`, `lint`, `typecheck`, `git-status`, and `git-diff-check`. Direct command execution requires an explicit confirmation and is still disabled by default. **Do not set `ENABLE_WORKSPACE_COMMANDS=true` on the public Render app**, because this project does not ship a true OS/container sandbox and project-defined npm scripts can execute arbitrary code.


## What is implemented

- Email/password login with scrypt password hashes and opaque HTTP-only sessions stored by hash.
- Admin bootstrap from environment variables on the first launch.
- Admin page to create/disable customer accounts, assign per-user HTTPS API endpoints, model IDs and API keys, set monthly token allowances, and inspect usage events.
- Per-user API keys encrypted at rest with AES-256-GCM. Keys are never returned to the UI after saving.
- Administrator-configurable system prompt for each model ID, plus `*` as the fallback prompt.
- The model-specific system prompt is injected server-side into both chat and agent calls.
- Each user has a distinct workspace and data directory for task/session/file history and pending tool approvals.
- Usage token metering and monthly token quota checks.
- Low / Medium / High / X High reasoning-effort controls, separate from Standard / Quick / Long / Deep response modes. The selected value is sent to the provider only when a supported/configured field mapping exists.
- Automatic request mapping for ODiRouter Gemini 2.5 Pro: `reasoning_effort` for Low / Medium / High; X High maps to the documented High ceiling. Deep mode requests a 10,000 thinking budget; Long mode requests an output-token maximum of 10,000 (not a minimum).
- Read/search workspace tools, a safe no-execution JavaScript/JSON syntax checker, approval-gated file writes/deletes/task creation/commands, sessions, tasks, rules and skills.
- Chat activity trace showing which tools were actually called and their result status.
- Settings → Tools & reasoning diagnostics: safe local workspace tests plus optional live provider tests for chat, function/tool calling, Low / Medium / High / X High, Deep and Long mode.

## Install locally (Termux or desktop)

Requires Node.js 20+. On Termux, install native build prerequisites before npm packages: `pkg install nodejs clang make python pkg-config -y`.

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `BOOTSTRAP_ADMIN_EMAIL` and a long `BOOTSTRAP_ADMIN_PASSWORD`. Set a random `APP_ENCRYPTION_KEY` (at least 32 characters; recommended command below) before saving user API keys:

```bash
openssl rand -hex 32
```

Put the output in `APP_ENCRYPTION_KEY`. Then run:

```bash
npm run dev
```

Open the Vite URL shown in the terminal and sign in with the bootstrap admin account. On the first startup, the admin is created only if the email does not already exist. Keep the database and encryption key backed up together; changing the encryption key makes stored provider keys undecryptable.

## Configure per-user providers

Open **Admin console → Users & API**, create a user, select them, and assign:

- Provider name (display label only)
- HTTPS base URL (the API's OpenAI-compatible base URL)
- exact model ID returned/accepted by the provider
- API key
- monthly token limit (`0` means unlimited)

The provider URL must be HTTPS. The API key is encrypted and then only a masked status is shown. If the customer should pay the provider directly, enter their own provider key. The app meters token usage, but this starter does not yet process in-app monetary payments or create financial invoices.

## Configure system prompts per model

Open **Admin console → System prompts**. Save a prompt for the exact model ID, e.g. `provider/model-slug`. Use `*` for the fallback prompt. The server chooses the prompt based on that user's assigned model. Project instructions and repository content are appended as untrusted context and should not be treated as instructions with greater authority.

A system prompt cannot be guaranteed to be followed 100% of the time by a probabilistic model. This implementation gives the administrator prompt system-level placement, adds application guardrails, and independently enforces file/command permissions on the server. Sensitive actions should never rely on prompt text alone.

## Reasoning mode and diagnostics

The UI exposes Low / Medium / High / X High separately from Standard / Quick / Long / Deep response modes. For ODiRouter Gemini 2.5 Pro, the app automatically sends `reasoning_effort`; X High maps to High because High is that model's documented ceiling. Deep mode requests a 10,000-token thinking budget. Other routes require a provider-supported mapping in the model prompt editor or environment variables. These settings describe the request, not a guarantee that a gateway honored it.

Go to **Settings & account → Tools & reasoning diagnostics → Run full diagnostics** to test workspace list/read/search/write/delete/task tools and, when a provider is assigned, run live API tests for basic chat, forced function calling, each thinking level, Deep mode, and Long mode. Live tests can consume API quota. Results distinguish failed calls from parameters that were not configured, and show request/usage details where the gateway returns them.

The current agent implements these eight tools: `list_files`, `read_file`, `search_files`, `check_code`, `write_file`, `delete_file`, `create_task`, and `run_command`. `check_code` validates native JavaScript syntax and JSON data without executing the source; it does not parse JSX/TypeScript. Write/delete/task/command actions require explicit user approval. `run_command` supports only allowlisted aliases (`build`, `test`, `lint`, `typecheck`, `git-status`, `git-diff-check`) and remains disabled by default; do not enable it on a public deployment until an OS/container sandbox is in place. Web search, MCP server management, LSP diagnostics, parallel subagents, Git worktrees, and plugin lifecycle are not implemented in this build. Diagnostics list those as not implemented rather than pretending they passed.

Long mode requests a maximum of 10,000 output tokens, not a minimum; the provider may cap or reject this parameter. Reasoning token counts are displayed only when returned by the API. A successful HTTP response cannot prove that a gateway did not silently ignore a parameter.

## Deployment notes

- Set Render build command to `npm install --include=dev && npm run build` and start command to `npm start`.
- Set `NODE_ENV=production`, admin bootstrap variables, and `APP_ENCRYPTION_KEY` as Render environment variables. After the first successful boot, keep the bootstrap credentials secure; rotate the admin password using an appropriate account-management workflow before public production.
- Attach a persistent disk at `/var/data` and set `APP_STORAGE_DIR=/var/data`. SQLite and each user workspace are stored below that one mounted directory (`/var/data/data` and `/var/data/workspace`). Without persistent storage, accounts, usage, API configuration, sessions, and workspaces may be lost on restart/redeploy.
- Do not enable `ENABLE_WORKSPACE_COMMANDS` on a public deployment until commands run inside a proper isolated sandbox with resource limits. Workspace separation alone is not an OS/container sandbox.
- Before public production, add password reset, admin password rotation UI, stronger external rate limiting, backups/restore testing, monitoring, explicit privacy/retention policy, payment processor integration if charging customers, and a sandbox for command execution.

## Checks

Run `npm run verify` for server syntax checks and offline unit tests for provider parameter mapping. Run `npm run build` after dependencies are installed to test the Vite production build. The offline tests do not contact ODiRouter; live provider verification must be run from the deployed Settings diagnostics page with an API assigned.
